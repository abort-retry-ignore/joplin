const defaultSettings = Object.freeze({
	noteFontSize: 15,
	codeFontSize: 12,
	noteMonospace: false,
	dateFormat: 'MMM-DD-YY',
	datetimeFormat: 'YYYY-MM-DD HH:mm',
});

const nowMs = () => Date.now();

const normalizeInteger = (value, fallback, min, max) => {
	const numeric = Number.parseInt(`${value}`, 10);
	if (Number.isNaN(numeric)) return fallback;
	return Math.max(min, Math.min(max, numeric));
};

const normalizeSettings = settings => ({
	noteFontSize: normalizeInteger(settings.noteFontSize, defaultSettings.noteFontSize, 12, 24),
	codeFontSize: normalizeInteger(settings.codeFontSize, defaultSettings.codeFontSize, 10, 22),
	noteMonospace: !!Number(settings.noteMonospace) || settings.noteMonospace === true || settings.noteMonospace === '1',
	dateFormat: `${settings.dateFormat || defaultSettings.dateFormat}`.trim() || defaultSettings.dateFormat,
	datetimeFormat: `${settings.datetimeFormat || defaultSettings.datetimeFormat}`.trim() || defaultSettings.datetimeFormat,
});

const createSettingsService = database => {
	let initPromise = null;

	const ensureTable = async () => {
		if (!initPromise) {
			initPromise = database.query(`
				CREATE TABLE IF NOT EXISTS joplock_user_settings (
					user_id VARCHAR(32) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
					note_font_size INTEGER NOT NULL DEFAULT 15,
					code_font_size INTEGER NOT NULL DEFAULT 12,
					note_monospace INTEGER NOT NULL DEFAULT 0,
					date_format TEXT NOT NULL DEFAULT 'MMM-DD-YY',
					datetime_format TEXT NOT NULL DEFAULT 'YYYY-MM-DD HH:mm',
					created_time BIGINT NOT NULL,
					updated_time BIGINT NOT NULL
				)
			`);
		}
		await initPromise;
	};

	return {
		async settingsByUserId(userId) {
			await ensureTable();
			const result = await database.query(`
				SELECT note_font_size, code_font_size, note_monospace, date_format, datetime_format
				FROM joplock_user_settings
				WHERE user_id = $1
				LIMIT 1
			`, [userId]);
			const row = result.rows[0];
			if (!row) return { ...defaultSettings };
			return normalizeSettings({
				noteFontSize: row.note_font_size,
				codeFontSize: row.code_font_size,
				noteMonospace: row.note_monospace,
				dateFormat: row.date_format,
				datetimeFormat: row.datetime_format,
			});
		},

		async saveSettings(userId, settings) {
			await ensureTable();
			const normalized = normalizeSettings(settings);
			const timestamp = nowMs();
			await database.query(`
				INSERT INTO joplock_user_settings (
					user_id, note_font_size, code_font_size, note_monospace, date_format, datetime_format, created_time, updated_time
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
				ON CONFLICT (user_id) DO UPDATE SET
					note_font_size = EXCLUDED.note_font_size,
					code_font_size = EXCLUDED.code_font_size,
					note_monospace = EXCLUDED.note_monospace,
					date_format = EXCLUDED.date_format,
					datetime_format = EXCLUDED.datetime_format,
					updated_time = EXCLUDED.updated_time
			`, [
				userId,
				normalized.noteFontSize,
				normalized.codeFontSize,
				normalized.noteMonospace ? 1 : 0,
				normalized.dateFormat,
				normalized.datetimeFormat,
				timestamp,
			]);
			return normalized;
		},
	};
};

module.exports = {
	createSettingsService,
	defaultSettings,
	normalizeSettings,
};
