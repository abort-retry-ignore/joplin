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
			<input type="hidden" name="title" class="editor-title-hidden"
				value="${escapeHtml(note.title || '')}" />
			<div class="editor-title" contenteditable="true"
				data-placeholder="Note title">${renderInlineMarkdown(escapeHtml(note.title || ''))}</div>
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
			<button type="button" class="tb" title="Bold (Ctrl+B)" onclick="cmWrap('**')"><b>B</b></button>
			<button type="button" class="tb" title="Italic (Ctrl+I)" onclick="cmWrap('*')"><i>I</i></button>
			<button type="button" class="tb" title="Strikethrough" onclick="cmWrap('~~')"><s>S</s></button>
			<span class="tb-div"></span>
			<button type="button" class="tb" title="Heading 1" onclick="cmPrefix('# ')">H1</button>
			<button type="button" class="tb" title="Heading 2" onclick="cmPrefix('## ')">H2</button>
			<button type="button" class="tb" title="Heading 3" onclick="cmPrefix('### ')">H3</button>
			<span class="tb-div"></span>
			<button type="button" class="tb" title="Bullet list" onclick="cmPrefix('- ')">&#8226;</button>
			<button type="button" class="tb" title="Numbered list" onclick="cmPrefix('1. ')">1.</button>
			<button type="button" class="tb" title="Checkbox" onclick="cmPrefix('- [ ] ')">&#9744;</button>
			<span class="tb-div"></span>
			<button type="button" class="tb" title="Inline code" onclick="cmWrap('\`')">&lt;/&gt;</button>
			<button type="button" class="tb" title="Code block" onclick="cmInsert('\\n\`\`\`\\n\\n\`\`\`\\n')">{ }</button>
			<button type="button" class="tb" title="Quote" onclick="cmPrefix('> ')">&#8220;</button>
			<button type="button" class="tb" title="Horizontal rule" onclick="cmInsert('\\n---\\n')">&#8212;</button>
			<span class="tb-div"></span>
			<button type="button" class="tb" title="Link" onclick="cmLink()">&#128279;</button>
			<button type="button" class="tb" title="Image" onclick="cmImage()">&#128247;</button>
			<button type="button" class="tb" title="Upload file" onclick="document.getElementById('file-upload').click()">&#128206;</button>
			<input type="file" id="file-upload" style="display:none" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt" onchange="uploadFile(this.files[0]);this.value=''" />
		</div>
		<textarea name="body" class="editor-body" id="note-body" style="display:none">${escapeHtml(note.body || '')}</textarea>
		<div id="cm-editor" class="cm-editor-wrap" ondrop="handleDrop(event)" ondragover="event.preventDefault()"></div>
		<div class="editor-preview" id="note-preview" style="display:none"></div>
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
	html = html.replace(/`(.+?)`/g, '<code>$1</code>');
	return html;
};

