const crypto = require('crypto');

const base32Alphabet = 'abcdefghijklmnopqrstuvwxyz234567';

const normalizeSeed = seed => `${seed || ''}`.trim().toLowerCase();

const base32Decode = value => {
	const normalized = normalizeSeed(value).replace(/=+$/g, '');
	let bits = '';
	for (const char of normalized) {
		const index = base32Alphabet.indexOf(char);
		if (index < 0) throw new Error('Invalid TOTP seed');
		bits += index.toString(2).padStart(5, '0');
	}
	const bytes = [];
	for (let i = 0; i + 8 <= bits.length; i += 8) {
		bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
	}
	return Buffer.from(bytes);
};

const hotp = (secret, counter) => {
	const buf = Buffer.alloc(8);
	buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
	buf.writeUInt32BE(counter % 0x100000000, 4);
	const digest = crypto.createHmac('sha1', secret).update(buf).digest();
	const offset = digest[digest.length - 1] & 0x0f;
	const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
	return `${binary % 1000000}`.padStart(6, '0');
};

const createMfaService = options => {
	const seed = normalizeSeed(options.seed);
	const issuer = options.issuer || 'Joplock';
	const enabled = !!seed;
	const secret = enabled ? base32Decode(seed) : null;

	return {
		enabled() {
			return enabled;
		},

		otpauthUri(accountLabel) {
			if (!enabled) return '';
			const label = encodeURIComponent(`${issuer}:${accountLabel}`);
			return `otpauth://totp/${label}?secret=${seed.toUpperCase()}&issuer=${encodeURIComponent(issuer)}`;
		},

		verify(code, now = Date.now()) {
			if (!enabled) return true;
			const token = `${code || ''}`.replace(/\s+/g, '');
			if (!/^\d{6}$/.test(token)) return false;
			const counter = Math.floor(now / 30000);
			for (let offset = -1; offset <= 1; offset++) {
				if (hotp(secret, counter + offset) === token) return true;
			}
			return false;
		},

		maskedSeed() {
			if (!enabled) return '';
			return seed.toUpperCase();
		},

		qrDataUrl(accountLabel) {
			if (!enabled) return '';
			const text = this.otpauthUri(accountLabel);
			const size = 21;
			const cell = 8;
			const quiet = 2;
			const hash = crypto.createHash('sha256').update(text).digest();
			let bits = '';
			for (const byte of hash) bits += byte.toString(2).padStart(8, '0');
			while (bits.length < size * size) bits += bits;
			const rects = [];
			for (let y = 0; y < size; y++) {
				for (let x = 0; x < size; x++) {
					if (bits[y * size + x] === '1') rects.push(`<rect x="${(x + quiet) * cell}" y="${(y + quiet) * cell}" width="${cell}" height="${cell}" />`);
				}
			}
			const px = (size + quiet * 2) * cell;
			const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px} ${px}" fill="#000"><rect width="${px}" height="${px}" fill="#fff"/>${rects.join('')}</svg>`;
			return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
		},
	};
};

module.exports = {
	base32Decode,
	createMfaService,
	hotp,
	normalizeSeed,
};
