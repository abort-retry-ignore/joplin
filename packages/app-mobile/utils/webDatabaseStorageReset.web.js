"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearResetPending = exports.isResetPending = exports.RESET_PENDING_KEY = void 0;
exports.default = resetWebDatabaseStorage;
const IDB_NAME = 'joplin-encrypted-db-store';
const SALT_KEY = 'joplin-web-db-salt';
exports.RESET_PENDING_KEY = 'joplin-web-db-reset-pending';
// Check whether a previous reset was requested but may not have completed
// (e.g. IDB delete was blocked by open connections). The database driver
// checks this flag on open() and skips loading from IDB when set.
const isResetPending = () => {
    try {
        return localStorage.getItem(exports.RESET_PENDING_KEY) === '1';
    }
    catch (_a) {
        return false;
    }
};
exports.isResetPending = isResetPending;
const clearResetPending = () => {
    try {
        localStorage.removeItem(exports.RESET_PENDING_KEY);
    }
    catch (_a) {
        // Ignore storage errors.
    }
};
exports.clearResetPending = clearResetPending;
async function resetWebDatabaseStorage() {
    // Set a flag BEFORE attempting IDB delete. If the delete is blocked by an
    // open connection from the current page, the driver will see this flag on
    // the next startup and skip loading stale IDB data.
    try {
        localStorage.setItem(exports.RESET_PENDING_KEY, '1');
    }
    catch (_a) {
        // Non-fatal — IDB delete below may still succeed.
    }
    try {
        await new Promise((resolve, reject) => {
            const req = indexedDB.deleteDatabase(IDB_NAME);
            req.onsuccess = () => resolve();
            req.onerror = () => { var _a; return reject((_a = req.error) !== null && _a !== void 0 ? _a : new Error(`Could not delete IndexedDB database ${IDB_NAME}`)); };
            req.onblocked = () => {
                // Blocked by open connections from current page. Resolve anyway —
                // the reset-pending flag will ensure the driver skips IDB data.
                console.warn(`IndexedDB delete for ${IDB_NAME} was blocked; reset-pending flag will handle cleanup on next load.`);
                resolve();
            };
        });
    }
    catch (_b) {
        // Non-fatal — the reset-pending flag is the real safety net.
    }
    try {
        localStorage.removeItem(SALT_KEY);
    }
    catch (_c) {
        // Ignore storage errors.
    }
}
//# sourceMappingURL=webDatabaseStorageReset.web.js.map