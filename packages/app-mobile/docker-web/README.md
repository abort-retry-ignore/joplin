# Joplin Mobile Web In Docker

This hosts the existing `@joplin/app-mobile` web build behind a single local login.

## Quick Start

1. Copy `.env-sample` to `.env`.
2. Set `APP_PASSWORD` or `APP_PASSWORD_HASH`.
3. Run:

```bash
docker compose up --build
```

4. Open `http://localhost:3111`.

## Password Hash

To avoid storing the password in plain text, generate a hash from the repo root:

```bash
node packages/app-mobile/docker-web/hashPassword.js 'your-password'
```

Then set the output as `APP_PASSWORD_HASH` and remove `APP_PASSWORD`.

## Notes

- The app is served from `/app/` so the mobile web service worker stays scoped to the app, not the login page.
- Browser data remains local to the browser profile in this phase.
- For real mobile PWA install behavior, run behind HTTPS and set `COOKIE_SECURE=1`.
