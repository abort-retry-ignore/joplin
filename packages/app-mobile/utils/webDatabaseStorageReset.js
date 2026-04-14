"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearResetPending = exports.isResetPending = exports.RESET_PENDING_KEY = void 0;
exports.default = resetWebDatabaseStorage;
exports.RESET_PENDING_KEY = 'joplin-web-db-reset-pending';
const isResetPending = () => {
    return false;
};
exports.isResetPending = isResetPending;
const clearResetPending = () => {
    // No-op on non-web platforms.
};
exports.clearResetPending = clearResetPending;
async function resetWebDatabaseStorage() {
    throw new Error('resetWebDatabaseStorage is only available on web');
}
//# sourceMappingURL=webDatabaseStorageReset.js.map