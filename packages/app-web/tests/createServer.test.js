const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createServer } = require('../app/createServer');

const request = (port, options = {}) => {
	const {
		path: requestPath = '/api/web/me',
		method = 'GET',
		headers = { Cookie: 'sessionId=test-session' },
		body = null,
		rawBody = null,
	} = options;

	return new Promise((resolve, reject) => {
		const req = http.request({
			hostname: '127.0.0.1',
			port,
			path: requestPath,
			method,
			headers,
		}, res => {
			const chunks = [];
			res.on('data', chunk => chunks.push(chunk));
			res.on('end', () => {
				const buf = Buffer.concat(chunks);
				resolve({ statusCode: res.statusCode, body: buf.toString('utf8'), rawBody: buf, headers: res.headers });
			});
		});
		req.on('error', reject);
		if (rawBody) {
			req.write(rawBody);
		} else if (body) {
			req.write(body);
		}
		req.end();
	});
};

const makePublicDir = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-public-'));
	// Copy htmx.min.js stub so static file serving works
	fs.writeFileSync(path.join(dir, 'htmx.min.js'), '// stub');
	return dir;
};

const defaultMocks = (overrides = {}) => ({
	publicDir: overrides.publicDir || makePublicDir(),
	joplinPublicBasePath: '/joplin',
	joplinPublicBaseUrl: 'http://localhost:5444',
	joplinServerPublicUrl: 'http://localhost:5444/joplin',
	joplinServerOrigin: 'http://server:22300',
	itemService: {
		foldersByUserId: async () => [],
		folderByUserIdAndJopId: async () => null,
		notesByUserId: async () => [],
		noteHeadersByUserId: async () => [],
		noteByUserIdAndJopId: async () => null,
		searchNotes: async () => [],
		resourceBlobByUserId: async () => null,
		resourceMetaByUserId: async () => null,
		...overrides.itemService,
	},
	itemWriteService: {
		createFolder: async () => ({ id: 'folder-created' }),
		deleteFolder: async () => {},
		createNote: async () => ({ id: 'note-created' }),
		deleteNote: async () => {},
		trashNote: async () => {},
		restoreNote: async () => {},
		updateNote: async () => ({ id: 'note-updated' }),
		createResource: async () => ({ id: 'res-created' }),
		...overrides.itemWriteService,
	},
	sessionService: {
		userBySessionId: async sessionId => {
			if (sessionId === 'test-session') return { id: 'user-1', email: 'user@example.com', sessionId };
			return null;
		},
		...overrides.sessionService,
	},
});

const withServer = async (mocks, fn) => {
	const server = createServer(defaultMocks(mocks));
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const port = server.address().port;
	try {
		await fn(port);
	} finally {
		await new Promise(resolve => server.close(resolve));
	}
};

// --- JSON API tests ---

test('GET /api/web/me returns current user for valid session', async () => {
	await withServer({}, async port => {
		const res = await request(port);
		assert.equal(res.statusCode, 200);
		const payload = JSON.parse(res.body);
		assert.equal(payload.user.email, 'user@example.com');
	});
});

test('GET /api/web/me returns 401 for invalid session', async () => {
	await withServer({}, async port => {
		const res = await request(port, { headers: { Cookie: 'sessionId=bad' } });
		assert.equal(res.statusCode, 401);
	});
});

test('GET /api/web/folders returns folders', async () => {
	await withServer({
		itemService: {
			foldersByUserId: async () => [{ id: 'f1', title: 'Test', parentId: '', createdTime: 0, updatedTime: 0 }],
		},
	}, async port => {
		const res = await request(port, { path: '/api/web/folders' });
		assert.equal(res.statusCode, 200);
		const payload = JSON.parse(res.body);
		assert.equal(payload.items.length, 1);
		assert.equal(payload.items[0].id, 'f1');
	});
});

