const state = {
	folders: [],
	notes: [],
	selectedFolderId: '',
	selectedNoteId: '',
	user: null,
};

const elements = {
	sessionStatus: document.getElementById('sessionStatus'),
	workspace: document.getElementById('workspace'),
	logoutButton: document.getElementById('logoutButton'),
	folderList: document.getElementById('folderList'),
	folderCount: document.getElementById('folderCount'),
	noteList: document.getElementById('noteList'),
	noteCount: document.getElementById('noteCount'),
	noteDetail: document.getElementById('noteDetail'),
};

const joplinPublicBasePath = document.body.dataset.joplinBasePath || '/joplin';

const requestJson = async url => {
	const response = await fetch(url, {
		credentials: 'same-origin',
		headers: { Accept: 'application/json' },
	});

	const isJson = (response.headers.get('content-type') || '').includes('application/json');
	const payload = isJson ? await response.json() : null;

	if (!response.ok) {
		const error = new Error(payload?.error || `Request failed: ${response.status}`);
		error.status = response.status;
		throw error;
	}

	return payload;
};

const escapeHtml = value => `${value}`
	.replaceAll('&', '&amp;')
	.replaceAll('<', '&lt;')
	.replaceAll('>', '&gt;')
	.replaceAll('"', '&quot;')
	.replaceAll('\'', '&#39;');

const renderSession = () => {
	if (!state.user) {
		elements.sessionStatus.textContent = 'Login required to load folders and notes.';
		elements.workspace.hidden = true;
		elements.logoutButton.hidden = true;
		elements.logoutButton.disabled = false;
		elements.logoutButton.textContent = 'Logout';
		return;
	}

	elements.sessionStatus.textContent = `Signed in as ${state.user.fullName || state.user.email}`;
	elements.workspace.hidden = false;
	elements.logoutButton.hidden = false;
};

const resetState = () => {
	state.user = null;
	state.folders = [];
	state.notes = [];
	state.selectedFolderId = '';
	state.selectedNoteId = '';
	renderSession();
	renderFolders();
	renderNoteDetail(null);
};

const renderFolders = () => {
	elements.folderCount.textContent = `${state.folders.length}`;
	if (!state.folders.length) {
		elements.folderList.innerHTML = '<div class="empty-state">No folders yet.</div>';
		state.notes = [];
		state.selectedNoteId = '';
		renderNotes();
		return;
	}

	elements.folderList.innerHTML = state.folders.map(folder => {
		const active = folder.id === state.selectedFolderId ? ' active' : '';
		return `<button class="list-item${active}" data-folder-id="${escapeHtml(folder.id)}">
			<div class="list-title">${escapeHtml(folder.title || 'Untitled folder')}</div>
			<div class="list-meta">${escapeHtml(folder.id)}</div>
		</button>`;
	}).join('');

	for (const button of elements.folderList.querySelectorAll('[data-folder-id]')) {
		button.addEventListener('click', async () => {
			state.selectedFolderId = button.dataset.folderId;
			state.selectedNoteId = '';
			renderFolders();
			await loadNotes();
		});
	}
};

const renderNotes = () => {
	elements.noteCount.textContent = `${state.notes.length}`;
	if (!state.notes.length) {
		elements.noteList.innerHTML = '<div class="empty-state">No notes in this folder.</div>';
		elements.noteDetail.innerHTML = '<div class="note-detail-empty">Select a note to view its content.</div>';
		return;
	}

	elements.noteList.innerHTML = state.notes.map(note => {
		const active = note.id === state.selectedNoteId ? ' active' : '';
		return `<button class="list-item${active}" data-note-id="${escapeHtml(note.id)}">
			<div class="list-title">${escapeHtml(note.title || 'Untitled note')}</div>
			<div class="list-meta">${escapeHtml(note.bodyPreview || '')}</div>
		</button>`;
	}).join('');

	for (const button of elements.noteList.querySelectorAll('[data-note-id]')) {
		button.addEventListener('click', async () => {
			state.selectedNoteId = button.dataset.noteId;
			renderNotes();
			await loadNoteDetail();
		});
	}
};

const renderNoteDetail = note => {
	if (!note) {
		elements.noteDetail.innerHTML = '<div class="note-detail-empty">Select a note to view its content.</div>';
		return;
	}

	elements.noteDetail.innerHTML = `
		<h3>${escapeHtml(note.title || 'Untitled note')}</h3>
		<div class="note-meta">Updated ${escapeHtml(new Date(note.updatedTime || 0).toLocaleString())}</div>
		<pre>${escapeHtml(note.body || '')}</pre>
	`;
};

const loadNotes = async () => {
	const query = state.selectedFolderId ? `?folderId=${encodeURIComponent(state.selectedFolderId)}` : '';
	const payload = await requestJson(`/api/web/notes${query}`);
	state.notes = payload.items || [];
	if (state.notes.length && !state.selectedNoteId) state.selectedNoteId = state.notes[0].id;
	if (!state.notes.find(note => note.id === state.selectedNoteId)) state.selectedNoteId = state.notes[0]?.id || '';
	renderNotes();
	await loadNoteDetail();
};

const loadNoteDetail = async () => {
	if (!state.selectedNoteId) {
		renderNoteDetail(null);
		return;
	}

	const payload = await requestJson(`/api/web/notes/${encodeURIComponent(state.selectedNoteId)}`);
	renderNoteDetail(payload.item || null);
};

const loadFolders = async () => {
	const payload = await requestJson('/api/web/folders');
	state.folders = payload.items || [];
	if (state.folders.length && !state.selectedFolderId) state.selectedFolderId = state.folders[0].id;
	if (!state.folders.find(folder => folder.id === state.selectedFolderId)) state.selectedFolderId = state.folders[0]?.id || '';
	renderFolders();
	await loadNotes();
};

const bootstrap = async () => {
	try {
		const payload = await requestJson('/api/web/me');
		state.user = payload.user;
		renderSession();
		await loadFolders();
	} catch (error) {
		if (error.status === 401) {
			state.user = null;
			renderSession();
			return;
		}

		elements.sessionStatus.textContent = error.message || 'Could not load app state.';
		elements.workspace.hidden = true;
	}
};

const logout = async () => {
	elements.logoutButton.disabled = true;
	elements.logoutButton.textContent = 'Logging out...';

	try {
		const response = await fetch(`${joplinPublicBasePath}/logout`, {
			method: 'POST',
			credentials: 'same-origin',
		});

		if (!response.ok) {
			throw new Error(`Logout failed: ${response.status}`);
		}

		resetState();
	} catch (error) {
		elements.logoutButton.disabled = false;
		elements.logoutButton.textContent = 'Logout';
		elements.sessionStatus.textContent = error.message || 'Logout failed.';
	}
};

elements.logoutButton.addEventListener('click', () => {
	void logout();
});

void bootstrap();
