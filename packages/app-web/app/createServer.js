const http = require('http');
const fs = require('fs');
const path = require('path');
const { sessionIdFromHeaders } = require('./auth/cookies');
const templates = require('./templates');

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

const sendHtml = (response, statusCode, html) => {
	send(response, statusCode, html, {
		'Cache-Control': 'no-store',
		'Content-Type': 'text/html; charset=utf-8',
	});
};

const sendJson = (response, statusCode, body) => {
	send(response, statusCode, JSON.stringify(body), {
		'Cache-Control': 'no-store',
		'Content-Type': 'application/json; charset=utf-8',
	});
};

const readBody = request => {
	return new Promise((resolve, reject) => {
		let body = '';
		request.setEncoding('utf8');
		request.on('data', chunk => {
			body += chunk;
		});
		request.on('end', () => resolve(body));
		request.on('error', reject);
	});
};

const readRawBody = request => {
	return new Promise((resolve, reject) => {
		const chunks = [];
		request.on('data', chunk => chunks.push(chunk));
		request.on('end', () => resolve(Buffer.concat(chunks)));
		request.on('error', reject);
	});
};

// Minimal multipart parser — extracts the first file field
const parseMultipart = (buffer, contentType) => {
	const match = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
	if (!match) return null;
	const boundary = match[1] || match[2];
	const boundaryBuf = Buffer.from(`--${boundary}`);

	// Find first occurrence after the boundary
	let start = buffer.indexOf(boundaryBuf);
	if (start === -1) return null;
	start += boundaryBuf.length;

	// Find the header/body separator (\r\n\r\n)
	const headerEnd = buffer.indexOf('\r\n\r\n', start);
	if (headerEnd === -1) return null;
	const headerStr = buffer.slice(start, headerEnd).toString('utf8');

	// Extract filename and content-type from headers
	const fnMatch = headerStr.match(/filename="([^"]+)"/);
	const ctMatch = headerStr.match(/Content-Type:\s*(.+)/i);
	const filename = fnMatch ? fnMatch[1] : 'upload';
	const fileMime = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';

	const bodyStart = headerEnd + 4;
	// Find ending boundary
	const endBoundary = buffer.indexOf(boundaryBuf, bodyStart);
	// The body ends 2 bytes before the next boundary (\r\n)
	const bodyEnd = endBoundary !== -1 ? endBoundary - 2 : buffer.length;

	return {
		filename,
		mime: fileMime,
		data: buffer.slice(bodyStart, bodyEnd),
	};
};