test('POST /api/web/folders creates folder', async () => {
	let createdFolder = null;
	await withServer({
		itemWriteService: {
			createFolder: async (_sid, folder) => { createdFolder = folder; return { id: 'f-new' }; },
		},
		itemService: {
			folderByUserIdAndJopId: async () => ({ id: 'f-new', title: 'New', parentId: '' }),
		},
	}, async port => {
		const res = await request(port, {
			path: '/api/web/folders',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: 'New' }),
		});
		assert.equal(res.statusCode, 201);
		assert.equal(createdFolder.title, 'New');
	});
});

test('PUT /api/web/notes/:id updates note', async () => {
	const existing = { id: 'n1', title: 'Old', body: 'Old body', parentId: 'f1', createdTime: 1000 };
	let updateArgs = null;
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async () => existing,
		},
		itemWriteService: {
			updateNote: async (_sid, ex, updates) => { updateArgs = { ex, updates }; return { id: ex.id }; },
		},
	}, async port => {
		const res = await request(port, {
			path: '/api/web/notes/n1',
			method: 'PUT',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: 'New', body: 'New body' }),
		});
		assert.equal(res.statusCode, 200);
		assert.equal(updateArgs.updates.title, 'New');
		assert.equal(updateArgs.updates.body, 'New body');
	});
});

test('PUT /api/web/notes/:id returns 404 for missing note', async () => {
	await withServer({
		itemService: { noteByUserIdAndJopId: async () => null },
	}, async port => {
		const res = await request(port, {
			path: '/api/web/notes/missing',
			method: 'PUT',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: 'X' }),
		});
		assert.equal(res.statusCode, 404);
	});
});

// --- htmx fragment tests ---

test('GET /fragments/nav returns HTML folder-note tree', async () => {
	await withServer({
		itemService: {
			foldersByUserId: async () => [
				{ id: 'f1', title: 'Folder 1', parentId: '', createdTime: 0, updatedTime: 0 },
			],
			noteHeadersByUserId: async () => [
				{ id: 'n1', title: 'Note 1', parentId: 'f1', updatedTime: 0 },
			],
			searchNotes: async () => [
				{ id: 'n1', title: 'Note 1', parentId: 'f1', updatedTime: 0 },
			],
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/nav?q=Note' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.headers['content-type'].includes('text/html'));
		assert.ok(res.body.includes('Folder 1'));
		assert.ok(res.body.includes('Note 1'));
		assert.ok(res.body.includes('id="nav-search"'));
		assert.ok(res.body.includes('class="nav-search-form"'));
		assert.ok(res.body.includes('&#128269;'));
		assert.ok(res.body.includes('value="Note"'));
		assert.ok(res.body.includes('hx-get="/fragments/editor/n1"'));
	});
});

test('GET /fragments/editor/:id returns HTML editor', async () => {
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async () => ({ id: 'n1', title: 'Test Note', body: 'Hello world', parentId: 'f1', createdTime: 1000, updatedTime: 2000 }),
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/editor/n1' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('hx-put="/fragments/editor/n1"'));
		assert.ok(res.body.includes('Test Note'));
		assert.ok(res.body.includes('Hello world'));
		assert.ok(res.body.includes('delay:1s'));
		assert.ok(res.body.includes('name="baseUpdatedTime" value="2000"'));
		assert.ok(res.body.includes('data-created-time="1000"'));
	});
});

test('PUT /fragments/editor/:id autosaves and returns status', async () => {
	let savedUpdates = null;
	const existing = { id: 'n1', title: 'Old', body: 'Old', parentId: 'f1', createdTime: 1000, updatedTime: 1000 };
	let callCount = 0;
	await withServer({
		itemService: { noteByUserIdAndJopId: async () => { callCount += 1; return callCount === 1 ? existing : { ...existing, title: 'Updated Title', body: 'Updated body', updatedTime: 2000 }; } },
		itemWriteService: {
			updateNote: async (_sid, _ex, updates) => { savedUpdates = updates; return { id: 'n1' }; },
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/editor/n1',
			method: 'PUT',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'title=Updated+Title&body=Updated+body&baseUpdatedTime=1000',
		});
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('Saved'));
		assert.ok(res.body.includes('hx-swap-oob="true"'), 'should include OOB swap');
		assert.ok(res.body.includes('id="note-item-n1"'), 'should target note list item');
		assert.ok(res.body.includes('Updated Title'), 'OOB item should have updated title');
		assert.ok(res.body.includes('name="baseUpdatedTime" value="2000"'));
		assert.equal(savedUpdates.title, 'Updated Title');
		assert.equal(savedUpdates.body, 'Updated body');
	});
});

