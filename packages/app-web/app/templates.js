// SSR HTML templates for htmx-driven UI
// 3-column layout: folders | note list | editor (like Joplin desktop)

const escapeHtml = value => `${value}`
	.replaceAll('&', '&amp;')
	.replaceAll('<', '&lt;')
	.replaceAll('>', '&gt;')
	.replaceAll('"', '&quot;')
	.replaceAll('\'', '&#39;');

// Column 1: folder list item
const folderListItem = (folder, selectedFolderId) => {
	const active = folder.id === selectedFolderId ? ' active' : '';
	return `<button id="folder-item-${escapeHtml(folder.id)}" class="sidebar-item${active}" data-folder-id="${escapeHtml(folder.id)}"
		hx-get="/fragments/notes?folderId=${encodeURIComponent(folder.id)}"
		hx-target="#notelist-panel"
		hx-swap="innerHTML"
		hx-on::after-request="document.querySelectorAll('.sidebar-item').forEach(b=>b.classList.remove('active'));this.classList.add('active')">
		<span class="sidebar-item-icon">&#128193;</span>
		<span class="sidebar-item-name">${escapeHtml(folder.title || 'Untitled')}</span>
		<span class="sidebar-item-count">${folder.noteCount !== undefined ? folder.noteCount : ''}</span>
	</button>`;
};

// Column 1: full folder list
const folderListFragment = (folders, selectedFolderId) => {
	if (!folders.length) {
		return '<div class="empty-hint">No notebooks yet</div>';
	}
	return folders.map(f => folderListItem(f, selectedFolderId)).join('');
};

// Column 2: single note in the note list
const noteListItem = (note, selectedNoteId) => {
	const active = note.id === selectedNoteId ? ' active' : '';
	return `<button id="note-item-${escapeHtml(note.id)}" class="notelist-item${active}" data-note-id="${escapeHtml(note.id)}"
		hx-get="/fragments/editor/${encodeURIComponent(note.id)}"
		hx-target="#editor-panel"
		hx-swap="innerHTML"
		hx-on::after-request="document.querySelectorAll('.notelist-item').forEach(b=>b.classList.remove('active'));this.classList.add('active')">
		<span class="notelist-item-title">${escapeHtml(note.title || 'Untitled')}</span>
	</button>`;
};

// Column 2: note list with header (new note button + search)
const noteListFragment = (notes, selectedNoteId, folderId) => {
	const header = `<div class="notelist-header">
		${folderId ? `<button class="btn btn-sm"
			hx-post="/fragments/notes"
			hx-vals='${escapeHtml(JSON.stringify({ parentId: folderId }))}'
			hx-target="#notelist-panel"
			hx-swap="innerHTML">+ New note</button>` : ''}
		<input type="text" class="notelist-search" placeholder="Search..."
			hx-get="/fragments/search"
			hx-trigger="input changed delay:300ms"
			hx-target="#notelist-items"
			hx-swap="innerHTML"
			hx-include="this"
			name="q"
			${folderId ? `data-folder-id="${escapeHtml(folderId)}"` : ''} />
	</div>`;

	const items = notes.length
		? notes.map(n => noteListItem(n, selectedNoteId)).join('')
		: '<div class="empty-hint">No notes</div>';

	return `${header}<div class="notelist-items" id="notelist-items">${items}</div>`;
};

