const test = require('node:test');
const assert = require('node:assert/strict');
const { autosaveConflictFragment, editorFragment, navigationFragment } = require('../app/templates');

test('autosaveConflictFragment wires overwrite and create copy actions', () => {
	const html = autosaveConflictFragment('n1');
	assert.ok(html.includes('hx-put="/fragments/editor/n1"'));
	assert.ok(html.includes('hx-vals=\'{"forceSave":"1"}\''));
	assert.ok(html.includes('hx-vals=\'{"createCopy":"1"}\''));
	assert.ok(html.includes('hx-include="#note-editor-form"'));
});

test('editorFragment shows restore action for trashed note', () => {
	const html = editorFragment({ id: 'n1', title: 'Deleted', body: 'Body', parentId: 'f1', deletedTime: 123, createdTime: 1000, updatedTime: 2000 }, [{ id: 'f1', title: 'Folder 1' }]);
	assert.ok(html.includes('hx-post="/fragments/notes/n1/restore"'));
	assert.ok(html.includes('Restore'));
	assert.ok(html.includes('Permanently delete this note?'));
	assert.ok(!html.includes('Move this note to trash?'));
});

test('editorFragment shows trash delete prompt for active note', () => {
	const html = editorFragment({ id: 'n1', title: 'Active', body: 'Body', parentId: 'f1', deletedTime: 0, createdTime: 1000, updatedTime: 2000 }, [{ id: 'f1', title: 'Folder 1' }]);
	assert.ok(html.includes('Move this note to trash?'));
	assert.ok(!html.includes('Permanently delete this note?'));
});

test('navigationFragment shows trash folder empty action', () => {
	const html = navigationFragment([{ id: 'de1e7ede1e7ede1e7ede1e7ede1e7ede', title: 'Trash', parentId: '' }], [], '', '');
	assert.ok(html.includes('hx-post="/fragments/trash/empty"'));
	assert.ok(html.includes('Empty trash permanently?'));
	assert.ok(html.includes('&#128465;'));
});