test('PUT /fragments/editor/:id returns conflict status fragment when note changed remotely', async () => {
	await withServer({
		itemService: { noteByUserIdAndJopId: async () => ({ id: 'n1', title: 'Remote', body: 'Remote body', parentId: 'f1', createdTime: 1000, updatedTime: 2000 }) },
		itemWriteService: {
			updateNote: async () => { throw new Error('should not save'); },
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/editor/n1',
			method: 'PUT',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'title=Updated+Title&body=Updated+body&baseUpdatedTime=1000',
		});
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('Conflict'));
		assert.ok(res.body.includes('Overwrite'));
		assert.ok(res.body.includes('Create copy'));
	});
});

test('PUT /fragments/editor/:id can create copy on conflict', async () => {
	let createdArgs = null;
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async (_uid, id) => id === 'n-copy' ? { id: 'n-copy', title: 'Updated Title-3', body: 'Updated body', parentId: 'f1', createdTime: 3000, updatedTime: 3000 } : { id: 'n1', title: 'Remote', body: 'Remote body', parentId: 'f1', createdTime: 1000, updatedTime: 2000 },
			noteHeadersByUserId: async () => [
				{ id: 'n1', title: 'Updated Title', parentId: 'f1', updatedTime: 1000 },
				{ id: 'n2', title: 'Updated Title-1', parentId: 'f1', updatedTime: 1000 },
				{ id: 'n3', title: 'Updated Title-2', parentId: 'f1', updatedTime: 1000 },
			],
			foldersByUserId: async () => [{ id: 'f1', title: 'Folder 1', parentId: '' }],
		},
		itemWriteService: {
			createNote: async (_sid, note) => { createdArgs = note; return { id: 'n-copy' }; },
			updateNote: async () => { throw new Error('should not update'); },
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/editor/n1',
			method: 'PUT',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'title=Updated+Title&body=Updated+body&parentId=f1&baseUpdatedTime=1000&createCopy=1',
		});
		assert.equal(res.statusCode, 200);
		assert.equal(createdArgs.title, 'Updated Title-3');
		assert.equal(createdArgs.body, 'Updated body');
		assert.ok(res.body.includes('id="nav-panel" hx-swap-oob="innerHTML"'));
		assert.ok(res.body.includes('id="note-item-n-copy"'));
		assert.ok(res.body.includes('class="notelist-item active"'));
		assert.ok(res.body.includes('hx-put="/fragments/editor/n-copy"'));
	});
});

test('POST /fragments/folders creates folder and returns list', async () => {
	let created = false;
	await withServer({
		itemWriteService: {
			createFolder: async () => { created = true; return { id: 'f-new' }; },
		},
		itemService: {
			foldersByUserId: async () => [{ id: 'f-new', title: 'New Folder', parentId: '' }],
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/folders',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'title=New+Folder',
		});
		assert.equal(res.statusCode, 200);
		assert.ok(created);
		assert.ok(res.body.includes('New Folder'));
	});
});

