const SESSION_PASSWORD_KEY = 'joplin-web-boot-password';

export const readBootPassword = (): string|null => {
	try {
		return sessionStorage.getItem(SESSION_PASSWORD_KEY);
	} catch {
		return null;
	}
};

export const clearBootPassword = () => {
	try {
		sessionStorage.removeItem(SESSION_PASSWORD_KEY);
	} catch {
		// Ignore storage errors.
	}
};

export const storeBootPassword = (password: string) => {
	try {
		if (password) sessionStorage.setItem(SESSION_PASSWORD_KEY, password);
	} catch {
		// Ignore storage errors.
	}
};

export const replaceBootPassword = (password: string) => {
	clearBootPassword();
	storeBootPassword(password);
};
