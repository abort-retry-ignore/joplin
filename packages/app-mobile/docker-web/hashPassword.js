const crypto = require('crypto');

const password = process.argv[2];

if (!password) {
	console.error('Usage: node hashPassword.js <password>');
	process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
const cost = 16384;
const keyLength = 64;
const derivedKey = crypto.scryptSync(password, salt, keyLength, { N: cost, r: 8, p: 1 });

process.stdout.write(`scrypt$${cost}$${salt}$${derivedKey.toString('hex')}\n`);
