export type RecoverableWebDatabaseStartupReason = 'restore' | 'schema';

export interface RecoverableWebDatabaseStartupError {
	databaseName: string;
	reason: RecoverableWebDatabaseStartupReason;
	message: string;
}

const recoveryErrorKey = '__joplinRecoverableWebDatabaseStartupError';

type ErrorWithRecovery = Error & {
	[recoveryErrorKey]?: RecoverableWebDatabaseStartupError;
};

export const attachRecoverableWebDatabaseStartupError = (error: Error, recovery: RecoverableWebDatabaseStartupError): Error => {
	(error as ErrorWithRecovery)[recoveryErrorKey] = recovery;
	return error;
};

export const extractRecoverableWebDatabaseStartupError = (error: unknown): RecoverableWebDatabaseStartupError | null => {
	// Check for the tagged property on the error object (may have been
	// copied from an inner error by the initialize() wrapper).
	if (error && typeof error === 'object' && recoveryErrorKey in error) {
		return (error as ErrorWithRecovery)[recoveryErrorKey] ?? null;
	}

	// Fallback: regex match on the serialized error message. Match any
	// buildStartupTasks step, not just openDatabase — log.sqlite failures
	// happen during "set up logger".
	const message = error instanceof Error ? error.message : `${error}`;
	if (!message.includes('buildStartupTasks/')) return null;

	if (message.includes('Could not decrypt database') || message.includes('sqlite3_deserialize failed')) {
		return {
			databaseName: 'unknown',
			reason: 'restore',
			message: 'Stored local database could not be decrypted or loaded. Password may be wrong, or stored data may be corrupted.',
		};
	}

	const schemaConflict = message.match(/SQLite3Error: SQLITE_ERROR: sqlite3 result code 1: table (.+) already exists/);
	if (schemaConflict) {
		return {
			databaseName: 'database.sqlite',
			reason: 'schema',
			message: 'Existing local database could not be opened cleanly. Stored data may be corrupted or was loaded with the wrong password.',
		};
	}

	return null;
};