const parseBody = async request => {
	const raw = await readBody(request);
	if (!raw) return {};
	const contentType = request.headers['content-type'] || '';
	if (contentType.includes('application/json')) {
		return JSON.parse(raw);
	}
	// Parse URL-encoded form data (htmx default)
	const params = new URLSearchParams(raw);
	const result = {};
	for (const [key, value] of params) {
		result[key] = value;
	}
	return result;
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
			const responseHeaders = { ...upstreamResponse.headers };
			if (responseHeaders.location) {
				const location = responseHeaders.location;
				if (location === '/' || location === `${joplinPublicBasePath}` || location === `${joplinPublicBasePath}/`) {
					responseHeaders.location = '/';
				} else if (location.startsWith('/')) {
					responseHeaders.location = `${joplinPublicBasePath}${location}`;
				}
			}
			response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
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

		// --- Health check ---
		if (url.pathname === '/health') {
			send(response, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' });
			return;
		}

		// --- htmx fragment: create folder ---
		if (url.pathname === '/fragments/folders' && request.method === 'POST') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }

				const body = await parseBody(request);
				const title = `${body.title || ''}`.trim();
				if (!title) { sendHtml(response, 400, '<div class="empty-hint">Folder title is required.</div>'); return; }

				await itemWriteService.createFolder(auth.user.sessionId, { title, parentId: body.parentId || '' }, upstreamRequestContext(request));
				const folders = await itemService.foldersByUserId(auth.user.id);
				sendHtml(response, 200, templates.folderListFragment(folders, ''));
			} catch (error) {
				sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
			}
			return;
		}

		if (url.pathname.startsWith('/fragments/folders/') && request.method === 'DELETE') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }

				const folderId = decodeURIComponent(url.pathname.slice('/fragments/folders/'.length));
				await itemWriteService.deleteFolder(auth.user.sessionId, folderId, upstreamRequestContext(request));
				const folders = await itemService.foldersByUserId(auth.user.id);
				sendHtml(response, 200, templates.folderListFragment(folders, ''));
			} catch (error) {
				sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
			}
			return;
		}

		// --- htmx fragment: note list ---
		if (url.pathname === '/fragments/notes' && request.method === 'GET') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }

				const folderId = url.searchParams.get('folderId') || '';
				const notes = folderId ? await itemService.notesByUserId(auth.user.id, { folderId }) : [];
				sendHtml(response, 200, templates.noteListFragment(notes, '', folderId));
			} catch (error) {
				sendHtml(response, 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
			}
			return;
		}

		if (url.pathname === '/fragments/notes' && request.method === 'POST') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }

				const body = await parseBody(request);
				const parentId = `${body.parentId || ''}`;
				if (!parentId) { sendHtml(response, 400, '<div class="empty-hint">Select a folder first.</div>'); return; }

				await itemWriteService.createNote(auth.user.sessionId, {
					title: `${body.title || ''}`.trim() || 'Untitled note',
					body: '',
					parentId,
				}, upstreamRequestContext(request));

				const notes = await itemService.notesByUserId(auth.user.id, { folderId: parentId });
				sendHtml(response, 200, templates.noteListFragment(notes, '', parentId));
			} catch (error) {
				sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
			}
			return;
		}

		if (url.pathname.startsWith('/fragments/notes/') && !url.pathname.startsWith('/fragments/editor/') && request.method === 'DELETE') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }

				const noteId = decodeURIComponent(url.pathname.slice('/fragments/notes/'.length));
				const existing = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
				const folderId = existing ? existing.parentId : '';
				await itemWriteService.deleteNote(auth.user.sessionId, noteId, upstreamRequestContext(request));
				const notes = folderId ? await itemService.notesByUserId(auth.user.id, { folderId }) : [];
				sendHtml(response, 200, `${templates.noteListFragment(notes, '', folderId)}<div id="editor-panel" hx-swap-oob="innerHTML"><div class="editor-empty">Select a note</div></div>`);
			} catch (error) {
				sendHtml(response, error.statusCode || 500, `<div class="empty-hint">Error: ${templates.escapeHtml(error.message || `${error}`)}</div>`);
			}
			return;
		}

		// --- Resource binary serving ---
		if (url.pathname.startsWith('/resources/') && request.method === 'GET') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { send(response, 401, 'Unauthorized', { 'Content-Type': 'text/plain' }); return; }

				const resourceId = decodeURIComponent(url.pathname.slice('/resources/'.length));
				if (!resourceId || !/^[0-9a-zA-Z]{32}$/.test(resourceId)) {
					send(response, 400, 'Invalid resource ID', { 'Content-Type': 'text/plain' });
					return;
				}

				const [meta, blob] = await Promise.all([
					itemService.resourceMetaByUserId(auth.user.id, resourceId),
					itemService.resourceBlobByUserId(auth.user.id, resourceId),
				]);

				if (!blob) { send(response, 404, 'Resource not found', { 'Content-Type': 'text/plain' }); return; }

				const mime = (meta && meta.mime) || 'application/octet-stream';
				response.writeHead(200, {
					'Content-Type': mime,
					'Content-Length': blob.length,
					'Cache-Control': 'private, max-age=3600',
				});
				response.end(blob);
			} catch (error) {
				send(response, 500, 'Error loading resource', { 'Content-Type': 'text/plain' });
			}
			return;
		}

		// --- File upload (multipart) ---
		if (url.pathname === '/fragments/upload' && request.method === 'POST') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: 'Session expired' }); return; }

				const contentType = request.headers['content-type'] || '';
				if (!contentType.includes('multipart/form-data')) {
					sendJson(response, 400, { error: 'Expected multipart/form-data' });
					return;
				}

				const rawBody = await readRawBody(request);
				const file = parseMultipart(rawBody, contentType);
				if (!file || !file.data.length) {
					sendJson(response, 400, { error: 'No file uploaded' });
					return;
				}

				const extMatch = file.filename.match(/\.([^.]+)$/);
				const fileExtension = extMatch ? extMatch[1].toLowerCase() : '';

				const created = await itemWriteService.createResource(auth.user.sessionId, {
					title: file.filename,
					mime: file.mime,
					filename: file.filename,
					fileExtension,
					size: file.data.length,
				}, file.data, upstreamRequestContext(request));

				const isImage = file.mime.startsWith('image/');
				const markdown = isImage
					? `![${file.filename}](:/${created.id})`
					: `[${file.filename}](:/${created.id})`;

				sendJson(response, 200, { resourceId: created.id, markdown });
			} catch (error) {
				sendJson(response, error.statusCode || 500, { error: error.message || 'Upload failed' });
			}
			return;
		}

		// --- htmx fragment: search ---
		if (url.pathname === '/fragments/search' && request.method === 'GET') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="empty-hint">Session expired.</div>'); return; }

				const query = url.searchParams.get('q') || '';
				if (!query.trim()) { sendHtml(response, 200, ''); return; }
				const notes = await itemService.searchNotes(auth.user.id, query);
				sendHtml(response, 200, templates.searchResultsFragment(notes));
			} catch (error) {
				sendHtml(response, 500, '<div class="empty-hint">Search error</div>');
			}
			return;
		}

		// --- htmx fragment: note editor ---
		if (url.pathname.startsWith('/fragments/editor/') && request.method === 'GET') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<div class="editor-empty">Session expired.</div>'); return; }

				const noteId = decodeURIComponent(url.pathname.slice('/fragments/editor/'.length));
				const note = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
				if (!note) { sendHtml(response, 404, '<div class="editor-empty">Note not found.</div>'); return; }
				sendHtml(response, 200, templates.editorFragment(note));
			} catch (error) {
				sendHtml(response, 500, '<div class="editor-empty">Error</div>');
			}
			return;
		}

		if (url.pathname.startsWith('/fragments/editor/') && request.method === 'PUT') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendHtml(response, 401, '<span class="autosave-error">Session expired</span>'); return; }

				const noteId = decodeURIComponent(url.pathname.slice('/fragments/editor/'.length));
				const existing = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
				if (!existing) { sendHtml(response, 404, '<span class="autosave-error">Note not found</span>'); return; }

				const body = await parseBody(request);
				await itemWriteService.updateNote(auth.user.sessionId, existing, {
					title: body.title,
					body: body.body,
				}, upstreamRequestContext(request));

				// Build OOB swap to update the note list item sidebar
				const updatedNote = {
					...existing,
					title: body.title !== undefined ? body.title : existing.title,
					bodyPreview: body.body !== undefined ? `${body.body}`.slice(0, 100) : existing.bodyPreview,
				};
				const oobItem = templates.noteListItem(updatedNote, noteId)
					.replace(/^<button /, '<button hx-swap-oob="true" ');

				sendHtml(response, 200, templates.autosaveStatusFragment() + oobItem);
			} catch (error) {
				sendHtml(response, error.statusCode || 500, '<span class="autosave-error">Save failed</span>');
			}
			return;
		}

		// --- Logout (htmx) ---
		if (url.pathname === '/logout' && request.method === 'POST') {
			// Proxy logout to Joplin Server then return logged-out page
			const logoutUrl = new URL(joplinServerOrigin);
			const headers = { ...request.headers };
			headers.host = request.headers.host || configuredPublicUrl.host;
			headers['x-forwarded-host'] = headers.host;
			headers['x-forwarded-proto'] = (request.headers['x-forwarded-proto'] || configuredPublicUrl.protocol.replace(':', ''));
			delete headers.origin;
			delete headers.referer;

			const upstreamReq = http.request({
				hostname: logoutUrl.hostname,
				port: logoutUrl.port,
				path: '/logout',
				method: 'POST',
				headers,
			}, () => {
				sendHtml(response, 200, templates.loggedOutPage(joplinPublicBasePath));
			});
			upstreamReq.on('error', () => {
				sendHtml(response, 200, templates.loggedOutPage(joplinPublicBasePath));
			});
			request.pipe(upstreamReq);
			return;
		}

		// --- JSON API (kept for potential programmatic use) ---
		if (url.pathname === '/api/web/me') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
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
					if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
					const body = await parseBody(request);
					const title = `${body.title || ''}`.trim();
					if (!title) { sendJson(response, 400, { error: 'Folder title is required' }); return; }
					const created = await itemWriteService.createFolder(auth.user.sessionId, { title, parentId: body.parentId || '' }, upstreamRequestContext(request));
					const folder = await itemService.folderByUserIdAndJopId(auth.user.id, created.id);
					sendJson(response, 201, { item: folder });
				} catch (error) {
					sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
				}
				return;
			}
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
				const folders = await itemService.foldersByUserId(auth.user.id);
				sendJson(response, 200, { items: folders });
			} catch (error) {
				sendJson(response, 500, { error: error.message || `${error}` });
			}
			return;
		}

		if (url.pathname.startsWith('/api/web/folders/') && request.method === 'DELETE') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
				const folderId = decodeURIComponent(url.pathname.slice('/api/web/folders/'.length));
				if (!folderId) { sendJson(response, 404, { error: 'Folder not found' }); return; }
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
					if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
					const body = await parseBody(request);
					const parentId = `${body.parentId || ''}`;
					if (!parentId) { sendJson(response, 400, { error: 'Note parentId is required' }); return; }
					const created = await itemWriteService.createNote(auth.user.sessionId, {
						title: `${body.title || ''}`.trim() || 'Untitled note',
						body: `${body.body || ''}`,
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
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
				const folderId = url.searchParams.get('folderId') || '';
				const notes = await itemService.notesByUserId(auth.user.id, { folderId });
				sendJson(response, 200, { items: notes });
			} catch (error) {
				sendJson(response, 500, { error: error.message || `${error}` });
			}
			return;
		}

		if (url.pathname.startsWith('/api/web/notes/')) {
			const noteId = decodeURIComponent(url.pathname.slice('/api/web/notes/'.length));
			if (request.method === 'PUT') {
				try {
					const auth = await authenticatedUser(request);
					if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
					if (!noteId) { sendJson(response, 404, { error: 'Note not found' }); return; }
					const existing = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
					if (!existing) { sendJson(response, 404, { error: 'Note not found' }); return; }
					const body = await parseBody(request);
					const updated = await itemWriteService.updateNote(auth.user.sessionId, existing, {
						title: body.title, body: body.body, parentId: body.parentId,
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
					if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
					if (!noteId) { sendJson(response, 404, { error: 'Note not found' }); return; }
					await itemWriteService.deleteNote(auth.user.sessionId, noteId, upstreamRequestContext(request));
					sendJson(response, 204, {});
				} catch (error) {
					sendJson(response, error.statusCode || 500, { error: error.message || `${error}` });
				}
				return;
			}
			try {
				const auth = await authenticatedUser(request);
				if (auth.error) { sendJson(response, 401, { error: auth.error }); return; }
				if (!noteId) { sendJson(response, 404, { error: 'Note not found' }); return; }
				const note = await itemService.noteByUserIdAndJopId(auth.user.id, noteId);
				if (!note) { sendJson(response, 404, { error: 'Note not found' }); return; }
				sendJson(response, 200, { item: note });
			} catch (error) {
				sendJson(response, 500, { error: error.message || `${error}` });
			}
			return;
		}

		// --- Joplin Server proxy ---
		if (url.pathname === joplinPublicBasePath || url.pathname.startsWith(`${joplinPublicBasePath}/`)) {
			proxyToJoplinServer(request, response, url);
			return;
		}

		// --- SSR full page (GET /) ---
		const relativePath = url.pathname === '/' ? '/index.html' : url.pathname;

		if (relativePath === '/index.html') {
			try {
				const auth = await authenticatedUser(request);
				if (auth.error || !auth.user) {
					sendHtml(response, 200, templates.layoutPage({ user: null, joplinBasePath: joplinPublicBasePath }));
					return;
				}

				const folders = await itemService.foldersByUserId(auth.user.id);
				const selectedFolderId = folders.length ? folders[0].id : '';
				const notes = selectedFolderId ? await itemService.notesByUserId(auth.user.id, { folderId: selectedFolderId }) : [];
				const sidebarContent = templates.folderListFragment(folders, selectedFolderId);
				const notelistContent = templates.noteListFragment(notes, '', selectedFolderId);

				sendHtml(response, 200, templates.layoutPage({
					user: auth.user,
					sidebarContent,
					notelistContent,
					joplinBasePath: joplinPublicBasePath,
				}));
			} catch (error) {
				sendHtml(response, 200, templates.layoutPage({ user: null, joplinBasePath: joplinPublicBasePath }));
			}
			return;
		}

		// --- Static files ---
		const filePath = path.join(publicDir, relativePath.replace(/^\/+/, ''));

		if (filePath.startsWith(publicDir) && fileExists(filePath) && !relativePath.endsWith('/')) {
			serveFile(response, filePath);
			return;
		}

		// Fallback: serve SSR page for any unknown path (SPA-like)
		try {
			const auth = await authenticatedUser(request);
			if (auth.error || !auth.user) {
				sendHtml(response, 200, templates.layoutPage({ user: null, joplinBasePath: joplinPublicBasePath }));
				return;
			}
			const folders = await itemService.foldersByUserId(auth.user.id);
			sendHtml(response, 200, templates.layoutPage({
				user: auth.user,
				sidebarContent: templates.folderListFragment(folders, ''),
				notelistContent: '',
				joplinBasePath: joplinPublicBasePath,
			}));
		} catch (error) {
			sendHtml(response, 200, templates.layoutPage({ user: null, joplinBasePath: joplinPublicBasePath }));
		}
	});
};

module.exports = {
	createServer,
};
