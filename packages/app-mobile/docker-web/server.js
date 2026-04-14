const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || '3000');
const sessionCookieName = 'joplin_web_session';
const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;
const sessionSecret = process.env.APP_SESSION_SECRET || process.env.NEXTAUTH_SECRET || 'change-this-session-secret';
const distDir = path.join(__dirname, 'public');

const loginBackground = {
	dark: '#0a0a0f',
	light: '#eef2f7',
};

const appHeaders = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
	'Cross-Origin-Resource-Policy': 'cross-origin',
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

const clearCookie = response => {
	response.setHeader('Set-Cookie', `${sessionCookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
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
	const body = fs.readFileSync(indexPath, 'utf8').replace('</body>', `${String.raw`
		<a href="/logout" id="joplinLogoutLink" aria-label="Log out">Log out</a>
		<style>
			#joplinLogoutLink {
				position: fixed;
				top: max(16px, env(safe-area-inset-top));
				right: max(16px, env(safe-area-inset-right));
				z-index: 2147483647;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				padding: 10px 14px;
				border-radius: 999px;
				border: 1px solid rgba(255, 255, 255, 0.14);
				background: rgba(15, 23, 42, 0.72);
				backdrop-filter: blur(18px);
				-webkit-backdrop-filter: blur(18px);
				box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
				color: #eef2ff;
				font: 600 14px/1 Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
				text-decoration: none;
			}

			#joplinLogoutLink:hover {
				background: rgba(30, 41, 59, 0.82);
			}

			@media (prefers-color-scheme: light) {
				#joplinLogoutLink {
					border-color: rgba(15, 23, 42, 0.08);
					background: rgba(255, 255, 255, 0.78);
					color: #111827;
				}

				#joplinLogoutLink:hover {
					background: rgba(248, 250, 252, 0.92);
				}
			}
		</style>
	</body>`}`);

	send(response, 200, body, {
		...appHeaders,
		'Cache-Control': 'no-store',
		'Content-Type': 'text/html; charset=utf-8',
	});
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

				// Store the password in sessionStorage before form submit so the app
				// can derive the fs encryption key on first load, then clear it immediately.
				document.getElementById('loginForm').addEventListener('submit', function() {
					var pw = document.getElementById('password').value;
					if (pw) {
						sessionStorage.setItem('joplin-web-boot-password', pw);
					}
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
	redirect(response, '/app/');
};

const serveApp = (request, response, requestPath) => {
	const relativePath = requestPath.replace(/^\/app\/?/, '');
	let filePath = path.join(distDir, relativePath || 'index.html');

	if (relativePath === '' || relativePath.endsWith('/')) {
		filePath = path.join(distDir, relativePath, 'index.html');
	}

	if (!filePath.startsWith(distDir)) {
		send(response, 403, 'Forbidden', appHeaders);
		return;
	}

	if (!fileExists(filePath)) {
		filePath = path.join(distDir, 'index.html');
	}

	if (filePath === path.join(distDir, 'index.html')) {
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
			redirect(response, '/login');
			return;
		}

		if (url.pathname === '/login' && request.method === 'GET') {
			if (isAuthenticated(request)) {
				redirect(response, '/app/');
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
			redirect(response, isAuthenticated(request) ? '/app/' : '/login');
			return;
		}

		if (url.pathname === '/app') {
			redirect(response, '/app/');
			return;
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
