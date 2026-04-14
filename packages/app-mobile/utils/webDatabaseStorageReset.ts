export const RESET_PENDING_KEY = 'joplin-web-db-reset-pending';

export const isResetPending = (): boolean => {
	return false;
};

export const clearResetPending = (): void => {
	// No-op on non-web platforms.
};

export default async function resetWebDatabaseStorage(): Promise<void> {
	throw new Error('resetWebDatabaseStorage is only available on web');
}
