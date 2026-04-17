const http = require('http');
const fs = require('fs');
const path = require('path');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || '3001');
const serverBaseUrl = process.env.JOPLIN_SERVER_BASE_URL || 'http://localhost:22300';
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
	return template.replace(/__JOPLIN_SERVER_BASE_URL__/g, serverBaseUrl);
};

const server = http.createServer((request, response) => {
	const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

	if (url.pathname === '/health') {
		send(response, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' });
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