test('POST /fragments/notes selects created note and loads editor', async () => {
	await withServer({
		itemWriteService: {
			createNote: async () => ({ id: 'n-new' }),
		},
		itemService: {
			noteHeadersByUserId: async () => [
				{ id: 'n-old', title: 'Old Note', parentId: 'f1', updatedTime: 0 },
				{ id: 'n-new', title: 'Untitled note', parentId: 'f1', updatedTime: 0 },
			],
			noteByUserIdAndJopId: async (_uid, id) => ({ id, title: 'Untitled note', body: '', parentId: 'f1', updatedTime: Date.now() }),
			foldersByUserId: async () => [{ id: 'f1', title: 'Folder 1', parentId: '' }],
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/notes',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'parentId=f1',
		});
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('id="note-item-n-new"'));
		assert.ok(res.body.includes('class="notelist-item active"'));
		assert.ok(res.body.includes('id="editor-panel" hx-swap-oob="innerHTML"'));
		assert.ok(res.body.includes('hx-put="/fragments/editor/n-new"'));
	});
});

test('DELETE /fragments/notes/:id trashes note and shows trash folder', async () => {
	let trashed = false;
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async () => ({ id: 'n1', title: 'Note 1', body: 'body', parentId: 'f1', createdTime: 1000, updatedTime: 1000, deletedTime: 0 }),
			noteHeadersByUserId: async (_uid, options = {}) => options.deleted === 'only' ? [{ id: 'n1', title: 'Note 1', parentId: 'f1', updatedTime: 1000, deletedTime: 2000 }] : [],
			foldersByUserId: async () => [{ id: 'f1', title: 'Folder 1', parentId: '' }],
		},
		itemWriteService: {
			trashNote: async () => { trashed = true; },
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/notes/n1',
			method: 'DELETE',
			headers: { Cookie: 'sessionId=test-session' },
		});
		assert.equal(res.statusCode, 200);
		assert.ok(trashed);
		assert.ok(res.body.includes('Trash'));
		assert.ok(res.body.includes('id="editor-panel" hx-swap-oob="innerHTML"'));
	});
});

test('DELETE /fragments/notes/:id permanently deletes trashed note', async () => {
	let deleted = false;
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async (_uid, _id, options = {}) => options.deleted === 'only' ? { id: 'n1', title: 'Note 1', body: 'body', parentId: 'f1', createdTime: 1000, updatedTime: 1000, deletedTime: 2000 } : null,
			noteHeadersByUserId: async () => [],
			foldersByUserId: async () => [{ id: 'f1', title: 'Folder 1', parentId: '' }],
		},
		itemWriteService: {
			deleteNote: async () => { deleted = true; },
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/notes/n1',
			method: 'DELETE',
			headers: { Cookie: 'sessionId=test-session' },
		});
		assert.equal(res.statusCode, 200);
		assert.ok(deleted);
	});
});

test('POST /fragments/notes/:id/restore restores trashed note', async () => {
	let restoreArgs = null;
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async (_uid, id, options = {}) => {
				if (options.deleted === 'only') return { id, title: 'Deleted Note', body: 'body', parentId: 'f2', createdTime: 1000, updatedTime: 2000, deletedTime: 2000 };
				return { id, title: 'Deleted Note', body: 'body', parentId: 'f2', createdTime: 1000, updatedTime: 3000, deletedTime: 0 };
			},
			noteHeadersByUserId: async (_uid, options = {}) => options.deleted === 'only' ? [] : [{ id: 'n1', title: 'Deleted Note', parentId: 'f2', updatedTime: 3000, deletedTime: 0 }],
			foldersByUserId: async () => [{ id: 'f1', title: 'Folder 1', parentId: '' }, { id: 'f2', title: 'Folder 2', parentId: '' }],
		},
		itemWriteService: {
			restoreNote: async (_sid, note, parentId) => { restoreArgs = { note, parentId }; },
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/notes/n1/restore',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session' },
		});
		assert.equal(res.statusCode, 200);
		assert.equal(restoreArgs.parentId, 'f2');
		assert.ok(res.body.includes('hx-put="/fragments/editor/n1"'));
	});
});

