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
		headers = { Cookie: 'sessionId=test-session' },
	} = options;

	return new Promise((resolve, reject) => {
		const req = http.request({
			hostname: '127.0.0.1',
			port,
			path: requestPath,
			method: 'GET',
			headers,
		}, response => {
			let body = '';
			response.setEncoding('utf8');
			response.on('data', chunk => {
				body += chunk;
			});
			response.on('end', () => {
				resolve({
					statusCode: response.statusCode,
					body,
				});
			});
		});
		req.on('error', reject);
		req.end();
	});
};

test('GET /api/web/me returns current user for valid session', async () => {
	const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-public-'));
	fs.writeFileSync(path.join(publicDir, 'index.html'), '<html></html>');

	const server = createServer({
		publicDir,
		renderIndex: () => '<html></html>',
		joplinPublicBasePath: '/joplin',
		joplinServerOrigin: 'http://server:22300',
		itemService: {
			foldersByUserId: async () => [],
			notesByUserId: async () => [],
			noteByUserIdAndJopId: async () => null,
		},
		sessionService: {
			userBySessionId: async sessionId => ({
				id: 'user-1',
				email: 'user@example.com',
				fullName: 'User One',
				isAdmin: false,
				canUpload: true,
				sessionId,
			}),
		},
	});

	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const port = server.address().port;

	try {
		const response = await request(port);
		assert.equal(response.statusCode, 200);
		const payload = JSON.parse(response.body);
		assert.equal(payload.user.email, 'user@example.com');
		assert.equal(payload.user.id, 'user-1');
	} finally {
		await new Promise(resolve => server.close(resolve));
	}
});

test('GET /api/web/me returns 401 for invalid session', async () => {
	const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-public-'));
	fs.writeFileSync(path.join(publicDir, 'index.html'), '<html></html>');

	const server = createServer({
		publicDir,
		renderIndex: () => '<html></html>',
		joplinPublicBasePath: '/joplin',
		joplinServerOrigin: 'http://server:22300',
		itemService: {
			foldersByUserId: async () => [],
			notesByUserId: async () => [],
			noteByUserIdAndJopId: async () => null,
		},
		sessionService: {
			userBySessionId: async () => null,
		},
	});

	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const port = server.address().port;

	try {
		const response = await request(port);
		assert.equal(response.statusCode, 401);
		const payload = JSON.parse(response.body);
		assert.equal(payload.error, 'Invalid or expired session');
	} finally {
		await new Promise(resolve => server.close(resolve));
	}
});

test('GET /api/web/folders returns mapped folders for valid session', async () => {
	const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-public-'));
	fs.writeFileSync(path.join(publicDir, 'index.html'), '<html></html>');

	const server = createServer({
		publicDir,
		renderIndex: () => '<html></html>',
		joplinPublicBasePath: '/joplin',
		joplinServerOrigin: 'http://server:22300',
		itemService: {
			foldersByUserId: async () => [{ id: 'folder1', title: 'Projects', parentId: '' }],
			notesByUserId: async () => [],
			noteByUserIdAndJopId: async () => null,
		},
		sessionService: {
			userBySessionId: async () => ({ id: 'user-1', email: 'user@example.com' }),
		},
	});

	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const port = server.address().port;

	try {
		const response = await new Promise((resolve, reject) => {
			const req = http.request({
				hostname: '127.0.0.1',
				port,
				path: '/api/web/folders',
				method: 'GET',
				headers: { Cookie: 'sessionId=test-session' },
			}, res => {
				let body = '';
				res.setEncoding('utf8');
				res.on('data', chunk => {
					body += chunk;
				});
				res.on('end', () => resolve({ statusCode: res.statusCode, body }));
			});
			req.on('error', reject);
			req.end();
		});

		assert.equal(response.statusCode, 200);
		const payload = JSON.parse(response.body);
		assert.equal(payload.items[0].id, 'folder1');
		assert.equal(payload.items[0].title, 'Projects');
	} finally {
		await new Promise(resolve => server.close(resolve));
	}
});

test('GET / returns rendered index with replaced base path', async () => {
	const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-public-'));
	fs.writeFileSync(path.join(publicDir, 'index.html'), '<html>__JOPLIN_PUBLIC_BASE_PATH__</html>');

	const server = createServer({
		publicDir,
		renderIndex: () => '<html>/joplin/login</html>',
		joplinPublicBasePath: '/joplin',
		joplinServerOrigin: 'http://server:22300',
		itemService: {
			foldersByUserId: async () => [],
			notesByUserId: async () => [],
			noteByUserIdAndJopId: async () => null,
		},
		sessionService: {
			userBySessionId: async () => null,
		},
	});

	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const port = server.address().port;

	try {
		const response = await request(port, {
			path: '/',
			headers: {},
		});
		assert.equal(response.statusCode, 200);
		assert.match(response.body, /\/joplin\/login/);
		assert.doesNotMatch(response.body, /__JOPLIN_PUBLIC_BASE_PATH__/);
	} finally {
		await new Promise(resolve => server.close(resolve));
	}
});
