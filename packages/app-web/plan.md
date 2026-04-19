# Joplock Thin Client Plan

## Goal

Build `packages/app-web` as thin-client web frontend and companion API for stock Joplin Server.

Requirements:
- do not modify Joplin Server source
- same auth/session as Joplin Server
- same user data visible across web, desktop, mobile, CLI
- minimal browser storage
- no offline note cache
- shared-browser safe: after logout, note/resource data must not remain available via local storage, client cache, or restored authenticated UI state
- PWA shell support
- thin client UI distinct from other Joplin clients
- keep compatibility with normal Joplin sync clients

## Non-Goals

- no browser-local authoritative DB
- no offline reading or editing
- no plugin support in first versions
- no need to reuse React Native web code
- no separate vault encryption model
- no custom auth separate from Joplin Server auth
- no direct browser use of Joplin sync API for normal UI flows

## Product Model

- one stock Joplin Server instance
- one sidecar `app-web` service owned by this project
- one user logs in with normal Joplin Server account
- one user can open thin client in multiple browsers and see same server-backed data
- desktop/mobile/CLI keep syncing against same server as before
- thin client talks to sidecar app-oriented API endpoints

## Service Split

### Stock `joplin-server`

Owns:
- login/session/auth
- sync endpoints
- canonical server data storage rules
- existing user/session schema
- normal Joplin compatibility contract

### `packages/app-web`

Owns:
- thin-client frontend
- PWA shell
- sidecar API service
- session validation against Joplin Server tables
- app-oriented view models for notes/folders/search/resources

## Architecture Decision

### Why Sidecar Instead Of Modifying Server

Reasons:
- keeps upstream Joplin Server easy to pull in
- reduces merge pain
- lets thin client evolve independently
- preserves clear separation between stock server and custom web UI/API

### Sidecar API Model

Frontend calls only `app-web` API, for example `/api/web/*`.

Sidecar API:
- validates Joplin Server session cookie
- reads same Postgres database
- translates Joplin Server storage model into thin-client API responses
- writes data in a way that preserves sync compatibility

### Important Constraint

`app-web` must not write arbitrary DB rows directly without respecting Joplin semantics.

Write paths must preserve:
- item serialization format
- timestamps
- change tracking
- resource relations
- sync behavior expected by other Joplin clients

## Data Strategy

Keep existing sync/item storage compatibility for external Joplin clients.

Sidecar API should:
1. start by reading current Joplin Server item/session tables and models where possible
2. hide those internals behind app-specific API contracts
3. optionally add projection/index tables later for performance

Frontend must never depend on raw table/schema shape.

## Routing Model

Recommended runtime shape:
- `http://localhost:22300` -> stock Joplin Server
- `http://localhost:3001` -> `app-web` sidecar during early development
- later optional reverse proxy:
  - `/login`, `/api/items`, sync routes -> Joplin Server
  - `/app`, `/api/web/*` -> app-web

## Step-by-Step Implementation Plan

### Phase 0: Freeze Architecture

Tasks:
- confirm sidecar model
- confirm no Joplin Server source modifications
- confirm online-only PWA
- confirm Postgres primary target
- confirm sidecar reads Joplin session tables for auth

Deliverables:
- final architecture note
- compose topology
- API boundary rules

### Phase 1: Sidecar Skeleton

Goal:
- make `packages/app-web` a real package with separate frontend shell and sidecar runtime

Tasks:
- keep minimal frontend shell
- add sidecar server entrypoint structure
- define environment variables:
  - Joplin Server base URL
  - Postgres connection settings
  - session cookie name
  - app-web port
- keep Dockerfile and compose working

Deliverables:
- app-web container boots
- app-web health endpoint works
- PWA shell still served

Tests:
- unit test config parsing
- unit test health endpoint
- compose config validation in CI or local script

### Phase 2: Session Reuse

Goal:
- sidecar can authenticate user using existing Joplin Server session cookie

Tasks:
- inspect session cookie name/lookup rules from Joplin Server
- add sidecar auth middleware
- load session from same DB tables used by Joplin Server
- load current user from same DB tables
- return unauthorized when session missing/invalid

Initial endpoint:
- `GET /api/web/me`

Deliverables:
- browser logged into Joplin Server can call app-web API successfully
- unauthenticated browser gets `401`

Tests:
- unit test session extraction from cookie header
- unit test session lookup service
- integration test `GET /api/web/me` with valid session fixture
- integration test `GET /api/web/me` with invalid session

### Phase 3: Read-Only Note Browsing

Goal:
- show real user data without editing yet

Tasks:
- implement folder query service
- implement note list query service
- implement note detail read service
- map current server storage model to app-web response shape

Endpoints:
- `GET /api/web/folders`
- `GET /api/web/notes?folderId=&page=&limit=`
- `GET /api/web/notes/:id`

Frontend tasks:
- folder sidebar
- note list
- note viewer
- loading/error states

Deliverables:
- authenticated user can browse folders and notes

