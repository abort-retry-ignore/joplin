// Key derivation for the browser-local encrypted fs-driver.
//
// The derived key lives in memory only — it is never persisted.
// A per-installation salt IS persisted in localStorage so the same
// password always produces the same key for a given browser profile.
//
// Duplicate comment: this module is intentionally separate from fsDriverWebCrypto.ts
// (which lives in the worker context) so that the derivation cost stays on the
// main thread and the result is transferred to the worker as a CryptoKey via structured clone.

const SALT_STORAGE_KEY = 'joplin-web-fs-salt';
const PBKDF2_ITERATIONS = 210_000;

const getOrCreateSalt = (): Uint8Array => {
	const stored = localStorage.getItem(SALT_STORAGE_KEY);
	if (stored) {
		const bytes = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
		if (bytes.length === 32) return bytes;
	}

	const salt = crypto.getRandomValues(new Uint8Array(32));
	localStorage.setItem(SALT_STORAGE_KEY, btoa(String.fromCharCode(...salt)));
	return salt;
};

export const deriveFsEncryptionKey = async (password: string): Promise<CryptoKey> => {
	const salt = getOrCreateSalt();
	const enc = new TextEncoder();

	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		enc.encode(password),
		'PBKDF2',
		false,
		['deriveKey'],
	);

	return crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt,
			iterations: PBKDF2_ITERATIONS,
			hash: 'SHA-256',
		},
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
};

export default deriveFsEncryptionKey;
