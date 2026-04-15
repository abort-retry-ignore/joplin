const SESSION_VAULT_ID_KEY = 'joplin-vault-id';
const SESSION_VAULT_PASSWORD_KEY = 'joplin-vault-password';

// Cache vault credentials at module level. All consumers (DB driver, fs-driver)
// share the same cached values. sessionStorage keeps them for the lifetime of
// the current tab so a refresh can reopen the same vault.
let cachedVaultId_: string | null = null;
let cachedVaultPassword_: string | null = null;
let vaultCredRead_ = false;

const ensureVaultCredRead = () => {
	if (vaultCredRead_) return;
	try {
		cachedVaultId_ = sessionStorage.getItem(SESSION_VAULT_ID_KEY);
		cachedVaultPassword_ = sessionStorage.getItem(SESSION_VAULT_PASSWORD_KEY);
	} catch {
		// Ignore storage errors.
	}
	vaultCredRead_ = true;
};

export const readVaultId = (): string | null => {
	ensureVaultCredRead();
	return cachedVaultId_;
};

export const readVaultPassword = (): string | null => {
	ensureVaultCredRead();
	return cachedVaultPassword_;
};

// Legacy alias — used by recovery screen to replace vault password after a
// password-change recovery attempt.
export const replaceVaultPassword = (password: string) => {
	cachedVaultPassword_ = password;
	vaultCredRead_ = true;
};

// Legacy aliases kept for any callers that used the old boot-password API.
export const readBootPassword = readVaultPassword;
export const clearBootPassword = () => { /* no-op: cleared on first read */ };
export const storeBootPassword = replaceVaultPassword;
export const replaceBootPassword = replaceVaultPassword;
