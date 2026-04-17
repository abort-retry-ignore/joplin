const path = require('path');
const { createPoolFromEnv, createSessionService } = require('./app/auth/sessionService');
const { createItemService } = require('./app/items/itemService');
const { createServer } = require('./app/createServer');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || '3001');
const joplinServerOrigin = process.env.JOPLIN_SERVER_ORIGIN || 'http://server:22300';
const joplinPublicBasePath = process.env.JOPLIN_PUBLIC_BASE_PATH || '/joplin';
const publicDir = path.join(__dirname, 'public');

const renderIndex = () => {
	const fs = require('fs');
	const templatePath = path.join(publicDir, 'index.html');
	const template = fs.readFileSync(templatePath, 'utf8');
	return template.replace(/__JOPLIN_PUBLIC_BASE_PATH__/g, joplinPublicBasePath);
};

const databasePool = createPoolFromEnv(process.env);
const sessionService = createSessionService(databasePool);
const itemService = createItemService(databasePool);

const server = createServer({
	publicDir,
	renderIndex,
	joplinPublicBasePath,
	joplinServerOrigin,
	sessionService,
	itemService,
});

server.listen(port, host, () => {
	process.stdout.write(`Joplock app-web skeleton listening on http://${host}:${port}\n`);
});

server.on('close', () => {
	void databasePool.end();
});