// Column 3: editor
const editorFragment = (note, folders) => {
	if (!note) {
		return '<div class="editor-empty">Select a note</div>';
	}
	const folderOptions = (folders || []).map(f =>
		`<option value="${escapeHtml(f.id)}"${f.id === note.parentId ? ' selected' : ''}>${escapeHtml(f.title || 'Untitled')}</option>`,
	).join('');
	return `<form class="editor-form" id="note-editor-form"
		hx-put="/fragments/editor/${encodeURIComponent(note.id)}"
		hx-trigger="input changed delay:1s from:find input, input changed delay:1s from:find textarea, change changed from:find select"
		hx-target="#autosave-status"
		hx-swap="innerHTML"
		hx-indicator="#autosave-indicator">
		<div class="editor-titlebar">
			<select name="parentId" class="editor-folder-select" title="Move to folder">${folderOptions}</select>
			<span class="editor-folder-arrow">&#9656;</span>
			<input type="text" name="title" class="editor-title"
				value="${escapeHtml(note.title || '')}" placeholder="Note title" />
			<span id="autosave-status"></span>
			<span id="autosave-indicator" class="htmx-indicator">Saving...</span>
			<button type="button" class="btn btn-icon" title="Preview" id="preview-toggle" onclick="togglePreview()">&#128065;</button>
			<button type="button" class="btn btn-icon btn-danger" title="Delete"
				hx-delete="/fragments/notes/${encodeURIComponent(note.id)}"
				hx-target="#notelist-panel"
				hx-swap="innerHTML"
				hx-confirm="Delete this note?">&#128465;</button>
		</div>
		<div class="editor-toolbar" id="editor-toolbar">
			<button type="button" class="tb" title="Bold (Ctrl+B)" onclick="wrapSel('**','**')"><b>B</b></button>
			<button type="button" class="tb" title="Italic (Ctrl+I)" onclick="wrapSel('*','*')"><i>I</i></button>
			<button type="button" class="tb" title="Underline" onclick="wrapSel('++','++')"><u>U</u></button>
			<button type="button" class="tb" title="Strikethrough" onclick="wrapSel('~~','~~')"><s>S</s></button>
			<span class="tb-div"></span>
			<button type="button" class="tb" title="Heading 1" onclick="insertPfx('# ')">H1</button>
			<button type="button" class="tb" title="Heading 2" onclick="insertPfx('## ')">H2</button>
			<button type="button" class="tb" title="Heading 3" onclick="insertPfx('### ')">H3</button>
			<span class="tb-div"></span>
			<button type="button" class="tb" title="Bullet list" onclick="insertPfx('- ')">&#8226;</button>
			<button type="button" class="tb" title="Numbered list" onclick="insertPfx('1. ')">1.</button>
			<button type="button" class="tb" title="Checkbox" onclick="insertPfx('- [ ] ')">&#9744;</button>
			<span class="tb-div"></span>
			<button type="button" class="tb" title="Inline code" onclick="wrapSel('\`','\`')">&lt;/&gt;</button>
			<button type="button" class="tb" title="Code block" onclick="wrapSel('\\n\`\`\`\\n','\\n\`\`\`\\n')">{ }</button>
			<button type="button" class="tb" title="Quote" onclick="insertPfx('> ')">&#8220;</button>
			<button type="button" class="tb" title="Horizontal rule" onclick="insertTxt('\\n---\\n')">&#8212;</button>
			<span class="tb-div"></span>
			<button type="button" class="tb" title="Link" onclick="insertLink()">&#128279;</button>
			<button type="button" class="tb" title="Image" onclick="insertImg()">&#128247;</button>
			<button type="button" class="tb" title="Upload file" onclick="document.getElementById('file-upload').click()">&#128206;</button>
			<input type="file" id="file-upload" style="display:none" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt" onchange="uploadFile(this.files[0]);this.value=''" />
		</div>
		<textarea name="body" class="editor-body" id="note-body"
			placeholder="Start writing..."
			ondrop="handleDrop(event)" ondragover="event.preventDefault()">${escapeHtml(note.body || '')}</textarea>
		<div class="editor-preview" id="note-preview" style="display:none"></div>
	</form>`;
};

const autosaveStatusFragment = () => '<span class="autosave-ok">Saved</span>';

