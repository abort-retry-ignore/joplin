const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { autosaveConflictFragment, editorFragment, layoutPage, loggedOutPage, navigationFragment, renderMarkdown } = require('../app/templates');

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

test('editorFragment includes date and datetime toolbar buttons', () => {
	const html = editorFragment({ id: 'n1', title: 'Active', body: 'Body', parentId: 'f1', deletedTime: 0, createdTime: 1000, updatedTime: 2000 }, [{ id: 'f1', title: 'Folder 1' }]);
	assert.ok(html.includes('title="Insert date"'));
	assert.ok(html.includes('title="Insert date and time"'));
	assert.ok(html.includes('insertStamp(\'date\')'));
	assert.ok(html.includes('insertStamp(\'datetime\')'));
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


test('logged out page shows cleanup progress and login link', () => {
	const html = loggedOutPage('');
	assert.ok(html.includes('Logging out'));
	assert.ok(html.includes('Clear local storage'));
	assert.ok(html.includes('Remove service workers'));
	assert.ok(html.includes('Clear cached assets'));
	assert.ok(html.includes('Cleanup complete'));
	assert.ok(html.includes('onclick="toggleLogoutDetail(\'session\')"'));
	assert.ok(html.includes('id="logout-detail-session"'));
	assert.ok(html.includes('Remove local preferences like theme'));
	assert.ok(html.includes('id="logout-login-link"'));
	assert.ok(html.includes('Go to login'));
	assert.ok(html.includes('check.className=\'logout-step-check\''));
	assert.ok(html.includes('check.textContent=\'✓\''));
	assert.ok(html.includes('window.toggleLogoutDetail=function(step)'));
	assert.ok(html.includes('if(loginLink)loginLink.style.display=\'inline-flex\''));
});

test('logged in layout uses logout navigation link', () => {
	const html = layoutPage({ user: { email: 'user@example.com', fullName: 'User' }, navContent: '' });
	assert.ok(html.includes('<a href="/logout" class="btn btn-sm btn-secondary logout-link">Logout</a>'));
	assert.ok(!html.includes('logoutNow(event)'));
	assert.ok(!html.includes('hx-post="/logout"'));
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

test('logged in layout uses ordered list command and block transforms in preview toolbar', () => {
	const html = layoutPage({ user: { email: 'user@example.com', fullName: 'User' }, navContent: '' });
	assert.ok(html.includes('function transformPVBlock(tagName,defaultText)'));
	assert.ok(html.includes('document.execCommand(\'insertOrderedList\',false,null)'));
	assert.ok(html.includes('if(p===\'> \'&&transformPVBlock(\'blockquote\',\'Quote\'))return'));
	assert.ok(html.includes('var fenced=String.fromCharCode(10)+String.fromCharCode(96,96,96)+String.fromCharCode(10)'));
	assert.ok(html.includes('if(a===fenced&&b===fenced&&transformPVBlock(\'pre\',\'code\'))return'));
	assert.ok(html.includes('var inlineCode=String.fromCharCode(96)'));
	assert.ok(html.includes('if(a===inlineCode&&b===inlineCode){document.execCommand(\'insertHTML\',false,\'<code>\'+(window.getSelection().toString()||\'code\')+\'</code>\')'));
	assert.ok(html.includes('function formatStamp(kind){'));
	assert.ok(html.includes('return d.getFullYear()+\'-\'+pad2(d.getMonth()+1)+\'-\'+pad2(d.getDate())+\' \'+pad2(d.getHours())+\':\'+pad2(d.getMinutes())'));
	assert.ok(html.includes('return months[d.getMonth()]+\'-\'+pad2(d.getDate())+\'-\'+String(d.getFullYear()).slice(-2)'));
	assert.ok(html.includes('function insertStamp(kind){insertTxt(formatStamp(kind))}'));
});

test('logged in layout emits inline script that parses', () => {
	const html = layoutPage({ user: { email: 'user@example.com', fullName: 'User' }, navContent: '<div></div>' });
	const match = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
	assert.ok(match);
	assert.doesNotThrow(() => new vm.Script(match[1]));
});

test('styles define ordered list spacing and white matrix note text', () => {
	const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
	assert.ok(css.includes('--text: #ffffff;'));
	assert.ok(css.includes('.editor-preview ul, .editor-preview ol { padding-left: 1.5em; margin: 0.5em 0; }'));
	assert.ok(css.includes('.editor-preview > h1:first-child,'));
	assert.ok(css.includes('.logout-progress {'));
	assert.ok(css.includes('.logout-step.done {'));
	assert.ok(css.includes('.logout-step-check {'));
	assert.ok(css.includes('.logout-detail {'));
	assert.ok(css.includes('.logout-detail.open {'));
	assert.ok(css.includes('--font-size-note: 15px;'));
	assert.ok(css.includes('--font-size-code: 12px;'));
	assert.ok(css.includes('font-size: var(--font-size-note);'));
	assert.ok(css.includes('font-size: var(--font-size-code);'));
});

test('styles color folders differently from notes', () => {
	const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
	assert.ok(css.includes('.nav-folder-title {'));
	assert.ok(css.includes('.sidebar-item-name {'));
	assert.ok(css.includes('.notelist-item-title {'));
	assert.ok(css.includes('color: var(--accent);'));
	assert.ok(css.includes('color: var(--text);'));
});
