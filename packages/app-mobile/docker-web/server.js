const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { URLSearchParams } = require('url');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || '3000');
const sessionCookieName = 'joplin_web_session';
const vaultCookieName = 'joplin_web_vault';
const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;
const distDir = path.join(__dirname, 'public');
const vaultsDir = path.join(__dirname, 'vaults');
const vaultsRegistryPath = path.join(vaultsDir, 'registry.json');
const sessionSecretPath = path.join(vaultsDir, '.session-secret');

// Ensure vaults directory exists.
if (!fs.existsSync(vaultsDir)) fs.mkdirSync(vaultsDir, { recursive: true });

// Session secret: use explicit env var if it's a real (non-placeholder) value.
// Otherwise, generate a random secret and persist it to the vaults volume so
// it survives container restarts but is unique per deployment. This prevents
// session cookies from being valid across different machines.
const defaultPlaceholders = ['test-session-secret', 'change-this-session-secret', ''];
const envSecret = process.env.APP_SESSION_SECRET || process.env.NEXTAUTH_SECRET || '';
const resolveSessionSecret = () => {
	if (envSecret && !defaultPlaceholders.includes(envSecret)) return envSecret;
	try {
		const persisted = fs.readFileSync(sessionSecretPath, 'utf8').trim();
		if (persisted) return persisted;
	} catch {
		// File doesn't exist yet.
	}
	const generated = crypto.randomBytes(48).toString('base64url');
	fs.writeFileSync(sessionSecretPath, generated, 'utf8');
	return generated;
};
const sessionSecret = resolveSessionSecret();

const loginBackground = {
	dark: '#0a0a0f',
	light: '#eef2f7',
};

const appHeaders = {
	'X-Frame-Options': 'SAMEORIGIN',
	'X-Content-Type-Options': 'nosniff',
};

const contentTypes = {
	'.css': 'text/css; charset=utf-8',
	'.gif': 'image/gif',
	'.html': 'text/html; charset=utf-8',
	'.ico': 'image/x-icon',
	'.jpg': 'image/jpeg',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ttf': 'font/ttf',
	'.txt': 'text/plain; charset=utf-8',
	'.wasm': 'application/wasm',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
};

const isPublicAppAsset = requestPath => {
	return requestPath === '/app/manifest.json'
		|| requestPath === '/app/serviceWorker.bundle.js'
		|| requestPath.startsWith('/app/icons/')
		|| requestPath.startsWith('/app/screenshots/');
};

const readPasswordConfig = () => {
	const plainPassword = process.env.APP_PASSWORD || '';
	const hashedPassword = process.env.APP_PASSWORD_HASH || '';

	if (!plainPassword && !hashedPassword) {
		throw new Error('Set APP_PASSWORD or APP_PASSWORD_HASH before starting the server.');
	}

	return {
		plainPassword,
		hashedPassword,
	};
};

const passwordConfig = readPasswordConfig();

const toBase64Url = value => Buffer.from(value).toString('base64url');
const fromBase64Url = value => Buffer.from(value, 'base64url').toString('utf8');

const sign = value => crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');

const createSessionCookie = () => {
	const payload = JSON.stringify({
		expiresAt: Date.now() + sessionTtlMs,
	});
	const encodedPayload = toBase64Url(payload);
	const signature = sign(encodedPayload);
	return `${encodedPayload}.${signature}`;
};

const parseCookies = request => {
	const cookieHeader = request.headers.cookie || '';
	const output = {};

	for (const cookie of cookieHeader.split(';')) {
		const [rawName, ...rawValue] = cookie.trim().split('=');
		if (!rawName) continue;
		output[rawName] = decodeURIComponent(rawValue.join('='));
	}

	return output;
};

const isAuthenticated = request => {
	const cookies = parseCookies(request);
	const cookieValue = cookies[sessionCookieName];
	if (!cookieValue) return false;

	const parts = cookieValue.split('.');
	if (parts.length !== 2) return false;

	const [payload, signature] = parts;
	const expectedSignature = sign(payload);
	const givenBuffer = Buffer.from(signature);
	const expectedBuffer = Buffer.from(expectedSignature);
	if (givenBuffer.length !== expectedBuffer.length) return false;
	if (!crypto.timingSafeEqual(givenBuffer, expectedBuffer)) return false;

	try {
		const parsed = JSON.parse(fromBase64Url(payload));
		return typeof parsed.expiresAt === 'number' && parsed.expiresAt > Date.now();
	} catch (error) {
		return false;
	}
};

const setCookie = (response, value, maxAgeSeconds) => {
	const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
	response.setHeader('Set-Cookie', `${sessionCookieName}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${secure}`);
};

const appendCookie = (response, cookieValue) => {
	const existing = response.getHeader('Set-Cookie');
	if (!existing) {
		response.setHeader('Set-Cookie', cookieValue);
		return;
	}
	response.setHeader('Set-Cookie', Array.isArray(existing) ? [...existing, cookieValue] : [existing, cookieValue]);
};

const setVaultCookie = (response, value, maxAgeSeconds) => {
	const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
	appendCookie(response, `${vaultCookieName}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${secure}`);
};

