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
		hx-on::after-request="document.querySelectorAll('.notelist-item').forEach(b=>b.classList.remove('active'));this.classList.add('active');if(window.innerWidth<=768)closeMobileNav()">
		<span class="notelist-item-title">${renderInlineMarkdown(escapeHtml(note.title || 'Untitled'))}</span>
	</button>`;
};

// Column 2: note list with header (new note button + search)
const noteListFragment = (notes, selectedNoteId, folderId) => {
	const header = `<div class="notelist-header">
		${folderId ? `<button class="btn btn-sm"
			hx-post="/fragments/notes"
			hx-vals='${escapeHtml(JSON.stringify({ parentId: folderId }))}'
			hx-target="#notelist-panel"
			hx-swap="innerHTML"
			hx-on::after-request="if(window.innerWidth<=768)closeMobileNav()">+ New note</button>` : ''}
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

const navigationFragment = (folders, notes, selectedFolderId, selectedNoteId) => {
	const notesByFolder = new Map();
	for (const note of notes || []) {
		const key = note.parentId || '';
		if (!notesByFolder.has(key)) notesByFolder.set(key, []);
		notesByFolder.get(key).push(note);
	}

	const folderSections = (folders || []).map(folder => {
		const folderNotes = notesByFolder.get(folder.id) || [];
		const isOpen = folder.id === selectedFolderId || folderNotes.some(n => n.id === selectedNoteId);
		const count = folderNotes.length;
		return `<div class="nav-folder collapsed" data-folder-id="${escapeHtml(folder.id)}" data-selected="${isOpen ? '1' : ''}">
			<div class="nav-folder-row" onclick="toggleNavFolder('${escapeHtml(folder.id)}')">
				<button type="button" class="nav-folder-toggle" tabindex="-1">&#9656;</button>
				<span class="sidebar-item-icon">&#128193;</span>
				<span class="nav-folder-title">${escapeHtml(folder.title || 'Untitled')}</span>
				<span class="sidebar-item-count">${count || ''}</span>
				<button type="button" class="btn-icon-sm nav-folder-add" title="New note"
					hx-post="/fragments/notes"
					hx-vals='${escapeHtml(JSON.stringify({ parentId: folder.id }))}'
					hx-target="#nav-panel"
					hx-swap="innerHTML"
					hx-on:click="event.stopPropagation()">+</button>
			</div>
			<div class="nav-folder-notes">
				${folderNotes.length ? folderNotes.map(n => noteListItem(n, selectedNoteId)).join('') : '<div class="empty-hint nav-empty">No notes</div>'}
			</div>
		</div>`;
	}).join('');

	return `<div class="nav-panel-header">
		<input type="text" class="notelist-search" placeholder="Search..."
			hx-get="/fragments/nav"
			hx-trigger="input changed delay:300ms"
			hx-target="#nav-panel"
			hx-swap="innerHTML"
			hx-include="this"
			name="q" />
		<button class="btn btn-sm" title="New notebook"
			onclick="event.preventDefault();var t=prompt('Notebook name');if(t&&t.trim()){htmx.ajax('POST','/fragments/folders',{target:'#nav-panel',swap:'innerHTML',values:{title:t.trim()}})}">+ Notebook</button>
	</div><div class="nav-items">${folderSections || '<div class="empty-hint">No notebooks yet</div>'}</div>`;
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
			<input type="hidden" name="title" class="editor-title-hidden"
				value="${escapeHtml(note.title || '')}" />
			<div class="editor-title" contenteditable="true"
				data-placeholder="Note title">${renderInlineMarkdown(escapeHtml(note.title || ''))}</div>
			<span id="autosave-status"></span>
			<span id="autosave-indicator" class="htmx-indicator">Saving...</span>
			<button type="button" class="btn btn-icon" title="Edit" id="preview-toggle" onclick="togglePreview()">&#9998;</button>
			<button type="button" class="btn btn-icon" title="Toggle clean markdown (hide &lt;br&gt; tags)" id="clean-md-toggle" onclick="toggleCleanMd()" style="width:auto;padding:0 6px;font-size:11px;display:none">md</button>
			<button type="button" class="btn btn-icon btn-danger" title="Delete"
				hx-delete="/fragments/notes/${encodeURIComponent(note.id)}"
				hx-target="#nav-panel"
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
			ondrop="handleDrop(event)" ondragover="event.preventDefault()" style="display:none">${escapeHtml(note.body || '')}</textarea>
		<div class="editor-preview" id="note-preview" contenteditable="true">${renderMarkdown(note.body || '')}</div>
	</form>`;
};

const autosaveStatusFragment = () => '<span class="autosave-ok">Saved</span>';

// Render only inline markdown (bold, italic, strikethrough, inline code) — no block elements
const renderInlineMarkdown = (text) => {
	if (!text) return '';
	let html = text;
	html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
	html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
	html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
	html = html.replace(/\+\+(.+?)\+\+/g, '<u>$1</u>');
	html = html.replace(/`(.+?)`/g, '<code>$1</code>');
	return html;
};

// Simple markdown to HTML renderer (handles common Joplin markdown)
const renderMarkdown = (markdown) => {
	if (!markdown) return '';
	let html = escapeHtml(markdown);

	// Passthrough <br> tags (used for blank line preservation in Joplin)
	html = html.replace(/&lt;br&gt;/g, '<br>');

	// Passthrough inline <img> HTML tags (restore escaped versions)
	// Handles: <img src=":/id" ...> and <img src="url" ...>
	html = html.replace(/&lt;img\s([\s\S]*?)\/&gt;/g, (_m, attrs) => {
		const restored = attrs.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, '\'');
		const srcMatch = restored.match(/src=":\/([\w]{32})"/);
		const fixedAttrs = srcMatch ? restored.replace(/src=":\/([\w]{32})"/, `src="/resources/${srcMatch[1]}"`) : restored;
		return `<img ${fixedAttrs} class="preview-img" />`;
	});

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
	// Underline (Joplin markdown-it plugin)
	html = html.replace(/\+\+(.+?)\+\+/g, '<u>$1</u>');
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
	html = html.replace(/^- \[x\](?:\s+(.*))?$/gm, (_m, text) => `<div class="md-checkbox checked">&#9745;&nbsp;${text || ''}</div>`);
	html = html.replace(/^- \[ \](?:\s+(.*))?$/gm, (_m, text) => `<div class="md-checkbox">&#9744;&nbsp;${text || ''}</div>`);

	// Unordered lists
	html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
	// Wrap consecutive <li> in <ul>
	html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
	// Ordered lists
	html = html.replace(/^\d+\.\s+(.+)$/gm, '<li class="ol-item">$1</li>');
	// Wrap consecutive ol-item <li> in <ol>
	html = html.replace(/((?:<li class="ol-item">.*<\/li>\n?)+)/g, (_m, items) => `<ol>${items.replace(/ class="ol-item"/g, '')}</ol>`);
	// Ensure block elements have double-newline spacing around them
	html = html.replace(/(<\/(?:ul|ol|pre|blockquote|h[1-6])>)\n?/g, '$1\n\n');
	html = html.replace(/\n?(<(?:ul|ol|pre|blockquote|h[1-6])[> ])/g, '\n\n$1');

	// Blockquote
	html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');

	// Preserve extra blank lines (3+ newlines) as explicit markers before paragraph splitting
	html = html.replace(/\n{3,}/g, match => {
		const extraBlanks = match.length - 2; // beyond the normal paragraph break
		return `\n\n${Array.from({ length: extraBlanks }, () => '<div class="md-blank-line">\u00a0</div>').join('')}\n\n`;
	});

	// Paragraphs: double newline → paragraph break
	const blocks = html.split('\n\n');
	const blockRe = /^<(?:h[1-6]|pre|ul|ol|blockquote|hr|div)/;
	const out = [];
	for (let i = 0; i < blocks.length; i++) {
		const trimmed = blocks[i].trim();
		if (!trimmed) continue;
		if (blockRe.test(trimmed)) { out.push(trimmed); continue; }
		out.push(`<p>${trimmed.replace(/\n/g, '<br>')}</p>`);
	}
	html = out.join('');

	return html;
};

