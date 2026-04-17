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

const readJsonBody = request => {
	return new Promise((resolve, reject) => {
		let body = '';
		request.setEncoding('utf8');
		request.on('data', chunk => {
			body += chunk;
		});
		request.on('end', () => {
			if (!body) {
				resolve({});
				return;
			}

			try {
				resolve(JSON.parse(body));
			} catch (error) {
				reject(new Error('Invalid JSON body'));
			}
		});
		request.on('error', reject);
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
		joplinPublicBaseUrl,
		joplinServerOrigin,
		sessionService,
		itemService,
		itemWriteService,
	} = options;

	const configuredPublicUrl = new URL(joplinPublicBaseUrl);

	const authenticatedUser = async request => {
		const sessionId = sessionIdFromHeaders(request.headers);
		if (!sessionId) return { error: 'Missing session', user: null };
		const user = await sessionService.userBySessionId(sessionId);
		if (!user) return { error: 'Invalid or expired session', user: null };
		return { error: null, user };
	};

	const upstreamRequestContext = request => ({
		host: request.headers.host || configuredPublicUrl.host,
		protocol: request.headers['x-forwarded-proto'] || configuredPublicUrl.protocol.replace(':', ''),
	});

	const proxyToJoplinServer = (request, response, url) => {
		const targetPath = url.pathname.replace(joplinPublicBasePath, '') || '/';
		const targetUrl = new URL(joplinServerOrigin);
		const headers = { ...request.headers };
		headers.host = request.headers.host || configuredPublicUrl.host;
		delete headers.origin;
		delete headers.referer;
		headers['x-forwarded-host'] = request.headers.host || configuredPublicUrl.host;
		headers['x-forwarded-proto'] = (request.headers['x-forwarded-proto'] || configuredPublicUrl.protocol.replace(':', ''));

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
			if (request.method === 'POST') {
				try {
					const auth = await authenticatedUser(request);
					if (auth.error) {
						sendJson(response, 401, { error: auth.error });
						return;
					}

					const body = await readJsonBody(request);
					const title = `${body.title || ''}`.trim();
					const parentId = `${body.parentId || ''}`;
					if (!title) {
						sendJson(response, 400, { error: 'Folder title is required' });
						return;
					}

					const created = await itemWriteService.createFolder(auth.user.sessionId, { title, parentId }, upstreamRequestContext(request));
					const folder = await itemService.folderByUserIdAndJopId(auth.user.id, created.id);
					sendJson(response, 201, { item: folder });
				} catch (error) {
					sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
				}
				return;
			}

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

		if (request.method === 'DELETE' && url.pathname.startsWith('/api/web/folders/')) {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) {
					sendJson(response, 401, { error: auth.error });
					return;
				}

				const folderId = decodeURIComponent(url.pathname.slice('/api/web/folders/'.length));
				if (!folderId) {
					sendJson(response, 404, { error: 'Folder not found' });
					return;
				}

				await itemWriteService.deleteFolder(auth.user.sessionId, folderId, upstreamRequestContext(request));
				sendJson(response, 204, {});
			} catch (error) {
				sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
			}
			return;
		}

		if (url.pathname === '/api/web/notes') {
			if (request.method === 'POST') {
				try {
					const auth = await authenticatedUser(request);
					if (auth.error) {
						sendJson(response, 401, { error: auth.error });
						return;
					}

					const body = await readJsonBody(request);
					const title = `${body.title || ''}`.trim();
					const parentId = `${body.parentId || ''}`;
					const noteBody = `${body.body || ''}`;
					if (!parentId) {
						sendJson(response, 400, { error: 'Note parentId is required' });
						return;
					}

					const created = await itemWriteService.createNote(auth.user.sessionId, {
						title: title || 'Untitled note',
						body: noteBody,
						parentId,
					}, upstreamRequestContext(request));
					const note = await itemService.noteByUserIdAndJopId(auth.user.id, created.id);
					sendJson(response, 201, { item: note });
				} catch (error) {
					sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
				}
				return;
			}

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
			if (request.method === 'PUT') {
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

					const existing = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
					if (!existing) {
						sendJson(response, 404, { error: 'Note not found' });
						return;
					}

					const body = await readJsonBody(request);
					const updated = await itemWriteService.updateNote(auth.user.sessionId, existing, {
						title: body.title,
						body: body.body,
						parentId: body.parentId,
					}, upstreamRequestContext(request));

					const note = await itemService.noteByUserIdAndJopId(auth.user.id, updated.id);
					sendJson(response, 200, { item: note });
				} catch (error) {
					sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
				}
				return;
			}

			if (request.method === 'DELETE') {
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

					await itemWriteService.deleteNote(auth.user.sessionId, noteId, upstreamRequestContext(request));
					sendJson(response, 204, {});
				} catch (error) {
					sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
				}
				return;
			}

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