// Simple markdown to HTML renderer (handles common Joplin markdown)
const renderMarkdown = (markdown) => {
	if (!markdown) return '';
	let html = escapeHtml(markdown);

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
	const { user, sidebarContent, notelistContent, loginError } = options;
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
	<script src="/codemirror.min.js"></script>
	<title>Joplock</title>
</head>
<body class="theme-matrix">
	<div class="app">
		<div class="col-sidebar" id="sidebar-panel">
			<div class="col-header">
				<button class="btn-icon-sm sidebar-collapse-btn" title="Toggle notebooks" onclick="var sb=document.getElementById('sidebar-panel');sb.classList.toggle('collapsed');localStorage.setItem('sidebar-collapsed',sb.classList.contains('collapsed')?'1':'')">&#9776;</button>
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
	(function(){if(localStorage.getItem('sidebar-collapsed')){var sb=document.getElementById('sidebar-panel');if(sb)sb.classList.add('collapsed')}})();
	var _cmView=null;
	function getTA(){return document.getElementById('note-body')}
	function destroyCM(){if(_cmView){_cmView.destroy();_cmView=null}}
	function initCM(){
		destroyCM();
		var ta=getTA();if(!ta)return;
		var wrap=document.getElementById('cm-editor');if(!wrap)return;
		wrap.innerHTML='';
		var c=CM;
		var theme=c.EditorView.theme({
			'&':{backgroundColor:'transparent',color:'var(--text)',fontSize:'14px'},
			'.cm-content':{fontFamily:'"SF Mono","Fira Code","Cascadia Code",Consolas,monospace',lineHeight:'1.65',padding:'16px 20px',caretColor:'var(--accent)'},
			'.cm-gutters':{display:'none'},
			'.cm-cursor':{borderLeftColor:'var(--accent)'},
			'&.cm-focused .cm-selectionBackground, .cm-selectionBackground':{backgroundColor:'var(--bg-active)'},
			'.cm-activeLine':{backgroundColor:'var(--bg-hover)'},
			'.cm-scroller':{overflow:'auto'}
		});
		var mdHL=c.HighlightStyle.define([
			{tag:c.tags.heading1,fontSize:'1.6em',fontWeight:'bold',color:'var(--text-heading)'},
			{tag:c.tags.heading2,fontSize:'1.4em',fontWeight:'bold',color:'var(--text-heading)'},
			{tag:c.tags.heading3,fontSize:'1.2em',fontWeight:'bold',color:'var(--text-heading)'},
			{tag:c.tags.strong,fontWeight:'bold',color:'var(--text-heading)'},
			{tag:c.tags.emphasis,fontStyle:'italic'},
			{tag:c.tags.strikethrough,textDecoration:'line-through'},
			{tag:c.tags.monospace,fontFamily:'monospace',backgroundColor:'var(--bg-hover)',borderRadius:'3px'},
			{tag:c.tags.url,color:'var(--accent)',textDecoration:'underline'},
			{tag:c.tags.link,color:'var(--accent)'},
			{tag:c.tags.meta,color:'var(--text-dim)'},
			{tag:c.tags.quote,color:'var(--text-dim)',fontStyle:'italic'},
			{tag:c.tags.list,color:'var(--accent)'}
		]);
		_cmView=new c.EditorView({
			parent:wrap,
			state:c.EditorState.create({
				doc:ta.value,
				extensions:[
					c.markdown({base:c.markdownLanguage}),
					theme,
					c.syntaxHighlighting(mdHL),
					c.syntaxHighlighting(c.defaultHighlightStyle,{fallback:true}),
					c.history(),
					c.drawSelection(),
					c.highlightActiveLine(),
					c.highlightSelectionMatches(),
					c.bracketMatching(),
					c.keymap.of([...c.defaultKeymap,...c.historyKeymap,...c.searchKeymap,c.indentWithTab]),
					c.placeholder('Start writing...'),
					c.EditorView.lineWrapping,
					c.EditorView.updateListener.of(function(u){
						if(u.docChanged){
							ta.value=u.state.doc.toString();
							ta.dispatchEvent(new Event('input',{bubbles:true}));
							autoTitle();
						}
					})
				]
			})
		});
		_cmView.focus();
	}
	// Auto-title: first line of body becomes title unless user manually edited it
	var _titleManual=false;
	function syncTitle(){var ti=document.querySelector('.editor-title');var hi=document.querySelector('.editor-title-hidden');if(ti&&hi){hi.value=ti.textContent;hi.dispatchEvent(new Event('input',{bubbles:true}))}}
	function initAutoTitle(){_titleManual=false;var ti=document.querySelector('.editor-title');if(ti){ti.addEventListener('input',function(){_titleManual=true;syncTitle()})}}
	function autoTitle(){if(_titleManual)return;var ta=getTA();var ti=document.querySelector('.editor-title');if(!ta||!ti)return;var lines=ta.value.split('\\n');var first='';for(var i=0;i<lines.length;i++){var l=lines[i].replace(/^#+\\s*/,'').trim();if(l){first=l;break}}if(first&&first!==ti.textContent){ti.textContent=first;syncTitle()}}
	// CM6 toolbar helpers
	function cmWrap(mark){if(!_cmView)return;var s=_cmView.state,sel=s.selection.main;var txt=s.sliceDoc(sel.from,sel.to)||'text';_cmView.dispatch({changes:{from:sel.from,to:sel.to,insert:mark+txt+mark},selection:{anchor:sel.from+mark.length,head:sel.from+mark.length+txt.length}});_cmView.focus()}
	function cmPrefix(pfx){if(!_cmView)return;var s=_cmView.state,sel=s.selection.main;var line=s.doc.lineAt(sel.from);_cmView.dispatch({changes:{from:line.from,to:line.from,insert:pfx}});_cmView.focus()}
	function cmInsert(txt){if(!_cmView)return;var s=_cmView.state,sel=s.selection.main;_cmView.dispatch({changes:{from:sel.from,to:sel.to,insert:txt},selection:{anchor:sel.from+txt.length}});_cmView.focus()}
	function cmLink(){var u=prompt('URL:');if(!u)return;if(!_cmView)return;var s=_cmView.state,sel=s.selection.main;var txt=s.sliceDoc(sel.from,sel.to)||'link';_cmView.dispatch({changes:{from:sel.from,to:sel.to,insert:'['+txt+']('+u+')'}});_cmView.focus()}
	function cmImage(){var u=prompt('Image URL:');if(!u)return;if(!_cmView)return;var s=_cmView.state,sel=s.selection.main;_cmView.dispatch({changes:{from:sel.from,to:sel.to,insert:'![image]('+u+')'}});_cmView.focus()}
	function uploadFile(f){if(!f)return;var fd=new FormData();fd.append('file',f);var s=document.getElementById('autosave-status');if(s)s.innerHTML='<span class="autosave-saving">Uploading...</span>';fetch('/fragments/upload',{method:'POST',body:fd}).then(function(r){return r.json()}).then(function(d){if(d.error){alert(d.error);return}cmInsert(d.markdown)}).catch(function(e){alert('Upload failed: '+e.message)}).finally(function(){if(s)s.innerHTML=''})}
	function handleDrop(e){e.preventDefault();var files=e.dataTransfer&&e.dataTransfer.files;if(!files||!files.length)return;for(var i=0;i<files.length;i++)uploadFile(files[i])}
	function togglePreview(){var wrap=document.getElementById('cm-editor'),pv=document.getElementById('note-preview'),tb=document.getElementById('editor-toolbar'),btn=document.getElementById('preview-toggle'),ta=getTA();if(!wrap||!pv||!ta)return;if(pv.style.display==='none'){fetch('/fragments/preview',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'body='+encodeURIComponent(ta.value)}).then(function(r){return r.text()}).then(function(h){pv.innerHTML=h;pv.style.display='';wrap.style.display='none';if(tb)tb.style.display='none';if(btn)btn.innerHTML='&#9998;';if(btn)btn.title='Edit'})}else{pv.style.display='none';wrap.style.display='';if(tb)tb.style.display='';if(btn)btn.innerHTML='&#128065;';if(btn)btn.title='Preview';if(_cmView)_cmView.focus()}}
	document.addEventListener('keydown',function(e){if(!_cmView)return;if((e.ctrlKey||e.metaKey)&&e.key==='b'){e.preventDefault();cmWrap('**')}if((e.ctrlKey||e.metaKey)&&e.key==='i'){e.preventDefault();cmWrap('*')}});
	document.body.addEventListener('htmx:afterSettle',function(e){if(e.detail.target&&e.detail.target.id==='editor-panel'){initAutoTitle();initCM()}});
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
	renderInlineMarkdown,
	renderMarkdown,
	searchResultsFragment,
	layoutPage,
	loggedOutPage,
};