test('POST /fragments/trash/empty permanently deletes trashed notes', async () => {
	const deletedIds = [];
	await withServer({
		itemService: {
			noteHeadersByUserId: async (_uid, options = {}) => options.deleted === 'only' ? [{ id: 'n1', title: 'Deleted Note', parentId: 'f1', updatedTime: 1000, deletedTime: 2000 }] : [],
			foldersByUserId: async () => [],
		},
		itemWriteService: {
			deleteNote: async (_sid, id) => { deletedIds.push(id); },
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/trash/empty',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session' },
		});
		assert.equal(res.statusCode, 200);
		assert.deepEqual(deletedIds, ['n1']);
	});
});

test('GET / returns full SSR page for logged-in user', async () => {
	await withServer({
		itemService: {
			foldersByUserId: async () => [{ id: 'f1', title: 'My Folder', parentId: '' }],
			noteHeadersByUserId: async () => [],
		},
	}, async port => {
		const res = await request(port, { path: '/' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('<!DOCTYPE html>'));
		assert.ok(res.body.includes('Joplock'));
		assert.ok(res.body.includes('My Folder'));
		assert.ok(res.body.includes('Trash'));
		assert.ok(res.body.includes('htmx.min.js'));
		assert.ok(res.body.includes('apple-touch-icon.png'));
		assert.ok(res.body.includes('apple-touch-startup-image'));
	});
});

test('GET / redirects unauthenticated user to /login', async () => {
	await withServer({}, async port => {
		const res = await request(port, { path: '/', headers: {} });
		assert.equal(res.statusCode, 302);
		assert.equal(res.headers.location, '/login');
	});
});

test('GET /login returns login page for unauthenticated user', async () => {
	await withServer({}, async port => {
		const res = await request(port, { path: '/login', headers: {} });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('Login'));
		assert.ok(!res.body.includes('NOTEBOOKS'));
	});
});

test('GET /fragments/search returns matching notes', async () => {
	await withServer({
		itemService: {
			searchNotes: async (_uid, query) => {
				if (query === 'hello') {
					return [{ id: 'n1', title: 'Hello World', body: 'content', bodyPreview: 'content', parentId: 'f1' }];
				}
				return [];
			},
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/search?q=hello' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('Hello World'));
		assert.ok(res.body.includes('hx-get="/fragments/editor/n1"'));

		const empty = await request(port, { path: '/fragments/search?q=' });
		assert.equal(empty.statusCode, 200);
		assert.equal(empty.body, '');
	});
});

// --- Resource tests ---

test('GET /resources/:id serves binary blob with correct content-type', async () => {
	const blobData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]); // fake PNG header
	await withServer({
		itemService: {
			resourceMetaByUserId: async (_uid, rid) => {
				if (rid === 'abcdef01234567890abcdef012345678') return { id: rid, mime: 'image/png', title: 'test.png' };
				return null;
			},
			resourceBlobByUserId: async (_uid, rid) => {
				if (rid === 'abcdef01234567890abcdef012345678') return blobData;
				return null;
			},
		},
	}, async port => {
		const res = await request(port, { path: '/resources/abcdef01234567890abcdef012345678' });
		assert.equal(res.statusCode, 200);
		assert.equal(res.headers['cache-control'], 'no-store');
		assert.equal(res.headers['content-type'], 'image/png');
		assert.ok(res.rawBody.equals(blobData));
	});
});

test('POST /logout returns logged-out page and clears client state', async () => {
	await withServer({}, async port => {
		const res = await request(port, {
			path: '/logout',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session' },
		});
		assert.equal(res.statusCode, 200);
		assert.equal(res.headers['cache-control'], 'no-store');
		assert.equal(res.headers['clear-site-data'], '"cache", "storage"');
		const setCookie = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'].join('; ') : res.headers['set-cookie'];
		assert.ok(setCookie.includes('sessionId='));
		assert.ok(setCookie.includes('Max-Age=0'));
		assert.ok(res.body.includes('Cleanup complete'));
		assert.ok(res.body.includes('Go to login'));
	});
});

