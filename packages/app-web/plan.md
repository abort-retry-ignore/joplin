# Joplock Thin Client Plan

## Goal

Build `packages/app-web` as thin-client web frontend for Joplin Server.

Requirements:
- same backend as existing Joplin Server
- same auth/session as Joplin Server
- same user data visible across web, desktop, mobile, CLI
- minimal browser storage
- no offline note cache
- PWA shell support
- thin client UI distinct from other Joplin clients
- no dependency on `app-mobile` or old browser-local vault work

## Non-Goals

- no browser-local authoritative DB
- no offline reading or editing
- no plugin support in first versions
- no need to reuse React Native web code
- no separate vault encryption model
- no custom auth separate from Joplin Server auth

## Product Model

- one Joplin Server instance
- one user logs in with normal Joplin Server account
- one user can open web thin client in multiple browsers and see same server-backed data
- desktop/mobile/CLI keep syncing against same server as before
- thin client talks to same server through app-specific API endpoints

## Package Split

### `packages/server`

Owns backend responsibilities:
- auth/session reuse
- app-facing thin-client API
- sync compatibility for other Joplin clients
- resource delivery
- server-side search/list behavior
- static hosting for built `app-web` assets

### `packages/app-web`

Owns frontend responsibilities:
- thin-client SPA/PWA shell
- note list, folder tree, editor, search, settings UI
- same-origin API client for `packages/server`
- no browser-local source of truth

## Architecture Decision

### Backend

Use `packages/server` as base.

Reasons:
- already has users, sessions, MFA, sharing, storage, sync API
- already supports PostgreSQL
- already owns canonical server state for all clients
- easier to import upstream Joplin Server changes later

### Frontend

Build new dedicated web app in `packages/app-web`.

Characteristics:
- same-origin app served by server
- cookie/session auth via server
- online-only thin client
- no local DB
- no OPFS authority
- no browser sync engine

### Data Strategy

Keep existing sync/item storage compatibility for external Joplin clients.

Add app-facing server API for thin client.

Possible read model:
1. Start by reading existing server item model directly
2. Add projection/index tables later if note list/search performance needs it

## Milestones

### Milestone 0: Foundation Decisions

- confirm `packages/server` + `packages/app-web` split
- confirm PostgreSQL for primary deployment
- confirm online-only PWA
- confirm thin client scope: notes, folders, search, resources, basic settings/themes
- confirm frontend stack inside `packages/app-web`

Deliverables:
- architecture doc
- API surface doc
- route/module layout for server and app-web

### Milestone 1: `app-web` Scaffold

Create `packages/app-web` as dedicated thin-client frontend package.

Tasks:
- choose frontend build stack
- add package manifest and workspace wiring
- add minimal build pipeline
- add app shell, routing, theming foundation
- add PWA manifest/service worker for shell/assets only

Deliverables:
- `packages/app-web` builds
- server can later serve built app assets
- installable shell exists without app data features yet

### Milestone 2: Server Web App Hosting

Add authenticated web app entrypoint to `packages/server`.

Tasks:
- add `/app` route behind existing auth/session
- reuse existing login flow and session cookie
- serve built `packages/app-web` output
- redirect unauthenticated users to existing login

Deliverables:
- logged-in web shell loads from server
- unauthenticated users redirected to existing login
- app-web and server integrated same-origin

### Milestone 3: Thin Client API

Add app-oriented endpoints under new namespace, for example `/api/web`.

Initial endpoints:
- `GET /api/web/me`
- `GET /api/web/folders`
- `GET /api/web/notes`
- `GET /api/web/notes/:id`
- `POST /api/web/notes`
- `PUT /api/web/notes/:id`
- `DELETE /api/web/notes/:id`
- `GET /api/web/search`
- `GET /api/web/sync/status`
- `POST /api/web/sync`

Requirements:
- same auth/session as server
- no raw SQL over network
- responses shaped for thin client UI, not sync protocol

### Milestone 4: Core UI Vertical Slice

Build minimal useful web app in `packages/app-web`:
- folder sidebar
- note list
- note viewer/editor
- create note
- rename/delete note
- basic markdown editing
- save feedback/state

Requirements:
- server-authoritative state
- browser memory limited to current session UI state
- no full notebook cache persisted locally

### Milestone 5: Search and Fast Lists

Implement server-side search/list optimization.

Start with direct item model reads.

If needed, add projection layer:
- note summaries
- folder hierarchy cache
- normalized note-tag mapping
- search index support

Deliverables:
- fast note list
- fast search results
- stable pagination

### Milestone 6: Resources

Add thin-client resource handling.

Tasks:
- server resource metadata endpoint
- same-origin resource content endpoint
- inline image rendering
- attachment open/download
- attachment upload for note editing

Requirements:
- no browser-local authoritative resource store
- optional short-lived memory/object URL cache only

### Milestone 7: Sync Integration

Expose sync state cleanly to web app.

Tasks:
- show last sync
- trigger sync
- show active sync progress/errors

Longer-term options:
- server push updates via SSE/WebSocket
- passive refresh first, real-time later

### Milestone 8: Settings and Themes

Support thin-client-specific settings without trying to mirror every client feature.

Initial scope:
- theme selection
- editor layout preferences
- note list density / sort where practical

Keep scope narrow.

### Milestone 9: Hardening

Tasks:
- tests for web API routes
- tests for auth/session behavior
- tests for note CRUD
- tests for search and resource fetch
- frontend tests for core UI flows
- performance profiling on large notebooks
- security review for cache/storage/session behavior

## Server Module Plan

Likely new areas under `packages/server/src/`:
- `routes/webapp/`
- `routes/api/web/`
- `services/webapp/`
- `models/webapp/` or projection helpers if needed
- built frontend output serving path

## Frontend Module Plan

Thin client should be visually distinct from desktop/mobile clients.

Likely areas under `packages/app-web/`:
- app shell
- API client
- auth/session bootstrap
- sidebar
- note list
- note editor/viewer
- search UI
- settings/theme UI
- PWA assets and service worker

Keep UI independent from React Native web code.

## Open Questions

- frontend stack inside `packages/app-web`: React + Vite, Next, or lean SPA build?
- how should built `app-web` assets be wired into `packages/server` runtime?
- how much of note rendering/editor can reuse `@joplin/renderer` and `@joplin/editor` cleanly in thin client?
- when to add projection/index layer versus direct reads from current server models?

## Recommended Next Step

Prototype Milestone 1 + Milestone 2 + first slice of Milestone 3:
- scaffold `packages/app-web`
- add server-authenticated `/app`
- `GET /api/web/me`
- `GET /api/web/folders`
- `GET /api/web/notes`
- simple note list UI

Reason:
- proves package split
- proves auth reuse
- proves thin-client API shape
- proves same-user same-data model
- keeps work anchored in `packages/server` while letting UI stay distinct in `packages/app-web`
