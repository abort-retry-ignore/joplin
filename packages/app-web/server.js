const path = require('path');
const { createPoolFromEnv, createSessionService } = require('./app/auth/sessionService');
const { createItemService } = require('./app/items/itemService');
const { createItemWriteService } = require('./app/items/itemWriteService');
const { createServer } = require('./app/createServer');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || '3001');
const joplinServerOrigin = process.env.JOPLIN_SERVER_ORIGIN || 'http://server:22300';
const joplinPublicBasePath = process.env.JOPLIN_PUBLIC_BASE_PATH || '/joplin';
const joplinPublicBaseUrl = process.env.JOPLIN_PUBLIC_BASE_URL || `http://localhost:${port}`;
const publicDir = path.join(__dirname, 'public');

const databasePool = createPoolFromEnv(process.env);
const sessionService = createSessionService(databasePool);
const itemService = createItemService(databasePool);
const itemWriteService = createItemWriteService({
	joplinServerOrigin,
	joplinPublicBaseUrl,
});

const server = createServer({
	publicDir,
	joplinPublicBasePath,
	joplinPublicBaseUrl,
	joplinServerOrigin,
	sessionService,
	itemService,
	itemWriteService,
});

server.listen(port, host, () => {
	process.stdout.write(`Joplock app-web skeleton listening on http://${host}:${port}\n`);
});

server.on('close', () => {
	void databasePool.end();
});
