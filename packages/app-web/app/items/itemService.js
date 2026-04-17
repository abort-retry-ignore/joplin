const MODEL_TYPE_NOTE = 1;
const MODEL_TYPE_FOLDER = 2;

const decodeItemContent = content => {
	if (!content) return {};
	const raw = Buffer.isBuffer(content) ? content.toString('utf8') : `${content}`;
	if (!raw) return {};
	return JSON.parse(raw);
};

const mapFolderRow = row => {
	const content = decodeItemContent(row.content);
	return {
		id: row.jop_id,
		parentId: row.jop_parent_id || '',
		title: content.title || '',
		icon: content.icon || '',
		createdTime: Number(content.created_time || row.created_time || 0),
		updatedTime: Number(row.jop_updated_time || content.updated_time || 0),
	};
};

const mapNoteRow = row => {
	const content = decodeItemContent(row.content);
	const body = content.body || '';
	return {
		id: row.jop_id,
		parentId: row.jop_parent_id || '',
		title: content.title || '',
		body,
		bodyPreview: body.slice(0, 240),
		isTodo: !!Number(content.is_todo || 0),
		todoCompleted: Number(content.todo_completed || 0),
		createdTime: Number(content.created_time || row.created_time || 0),
		updatedTime: Number(row.jop_updated_time || content.updated_time || 0),
	};
};

const createItemService = database => {
	return {
		async foldersByUserId(userId) {
			const result = await database.query(`
				SELECT id, jop_id, jop_parent_id, jop_updated_time, created_time, content
				FROM items
				WHERE owner_id = $1 AND jop_type = $2
				ORDER BY LOWER(COALESCE(convert_from(content, 'UTF8')::json->>'title', '')) ASC, created_time ASC
			`, [userId, MODEL_TYPE_FOLDER]);

			return result.rows.map(mapFolderRow);
		},

		async folderByUserIdAndJopId(userId, folderId) {
			const result = await database.query(`
				SELECT id, jop_id, jop_parent_id, jop_updated_time, created_time, content
				FROM items
				WHERE owner_id = $1 AND jop_type = $2 AND jop_id = $3
				LIMIT 1
			`, [userId, MODEL_TYPE_FOLDER, folderId]);

			const row = result.rows[0];
			if (!row) return null;
			return mapFolderRow(row);
		},

		async notesByUserId(userId, options = {}) {
			const folderId = options.folderId || '';
			const params = [userId, MODEL_TYPE_NOTE];
			let where = 'WHERE owner_id = $1 AND jop_type = $2';

			if (folderId) {
				params.push(folderId);
				where += ` AND jop_parent_id = $${params.length}`;
			}

			const result = await database.query(`
				SELECT id, jop_id, jop_parent_id, jop_updated_time, created_time, content
				FROM items
				${where}
				ORDER BY jop_updated_time DESC, created_time DESC
			`, params);

			return result.rows.map(mapNoteRow);
		},

		async searchNotes(userId, query) {
			if (!query || !query.trim()) return [];
			const pattern = `%${query.trim()}%`;
			const result = await database.query(`
				SELECT id, jop_id, jop_parent_id, jop_updated_time, created_time, content
				FROM items
				WHERE owner_id = $1 AND jop_type = $2
					AND convert_from(content, 'UTF8') ILIKE $3
				ORDER BY jop_updated_time DESC, created_time DESC
				LIMIT 50
			`, [userId, MODEL_TYPE_NOTE, pattern]);

			return result.rows.map(mapNoteRow);
		},

		async noteByUserIdAndJopId(userId, noteId) {
			const result = await database.query(`
				SELECT id, jop_id, jop_parent_id, jop_updated_time, created_time, content
				FROM items
				WHERE owner_id = $1 AND jop_type = $2 AND jop_id = $3
				LIMIT 1
			`, [userId, MODEL_TYPE_NOTE, noteId]);

			const row = result.rows[0];
			if (!row) return null;
			return mapNoteRow(row);
		},
	};
};

module.exports = {
	MODEL_TYPE_FOLDER,
	MODEL_TYPE_NOTE,
	createItemService,
	decodeItemContent,
	mapFolderRow,
	mapNoteRow,
};
