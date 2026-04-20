const path = require('path');
const { createPoolFromEnv, createSessionService } = require('./app/auth/sessionService');
const { createMfaService } = require('./app/auth/mfaService');
const { createItemService } = require('./app/items/itemService');
const { createItemWriteService } = require('./app/items/itemWriteService');
const { createSettingsService } = require('./app/settingsService');
const { createServer } = require('./app/createServer');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || '3001');
const joplinServerOrigin = process.env.JOPLIN_SERVER_ORIGIN || 'http://server:22300';
const joplinPublicBasePath = process.env.JOPLIN_PUBLIC_BASE_PATH || '';
const joplinPublicBaseUrl = process.env.JOPLIN_PUBLIC_BASE_URL || `http://localhost:${port}`;
const joplinServerPublicUrl = process.env.JOPLIN_SERVER_PUBLIC_URL || `${joplinPublicBaseUrl}${joplinPublicBasePath}`;
const publicDir = path.join(__dirname, 'public');
const mfaService = createMfaService({
	seed: process.env.JOPLOCK_TOTP_SEED || '',
	issuer: process.env.JOPLOCK_TOTP_ISSUER || 'Joplock',
});

const databasePool = createPoolFromEnv(process.env);
const sessionService = createSessionService(databasePool);
const itemService = createItemService(databasePool);
const settingsService = createSettingsService(databasePool);
const itemWriteService = createItemWriteService({
	joplinServerOrigin,
	joplinServerPublicUrl,
});

const server = createServer({
	publicDir,
	joplinPublicBasePath,
	joplinPublicBaseUrl,
	joplinServerPublicUrl,
	joplinServerOrigin,
	mfaService,
	sessionService,
	itemService,
	settingsService,
	itemWriteService,
});

server.listen(port, host, () => {
	process.stdout.write(`Joplock app-web skeleton listening on http://${host}:${port}\n`);
});

server.on('close', () => {
	void databasePool.end();
});