// Simple markdown to HTML renderer (handles common Joplin markdown)
const renderMarkdown = (markdown) => {
	if (!markdown) return '';
	let html = escapeHtml(markdown);

	// Code blocks (``` ... ```) — must be before inline rules
	html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => `<pre><code>${code}</code></pre>`);

	// Headings
	html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
	html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
	html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
	html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
	html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
	html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

	// Horizontal rule
	html = html.replace(/^---+$/gm, '<hr>');

	// Bold + italic
	html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
	// Bold
	html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
	// Italic
	html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
	// Strikethrough
	html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
	// Inline code
	html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

	// Joplin resource images: ![alt](:/resourceId)
	html = html.replace(/!\[([^\]]*)\]\(:\/([0-9a-zA-Z]{32})\)/g, '<img src="/resources/$2" alt="$1" class="preview-img" />');
	// Regular images: ![alt](url)
	html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="preview-img" />');
	// Joplin resource links: [text](:/resourceId)
	html = html.replace(/\[([^\]]*)\]\(:\/([0-9a-zA-Z]{32})\)/g, '<a href="/resources/$2">$1</a>');
	// Regular links: [text](url)
	html = html.replace(/\[([^\]]*)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

	// Checkboxes
	html = html.replace(/^- \[x\]\s+(.+)$/gm, '<div class="md-checkbox checked">&#9745; $1</div>');
	html = html.replace(/^- \[ \]\s+(.+)$/gm, '<div class="md-checkbox">&#9744; $1</div>');

	// Unordered lists
	html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
	// Wrap consecutive <li> in <ul>
	html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

	// Blockquote
	html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');

	// Paragraphs: double newline
	html = html.replace(/\n\n+/g, '</p><p>');
	// Single newline to <br> (but not inside pre/block elements)
	html = html.replace(/\n/g, '<br>');

	return `<p>${html}</p>`;
};

const searchResultsFragment = (notes) => {
	if (!notes.length) return '<div class="empty-hint">No results</div>';
	return notes.map(n => noteListItem(n, '')).join('');
};

