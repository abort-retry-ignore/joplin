const http = require('http');
const fs = require('fs');
const path = require('path');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || '3001');
const joplinServerOrigin = process.env.JOPLIN_SERVER_ORIGIN || 'http://server:22300';
const joplinPublicBasePath = process.env.JOPLIN_PUBLIC_BASE_PATH || '/joplin';
const publicDir = path.join(__dirname, 'public');

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

const renderIndex = () => {
	const templatePath = path.join(publicDir, 'index.html');
	const template = fs.readFileSync(templatePath, 'utf8');
	return template.replace(/__JOPLIN_PUBLIC_BASE_PATH__/g, joplinPublicBasePath);
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

const server = http.createServer((request, response) => {
	const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

	if (url.pathname === '/health') {
		send(response, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' });
		return;
	}

	if (url.pathname === joplinPublicBasePath || url.pathname.startsWith(`${joplinPublicBasePath}/`)) {
		proxyToJoplinServer(request, response, url);
		return;
	}

	const relativePath = url.pathname === '/' ? '/index.html' : url.pathname;
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

server.listen(port, host, () => {
	process.stdout.write(`Joplock app-web skeleton listening on http://${host}:${port}\n`);
});
