// Encryption helpers for the fs-driver web worker.
//
// Format of every encrypted file written to OPFS:
//
//   [ 4 bytes magic ] [ 1 byte version ] [ 12 bytes IV ] [ N bytes AES-256-GCM ciphertext ]
//
// The magic bytes allow the reader to detect unencrypted legacy files and return them as-is
// so that an existing unencrypted profile can still be read after encryption is enabled (one-
// time transparent migration happens on first write).

const MAGIC = new Uint8Array([0x4a, 0x57, 0x45, 0x42]); // Joplin Web magic bytes
const VERSION = 1;
const IV_LENGTH = 12;
const HEADER_LENGTH = MAGIC.length + 1 + IV_LENGTH; // 17 bytes

const isEncryptedBuffer = (buf: ArrayBuffer): boolean => {
	if (buf.byteLength < HEADER_LENGTH) return false;
	const view = new Uint8Array(buf, 0, MAGIC.length);
	for (let i = 0; i < MAGIC.length; i++) {
		if (view[i] !== MAGIC[i]) return false;
	}
	return new Uint8Array(buf)[MAGIC.length] === VERSION;
};

// Derives an AES-256-GCM CryptoKey from a plain-text password and a fixed per-installation
// salt stored in the OPFS root alongside the encrypted files.
export const deriveKey = async (password: string, salt: Uint8Array): Promise<CryptoKey> => {
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
			iterations: 210_000,
			hash: 'SHA-256',
		},
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
};

export const encryptBytes = async (key: CryptoKey, plaintext: ArrayBuffer): Promise<ArrayBuffer> => {
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		plaintext,
	);

	const result = new Uint8Array(HEADER_LENGTH + ciphertext.byteLength);
	result.set(MAGIC, 0);
	result[MAGIC.length] = VERSION;
	result.set(iv, MAGIC.length + 1);
	result.set(new Uint8Array(ciphertext), HEADER_LENGTH);
	return result.buffer;
};

export const decryptBytes = async (key: CryptoKey, data: ArrayBuffer): Promise<ArrayBuffer> => {
	if (!isEncryptedBuffer(data)) {
		// Legacy unencrypted file — return as-is so the app can still read it.
		// On the next write the data will be re-written encrypted.
		return data;
	}

	const iv = new Uint8Array(data, MAGIC.length + 1, IV_LENGTH);
	const ciphertext = data.slice(HEADER_LENGTH);

	return crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv },
		key,
		ciphertext,
	);
};