Tests:
- unit tests for folder tree mapping
- unit tests for note summary mapping
- integration tests for folder/note endpoints
- frontend component tests for sidebar and note list rendering

### Phase 4: Note Editing

Goal:
- create and update notes safely through sidecar API

Tasks:
- implement note create service
- implement note update service
- implement note delete service
- ensure writes preserve Joplin-compatible serialization and timestamps
- ensure data remains visible and consistent to desktop/mobile after sync

Endpoints:
- `POST /api/web/notes`
- `PUT /api/web/notes/:id`
- `DELETE /api/web/notes/:id`

Deliverables:
- thin client can create, edit, and delete notes
- desktop/mobile clients still see correct results after sync

Tests:
- unit tests for note payload validation
- unit tests for serialization/mapping layer
- integration tests for note CRUD API
- cross-client compatibility smoke test plan: create note via app-web, verify via server-side item read

### Phase 5: Search

Goal:
- server-side search results for thin client

Tasks:
- implement search endpoint using current storage model first
- shape results for note list UI
- add pagination and ordering

Endpoints:
- `GET /api/web/search?q=&page=&limit=`

Deliverables:
- search UI returns usable results quickly

Tests:
- unit tests for query normalization
- integration tests for search endpoint
- frontend tests for search result rendering

### Phase 6: Resources

Goal:
- attachments and inline images work without local authoritative storage

Tasks:
- resource metadata endpoint
- resource content endpoint
- inline image rendering path
- attachment open/download
- optional upload path for note editing later

Endpoints:
- `GET /api/web/resources/:id/meta`
- `GET /api/web/resources/:id/content`
- later `POST /api/web/resources`

Deliverables:
- inline images display
- attachments open/download from same-origin sidecar

Tests:
- integration tests for resource metadata/content endpoints
- frontend tests for image/attachment rendering components

### Phase 7: Sync Status

Goal:
- show sync status and trigger sync-aware refresh flows without using sync API directly in browser

Tasks:
- add status endpoint backed by observable server state if possible
- add trigger endpoint if safe and practical
- otherwise surface read-only sync status first

Endpoints:
- `GET /api/web/sync/status`
- optional `POST /api/web/sync`

Tests:
- unit tests for sync status mapping
- integration tests for status endpoint

### Phase 8: PWA and Polish

Goal:
- make shell installable and pleasant, but keep online-only model

Tasks:
- refine manifest
- refine service worker to cache shell/assets only
- add reconnect screen
- theme/settings basics
- keep UI distinct from stock clients

Tests:
- frontend tests for offline/reconnect screen behavior
- smoke test service worker registration

### Phase 9: Hardening

Tasks:
- auth/session security review
- large notebook performance profiling
- pagination and query tuning
- optional projection/index layer if needed
- end-to-end test pass for core flows

## API Contract Guidance

Frontend uses only sidecar API.

Recommended first contract:
- `GET /api/web/me`
- `GET /api/web/folders`
- `GET /api/web/notes`
- `GET /api/web/notes/:id`
- `POST /api/web/notes`
- `PUT /api/web/notes/:id`
- `DELETE /api/web/notes/:id`
- `GET /api/web/search`
- `GET /api/web/resources/:id/meta`
- `GET /api/web/resources/:id/content`
- `GET /api/web/sync/status`

## Testing Strategy

### Unit Tests

Test pure logic in isolation:
- config/env parsing
- cookie/session parsing
- auth helpers
- API request validation
- data mapping from server storage model to app-web view model
- folder tree building
- note summary shaping

### Integration Tests

Test sidecar API against test database fixtures:
- auth/session validation
- `GET /api/web/me`
- folders list
- notes list/detail
- note CRUD
- search
- resource fetch

### Frontend Component Tests

Test UI in isolation:
- shell routing states
- auth-required screen
- sidebar rendering
- note list rendering
- note editor/viewer interactions
- search UI

### End-to-End / Smoke Tests

Keep minimal but meaningful:
- login to Joplin Server
- app-web sees valid session
- browse notes
- edit note
- reload and confirm persistence

## Rules For Safe Writes

Must not do:
- arbitrary direct updates to raw DB tables from frontend
- bypassing Joplin item semantics for note/resource writes
- coupling browser to sync item schema

Prefer:
- sidecar service layer for all writes
- reuse shared Joplin code where practical for serialization and validation
- keep thin compatibility layer around DB/session internals

## Open Questions

- should sidecar API be in same `packages/app-web` package or split into separate `packages/app-web-api` later?
- what exact Joplin Server session table/schema contract should be treated as supported dependency?
- how much shared Joplin code can be reused without pulling in wrong client assumptions?
- when to add projection/index layer versus direct reads from current server data?

## Recommended Next Step

Implement Phase 2 first.

Concrete next slice:
- add sidecar auth middleware
- add `GET /api/web/me`
- add unit tests for session parsing/lookup
- add integration test for authenticated request

Reason:
- proves no-server-modification model
- proves session reuse
- proves sidecar viability before building note UI
