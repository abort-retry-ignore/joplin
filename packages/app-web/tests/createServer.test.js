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
	} = options;

	return new Promise((resolve, reject) => {
		const req = http.request({
			hostname: '127.0.0.1',
			port,
			path: requestPath,
			method,
			headers,
		}, res => {
			let responseBody = '';
			res.setEncoding('utf8');
			res.on('data', chunk => {
				responseBody += chunk;
			});
			res.on('end', () => resolve({ statusCode: res.statusCode, body: responseBody, headers: res.headers }));
		});
		req.on('error', reject);
		if (body) req.write(body);
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
	joplinServerOrigin: 'http://server:22300',
	itemService: {
		foldersByUserId: async () => [],
		folderByUserIdAndJopId: async () => null,
		notesByUserId: async () => [],
		noteByUserIdAndJopId: async () => null,
		...overrides.itemService,
	},
	itemWriteService: {
		createFolder: async () => ({ id: 'folder-created' }),
		deleteFolder: async () => {},
		createNote: async () => ({ id: 'note-created' }),
		deleteNote: async () => {},
		updateNote: async () => ({ id: 'note-updated' }),
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

test('GET /fragments/notes returns HTML note list', async () => {
	await withServer({
		itemService: {
			notesByUserId: async () => [
				{ id: 'n1', title: 'Note 1', body: 'Body', bodyPreview: 'Body', parentId: 'f1', isTodo: false, todoCompleted: 0, createdTime: 0, updatedTime: 0 },
			],
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/notes?folderId=f1' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.headers['content-type'].includes('text/html'));
		assert.ok(res.body.includes('Note 1'));
		assert.ok(res.body.includes('hx-get="/fragments/editor/n1"'));
	});
});

test('GET /fragments/editor/:id returns HTML editor', async () => {
	await withServer({
		itemService: {
			noteByUserIdAndJopId: async () => ({ id: 'n1', title: 'Test Note', body: 'Hello world', parentId: 'f1', updatedTime: Date.now() }),
		},
	}, async port => {
		const res = await request(port, { path: '/fragments/editor/n1' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('hx-put="/fragments/editor/n1"'));
		assert.ok(res.body.includes('Test Note'));
		assert.ok(res.body.includes('Hello world'));
		assert.ok(res.body.includes('delay:1s'));
	});
});

test('PUT /fragments/editor/:id autosaves and returns status', async () => {
	let savedUpdates = null;
	const existing = { id: 'n1', title: 'Old', body: 'Old', parentId: 'f1', createdTime: 1000 };
	await withServer({
		itemService: { noteByUserIdAndJopId: async () => existing },
		itemWriteService: {
			updateNote: async (_sid, _ex, updates) => { savedUpdates = updates; return { id: 'n1' }; },
		},
	}, async port => {
		const res = await request(port, {
			path: '/fragments/editor/n1',
			method: 'PUT',
			headers: { Cookie: 'sessionId=test-session', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'title=Updated+Title&body=Updated+body',
		});
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('Saved'));
		assert.ok(res.body.includes('hx-swap-oob="true"'), 'should include OOB swap');
		assert.ok(res.body.includes('id="note-item-n1"'), 'should target note list item');
		assert.ok(res.body.includes('Updated Title'), 'OOB item should have updated title');
		assert.equal(savedUpdates.title, 'Updated Title');
		assert.equal(savedUpdates.body, 'Updated body');
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

test('GET / returns full SSR page for logged-in user', async () => {
	await withServer({
		itemService: {
			foldersByUserId: async () => [{ id: 'f1', title: 'My Folder', parentId: '' }],
			notesByUserId: async () => [],
		},
	}, async port => {
		const res = await request(port, { path: '/' });
		assert.equal(res.statusCode, 200);
		assert.ok(res.body.includes('<!DOCTYPE html>'));
		assert.ok(res.body.includes('Joplock'));
		assert.ok(res.body.includes('My Folder'));
		assert.ok(res.body.includes('htmx.min.js'));
	});
});

test('GET / returns login page for unauthenticated user', async () => {
	await withServer({}, async port => {
		const res = await request(port, { path: '/', headers: {} });
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
