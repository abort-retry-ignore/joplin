import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import DatabaseDriver, { DatabaseCloseOptions, DatabaseOpenOptions } from '@joplin/lib/database-driver';
import { safeFilename } from '@joplin/utils/path';
import { readVaultId, readVaultPassword } from './webEncryptionPassword';
import { attachRecoverableWebDatabaseStartupError } from './webDatabaseStartupRecovery';
import { isResetPending } from './webDatabaseStorageReset.web';

const PBKDF2_ITERATIONS = 210_000;
const AUTO_SAVE_INTERVAL_MS = 30_000;

const getDatabaseFilename = (name: string) => `${safeFilename(name)}.sqlite3`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- sqlite3 WASM types are complex; typed where it matters.
type Sqlite3Module = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- oo1.DB instance.
type Sqlite3Db = any;

// Singleton WASM module.
let modulePromise: Promise<Sqlite3Module> | null = null;
const getModule = (): Promise<Sqlite3Module> => {
	if (!modulePromise) {
		modulePromise = sqlite3InitModule();
	}
	return modulePromise;
};

// --- Server blob API helpers ---

// Fetch encrypted blob from server. Returns null if no blob exists yet (204).
const fetchVaultBlob = async (vaultId: string): Promise<ArrayBuffer | null> => {
	const res = await fetch(`/api/vaults/${encodeURIComponent(vaultId)}/blob`, { credentials: 'same-origin' });
	if (res.status === 204) return null;
	if (!res.ok) throw new Error(`Failed to fetch vault blob: ${res.status} ${res.statusText}`);
	return res.arrayBuffer();
};

const putVaultBlob = async (vaultId: string, data: ArrayBuffer): Promise<void> => {
	const res = await fetch(`/api/vaults/${encodeURIComponent(vaultId)}/blob`, {
		method: 'PUT',
		credentials: 'same-origin',
		headers: { 'Content-Type': 'application/octet-stream' },
		body: data,
	});
	if (!res.ok) throw new Error(`Failed to save vault blob: ${res.status} ${res.statusText}`);
};

const fetchVaultSalt = async (vaultId: string): Promise<Uint8Array> => {
	const res = await fetch(`/api/vaults/${encodeURIComponent(vaultId)}/salt`, { credentials: 'same-origin' });
	if (!res.ok) throw new Error(`Failed to fetch vault salt: ${res.status} ${res.statusText}`);
	const { salt } = await res.json() as { salt: string };
	return Uint8Array.from(atob(salt), c => c.charCodeAt(0));
};

// --- AES-256-GCM encryption helpers ---

const deriveKey = async (password: string, salt: Uint8Array): Promise<CryptoKey> => {
	const enc = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
};

const encrypt = async (key: CryptoKey, data: Uint8Array): Promise<ArrayBuffer> => {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
	// Prefix ciphertext with IV (12 bytes).
	const result = new Uint8Array(12 + ciphertext.byteLength);
	result.set(iv, 0);
	result.set(new Uint8Array(ciphertext), 12);
	return result.buffer;
};

const decrypt = async (key: CryptoKey, data: ArrayBuffer): Promise<Uint8Array> => {
	const iv = new Uint8Array(data, 0, 12);
	const ciphertext = new Uint8Array(data, 12);
	const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
	return new Uint8Array(plain);
};

// --- Database driver ---

export default class DatabaseDriverReactNative implements DatabaseDriver {
	private lastInsertId_: string;
	private db_: Sqlite3Db;
	private sqlite3_: Sqlite3Module;
	private vaultId_: string | null = null;
	private cryptoKey_: CryptoKey | null = null;
	private persistTimer_: ReturnType<typeof setTimeout> | null = null;
	private persistPromise_: Promise<void> | null = null;
	private isLogDb_ = false;

	public constructor() {
		this.lastInsertId_ = null;
	}

