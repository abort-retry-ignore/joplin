import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import DatabaseDriver, { DatabaseCloseOptions, DatabaseOpenOptions } from '@joplin/lib/database-driver';
import { safeFilename } from '@joplin/utils/path';
import { readBootPassword, clearBootPassword } from './webEncryptionPassword';
import { attachRecoverableWebDatabaseStartupError } from './webDatabaseStartupRecovery';
import { isResetPending } from './webDatabaseStorageReset.web';

const IDB_NAME = 'joplin-encrypted-db-store';
const IDB_STORE = 'databases';
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

// Cache boot password at module level so multiple driver instances (log.sqlite,
// database.sqlite) can all read it. The sessionStorage value is cleared only
// after the password has been cached here.
let cachedBootPassword: string | null = null;
let bootPasswordRead = false;
const getBootPassword = (): string | null => {
	if (!bootPasswordRead) {
		cachedBootPassword = readBootPassword();
		clearBootPassword();
		bootPasswordRead = true;
	}
	return cachedBootPassword;
};

// --- IndexedDB helpers ---

const openIdb = (): Promise<IDBDatabase> => {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(IDB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
};

const idbGet = async (key: string): Promise<ArrayBuffer | null> => {
	const db = await openIdb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(IDB_STORE, 'readonly');
		const req = tx.objectStore(IDB_STORE).get(key);
		req.onsuccess = () => resolve(req.result ?? null);
		req.onerror = () => reject(req.error);
		tx.oncomplete = () => db.close();
	});
};

const idbPut = async (key: string, value: ArrayBuffer): Promise<void> => {
	const db = await openIdb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(IDB_STORE, 'readwrite');
		tx.objectStore(IDB_STORE).put(value, key);
		tx.oncomplete = () => { db.close(); resolve(); };
		tx.onerror = () => { db.close(); reject(tx.error); };
	});
};

const idbDelete = async (key: string): Promise<void> => {
	const db = await openIdb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(IDB_STORE, 'readwrite');
		tx.objectStore(IDB_STORE).delete(key);
		tx.oncomplete = () => { db.close(); resolve(); };
		tx.onerror = () => { db.close(); reject(tx.error); };
	});
};

// --- AES-256-GCM encryption helpers ---

const SALT_KEY = 'joplin-web-db-salt';

const getOrCreateSalt = (): Uint8Array => {
	const stored = localStorage.getItem(SALT_KEY);
	if (stored) {
		const bytes = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
		if (bytes.length === 32) return bytes;
	}
	const salt = crypto.getRandomValues(new Uint8Array(32));
	localStorage.setItem(SALT_KEY, btoa(String.fromCharCode(...salt)));
	return salt;
};

const deriveKey = async (password: string): Promise<CryptoKey> => {
	const enc = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt: getOrCreateSalt(), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
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
	private idbKey_: string;
	private cryptoKey_: CryptoKey | null = null;
	private persistTimer_: ReturnType<typeof setTimeout> | null = null;
	private persistPromise_: Promise<void> | null = null;

	public constructor() {
		this.lastInsertId_ = null;
	}

	public async open(options: DatabaseOpenOptions) {
		const filename = getDatabaseFilename(options.name);
		this.idbKey_ = filename;

		const bootPassword = getBootPassword();

		const sqlite3 = await getModule();
		this.sqlite3_ = sqlite3;

		// Only encrypt the main database — log.sqlite is disposable and
		// encrypting it causes startup failures when sessions change.
		const shouldEncrypt = bootPassword && options.name !== 'log.sqlite';
		if (shouldEncrypt) {
			this.cryptoKey_ = await deriveKey(bootPassword);
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
		// screen), skip loading from IDB. Don't clear the flag here — multiple
		// driver instances (log.sqlite, database.sqlite) need to see it. The
		// flag is cleared after successful app startup or on next reset call.
		const resetRequested = isResetPending();
		if (resetRequested) {
			try {
				await idbDelete(filename);
			} catch {
				// Best-effort — DB is fresh in-memory anyway.
			}
		}

		// Restore from IndexedDB if available (and no reset was requested).
		if (!resetRequested) {
			const stored = await idbGet(filename);
			if (stored && stored.byteLength > 0) {
				console.info(`[db-driver] Restoring "${filename}" from IDB (${stored.byteLength} bytes, encrypted=${!!this.cryptoKey_})`);
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
						message: 'Stored local database could not be decrypted. Password may be wrong, or stored data may be corrupted.',
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
						message: 'Stored local database could not be loaded. Password may be wrong, or stored data may be corrupted.',
					});
				}
			}
		} else {
			console.info(`[db-driver] Reset pending for "${filename}", using fresh in-memory DB`);
		}

		// Start periodic auto-save.
		setInterval(() => {
			void this.persistToIdb_();
		}, AUTO_SAVE_INTERVAL_MS);

		// Flush on page unload to avoid data loss.
		window.addEventListener('beforeunload', () => {
			void this.flush();
		});
	}

	// Schedule persist with debounce. Multiple rapid exec() calls (e.g. during
	// migrations) coalesce into one IDB write after 500ms of quiet.
	private schedulePersist_(): void {
		if (this.persistTimer_) clearTimeout(this.persistTimer_);
		this.persistTimer_ = setTimeout(() => {
			this.persistTimer_ = null;
			this.persistPromise_ = this.persistToIdb_().finally(() => {
				this.persistPromise_ = null;
			});
		}, 500);
	}

	// Flush any pending or in-flight persist. Used before close / page unload.
	public async flush(): Promise<void> {
		if (this.persistTimer_) {
			clearTimeout(this.persistTimer_);
			this.persistTimer_ = null;
		}
		if (this.persistPromise_) {
			await this.persistPromise_;
		}
		await this.persistToIdb_();
	}

	private async persistToIdb_(): Promise<void> {
		if (!this.db_ || !this.sqlite3_) return;
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
			await idbPut(this.idbKey_, toStore);
		} catch (error) {
			console.warn(`Auto-save of database "${this.idbKey_}" failed: ${error}`);
		}
	}

	public async deleteDatabase(options: DatabaseCloseOptions) {
		const filename = getDatabaseFilename(options.name);
		await idbDelete(filename);
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