const clearCookie = response => {
	response.setHeader('Set-Cookie', `${sessionCookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
};

const clearVaultCookie = response => {
	appendCookie(response, `${vaultCookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
};

const createVaultCookie = vaultId => {
	const payload = JSON.stringify({
		vaultId,
		expiresAt: Date.now() + sessionTtlMs,
	});
	const encodedPayload = toBase64Url(payload);
	const signature = sign(encodedPayload);
	return `${encodedPayload}.${signature}`;
};

const openedVaultId = request => {
	const cookies = parseCookies(request);
	const cookieValue = cookies[vaultCookieName];
	if (!cookieValue) return null;

	const parts = cookieValue.split('.');
	if (parts.length !== 2) return null;

	const [payload, signature] = parts;
	const expectedSignature = sign(payload);
	const givenBuffer = Buffer.from(signature);
	const expectedBuffer = Buffer.from(expectedSignature);
	if (givenBuffer.length !== expectedBuffer.length) return null;
	if (!crypto.timingSafeEqual(givenBuffer, expectedBuffer)) return null;

	try {
		const parsed = JSON.parse(fromBase64Url(payload));
		if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= Date.now()) return null;
		return typeof parsed.vaultId === 'string' ? parsed.vaultId : null;
	} catch (error) {
		return null;
	}
};

const hasOpenedVaultAccess = (request, vaultId) => {
	return openedVaultId(request) === vaultId;
};

const send = (response, statusCode, body, headers = {}) => {
	response.writeHead(statusCode, headers);
	response.end(body);
};

const redirect = (response, location) => {
	send(response, 302, `Redirecting to ${location}`, { Location: location });
};

const readRequestBody = request => new Promise((resolve, reject) => {
	const chunks = [];
	request.on('data', chunk => chunks.push(chunk));
	request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
	request.on('error', reject);
});

const verifyPassword = password => {
	if (passwordConfig.plainPassword) {
		return password === passwordConfig.plainPassword;
	}

	const [algorithm, cost, salt, expectedHash] = passwordConfig.hashedPassword.split('$');
	if (algorithm !== 'scrypt' || !cost || !salt || !expectedHash) {
		throw new Error('APP_PASSWORD_HASH has an invalid format.');
	}

	const keyLength = Buffer.from(expectedHash, 'hex').length;
	const derivedKey = crypto.scryptSync(password, salt, keyLength, { N: Number(cost), r: 8, p: 1 });
	const expectedBuffer = Buffer.from(expectedHash, 'hex');
	return crypto.timingSafeEqual(derivedKey, expectedBuffer);
};

const fileExists = filePath => {
	try {
		return fs.statSync(filePath).isFile();
	} catch (error) {
		return false;
	}
};

// --- Vault registry helpers ---

const readRegistry = () => {
	try {
		return JSON.parse(fs.readFileSync(vaultsRegistryPath, 'utf8'));
	} catch {
		return { vaults: [] };
	}
};

const writeRegistry = data => {
	fs.writeFileSync(vaultsRegistryPath, JSON.stringify(data, null, '\t'), 'utf8');
};

const vaultBlobPath = id => path.join(vaultsDir, `${id}.joplin.enc`);

const suffixTimestamp = isoString => {
	return isoString
		.replace(/[-:]/g, '')
		.replace('T', '-')
		.replace(/\..+$/, '')
		.replace('Z', '');
};

const createVaultDisplayName = (name, id, createdAt) => {
	const hash = id.replace(/-/g, '').slice(0, 8);
	return `${name} ${suffixTimestamp(createdAt)}-${hash}`;
};

const readRequestBodyRaw = request => new Promise((resolve, reject) => {
	const chunks = [];
	request.on('data', chunk => chunks.push(chunk));
	request.on('end', () => resolve(Buffer.concat(chunks)));
	request.on('error', reject);
});

const buildQueryString = query => {
	const searchParams = new URLSearchParams();
	for (const key of Object.keys(query)) {
		const value = query[key];
		if (value === null || typeof value === 'undefined') continue;
		if (Array.isArray(value)) {
			for (const item of value) searchParams.append(key, `${item}`);
		} else {
			searchParams.append(key, `${value}`);
		}
	}
	const output = searchParams.toString();
	return output ? `?${output}` : '';
};

const proxyRequestHeaders = request => {
	const output = {};
	for (const headerName of ['content-type', 'x-api-auth', 'x-api-min-version']) {
		const value = request.headers[headerName];
		if (typeof value === 'string' && value) output[headerName] = value;
	}
	return output;
};

const serveFile = (response, filePath) => {
	const extension = path.extname(filePath).toLowerCase();
	const contentType = contentTypes[extension] || 'application/octet-stream';
	const stat = fs.statSync(filePath);

	response.writeHead(200, {
		...appHeaders,
		'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=300',
		'Content-Length': stat.size,
		'Content-Type': contentType,
	});

	fs.createReadStream(filePath).pipe(response);
};

const serveAppIndex = response => {
	const indexPath = path.join(distDir, 'index.html');
	const body = fs.readFileSync(indexPath, 'utf8');

	send(response, 200, body, {
		...appHeaders,
		'Cache-Control': 'no-store',
		'Content-Type': 'text/html; charset=utf-8',
	});
};

// --- Vault API handlers ---

const handleVaultApiList = (response) => {
	const registry = readRegistry();
	send(response, 200, JSON.stringify(registry.vaults.map(v => ({ id: v.id, name: v.name, createdAt: v.createdAt }))), {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
	});
};

const handleVaultApiCreate = async (request, response) => {
	const body = JSON.parse((await readRequestBodyRaw(request)).toString('utf8'));
	const name = (body.name || '').trim();
	const salt = (body.salt || '').trim();
	const passwordVerifier = (body.passwordVerifier || '').trim();
	if (!name || !salt || !passwordVerifier) {
		send(response, 400, JSON.stringify({ error: 'name, salt, and passwordVerifier are required' }), { 'Content-Type': 'application/json; charset=utf-8' });
		return;
	}
	const id = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	const displayName = createVaultDisplayName(name, id, createdAt);
	const registry = readRegistry();
	registry.vaults.push({ id, name: displayName, salt, passwordVerifier, createdAt });
	writeRegistry(registry);
	send(response, 201, JSON.stringify({ id, name: displayName, createdAt }), { 'Content-Type': 'application/json; charset=utf-8' });
};

const handleVaultApiDelete = (response, id) => {
	const registry = readRegistry();
	const idx = registry.vaults.findIndex(v => v.id === id);
	if (idx === -1) {
		send(response, 404, JSON.stringify({ error: 'Vault not found' }), { 'Content-Type': 'application/json; charset=utf-8' });
		return;
	}
	registry.vaults.splice(idx, 1);
	writeRegistry(registry);
	const blobPath = vaultBlobPath(id);
	if (fileExists(blobPath)) fs.unlinkSync(blobPath);
	send(response, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json; charset=utf-8' });
};

const handleVaultApiGetSalt = (response, id) => {
	const registry = readRegistry();
	const vault = registry.vaults.find(v => v.id === id);
	if (!vault) {
		send(response, 404, JSON.stringify({ error: 'Vault not found' }), { 'Content-Type': 'application/json; charset=utf-8' });
		return;
	}
	send(response, 200, JSON.stringify({ id: vault.id, salt: vault.salt, passwordVerifier: vault.passwordVerifier || null }), { 'Content-Type': 'application/json; charset=utf-8' });
};

const handleVaultApiPutVerifier = async (request, response, id) => {
	const body = JSON.parse((await readRequestBodyRaw(request)).toString('utf8'));
	const passwordVerifier = (body.passwordVerifier || '').trim();
	if (!passwordVerifier) {
		send(response, 400, JSON.stringify({ error: 'passwordVerifier is required' }), { 'Content-Type': 'application/json; charset=utf-8' });
		return;
	}
	const registry = readRegistry();
	const vault = registry.vaults.find(v => v.id === id);
	if (!vault) {
		send(response, 404, JSON.stringify({ error: 'Vault not found' }), { 'Content-Type': 'application/json; charset=utf-8' });
		return;
	}
	vault.passwordVerifier = passwordVerifier;
	writeRegistry(registry);
	send(response, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json; charset=utf-8' });
};

const handleVaultApiOpen = async (request, response, id) => {
	const registry = readRegistry();
	const vault = registry.vaults.find(v => v.id === id);
	if (!vault) {
		send(response, 404, JSON.stringify({ error: 'Vault not found' }), { 'Content-Type': 'application/json; charset=utf-8' });
		return;
	}
	setVaultCookie(response, createVaultCookie(id), Math.floor(sessionTtlMs / 1000));
	send(response, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json; charset=utf-8' });
};

const handleJoplinProxy = async (request, response, url) => {
	const targetBaseUrl = url.searchParams.get('baseUrl');
	const targetPath = url.searchParams.get('path') || '';
	if (!targetBaseUrl) {
		send(response, 400, JSON.stringify({ error: 'Missing baseUrl' }), { 'Content-Type': 'application/json; charset=utf-8' });
		return;
	}

	let targetUrl;
	try {
		targetUrl = new URL(`${targetBaseUrl.replace(/\/+$/, '')}/${targetPath.replace(/^\/+/, '')}`);
	} catch (error) {
		send(response, 400, JSON.stringify({ error: 'Invalid baseUrl' }), { 'Content-Type': 'application/json; charset=utf-8' });
		return;
	}

	const forwardedQuery = {};
	for (const [key, value] of url.searchParams.entries()) {
		if (key === 'baseUrl' || key === 'path') continue;
		if (typeof forwardedQuery[key] === 'undefined') {
			forwardedQuery[key] = value;
		} else if (Array.isArray(forwardedQuery[key])) {
			forwardedQuery[key].push(value);
		} else {
			forwardedQuery[key] = [forwardedQuery[key], value];
		}
	}

	const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readRequestBodyRaw(request);
	const proxyResponse = await fetch(`${targetUrl.toString()}${buildQueryString(forwardedQuery)}`, {
		method: request.method,
		headers: proxyRequestHeaders(request),
		body,
		redirect: 'manual',
	});

	const responseBuffer = Buffer.from(await proxyResponse.arrayBuffer());
	const responseHeaders = {
		'Cache-Control': 'no-store',
		'Content-Type': proxyResponse.headers.get('content-type') || 'application/octet-stream',
	};
	const contentLength = proxyResponse.headers.get('content-length');
	if (contentLength) responseHeaders['Content-Length'] = contentLength;
	response.writeHead(proxyResponse.status, responseHeaders);
	response.end(responseBuffer);
};

const handleVaultApiGetBlob = (response, id) => {
	const registry = readRegistry();
	const vault = registry.vaults.find(v => v.id === id);
	if (!vault) {
		send(response, 404, JSON.stringify({ error: 'Vault not found' }), { 'Content-Type': 'application/json; charset=utf-8' });
		return;
	}
	const blobPath = vaultBlobPath(id);
	if (!fileExists(blobPath)) {
		// New vault — no blob yet.
		send(response, 204, '', { 'Cache-Control': 'no-store' });
		return;
	}
	const data = fs.readFileSync(blobPath);
	response.writeHead(200, {
		'Content-Type': 'application/octet-stream',
		'Content-Length': data.length,
		'Cache-Control': 'no-store',
	});
	response.end(data);
};

const handleVaultApiPutBlob = async (request, response, id) => {
	if (!hasOpenedVaultAccess(request, id)) {
		send(response, 403, JSON.stringify({ error: 'Vault is not open in this session' }), { 'Content-Type': 'application/json; charset=utf-8' });
		return;
	}
	const registry = readRegistry();
	const vault = registry.vaults.find(v => v.id === id);
	if (!vault) {
		send(response, 404, JSON.stringify({ error: 'Vault not found' }), { 'Content-Type': 'application/json; charset=utf-8' });
		return;
	}
	const data = await readRequestBodyRaw(request);
	fs.writeFileSync(vaultBlobPath(id), data);
	send(response, 200, JSON.stringify({ ok: true, bytes: data.length }), { 'Content-Type': 'application/json; charset=utf-8' });
};

const loginPage = errorMessage => `<!DOCTYPE html>
<html lang="en" data-theme="dark">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
		<meta name="theme-color" content="${loginBackground.dark}" />
		<title>Joplin Web Login</title>
		<style>
			:root,
			[data-theme="dark"] {
				color-scheme: dark;
				--bg-primary: #0a0a0f;
				--bg-secondary: #12121a;
				--bg-glass: rgba(18, 18, 30, 0.7);
				--bg-glass-strong: rgba(10, 10, 15, 0.84);
				--bg-input: rgba(15, 23, 42, 0.65);
				--text-primary: #eef2ff;
				--text-secondary: #b7bfd8;
				--text-muted: #8390b0;
				--accent: #7c8cff;
				--accent-strong: #95a2ff;
				--border: rgba(255, 255, 255, 0.1);
				--shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
				--error-bg: rgba(239, 68, 68, 0.14);
				--error-border: rgba(248, 113, 113, 0.24);
				--error-text: #fecaca;
			}

			[data-theme="light"] {
				color-scheme: light;
				--bg-primary: #eef2f7;
				--bg-secondary: #dde6f3;
				--bg-glass: rgba(255, 255, 255, 0.72);
				--bg-glass-strong: rgba(248, 250, 252, 0.88);
				--bg-input: rgba(255, 255, 255, 0.88);
				--text-primary: #111827;
				--text-secondary: #475569;
				--text-muted: #64748b;
				--accent: #4f46e5;
				--accent-strong: #4338ca;
				--border: rgba(15, 23, 42, 0.08);
				--shadow: 0 24px 70px rgba(15, 23, 42, 0.12);
				--error-bg: rgba(254, 226, 226, 0.9);
				--error-border: rgba(248, 113, 113, 0.3);
				--error-text: #991b1b;
			}

			* {
				box-sizing: border-box;
			}

			html, body {
				margin: 0;
				min-height: 100%;
				font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
				background:
					radial-gradient(circle at top left, rgba(124, 140, 255, 0.16), transparent 35%),
					radial-gradient(circle at bottom right, rgba(45, 212, 191, 0.14), transparent 36%),
					linear-gradient(135deg, var(--bg-primary), var(--bg-secondary));
				color: var(--text-primary);
			}

			body {
				display: flex;
				align-items: center;
				justify-content: center;
				padding: 24px;
			}

			.shell {
				width: 100%;
				max-width: 960px;
				display: grid;
				grid-template-columns: minmax(0, 1.1fr) minmax(320px, 420px);
				gap: 24px;
			}

			.panel,
			.form-panel {
				border: 1px solid var(--border);
				background: var(--bg-glass);
				backdrop-filter: blur(22px);
				-webkit-backdrop-filter: blur(22px);
				border-radius: 28px;
				box-shadow: var(--shadow);
			}

			.panel {
				padding: 32px;
				display: flex;
				flex-direction: column;
				justify-content: space-between;
				min-height: 520px;
			}

			.form-panel {
				padding: 28px;
				align-self: center;
			}

			.kicker {
				display: inline-flex;
				align-items: center;
				gap: 8px;
				padding: 8px 12px;
				border-radius: 999px;
				border: 1px solid var(--border);
				background: rgba(255, 255, 255, 0.04);
				color: var(--text-secondary);
				font-size: 13px;
				letter-spacing: 0.02em;
			}

			h1 {
				margin: 18px 0 12px;
				font-size: clamp(2.6rem, 4vw, 4rem);
				line-height: 0.98;
			}

			.lead {
				max-width: 34rem;
				color: var(--text-secondary);
				font-size: 1.05rem;
				line-height: 1.6;
			}

			.feature-list {
				display: grid;
				gap: 12px;
				margin-top: 28px;
			}

			.feature {
				display: flex;
				gap: 12px;
				align-items: flex-start;
				padding: 14px 16px;
				border-radius: 18px;
				background: rgba(255, 255, 255, 0.04);
				border: 1px solid var(--border);
			}

			.feature strong {
				display: block;
				margin-bottom: 2px;
			}

			.feature span {
				color: var(--text-muted);
				font-size: 0.95rem;
				line-height: 1.45;
			}

			.form-header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 16px;
				margin-bottom: 24px;
			}

			.form-title {
				font-size: 1.4rem;
				font-weight: 700;
			}

			.form-subtitle {
				margin-top: 6px;
				color: var(--text-secondary);
				font-size: 0.95rem;
			}

			.theme-toggle {
				appearance: none;
				border: 1px solid var(--border);
				background: var(--bg-glass-strong);
				color: var(--text-primary);
				width: 42px;
				height: 42px;
				border-radius: 999px;
				cursor: pointer;
				font-size: 1rem;
			}

			label {
				display: block;
				margin-bottom: 10px;
				font-size: 0.95rem;
				font-weight: 600;
			}

			input {
				width: 100%;
				padding: 15px 16px;
				border-radius: 16px;
				border: 1px solid var(--border);
				background: var(--bg-input);
				color: var(--text-primary);
				font-size: 1rem;
				outline: none;
				margin-bottom: 16px;
			}

			input:focus {
				border-color: rgba(124, 140, 255, 0.65);
				box-shadow: 0 0 0 4px rgba(124, 140, 255, 0.14);
			}

			button[type="submit"] {
				width: 100%;
				padding: 15px 18px;
				border: none;
				border-radius: 16px;
				background: linear-gradient(135deg, var(--accent), var(--accent-strong));
				color: white;
				font-size: 1rem;
				font-weight: 700;
				cursor: pointer;
				box-shadow: 0 12px 28px rgba(79, 70, 229, 0.28);
			}

			.error {
				margin-bottom: 16px;
				padding: 14px 16px;
				border-radius: 16px;
				border: 1px solid var(--error-border);
				background: var(--error-bg);
				color: var(--error-text);
				font-size: 0.95rem;
			}

			.footer-note {
				margin-top: 18px;
				color: var(--text-muted);
				font-size: 0.86rem;
				line-height: 1.5;
			}

			.mini-card-row {
				display: grid;
				grid-template-columns: repeat(3, minmax(0, 1fr));
				gap: 12px;
				margin-top: 32px;
			}

			.mini-card {
				padding: 16px;
				border-radius: 18px;
				background: rgba(255, 255, 255, 0.04);
				border: 1px solid var(--border);
			}

			.mini-card strong {
				display: block;
				font-size: 1.1rem;
			}

			.mini-card span {
				color: var(--text-muted);
				font-size: 0.85rem;
			}

			@media (max-width: 900px) {
				.shell {
					grid-template-columns: 1fr;
				}

				.panel {
					min-height: auto;
				}

				.mini-card-row {
					grid-template-columns: 1fr;
				}
			}
		</style>
	</head>
	<body>
		<div class="shell">
			<section class="panel">
				<div>
					<div class="kicker">Private browser workspace</div>
					<h1>Joplin Web, wrapped for the browser.</h1>
					<p class="lead">
						This keeps the existing mobile-based Joplin web app intact, but serves it from Docker behind a single local login.
					</p>
					<div class="feature-list">
						<div class="feature">
							<div>01</div>
							<div><strong>Same app</strong><span>The React Native web build still powers the UI.</span></div>
						</div>
						<div class="feature">
							<div>02</div>
							<div><strong>Docker hosted</strong><span>The server, auth gate, and static hosting all run in one container.</span></div>
						</div>
						<div class="feature">
							<div>03</div>
							<div><strong>PWA ready</strong><span>The app bundle still includes its manifest and service worker under <code>/app/</code>.</span></div>
						</div>
					</div>
				</div>
				<div class="mini-card-row">
					<div class="mini-card"><strong>Local-first</strong><span>Data remains browser-local for this phase.</span></div>
					<div class="mini-card"><strong>Protected</strong><span>App assets are served only after login.</span></div>
					<div class="mini-card"><strong>Ready</strong><span>Good base for later Joplin Server integration.</span></div>
				</div>
			</section>
			<section class="form-panel">
				<div class="form-header">
					<div>
						<div class="form-title">Unlock workspace</div>
						<div class="form-subtitle">Enter the local password to open the web app.</div>
					</div>
					<button class="theme-toggle" id="themeToggle" type="button" aria-label="Toggle theme">◐</button>
				</div>
				${errorMessage ? `<div class="error">${errorMessage}</div>` : ''}
				<form method="post" action="/login" id="loginForm">
					<label for="password">Password</label>
					<input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
					<button type="submit">Enter Joplin</button>
				</form>
				<p class="footer-note">
					This login is enforced by the Docker host process. The app itself lives at <code>/app/</code> so its service worker stays scoped away from the login screen.
				</p>
			</section>
		</div>
		<script>
			(function() {
				var storageKey = 'joplin-web-login-theme';
				var meta = document.querySelector('meta[name="theme-color"]');
				var toggle = document.getElementById('themeToggle');
				var root = document.documentElement;

				try {
					sessionStorage.removeItem('joplin-vault-id');
					sessionStorage.removeItem('joplin-vault-password');
					sessionStorage.removeItem('joplin-web-boot-password');
				} catch (error) {
					// Ignore sessionStorage failures.
				}

				var setTheme = function(theme) {
					root.setAttribute('data-theme', theme);
					meta.setAttribute('content', theme === 'light' ? '${loginBackground.light}' : '${loginBackground.dark}');
					toggle.textContent = theme === 'light' ? '◑' : '◐';
					window.localStorage.setItem(storageKey, theme);
				};

				var stored = window.localStorage.getItem(storageKey);
				if (stored === 'light' || stored === 'dark') {
					setTheme(stored);
				}

				toggle.addEventListener('click', function() {
					var nextTheme = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
					setTheme(nextTheme);
				});

			})();
		</script>
	</body>
</html>`;

const handleLogin = async (request, response) => {
	const rawBody = await readRequestBody(request);
	const body = new URLSearchParams(rawBody);
	const password = body.get('password') || '';

	if (!password || !verifyPassword(password)) {
		send(response, 401, loginPage('Incorrect password.'), {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
		});
		return;
	}

	setCookie(response, createSessionCookie(), Math.floor(sessionTtlMs / 1000));
	clearVaultCookie(response);
	redirect(response, '/vaults');
};

const vaultPage = () => `<!DOCTYPE html>
<html lang="en" data-theme="dark">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
		<title>Joplin — Select Vault</title>
		<style>
			:root, [data-theme="dark"] {
				color-scheme: dark;
				--bg-primary: #0a0a0f;
				--bg-secondary: #12121a;
				--bg-glass: rgba(18, 18, 30, 0.7);
				--bg-glass-strong: rgba(10, 10, 15, 0.84);
				--bg-input: rgba(15, 23, 42, 0.65);
				--text-primary: #eef2ff;
				--text-secondary: #b7bfd8;
				--text-muted: #8390b0;
				--accent: #7c8cff;
				--accent-strong: #95a2ff;
				--border: rgba(255, 255, 255, 0.1);
				--shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
				--error-bg: rgba(239, 68, 68, 0.14);
				--error-border: rgba(248, 113, 113, 0.24);
				--error-text: #fecaca;
				--success-bg: rgba(34, 197, 94, 0.12);
				--success-border: rgba(34, 197, 94, 0.25);
				--success-text: #bbf7d0;
			}
			[data-theme="light"] {
				color-scheme: light;
				--bg-primary: #eef2f7;
				--bg-secondary: #dde6f3;
				--bg-glass: rgba(255, 255, 255, 0.72);
				--bg-glass-strong: rgba(248, 250, 252, 0.88);
				--bg-input: rgba(255, 255, 255, 0.88);
				--text-primary: #111827;
				--text-secondary: #475569;
				--text-muted: #64748b;
				--accent: #4f46e5;
				--accent-strong: #4338ca;
				--border: rgba(15, 23, 42, 0.08);
				--shadow: 0 24px 70px rgba(15, 23, 42, 0.12);
				--error-bg: rgba(254, 226, 226, 0.9);
				--error-border: rgba(248, 113, 113, 0.3);
				--error-text: #991b1b;
				--success-bg: rgba(220, 252, 231, 0.9);
				--success-border: rgba(34, 197, 94, 0.3);
				--success-text: #166534;
			}
			* { box-sizing: border-box; }
			html, body {
				margin: 0; min-height: 100%;
				font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
				background:
					radial-gradient(circle at top left, rgba(124, 140, 255, 0.16), transparent 35%),
					radial-gradient(circle at bottom right, rgba(45, 212, 191, 0.14), transparent 36%),
					linear-gradient(135deg, var(--bg-primary), var(--bg-secondary));
				color: var(--text-primary);
			}
			body { display: flex; align-items: center; justify-content: center; padding: 24px; min-height: 100vh; }
			.shell { width: 100%; max-width: 580px; }
			.panel {
				border: 1px solid var(--border);
				background: var(--bg-glass);
				backdrop-filter: blur(22px);
				-webkit-backdrop-filter: blur(22px);
				border-radius: 28px;
				box-shadow: var(--shadow);
				padding: 32px;
			}
			.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
			.page-title { font-size: 1.5rem; font-weight: 700; }
			.page-subtitle { color: var(--text-secondary); font-size: 0.93rem; margin-top: 4px; }
			.btn-row { display: flex; gap: 10px; }
			.btn {
				padding: 10px 18px; border-radius: 14px; font-size: 0.93rem; font-weight: 600;
				cursor: pointer; border: 1px solid var(--border); background: var(--bg-glass-strong);
				color: var(--text-primary); white-space: nowrap;
			}
			.btn-primary {
				background: linear-gradient(135deg, var(--accent), var(--accent-strong));
				border-color: transparent; color: #fff;
				box-shadow: 0 8px 20px rgba(79, 70, 229, 0.24);
			}
			.btn-danger { border-color: rgba(239,68,68,0.35); color: #fca5a5; background: rgba(239,68,68,0.10); }
			.vault-list { display: grid; gap: 10px; margin-bottom: 24px; }
			.vault-card {
				padding: 16px 18px; border-radius: 18px;
				border: 1px solid var(--border); background: rgba(255,255,255,0.04);
				cursor: pointer; display: flex; align-items: center; justify-content: space-between;
				transition: border-color 0.15s;
			}
			.vault-card:hover { border-color: rgba(124,140,255,0.45); }
			.vault-card.selected { border-color: var(--accent); background: rgba(124,140,255,0.08); }
			.vault-name { font-weight: 600; }
			.vault-date { color: var(--text-muted); font-size: 0.85rem; margin-top: 2px; }
			.vault-del { font-size: 0.8rem; padding: 6px 11px; border-radius: 10px; }
			.empty-state { color: var(--text-muted); font-size: 0.95rem; margin-bottom: 18px; padding: 20px; text-align: center; }
			.section-divider { border: none; border-top: 1px solid var(--border); margin: 24px 0; }
			label { display: block; margin-bottom: 8px; font-size: 0.93rem; font-weight: 600; }
			input[type="text"], input[type="password"] {
				width: 100%; padding: 13px 15px; border-radius: 14px;
				border: 1px solid var(--border); background: var(--bg-input);
				color: var(--text-primary); font-size: 1rem; outline: none; margin-bottom: 14px;
			}
			input:focus { border-color: rgba(124,140,255,0.65); box-shadow: 0 0 0 4px rgba(124,140,255,0.14); }
			.notice {
				padding: 12px 15px; border-radius: 14px; font-size: 0.88rem; line-height: 1.5;
				margin-bottom: 14px;
			}
			.notice-error { background: var(--error-bg); border: 1px solid var(--error-border); color: var(--error-text); }
			.notice-warn { background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.25); color: #fde68a; }
			.notice-hidden { display: none; }
			.new-vault-form { display: none; }
			.new-vault-form.open { display: block; }
			.open-form { display: none; }
			.open-form.open { display: block; }
			.top-bar { display: flex; justify-content: flex-end; margin-bottom: 8px; }
			a.logout-link { color: var(--text-muted); font-size: 0.85rem; text-decoration: none; }
			a.logout-link:hover { color: var(--text-secondary); }
			.theme-toggle {
				appearance: none; border: 1px solid var(--border); background: var(--bg-glass-strong);
				color: var(--text-primary); width: 36px; height: 36px; border-radius: 999px;
				cursor: pointer; font-size: 0.9rem;
			}
		</style>
	</head>
	<body>
		<div class="shell">
			<div class="top-bar">
				<button class="theme-toggle" id="themeToggle" type="button" aria-label="Toggle theme">◐</button>
			</div>
			<div class="panel">
				<div class="page-header">
					<div>
						<div class="page-title">Select a vault</div>
						<div class="page-subtitle">Each vault is a separate encrypted Joplin database.</div>
					</div>
					<div class="btn-row">
						<button class="btn" id="btnNew">+ New vault</button>
						<a class="btn" href="/logout">Log out</a>
					</div>
				</div>

				<div id="noticeBox" class="notice notice-hidden"></div>

				<div class="vault-list" id="vaultList">
					<div class="empty-state" id="emptyState">No vaults yet. Create one above.</div>
				</div>

				<!-- New vault form -->
				<div class="new-vault-form" id="newVaultForm">
					<hr class="section-divider" />
					<label for="newVaultName">Vault name</label>
					<input type="text" id="newVaultName" placeholder="e.g. Personal notes" maxlength="64" autocomplete="off" />
					<label for="newVaultPassword">Vault password</label>
					<input type="password" id="newVaultPassword" placeholder="Strong, memorable password" autocomplete="new-password" />
					<label for="newVaultPasswordConfirm">Confirm vault password</label>
					<input type="password" id="newVaultPasswordConfirm" placeholder="Repeat password" autocomplete="new-password" />
					<div class="notice notice-warn" style="display:block; margin-bottom:14px;">
						Lost vault password = lost data. There is no recovery path.
					</div>
					<div class="btn-row">
						<button class="btn btn-primary" id="btnCreateVault">Create vault</button>
						<button class="btn" id="btnCancelNew">Cancel</button>
					</div>
				</div>

				<!-- Open vault form -->
				<div class="open-form" id="openVaultForm">
					<hr class="section-divider" />
					<div id="openVaultLabel" style="font-weight:600; margin-bottom:14px;"></div>
					<label for="vaultPassword">Vault password</label>
					<input type="password" id="vaultPassword" placeholder="Vault password" autocomplete="current-password" />
					<div class="btn-row">
						<button class="btn btn-primary" id="btnOpenVault">Open vault</button>
						<button class="btn" id="btnCancelOpen">Cancel</button>
					</div>
				</div>
			</div>
		</div>
		<script>
		(function() {
			var PBKDF2_ITERATIONS = 210000;
			var storageKey = 'joplin-web-login-theme';
			var themeToggle = document.getElementById('themeToggle');
			var root = document.documentElement;
			try {
				sessionStorage.removeItem('joplin-vault-id');
				sessionStorage.removeItem('joplin-vault-password');
			} catch (error) {
				// Ignore sessionStorage failures.
			}
			var setTheme = function(t) {
				root.setAttribute('data-theme', t);
				themeToggle.textContent = t === 'light' ? '◑' : '◐';
				localStorage.setItem(storageKey, t);
			};
			var stored = localStorage.getItem(storageKey);
			if (stored === 'light' || stored === 'dark') setTheme(stored);
			themeToggle.addEventListener('click', function() {
				setTheme(root.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
			});

			var vaults = [];
			var selectedVaultId = null;

			var noticeBox = document.getElementById('noticeBox');
			var vaultList = document.getElementById('vaultList');
			var emptyState = document.getElementById('emptyState');
			var newVaultForm = document.getElementById('newVaultForm');
			var openVaultForm = document.getElementById('openVaultForm');
			var openVaultLabel = document.getElementById('openVaultLabel');

			function showNotice(msg, type) {
				noticeBox.textContent = msg;
				noticeBox.className = 'notice notice-' + (type || 'error');
			}
			function hideNotice() {
				noticeBox.className = 'notice notice-hidden';
			}

			function bytesFromBase64(value) {
				return Uint8Array.from(atob(value), function(c) { return c.charCodeAt(0); });
			}

			function fetchVaultSalt(id) {
				return fetch('/api/vaults/' + encodeURIComponent(id) + '/salt')
					.then(function(r) {
						if (!r.ok) throw new Error('Failed to load vault salt.');
						return r.json();
					});
			}

			function putVaultVerifier(id, passwordVerifier) {
				return fetch('/api/vaults/' + encodeURIComponent(id) + '/verifier', {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ passwordVerifier: passwordVerifier }),
				}).then(function(r) {
					if (!r.ok) throw new Error('Failed to save vault verifier.');
					return r.json();
				});
			}

			function openVaultSession(id) {
				return fetch('/api/vaults/' + encodeURIComponent(id) + '/open', {
					method: 'POST',
				}).then(function(r) {
					if (!r.ok) throw new Error('Failed to open vault session.');
					return r.json();
				});
			}

			function fetchVaultBlob(id) {
				return fetch('/api/vaults/' + encodeURIComponent(id) + '/blob')
					.then(function(r) {
						if (r.status === 204) return null;
						if (!r.ok) throw new Error('Failed to load vault data.');
						return r.arrayBuffer();
					});
			}

			async function deriveVaultKey(password, saltBase64) {
				var keyMaterial = await crypto.subtle.importKey(
					'raw',
					new TextEncoder().encode(password),
					'PBKDF2',
					false,
					['deriveKey']
				);
				return crypto.subtle.deriveKey(
					{ name: 'PBKDF2', salt: bytesFromBase64(saltBase64), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
					keyMaterial,
					{ name: 'AES-GCM', length: 256 },
					false,
					['encrypt', 'decrypt']
				);
			}

			async function derivePasswordVerifier(password, saltBase64) {
				var keyMaterial = await crypto.subtle.importKey(
					'raw',
					new TextEncoder().encode(password),
					'PBKDF2',
					false,
					['deriveBits']
				);
				var bits = await crypto.subtle.deriveBits(
					{ name: 'PBKDF2', salt: bytesFromBase64(saltBase64), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
					keyMaterial,
					256
				);
				return btoa(String.fromCharCode.apply(null, new Uint8Array(bits)));
			}

			function constantTimeEquals(a, b) {
				if (!a || !b || a.length !== b.length) return false;
				var result = 0;
				for (var i = 0; i < a.length; i++) {
					result |= a.charCodeAt(i) ^ b.charCodeAt(i);
				}
				return result === 0;
			}

			async function verifyVaultPassword(id, password) {
				var saltResponse = await fetchVaultSalt(id);
				var passwordVerifier = await derivePasswordVerifier(password, saltResponse.salt);
				if (saltResponse.passwordVerifier) {
					return {
						ok: constantTimeEquals(passwordVerifier, saltResponse.passwordVerifier),
						error: 'Incorrect vault password.',
					};
				}
				var blob = await fetchVaultBlob(id);
				if (!blob || blob.byteLength === 0) {
					return { ok: false, error: 'This vault has no password verifier yet. Open it from the browser that created it after data exists, or recreate it.' };
				}
				if (blob.byteLength <= 12) {
					return { ok: false, error: 'Vault data is corrupted.' };
				}
				var key = await deriveVaultKey(password, saltResponse.salt);
				var iv = new Uint8Array(blob, 0, 12);
				var ciphertext = new Uint8Array(blob, 12);
				try {
					await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ciphertext);
					await putVaultVerifier(id, passwordVerifier);
					return { ok: true };
				} catch (error) {
					return { ok: false, error: 'Incorrect vault password.' };
				}
			}

			function renderVaults() {
				Array.from(vaultList.querySelectorAll('.vault-card')).forEach(function(el) { el.remove(); });
				if (vaults.length === 0) {
					emptyState.style.display = '';
				} else {
					emptyState.style.display = 'none';
					vaults.forEach(function(v) {
						var card = document.createElement('div');
						card.className = 'vault-card' + (selectedVaultId === v.id ? ' selected' : '');
						card.dataset.id = v.id;
						var info = document.createElement('div');
						var name = document.createElement('div');
						name.className = 'vault-name';
						name.textContent = v.name;
						var date = document.createElement('div');
						date.className = 'vault-date';
						date.textContent = 'Created ' + new Date(v.createdAt).toLocaleDateString();
						info.appendChild(name);
						info.appendChild(date);
						var delBtn = document.createElement('button');
						delBtn.className = 'btn btn-danger vault-del';
						delBtn.textContent = 'Delete';
						delBtn.addEventListener('click', function(e) {
							e.stopPropagation();
							deleteVault(v.id, v.name);
						});
						card.appendChild(info);
						card.appendChild(delBtn);
						card.addEventListener('click', function() { selectVault(v); });
						vaultList.insertBefore(card, emptyState);
					});
				}
			}

			function loadVaults() {
				fetch('/api/vaults').then(function(r) { return r.json(); }).then(function(data) {
					vaults = data;
					renderVaults();
				});
			}

			function selectVault(v) {
				selectedVaultId = v.id;
				renderVaults();
				openVaultLabel.textContent = 'Opening: ' + v.name;
				openVaultForm.classList.add('open');
				newVaultForm.classList.remove('open');
				hideNotice();
				document.getElementById('vaultPassword').value = '';
				document.getElementById('vaultPassword').focus();
			}

			function deleteVault(id, name) {
				if (!confirm('Delete vault "' + name + '"? This cannot be undone and all data will be lost.')) return;
				fetch('/api/vaults/' + id, { method: 'DELETE' }).then(function(r) { return r.json(); }).then(function() {
					if (selectedVaultId === id) {
						selectedVaultId = null;
						openVaultForm.classList.remove('open');
					}
					loadVaults();
				});
			}

			document.getElementById('btnNew').addEventListener('click', function() {
				newVaultForm.classList.add('open');
				openVaultForm.classList.remove('open');
				selectedVaultId = null;
				hideNotice();
				document.getElementById('newVaultName').focus();
			});

			document.getElementById('btnCancelNew').addEventListener('click', function() {
				newVaultForm.classList.remove('open');
			});

			document.getElementById('btnCancelOpen').addEventListener('click', function() {
				openVaultForm.classList.remove('open');
				selectedVaultId = null;
				renderVaults();
			});

				document.getElementById('btnCreateVault').addEventListener('click', async function() {
				var name = document.getElementById('newVaultName').value.trim();
				var pw = document.getElementById('newVaultPassword').value;
				var pw2 = document.getElementById('newVaultPasswordConfirm').value;
				if (!name) { showNotice('Vault name is required.'); return; }
				if (!pw) { showNotice('Vault password is required.'); return; }
				if (pw !== pw2) { showNotice('Passwords do not match.'); return; }
				// Generate salt client-side, stored server-side in registry.
				var saltBytes = crypto.getRandomValues(new Uint8Array(32));
				var salt = btoa(String.fromCharCode.apply(null, saltBytes));
				var passwordVerifier = await derivePasswordVerifier(pw, salt);
				var r = await fetch('/api/vaults', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: name, salt: salt, passwordVerifier: passwordVerifier }),
				});
				var data = await r.json();
				if (!r.ok) { showNotice(data.error || 'Failed to create vault.'); return; }
				newVaultForm.classList.remove('open');
				document.getElementById('newVaultName').value = '';
				document.getElementById('newVaultPassword').value = '';
				document.getElementById('newVaultPasswordConfirm').value = '';
				await loadVaults();
				var created = vaults.find(function(v) { return v.id === data.id; });
				if (created) selectVault(created);
				// Pre-fill the open-vault password with what was just typed.
				document.getElementById('vaultPassword').value = pw;
			});

			document.getElementById('btnOpenVault').addEventListener('click', async function() {
				var pw = document.getElementById('vaultPassword').value;
				if (!pw) { showNotice('Enter the vault password.'); return; }
				if (!selectedVaultId) { showNotice('No vault selected.'); return; }
				hideNotice();
				var verification = await verifyVaultPassword(selectedVaultId, pw);
				if (!verification.ok) {
					showNotice(verification.error || 'Could not open vault.');
					return;
				}
				await openVaultSession(selectedVaultId);
				// Hand off vault ID and password to app via sessionStorage. The DB
				// driver reads and clears these on first load.
				sessionStorage.setItem('joplin-vault-id', selectedVaultId);
				sessionStorage.setItem('joplin-vault-password', pw);
				window.location.href = '/app/';
			});

			document.getElementById('vaultPassword').addEventListener('keydown', function(e) {
				if (e.key === 'Enter') document.getElementById('btnOpenVault').click();
			});

			try {
				sessionStorage.removeItem('joplin-vault-id');
				sessionStorage.removeItem('joplin-vault-password');
			} catch (error) {
				// Ignore sessionStorage failures.
			}

			loadVaults();
		})();
		</script>
	</body>
</html>`;

const serveApp = (request, response, requestPath) => {
	const relativePath = requestPath.replace(/^\/app\/?/, '');
	if (relativePath === '' || relativePath.endsWith('/')) {
		serveAppIndex(response);
		return;
	}

	const filePath = path.join(distDir, relativePath || 'index.html');

	if (!filePath.startsWith(distDir)) {
		send(response, 403, 'Forbidden', appHeaders);
		return;
	}

	if (!fileExists(filePath)) {
		serveAppIndex(response);
		return;
	}

	serveFile(response, filePath);
};

const server = http.createServer(async (request, response) => {
	try {
		const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

		if (url.pathname === '/health') {
			send(response, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' });
			return;
		}

		if (url.pathname === '/logout') {
			clearCookie(response);
			clearVaultCookie(response);
			redirect(response, '/login');
			return;
		}

		if (url.pathname === '/login' && request.method === 'GET') {
			if (isAuthenticated(request)) {
				redirect(response, '/vaults');
				return;
			}

			send(response, 200, loginPage(''), {
				'Content-Type': 'text/html; charset=utf-8',
				'Cache-Control': 'no-store',
			});
			return;
		}

		if (url.pathname === '/login' && request.method === 'POST') {
			await handleLogin(request, response);
			return;
		}

		if (url.pathname === '/') {
			redirect(response, isAuthenticated(request) ? '/vaults' : '/login');
			return;
		}

		if (url.pathname === '/app') {
			redirect(response, '/app/');
			return;
		}

		if (url.pathname === '/vaults') {
			if (!isAuthenticated(request)) {
				redirect(response, '/login');
				return;
			}
			send(response, 200, vaultPage(), {
				'Content-Type': 'text/html; charset=utf-8',
				'Cache-Control': 'no-store',
			});
			return;
		}

		if (url.pathname === '/joplin-proxy') {
			if (!isAuthenticated(request)) {
				send(response, 401, JSON.stringify({ error: 'Authentication required' }), { 'Content-Type': 'application/json; charset=utf-8' });
				return;
			}
			await handleJoplinProxy(request, response, url);
			return;
		}

		// Vault API — require auth.
		if (url.pathname.startsWith('/api/vault') && !isAuthenticated(request)) {
			send(response, 401, JSON.stringify({ error: 'Authentication required' }), { 'Content-Type': 'application/json; charset=utf-8' });
			return;
		}

		if (url.pathname === '/api/vaults' && request.method === 'GET') {
			handleVaultApiList(response);
			return;
		}

		if (url.pathname === '/api/vaults' && request.method === 'POST') {
			await handleVaultApiCreate(request, response);
			return;
		}

		const vaultIdMatch = url.pathname.match(/^\/api\/vaults\/([^/]+)$/);
		if (vaultIdMatch) {
			const vaultId = vaultIdMatch[1];
			if (request.method === 'DELETE') {
				handleVaultApiDelete(response, vaultId);
				return;
			}
		}

		const vaultSaltMatch = url.pathname.match(/^\/api\/vaults\/([^/]+)\/salt$/);
		if (vaultSaltMatch && request.method === 'GET') {
			handleVaultApiGetSalt(response, vaultSaltMatch[1]);
			return;
		}

		const vaultVerifierMatch = url.pathname.match(/^\/api\/vaults\/([^/]+)\/verifier$/);
		if (vaultVerifierMatch && request.method === 'PUT') {
			await handleVaultApiPutVerifier(request, response, vaultVerifierMatch[1]);
			return;
		}

		const vaultOpenMatch = url.pathname.match(/^\/api\/vaults\/([^/]+)\/open$/);
		if (vaultOpenMatch && request.method === 'POST') {
			await handleVaultApiOpen(request, response, vaultOpenMatch[1]);
			return;
		}

		const vaultBlobMatch = url.pathname.match(/^\/api\/vaults\/([^/]+)\/blob$/);
		if (vaultBlobMatch) {
			const vaultId = vaultBlobMatch[1];
			if (request.method === 'GET') {
				handleVaultApiGetBlob(response, vaultId);
				return;
			}
			if (request.method === 'PUT') {
				await handleVaultApiPutBlob(request, response, vaultId);
				return;
			}
		}

		if (url.pathname.startsWith('/app/')) {
			if (!isPublicAppAsset(url.pathname) && !isAuthenticated(request)) {
				if ((request.headers.accept || '').includes('text/html')) {
					redirect(response, '/login');
				} else {
					send(response, 401, 'Authentication required', { 'Content-Type': 'text/plain; charset=utf-8' });
				}
				return;
			}

			serveApp(request, response, url.pathname);
			return;
		}

		send(response, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
	} catch (error) {
		console.error(error);
		send(response, 500, 'Internal server error', { 'Content-Type': 'text/plain; charset=utf-8' });
	}
});

server.listen(port, host, () => {
	process.stdout.write(`Joplin mobile web server listening on http://${host}:${port}\n`);
});