	public async open(options: DatabaseOpenOptions) {
		const filename = getDatabaseFilename(options.name);
		this.isLogDb_ = options.name === 'log.sqlite';

		const vaultId = readVaultId();
		const vaultPassword = readVaultPassword();
		this.vaultId_ = vaultId;
		const resetRequested = isResetPending();

		if (!this.isLogDb_ && !resetRequested && (!vaultId || !vaultPassword)) {
			throw attachRecoverableWebDatabaseStartupError(new Error(`Missing vault credentials for "${filename}"`), {
				databaseName: filename,
				reason: 'restore',
				message: 'Vault session expired. Go back to the vault selector and open the vault again.',
			});
		}

		const sqlite3 = await getModule();
		this.sqlite3_ = sqlite3;

		// Only encrypt the main database — log.sqlite is disposable.
		const shouldEncrypt = !this.isLogDb_ && vaultId && vaultPassword;
		if (shouldEncrypt) {
			const salt = await fetchVaultSalt(vaultId);
			this.cryptoKey_ = await deriveKey(vaultPassword, salt);
		}

		// Create in-memory database.
		const db = new sqlite3.oo1.DB(':memory:');
		this.db_ = db;

		// Sanity-check: verify the fresh in-memory DB is queryable.
		try {
			db.exec('SELECT 1');
		} catch (sanityError) {
			throw new Error(`Fresh :memory: DB failed sanity check for "${filename}": ${sanityError}`);
		}

		// If a reset was requested (e.g. "Delete local data" from the recovery
		// screen), skip loading from vault. Don't clear the flag here — multiple
		// driver instances (log.sqlite, database.sqlite) need to see it.
		// Restore from server vault blob if available (and no reset was requested).
		if (!resetRequested && !this.isLogDb_ && vaultId) {
			const stored = await fetchVaultBlob(vaultId);
			if (stored && stored.byteLength > 0) {
				// eslint-disable-next-line no-console
				console.info(`[db-driver] Restoring "${filename}" from vault (${stored.byteLength} bytes, encrypted=${!!this.cryptoKey_})`);
				let dbBytes: Uint8Array;
				try {
					if (this.cryptoKey_) {
						dbBytes = await decrypt(this.cryptoKey_, stored);
					} else {
						dbBytes = new Uint8Array(stored);
					}
				} catch (error) {
					throw attachRecoverableWebDatabaseStartupError(new Error(`Could not decrypt database "${filename}": ${error}`), {
						databaseName: filename,
						reason: 'restore',
						message: 'Stored vault database could not be decrypted. Password may be wrong, or stored data may be corrupted.',
					});
				}

				const rc = sqlite3.capi.sqlite3_deserialize(
					db.pointer,
					'main',
					sqlite3.wasm.allocFromTypedArray(dbBytes),
					dbBytes.byteLength,
					dbBytes.byteLength,
					sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
				);
				if (rc !== 0) {
					throw attachRecoverableWebDatabaseStartupError(new Error(`sqlite3_deserialize failed for "${filename}" with code ${rc}`), {
						databaseName: filename,
						reason: 'restore',
						message: 'Stored vault database could not be loaded. Password may be wrong, or stored data may be corrupted.',
					});
				}
			}
		} else if (resetRequested) {
			// eslint-disable-next-line no-console
			console.info(`[db-driver] Reset pending for "${filename}", using fresh in-memory DB`);
		}

		// Start periodic auto-save (main DB only).
		if (!this.isLogDb_) {
			setInterval(() => {
				void this.persistToServer_();
			}, AUTO_SAVE_INTERVAL_MS);

			window.addEventListener('beforeunload', () => {
				void this.flush();
			});
		}
	}

	// Schedule persist with debounce. Multiple rapid exec() calls (e.g. during
	// migrations) coalesce into one server write after 500ms of quiet.
	private schedulePersist_(): void {
		if (this.isLogDb_) return;
		if (this.persistTimer_) clearTimeout(this.persistTimer_);
		this.persistTimer_ = setTimeout(async () => {
			this.persistTimer_ = null;
			try {
				this.persistPromise_ = this.persistToServer_();
				await this.persistPromise_;
			} finally {
				this.persistPromise_ = null;
			}
		}, 500);
	}

	// Flush any pending or in-flight persist. Used before close / page unload.
	public async flush(): Promise<void> {
		if (this.isLogDb_) return;
		if (this.persistTimer_) {
			clearTimeout(this.persistTimer_);
			this.persistTimer_ = null;
		}
		if (this.persistPromise_) {
			await this.persistPromise_;
		}
		await this.persistToServer_();
	}

	private async persistToServer_(): Promise<void> {
		if (!this.db_ || !this.sqlite3_ || !this.vaultId_) return;
		try {
			// sqlite3_js_db_export handles all pointer management internally
			// and returns a Uint8Array of the serialized database.
			const rawBytes: Uint8Array = this.sqlite3_.capi.sqlite3_js_db_export(this.db_.pointer);
			if (rawBytes.byteLength === 0) return;
			let toStore: ArrayBuffer;
			if (this.cryptoKey_) {
				toStore = await encrypt(this.cryptoKey_, rawBytes);
			} else {
				// Use slice() to get an owned ArrayBuffer. rawBytes may be a
				// view into a larger WASM heap buffer, so rawBytes.buffer would
				// include unrelated data.
				toStore = rawBytes.slice().buffer;
			}
			await putVaultBlob(this.vaultId_, toStore);
		} catch (error) {
			console.warn(`Auto-save of database to vault "${this.vaultId_}" failed: ${error}`);
		}
	}

	public async deleteDatabase(options: DatabaseCloseOptions) {
		// Deletion is handled via the vault delete API on the vault landing page.
		// This method is called during local reset; nothing to do here since the
		// in-memory DB is discarded and a new session will start fresh.
		// eslint-disable-next-line no-console
		console.info(`[db-driver] deleteDatabase called for "${options.name}" — vault blob retained until vault is deleted via UI`);
	}

	public sqliteErrorToJsError(error: Error) {
		return error;
	}

	public selectOne(sql: string, params: (string | number | boolean)[] | null = []) {
		const row = params && params.length > 0
			? this.db_.selectObject(sql, params)
			: this.db_.selectObject(sql);
		return Promise.resolve(row ?? null);
	}

	public selectAll(sql: string, params: (string | number | boolean)[] | null = []) {
		const rows = params && params.length > 0
			? this.db_.selectObjects(sql, params)
			: this.db_.selectObjects(sql);
		return Promise.resolve(rows);
	}

	public loadExtension(path: string) {
		throw new Error(`No extension support for ${path} in sqlite wasm`);
	}

	public async exec(sql: string, params: (string | number | boolean)[] | null = null) {
		if (params && params.length > 0) {
			this.db_.exec({ sql, bind: params });
		} else {
			this.db_.exec(sql);
		}
		// Debounced persist — coalesces rapid writes (e.g. migrations).
		this.schedulePersist_();
	}

	public lastInsertId() {
		return this.lastInsertId_;
	}
}