test('GET /logout returns logged-out page and clears client state', async () => {
	await withServer({}, async port => {
		const res = await request(port, {
			path: '/logout',
			method: 'GET',
			headers: { Cookie: 'sessionId=test-session' },
		});
		assert.equal(res.statusCode, 200);
		assert.equal(res.headers['cache-control'], 'no-store');
		assert.equal(res.headers['clear-site-data'], '"cache", "storage"');
		const setCookie = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'].join('; ') : res.headers['set-cookie'];
		assert.ok(setCookie.includes('sessionId='));
		assert.ok(setCookie.includes('Max-Age=0'));
		assert.ok(res.body.includes('Cleanup complete'));
		assert.ok(res.body.includes('Go to login'));
	});
});

test('GET /resources/:id returns 404 for missing resource', async () => {
	await withServer({}, async port => {
		const res = await request(port, { path: '/resources/abcdef01234567890abcdef012345678' });
		assert.equal(res.statusCode, 404);
	});
});

test('GET /resources/:id returns 400 for invalid resource ID', async () => {
	await withServer({}, async port => {
		const res = await request(port, { path: '/resources/not-valid' });
		assert.equal(res.statusCode, 400);
	});
});

test('POST /fragments/upload creates resource and returns markdown', async () => {
	let createdResource = null;
	let createdBuffer = null;
	await withServer({
		itemWriteService: {
			createResource: async (_sid, resource, buffer) => {
				createdResource = resource;
				createdBuffer = buffer;
				return { id: 'newresource01234567890abcdef01234' };
			},
		},
	}, async port => {
		const boundary = '----testboundary';
		const fileContent = Buffer.from('fake image data');
		const body = Buffer.concat([
			Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`),
			fileContent,
			Buffer.from(`\r\n--${boundary}--\r\n`),
		]);

		const res = await request(port, {
			path: '/fragments/upload',
			method: 'POST',
			headers: {
				Cookie: 'sessionId=test-session',
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
				'Content-Length': body.length,
			},
			rawBody: body,
		});
		assert.equal(res.statusCode, 200);
		const payload = JSON.parse(res.body);
		assert.equal(payload.resourceId, 'newresource01234567890abcdef01234');
		assert.ok(payload.markdown.includes('![photo.png](:/')); // image markdown
		assert.equal(createdResource.mime, 'image/png');
		assert.equal(createdResource.filename, 'photo.png');
		assert.equal(createdResource.fileExtension, 'png');
		assert.ok(createdBuffer.equals(fileContent));
	});
});

test('POST /fragments/upload returns 401 for unauthenticated user', async () => {
	await withServer({}, async port => {
		const res = await request(port, {
			path: '/fragments/upload',
			method: 'POST',
			headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
		});
		assert.equal(res.statusCode, 401);
	});
});

test('GET /fragments/editor/:id includes folder dropdown', async () => {
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async () => ({ id: 'n1', title: 'My Note', body: 'text', parentId: 'f2', updatedTime: Date.now() }),
			foldersByUserId: async () => [
				{ id: 'f1', title: 'Work', parentId: '' },
				{ id: 'f2', title: 'Personal', parentId: '' },
			],
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/editor/n1' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('<select name="parentId"'));
		assert.ok(res.body.includes('Work'));
		assert.ok(res.body.includes('Personal'));
		// f2 should be selected
		assert.ok(res.body.includes('value="f2" selected'));
	});
});

test('POST /fragments/preview renders markdown to HTML', async () => {
	await withServer({}, async port => {
		const res = await request(port, {
			path: '/fragments/preview',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'body=**bold**+and+*italic*',
		});
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('<strong>bold</strong>'));
		assert.ok(res.body.includes('<em>italic</em>'));
	});
});

test('POST /fragments/preview renders Joplin resource images', async () => {
	await withServer({}, async port => {
		const res = await request(port, {
			path: '/fragments/preview',
			method: 'POST',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'body=!%5Bphoto%5D(%3A%2Fabcdef01234567890abcdef012345678)',
		});
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('src="/resources/abcdef01234567890abcdef012345678"'));
		assert.ok(res.body.includes('class="preview-img"'));
	});
});
