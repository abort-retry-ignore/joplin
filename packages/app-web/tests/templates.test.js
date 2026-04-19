const test = require('node:test');
const assert = require('node:assert/strict');
const { autosaveConflictFragment, editorFragment, layoutPage, navigationFragment, renderMarkdown } = require('../app/templates');

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

test('navigationFragment hides empty folders while search query is active', () => {
	const html = navigationFragment([
		{ id: 'f1', title: 'Folder 1', parentId: '' },
		{ id: 'f2', title: 'Folder 2', parentId: '' },
	], [
		{ id: 'n1', title: 'Note 1', parentId: 'f1' },
	], '', '', 'note');
	assert.ok(html.includes('Folder 1'));
	assert.ok(!html.includes('Folder 2'));
});

test('navigationFragment does not make empty folders expandable', () => {
	const html = navigationFragment([
		{ id: 'f1', title: 'Folder 1', parentId: '' },
	], [], '', '');
	assert.ok(html.includes('nav-folder-empty'));
	assert.ok(!html.includes('onclick="toggleNavFolder(\'f1\')"'));
	assert.ok(html.includes('nav-folder-toggle-placeholder'));
});

test('renderMarkdown rewrites raw html resource images without self-closing slash', () => {
	const html = renderMarkdown('<img src=":/49a3f012f300473d98a33b97940306b1" alt="x" width="313" height="417">');
	assert.ok(html.includes('src="/resources/49a3f012f300473d98a33b97940306b1"'));
	assert.ok(html.includes('width="313"'));
	assert.ok(html.includes('height="417"'));
});

test('logged out layout clears client storage and service worker state', () => {
	const html = layoutPage({ user: null, loginError: '' });
	assert.ok(html.includes('localStorage.removeItem'));
	assert.ok(html.includes('navigator.serviceWorker.getRegistrations'));
	assert.ok(html.includes('caches.keys()'));
});

test('logged in layout preserves plain square brackets on preview round trip', () => {
	const html = layoutPage({ user: { email: 'user@example.com', fullName: 'User' }, navContent: '' });
	assert.ok(html.includes('function htmlToMarkdown(el){'));
	assert.ok(html.includes('getTurndown().turndown(el.innerHTML)'));
	assert.ok(html.includes('$1'));
});

test('logged in layout includes extended Joplin theme options', () => {
	const html = layoutPage({ user: { email: 'user@example.com', fullName: 'User' }, navContent: '' });
	assert.ok(html.includes('<option value="oled-dark">OLED Dark</option>'));
	assert.ok(html.includes('<option value="solarized-light">Solarized Light</option>'));
	assert.ok(html.includes('<option value="solarized-dark">Solarized Dark</option>'));
	assert.ok(html.includes('<option value="nord">Nord</option>'));
	assert.ok(html.includes('<option value="dracula">Dracula</option>'));
	assert.ok(html.includes('<option value="aritim-dark">Aritim Dark</option>'));
});
