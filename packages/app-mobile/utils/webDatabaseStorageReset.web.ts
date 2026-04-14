const IDB_NAME = 'joplin-encrypted-db-store';
const SALT_KEY = 'joplin-web-db-salt';
export const RESET_PENDING_KEY = 'joplin-web-db-reset-pending';

// Check whether a previous reset was requested but may not have completed
// (e.g. IDB delete was blocked by open connections). The database driver
// checks this flag on open() and skips loading from IDB when set.
export const isResetPending = (): boolean => {
	try {
		return localStorage.getItem(RESET_PENDING_KEY) === '1';
	} catch {
		return false;
	}
};

export const clearResetPending = (): void => {
	try {
		localStorage.removeItem(RESET_PENDING_KEY);
	} catch {
		// Ignore storage errors.
	}
};

export default async function resetWebDatabaseStorage(): Promise<void> {
	// Set a flag BEFORE attempting IDB delete. If the delete is blocked by an
	// open connection from the current page, the driver will see this flag on
	// the next startup and skip loading stale IDB data.
	try {
		localStorage.setItem(RESET_PENDING_KEY, '1');
	} catch {
		// Non-fatal — IDB delete below may still succeed.
	}

	try {
		await new Promise<void>((resolve, reject) => {
			const req = indexedDB.deleteDatabase(IDB_NAME);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error ?? new Error(`Could not delete IndexedDB database ${IDB_NAME}`));
			req.onblocked = () => {
				// Blocked by open connections from current page. Resolve anyway —
				// the reset-pending flag will ensure the driver skips IDB data.
				console.warn(`IndexedDB delete for ${IDB_NAME} was blocked; reset-pending flag will handle cleanup on next load.`);
				resolve();
			};
		});
	} catch {
		// Non-fatal — the reset-pending flag is the real safety net.
	}

	try {
		localStorage.removeItem(SALT_KEY);
	} catch {
		// Ignore storage errors.
	}
}
