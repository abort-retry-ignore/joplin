const test = require('node:test');
const assert = require('node:assert/strict');
const { createSettingsService, defaultSettings } = require('../app/settingsService');

test('settingsService returns defaults when row is missing', async () => {
	const queries = [];
	const service = createSettingsService({
		query: async (sql, params) => {
			queries.push({ sql, params });
			if (sql.includes('SELECT')) return { rows: [] };
			return { rows: [] };
		},
	});
	const settings = await service.settingsByUserId('user-1');
	assert.deepEqual(settings, defaultSettings);
	assert.ok(queries[0].sql.includes('CREATE TABLE IF NOT EXISTS joplock_user_settings'));
});

test('settingsService saves normalized settings', async () => {
	const calls = [];
	const service = createSettingsService({
		query: async (sql, params) => {
			calls.push({ sql, params });
			return { rows: [] };
		},
	});
	const saved = await service.saveSettings('user-1', {
		noteFontSize: '99',
		codeFontSize: '8',
		noteMonospace: '1',
		dateFormat: 'DD/MM/YYYY',
		datetimeFormat: 'DD/MM/YYYY HH:mm',
	});
	assert.equal(saved.noteFontSize, 24);
	assert.equal(saved.codeFontSize, 10);
	assert.equal(saved.noteMonospace, true);
	assert.equal(saved.dateFormat, 'DD/MM/YYYY');
	assert.equal(saved.datetimeFormat, 'DD/MM/YYYY HH:mm');
	assert.ok(calls.at(-1).sql.includes('INSERT INTO joplock_user_settings'));
});
