const http = require('http');
const fs = require('fs');
const path = require('path');
const { sessionIdFromHeaders } = require('./auth/cookies');

const contentTypes = {
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.webmanifest': 'application/manifest+json; charset=utf-8',
};

const fileExists = filePath => {
	try {
		return fs.statSync(filePath).isFile();
	} catch (error) {
		return false;
	}
};

const send = (response, statusCode, body, headers = {}) => {
	response.writeHead(statusCode, headers);
	response.end(body);
};

const sendJson = (response, statusCode, body) => {
	send(response, statusCode, JSON.stringify(body), {
		'Cache-Control': 'no-store',
		'Content-Type': 'application/json; charset=utf-8',
	});
};

const serveFile = (response, filePath) => {
	const extension = path.extname(filePath).toLowerCase();
	const contentType = contentTypes[extension] || 'application/octet-stream';
	const stat = fs.statSync(filePath);

	response.writeHead(200, {
		'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=300',
		'Content-Length': stat.size,
		'Content-Type': contentType,
	});

	fs.createReadStream(filePath).pipe(response);
};

const createServer = options => {
	const {
		publicDir,
		renderIndex,
		joplinPublicBasePath,
		joplinServerOrigin,
		sessionService,
		itemService,
	} = options;

	const authenticatedUser = async request => {
		const sessionId = sessionIdFromHeaders(request.headers);
		if (!sessionId) return { error: 'Missing session', user: null };
		const user = await sessionService.userBySessionId(sessionId);
		if (!user) return { error: 'Invalid or expired session', user: null };
		return { error: null, user };
	};

	const proxyToJoplinServer = (request, response, url) => {
		const targetPath = url.pathname.replace(joplinPublicBasePath, '') || '/';
		const targetUrl = new URL(joplinServerOrigin);
		const headers = { ...request.headers };
		headers.host = request.headers.host || '';
		delete headers.origin;
		delete headers.referer;
		headers['x-forwarded-host'] = request.headers.host || '';
		headers['x-forwarded-proto'] = (request.headers['x-forwarded-proto'] || 'http');

		const upstreamRequest = http.request({
			hostname: targetUrl.hostname,
			port: targetUrl.port,
			path: targetPath + url.search,
			method: request.method,
			headers,
		}, upstreamResponse => {
			response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
			upstreamResponse.pipe(response);
		});

		upstreamRequest.on('error', error => {
			send(response, 502, `Upstream Joplin Server proxy error: ${error.message}`, {
				'Content-Type': 'text/plain; charset=utf-8',
			});
		});

		request.pipe(upstreamRequest);
	};

	return http.createServer(async (request, response) => {
		const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

		if (url.pathname === '/health') {
			send(response, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' });
			return;
		}

		if (url.pathname === '/api/web/me') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) {
					sendJson(response, 401, { error: auth.error });
					return;
				}
				sendJson(response, 200, { user: auth.user });
			} catch (error) {
				sendJson(response, 500, { error: error.message || `${error}` });
			}
			return;
		}

		if (url.pathname === '/api/web/folders') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) {
					sendJson(response, 401, { error: auth.error });
					return;
				}
				const folders = await itemService.foldersByUserId(auth.user.id);
				sendJson(response, 200, { items: folders });
			} catch (error) {
				sendJson(response, 500, { error: error.message || `${error}` });
			}
			return;
		}

		if (url.pathname === '/api/web/notes') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) {
					sendJson(response, 401, { error: auth.error });
					return;
				}
				const folderId = url.searchParams.get('folderId') || '';
				const notes = await itemService.notesByUserId(auth.user.id, { folderId });
				sendJson(response, 200, { items: notes });
			} catch (error) {
				sendJson(response, 500, { error: error.message || `${error}` });
			}
			return;
		}

		if (url.pathname.startsWith('/api/web/notes/')) {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) {
					sendJson(response, 401, { error: auth.error });
					return;
				}

				const noteId = decodeURIComponent(url.pathname.slice('/api/web/notes/'.length));
				if (!noteId) {
					sendJson(response, 404, { error: 'Note not found' });
					return;
				}

				const note = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
				if (!note) {
					sendJson(response, 404, { error: 'Note not found' });
					return;
				}

				sendJson(response, 200, { item: note });
			} catch (error) {
				sendJson(response, 500, { error: error.message || `${error}` });
			}
			return;
		}

		if (url.pathname === joplinPublicBasePath || url.pathname.startsWith(`${joplinPublicBasePath}/`)) {
			proxyToJoplinServer(request, response, url);
			return;
		}

		const relativePath = url.pathname === '/' ? '/index.html' : url.pathname;

		if (relativePath === '/index.html') {
			send(response, 200, renderIndex(), {
				'Cache-Control': 'no-store',
				'Content-Type': 'text/html; charset=utf-8',
			});
			return;
		}

		const filePath = path.join(publicDir, relativePath.replace(/^\/+/, ''));

		if (filePath.startsWith(publicDir) && fileExists(filePath) && !relativePath.endsWith('/')) {
			serveFile(response, filePath);
			return;
		}

		send(response, 200, renderIndex(), {
			'Cache-Control': 'no-store',
			'Content-Type': 'text/html; charset=utf-8',
		});
	});
};

module.exports = {
	createServer,
};