const searchResultsFragment = (notes) => {
	if (!notes.length) return '<div class="empty-hint">No results</div>';
	return notes.map(n => noteListItem(n, '')).join('');
};

// Full page
const layoutPage = (options = {}) => {
	const { user, navContent, loginError } = options;
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
			<form class="login-form" method="POST" action="/login">
				<input type="email" name="email" placeholder="Email" class="login-input" required autofocus />
				<div class="login-password-wrap">
					<input type="password" name="password" id="login-password" placeholder="Password" class="login-input" required />
					<button type="button" class="login-eye" onclick="var p=document.getElementById('login-password');if(p.type==='password'){p.type='text';this.innerHTML='&#128065;'}else{p.type='password';this.innerHTML='&#128064;'}" title="Show/hide password">&#128064;</button>
				</div>
				<div class="login-error" id="login-error">${loginError ? escapeHtml(loginError) : ''}</div>
				<button type="submit" class="btn btn-primary login-btn">Login</button>
			</form>
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
	<script src="/turndown.min.js"></script>
	<title>Joplock</title>
</head>
<body class="theme-matrix">
	<div class="app">
		<div class="mobile-topbar">
			<button type="button" class="mobile-nav-toggle" title="Show notebooks and notes" onclick="toggleMobileNav()">&#9776;</button>
		</div>
		<div class="mobile-nav-backdrop" id="mobile-nav-backdrop" onclick="closeMobileNav()"></div>
		<div class="col-nav" id="nav-panel">
			${navContent || '<div class="empty-hint">No notebooks yet</div>'}
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
	function setMobileNav(open){var nav=document.getElementById('nav-panel');var bd=document.getElementById('mobile-nav-backdrop');if(!nav||!bd)return;nav.classList.toggle('open',open);bd.classList.toggle('open',open);document.body.classList.toggle('mobile-nav-open',open)}
	function toggleMobileNav(){var nav=document.getElementById('nav-panel');if(!nav)return;setMobileNav(!nav.classList.contains('open'))}
	function closeMobileNav(){setMobileNav(false)}
	function navFolderState(){try{return JSON.parse(localStorage.getItem('joplock-nav-folders')||'{}')}catch(e){return {}}}
	function saveNavFolderState(s){localStorage.setItem('joplock-nav-folders',JSON.stringify(s))}
	function toggleNavFolder(id,force){var el=document.querySelector('.nav-folder[data-folder-id="'+id.replace(/"/g,'\\"')+'"]');if(!el)return;var collapsed=force===undefined?!el.classList.contains('collapsed'):!force;el.classList.toggle('collapsed',collapsed);var s=navFolderState();s[id]=collapsed?'0':'1';saveNavFolderState(s)}
	function getTA(){return document.getElementById('note-body')}
	function getPV(){var pv=document.getElementById('note-preview');return pv&&pv.style.display!=='none'?pv:null}
	var _cleanMd=localStorage.getItem('joplock-clean-md')!=='0';
	function cleanForDisplay(md){return md.split('\\n').map(function(l){return l==='<br>'?'':l}).join('\\n')}
	function dirtyForSave(md){var lines=md.split('\\n');var out=[];for(var i=0;i<lines.length;i++){if(lines[i]===''&&i>0&&out.length>0&&out[out.length-1]===''){out.push('<br>');continue}out.push(lines[i])}return out.join('\\n')}
	function applyCleanMd(){var ta=getTA();if(!ta)return;var btn=document.getElementById('clean-md-toggle');if(_cleanMd){ta.value=cleanForDisplay(ta.value);if(btn)btn.classList.add('active')}else{ta.value=dirtyForSave(ta.value);if(btn)btn.classList.remove('active')}}
	function toggleCleanMd(){_cleanMd=!_cleanMd;localStorage.setItem('joplock-clean-md',_cleanMd?'1':'0');applyCleanMd()}
	var _pvSyncTimer=null;
	function syncPV(){var pv=getPV(),ta=getTA();if(pv&&ta){var md=htmlToMarkdown(pv);if(_cleanMd){ta.value=cleanForDisplay(md)}else{ta.value=md}ta.dispatchEvent(new Event('input',{bubbles:true}))}}
	function scheduleSyncPV(){if(_pvSyncTimer)clearTimeout(_pvSyncTimer);_pvSyncTimer=setTimeout(function(){_pvSyncTimer=null;syncPV();autoTitle()},150)}
	// Auto-title: first line of body becomes title unless user manually edited it
	var _titleManual=false;
	function syncTitle(){var ti=document.querySelector('.editor-title');var hi=document.querySelector('.editor-title-hidden');if(ti&&hi){hi.value=ti.textContent;hi.dispatchEvent(new Event('input',{bubbles:true}));ti.innerHTML=renderInlineMd(ti.textContent)}}
	function initAutoTitle(){_titleManual=false;var ti=document.querySelector('.editor-title');if(ti){ti.addEventListener('input',function(){_titleManual=true;syncTitle()})}}
	function autoTitle(){if(_titleManual)return;var ta=getTA();var ti=document.querySelector('.editor-title');if(!ta||!ti)return;var val=_cleanMd?dirtyForSave(ta.value):ta.value;var lines=val.split('\\n');var first='';for(var i=0;i<lines.length;i++){var l=lines[i].replace(/^#+\\s*/,'').trim();if(l){first=l;break}}if(first&&first!==ti.textContent){ti.innerHTML=renderInlineMd(first);var hi=document.querySelector('.editor-title-hidden');if(hi){hi.value=first;hi.dispatchEvent(new Event('input',{bubbles:true}))}}}
	function renderInlineMd(t){if(!t)return '';var h=t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');h=h.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>');h=h.replace(/\\*(.+?)\\*/g,'<em>$1</em>');h=h.replace(/~~(.+?)~~/g,'<del>$1</del>');h=h.replace(/\\+\\+(.+?)\\+\\+/g,'<u>$1</u>');h=h.replace(/\`([^\`]+)\`/g,'<code>$1</code>');return h}
	// Image resize via drag handles
	var _resizing=null;
	function initImgResize(pv){if(!pv||pv.dataset.imgResizeInit)return;pv.dataset.imgResizeInit='1';pv.addEventListener('mousedown',function(e){if(e.target.tagName==='IMG'&&e.target.classList.contains('preview-img')){var img=e.target,rect=img.getBoundingClientRect();var nearRight=e.clientX>rect.right-16,nearBottom=e.clientY>rect.bottom-16;if(nearRight||nearBottom){e.preventDefault();_resizing={img:img,startX:e.clientX,startY:e.clientY,startW:img.offsetWidth,startH:img.offsetHeight}}}})}
	document.addEventListener('mousemove',function(e){if(!_resizing)return;e.preventDefault();var dx=e.clientX-_resizing.startX,dy=e.clientY-_resizing.startY;var nw=Math.max(32,_resizing.startW+dx);var ratio=_resizing.startH/_resizing.startW;_resizing.img.style.width=nw+'px';_resizing.img.style.height=Math.round(nw*ratio)+'px'});
	document.addEventListener('mouseup',function(){if(_resizing){_resizing=null;syncPV()}});
	function wrapSel(a,b){var pv=getPV();if(pv){var cmdMap={'**':'bold','*':'italic','~~':'strikethrough','++':'underline'};var cmd=cmdMap[a];if(cmd){document.execCommand(cmd,false,null);syncPV();pv.focus();return}}var t=getTA();if(!t)return;var s=t.selectionStart,e=t.selectionEnd,v=t.value,sel=v.substring(s,e)||'text';t.value=v.substring(0,s)+a+sel+b+v.substring(e);t.selectionStart=s+a.length;t.selectionEnd=s+a.length+sel.length;t.focus();t.dispatchEvent(new Event('input',{bubbles:true}))}
	function insertPfx(p){var pv=getPV();if(pv){var sel=window.getSelection();if(sel.rangeCount){var range=sel.getRangeAt(0);var block=range.startContainer;while(block&&block!==pv&&block.nodeType!==1)block=block.parentNode;if(!block||block===pv)block=range.startContainer.parentNode;var hm=p.match(/^(#{1,6})\\s/);if(hm){var lvl=hm[1].length;var tag='h'+lvl;if(block&&block.parentNode&&block!==pv){var neo=document.createElement(tag);neo.textContent=block.textContent;block.parentNode.replaceChild(neo,block)}else{document.execCommand('insertHTML',false,'<'+tag+'>'+(sel.toString()||'Heading')+'</'+tag+'>')}setTimeout(function(){syncPV();pv.focus()},0);return}if(p==='- [ ] '){var neo=document.createElement('div');neo.className='md-checkbox';var icon=document.createTextNode('\\u2610\\u00a0');neo.appendChild(icon);var sel2=window.getSelection();var range2=sel2.rangeCount?sel2.getRangeAt(0):null;if(range2){range2.deleteContents();range2.insertNode(neo);var r=document.createRange();r.setStart(icon,2);r.collapse(true);sel2.removeAllRanges();sel2.addRange(r)}else{pv.appendChild(neo)}neo.scrollIntoView({block:'nearest'});syncPV();pv.focus();return}if(p==='- '||p==='1. '){document.execCommand('insertUnorderedList',false,null);syncPV();pv.focus();return}}return}var t=getTA();if(!t)return;var s=t.selectionStart,ls=t.value.lastIndexOf('\\n',s-1)+1;t.value=t.value.substring(0,ls)+p+t.value.substring(ls);t.selectionStart=t.selectionEnd=s+p.length;t.focus();t.dispatchEvent(new Event('input',{bubbles:true}))}
	function insertTxt(x){var pv=getPV();if(pv){if(x==='\\n---\\n'){document.execCommand('insertHorizontalRule',false,null);syncPV();pv.focus();return}document.execCommand('insertText',false,x);syncPV();pv.focus();return}var t=getTA();if(!t)return;var s=t.selectionStart;t.value=t.value.substring(0,s)+x+t.value.substring(t.selectionEnd);t.selectionStart=t.selectionEnd=s+x.length;t.focus();t.dispatchEvent(new Event('input',{bubbles:true}))}
	function insertLink(){var pv=getPV();if(pv){var u=prompt('URL:');if(!u)return;var sel=window.getSelection();var txt=sel.toString()||'link';document.execCommand('insertHTML',false,'<a href="'+u+'">'+txt+'</a>');syncPV();pv.focus();return}var u=prompt('URL:');if(u)wrapSel('[',']('+u+')')}
	function insertImg(){var pv=getPV();if(pv){var u=prompt('Image URL:');if(!u)return;document.execCommand('insertHTML',false,'<img src="'+u+'" alt="image" class="preview-img" />');syncPV();pv.focus();return}var u=prompt('Image URL:');if(u)insertTxt('![image]('+u+')')}
	function uploadFile(f){if(!f)return;var fd=new FormData();fd.append('file',f);var s=document.getElementById('autosave-status');if(s)s.innerHTML='<span class="autosave-saving">Uploading...</span>';fetch('/fragments/upload',{method:'POST',body:fd}).then(function(r){return r.json()}).then(function(d){if(d.error){alert(d.error);return}var pv=getPV();if(pv&&d.resourceId&&f.type.startsWith('image/')){document.execCommand('insertHTML',false,'<img src="/resources/'+d.resourceId+'" alt="'+f.name+'" class="preview-img" />');syncPV()}else{insertTxt(d.markdown)}}).catch(function(e){alert('Upload failed: '+e.message)}).finally(function(){if(s)s.innerHTML=''})}
	function handleDrop(e){e.preventDefault();var files=e.dataTransfer&&e.dataTransfer.files;if(!files||!files.length)return;for(var i=0;i<files.length;i++)uploadFile(files[i])}
	var _tdService=null;
	function getTurndown(){
		if(_tdService)return _tdService;
		var td=new TurndownService({headingStyle:'atx',hr:'---',codeBlockStyle:'fenced',bulletListMarker:'-',emDelimiter:'*',strongDelimiter:'**',br:'\\n'});
		// Joplin resource images (with optional resize dimensions)
		td.addRule('joplinImg',{filter:function(n){return n.nodeName==='IMG'},replacement:function(c,n){
			var alt=n.getAttribute('alt')||'';var src=n.getAttribute('src')||'';
			var w=n.style.width||n.getAttribute('width');var h=n.style.height||n.getAttribute('height');
			var rm=src.match(/^\\/resources\\/([0-9a-zA-Z]{32})$/);
			if(w||h){var iSrc=rm?':/'+rm[1]:src;return '<img src="'+iSrc+'" alt="'+alt+'"'+(w?' width="'+parseInt(w)+'"':'')+(h?' height="'+parseInt(h)+'"':'')+' />'}
			if(rm)return '!['+alt+'](:/'+ rm[1]+')';return '!['+alt+']('+src+')'}});
		// Joplin resource links
		td.addRule('joplinLink',{filter:function(n){return n.nodeName==='A'&&/^\\/resources\\/[0-9a-zA-Z]{32}$/.test(n.getAttribute('href')||'')},
			replacement:function(c,n){var m=n.getAttribute('href').match(/^\\/resources\\/([0-9a-zA-Z]{32})$/);return '['+c+'](:/'+ m[1]+')'}});
		// md-blank-line divs — emit <br> so Joplin preserves the blank line
		td.addRule('blankLine',{filter:function(n){return n.nodeName==='DIV'&&n.classList.contains('md-blank-line')},replacement:function(){return '\\n<br>\\n'}});
		// md-checkbox divs
		td.addRule('checkbox',{filter:function(n){return n.nodeName==='DIV'&&n.classList.contains('md-checkbox')},
			replacement:function(c,n){var checked=n.classList.contains('checked');var txt=c.replace(/^[\\u2611\\u2610\\u2612\\u2705\\u00a0 ]+/,'');return (checked?'- [x] ':'- [ ] ')+txt+'\\n'}});
		// Strikethrough
		td.addRule('strikethrough',{filter:['del','s','strike'],replacement:function(c){return c.trim()?'~~'+c.trim()+'~~':''}});
		// Underline
		td.addRule('underline',{filter:'u',replacement:function(c){return c.trim()?'++'+c.trim()+'++':''}});
		// Empty divs from contenteditable (Enter key creates <div><br></div>) — emit <br> for blank line
		td.addRule('emptyDiv',{filter:function(n){return n.nodeName==='DIV'&&!n.classList.length&&(!n.textContent.trim()||n.innerHTML==='<br>')},replacement:function(){return '\\n<br>\\n'}});
		// Empty paragraphs from contenteditable (<p><br></p>) — emit <br> for blank line
		td.addRule('emptyP',{filter:function(n){return n.nodeName==='P'&&!n.querySelector('img')&&(!n.textContent.trim()||n.innerHTML==='<br>')},replacement:function(){return '\\n\\n<br>\\n\\n'}});
		_tdService=td;return td}
	function htmlToMarkdown(el){return getTurndown().turndown(el.innerHTML)}
	function togglePreview(){var ta=document.getElementById('note-body'),pv=document.getElementById('note-preview'),tb=document.getElementById('editor-toolbar'),btn=document.getElementById('preview-toggle'),cleanBtn=document.getElementById('clean-md-toggle');if(!ta||!pv)return;if(pv.style.display==='none'){var body=_cleanMd?dirtyForSave(ta.value):ta.value;fetch('/fragments/preview',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'body='+encodeURIComponent(body)}).then(function(r){return r.text()}).then(function(h){pv.innerHTML=h;pv.contentEditable='true';pv.style.display='';ta.style.display='none';if(btn)btn.innerHTML='&#9998;';if(btn)btn.title='Edit';if(cleanBtn)cleanBtn.style.display='none';activatePV(pv)})}else{if(_pvSyncTimer){clearTimeout(_pvSyncTimer);_pvSyncTimer=null}if(pv.contentEditable==='true'){var md=htmlToMarkdown(pv);ta.value=_cleanMd?cleanForDisplay(md):md}ta.dispatchEvent(new Event('input',{bubbles:true}));pv.contentEditable='false';pv.oninput=null;pv.onkeyup=null;pv.style.display='none';ta.style.display='';if(tb)tb.style.display='';if(btn)btn.innerHTML='&#128065;';if(btn)btn.title='Preview';if(cleanBtn)cleanBtn.style.display='inline-flex'}}
	document.addEventListener('keydown',function(e){if(!getTA()&&!getPV())return;if((e.ctrlKey||e.metaKey)&&e.key==='b'){e.preventDefault();wrapSel('**','**')}if((e.ctrlKey||e.metaKey)&&e.key==='i'){e.preventDefault();wrapSel('*','*')}});
	function activatePV(pv){if(!pv)return;pv.contentEditable='true';initImgResize(pv);pv.oninput=scheduleSyncPV;pv.onkeyup=null;if(pv.dataset.pvInit)return;pv.dataset.pvInit='1';
		// Click checkbox icon to toggle checked state
		pv.addEventListener('click',function(e){var cb=e.target.closest('.md-checkbox');if(!cb)return;var txt=cb.firstChild;if(!txt||txt.nodeType!==3)return;var icon=txt.textContent.charAt(0);if(icon!=='\u2610'&&icon!=='\u2611')return;var r=document.createRange();r.setStart(txt,0);r.setEnd(txt,Math.min(2,txt.textContent.length));var iconRect=r.getBoundingClientRect();if(e.clientX>iconRect.right)return;e.preventDefault();var checked=!cb.classList.contains('checked');cb.classList.toggle('checked',checked);txt.textContent=(checked?'\u2611':'\u2610')+txt.textContent.slice(1);syncPV()});
		// Enter after checkbox creates new checkbox; scroll new content into view
		pv.addEventListener('keydown',function(e){if(e.key==='Enter'){var sel=window.getSelection();if(!sel.rangeCount)return;var range=sel.getRangeAt(0);var node=range.startContainer;var el=node.nodeType===3?node.parentElement:node;var cb=el&&el.closest?el.closest('.md-checkbox'):null;if(!cb&&node.nodeType===1&&range.startOffset>0){var prev=node.childNodes[range.startOffset-1];if(prev&&prev.nodeType===1&&prev.classList&&prev.classList.contains('md-checkbox'))cb=prev}if(!cb)return;e.preventDefault();var label=(cb.textContent||'').replace(/^[\\u2610\\u2611][\\u00a0 ]*/,'').replace(/\\u00a0|\\s/g,'');if(!label){var para=document.createElement('p');para.innerHTML='<br>';if(cb.parentNode)cb.parentNode.replaceChild(para,cb);var rp=document.createRange();rp.setStart(para,0);rp.collapse(true);sel.removeAllRanges();sel.addRange(rp);para.scrollIntoView({block:'nearest'});syncPV();return}var neo=document.createElement('div');neo.className='md-checkbox';var tn=document.createTextNode('\u2610\u00a0');neo.appendChild(tn);cb.parentNode.insertBefore(neo,cb.nextSibling);var r=document.createRange();r.setStart(tn,2);r.collapse(true);sel.removeAllRanges();sel.addRange(r);neo.scrollIntoView({block:'nearest'});syncPV();return}});
		// Scroll to keep cursor visible while typing
		pv.addEventListener('input',function(){var sel=window.getSelection();if(sel&&sel.rangeCount){var r=sel.getRangeAt(0).getBoundingClientRect();var pr=pv.getBoundingClientRect();if(r.bottom>pr.bottom-8)pv.scrollTop+=r.bottom-pr.bottom+24}})}
	function initEditorPanel(){var form=document.getElementById('note-editor-form');if(!form||form.dataset.editorInit)return;form.dataset.editorInit='1';if(window.innerWidth<=768)closeMobileNav();initAutoTitle();var ta=getTA();if(ta){ta.addEventListener('input',function(){autoTitle()});if(_cleanMd)ta.value=cleanForDisplay(ta.value)}var pv=document.getElementById('note-preview');if(pv&&pv.style.display!=='none'){activatePV(pv)}var btn=document.getElementById('clean-md-toggle');if(btn){btn.style.display=pv&&pv.style.display!=='none'?'none':'inline-flex';if(_cleanMd)btn.classList.add('active')}}
	function initNavPanel(){var state=navFolderState();document.querySelectorAll('.nav-folder').forEach(function(el){var id=el.getAttribute('data-folder-id');var selected=el.getAttribute('data-selected')==='1';var open=state[id]===true||state[id]==='1'||state[id]===1;if(state[id]===undefined)open=false;if(selected)open=true;el.classList.toggle('collapsed',!open)})}
	document.body.addEventListener('htmx:afterSettle',function(){initNavPanel();initEditorPanel()});
	window.addEventListener('load',function(){initNavPanel();initEditorPanel()});
	document.body.addEventListener('htmx:configRequest',function(e){if(e.detail.parameters&&e.detail.parameters.body&&_cleanMd){e.detail.parameters.body=dirtyForSave(e.detail.parameters.body)}});
	</script>
</body>
</html>`;
};

const loggedOutPage = (joplinBasePath) => layoutPage({ user: null, joplinBasePath });

module.exports = {
	escapeHtml,
	folderListItem,
	folderListFragment,
	navigationFragment,
	noteListItem,
	noteListFragment,
	editorFragment,
	autosaveStatusFragment,
	renderInlineMarkdown,
	renderMarkdown,
	searchResultsFragment,
	layoutPage,
	loggedOutPage,
};