// Full page
const layoutPage = (options = {}) => {
	const { user, sidebarContent, notelistContent, joplinBasePath } = options;
	const loggedIn = !!user;

	if (!loggedIn) {
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
	<link rel="stylesheet" href="/styles.css" />
	<title>Joplock</title>
</head>
<body class="theme-matrix">
	<div class="login-page">
		<div class="login-card">
			<h1 class="login-title">Joplock</h1>
			<p class="login-sub">Web client for Joplin Server</p>
			<div class="login-actions">
				<a class="btn btn-primary" href="${escapeHtml(joplinBasePath)}/login">Login</a>
				<a class="btn btn-secondary" href="${escapeHtml(joplinBasePath)}">Server Home</a>
			</div>
		</div>
	</div>
</body>
</html>`;
	}

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
	<link rel="stylesheet" href="/styles.css" />
	<script src="/htmx.min.js"></script>
	<title>Joplock</title>
</head>
<body class="theme-matrix">
	<div class="app">
		<div class="col-sidebar" id="sidebar-panel">
			<div class="col-header">
				<span class="col-label">NOTEBOOKS</span>
				<button class="btn-icon-sm" title="New notebook"
					onclick="event.preventDefault();var t=prompt('Notebook name');if(t&&t.trim()){htmx.ajax('POST','/fragments/folders',{target:'#folder-list',swap:'innerHTML',values:{title:t.trim()}})}">+</button>
			</div>
			<div class="col-scroll" id="folder-list">${sidebarContent || ''}</div>
		</div>
		<div class="col-notelist" id="notelist-panel">
			${notelistContent || '<div class="empty-hint">Select a notebook</div>'}
		</div>
		<div class="col-editor" id="editor-panel">
			<div class="editor-empty">Select a note</div>
		</div>
	</div>
	<div class="app-statusbar">
		<span class="status-user">${escapeHtml(user.fullName || user.email)}</span>
		<span class="status-spacer"></span>
		<select class="theme-picker" onchange="setTheme(this.value)">
			<option value="matrix">Matrix</option>
			<option value="dark">Dark</option>
			<option value="light">Light</option>
		</select>
		<button class="btn btn-sm btn-secondary"
			hx-post="/logout"
			hx-target="body"
			hx-swap="innerHTML"
			hx-push-url="/">Logout</button>
	</div>
	<script>
	if('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(function(){});
	function setTheme(t){document.body.className='theme-'+t;localStorage.setItem('joplock-theme',t)}
	(function(){var s=localStorage.getItem('joplock-theme');if(s){document.body.className='theme-'+s;var e=document.querySelector('.theme-picker');if(e)e.value=s}})();
	function getTA(){return document.getElementById('note-body')}
	function wrapSel(a,b){var t=getTA();if(!t)return;var s=t.selectionStart,e=t.selectionEnd,v=t.value,sel=v.substring(s,e)||'text';t.value=v.substring(0,s)+a+sel+b+v.substring(e);t.selectionStart=s+a.length;t.selectionEnd=s+a.length+sel.length;t.focus();t.dispatchEvent(new Event('input',{bubbles:true}))}
	function insertPfx(p){var t=getTA();if(!t)return;var s=t.selectionStart,ls=t.value.lastIndexOf('\\n',s-1)+1;t.value=t.value.substring(0,ls)+p+t.value.substring(ls);t.selectionStart=t.selectionEnd=s+p.length;t.focus();t.dispatchEvent(new Event('input',{bubbles:true}))}
	function insertTxt(x){var t=getTA();if(!t)return;var s=t.selectionStart;t.value=t.value.substring(0,s)+x+t.value.substring(t.selectionEnd);t.selectionStart=t.selectionEnd=s+x.length;t.focus();t.dispatchEvent(new Event('input',{bubbles:true}))}
	function insertLink(){var u=prompt('URL:');if(u)wrapSel('[',']('+u+')')}
	function insertImg(){var u=prompt('Image URL:');if(u)insertTxt('![image]('+u+')')}
	function uploadFile(f){if(!f)return;var fd=new FormData();fd.append('file',f);var s=document.getElementById('autosave-status');if(s)s.innerHTML='<span class="autosave-saving">Uploading...</span>';fetch('/fragments/upload',{method:'POST',body:fd}).then(function(r){return r.json()}).then(function(d){if(d.error){alert(d.error);return}insertTxt(d.markdown)}).catch(function(e){alert('Upload failed: '+e.message)}).finally(function(){if(s)s.innerHTML=''})}
	function handleDrop(e){e.preventDefault();var files=e.dataTransfer&&e.dataTransfer.files;if(!files||!files.length)return;for(var i=0;i<files.length;i++)uploadFile(files[i])}
	function togglePreview(){var ta=document.getElementById('note-body'),pv=document.getElementById('note-preview'),tb=document.getElementById('editor-toolbar'),btn=document.getElementById('preview-toggle');if(!ta||!pv)return;if(pv.style.display==='none'){fetch('/fragments/preview',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'body='+encodeURIComponent(ta.value)}).then(function(r){return r.text()}).then(function(h){pv.innerHTML=h;pv.style.display='';ta.style.display='none';if(tb)tb.style.display='none';if(btn)btn.innerHTML='&#9998;';if(btn)btn.title='Edit'})}else{pv.style.display='none';ta.style.display='';if(tb)tb.style.display='';if(btn)btn.innerHTML='&#128065;';if(btn)btn.title='Preview'}}
	document.addEventListener('keydown',function(e){if(!getTA())return;if((e.ctrlKey||e.metaKey)&&e.key==='b'){e.preventDefault();wrapSel('**','**')}if((e.ctrlKey||e.metaKey)&&e.key==='i'){e.preventDefault();wrapSel('*','*')}});
	</script>
</body>
</html>`;
};

const loggedOutPage = (joplinBasePath) => layoutPage({ user: null, joplinBasePath });

module.exports = {
	escapeHtml,
	folderListItem,
	folderListFragment,
	noteListItem,
	noteListFragment,
	editorFragment,
	autosaveStatusFragment,
	renderMarkdown,
	searchResultsFragment,
	layoutPage,
	loggedOutPage,
};
