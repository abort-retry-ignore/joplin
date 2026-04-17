const test = require('node:test');
const assert = require('node:assert/strict');
const { serializeFolder, serializeNote } = require('../app/items/itemWriteService');

test('serializeFolder should include title and parent id', () => {
	const folder = serializeFolder({
		id: 'folder123',
		title: 'Projects',
		parentId: 'parent456',
	});

	assert.equal(folder.id, 'folder123');
	assert.equal(folder.path, 'root:/folder123.md:');
	assert.match(folder.body, /Projects/);
	assert.match(folder.body, /parent_id: parent456/);
	assert.match(folder.body, /type_: 2/);
});

test('serializeNote should include title body and parent id', () => {
	const note = serializeNote({
		id: 'note123',
		title: 'Meeting',
		body: 'Agenda items',
		parentId: 'folder123',
	});

	assert.equal(note.id, 'note123');
	assert.equal(note.path, 'root:/note123.md:');
	assert.match(note.body, /Meeting/);
	assert.match(note.body, /Agenda items/);
	assert.match(note.body, /parent_id: folder123/);
	assert.match(note.body, /type_: 1/);
});
