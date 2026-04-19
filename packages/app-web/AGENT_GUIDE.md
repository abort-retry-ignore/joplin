# Joplock App-Web Agent Guide

<!-- cSpell:disable -->

## Purpose

This directory owns the thin-client frontend and sidecar API for `joplock` — a web UI for stock Joplin Server.

Use this guide when working on `packages/app-web` and its integration with stock Joplin Server.

## Product Direction

- Joplin Server stays unmodified
- `packages/app-web` is a distinct thin-client frontend plus sidecar API/runtime
- Reuses existing Joplin Server auth/session/user model through compatible sidecar logic
- Keeps compatibility with desktop/mobile/CLI clients (same data, same DB)
- Browser is thin and untrusted — no authoritative note/resource storage
- Installable PWA shell, but no offline notes/editing
- UI is distinct from other Joplin clients
- Uses the same Postgres database as Joplin Server (no separate DB)

## Architecture Overview

### Stack

- **Server**: Node.js HTTP server (no framework), SSR HTML fragments
- **Client**: htmx for declarative fragment swaps, zero client-side state/framework
- **Editor**: contenteditable WYSIWYG preview (default mode), plain textarea for raw markdown editing
- **Autosave**: `hx-trigger="input changed delay:1s"` — fires PUT 1 second after user stops typing
- **Markdown**: server-side `renderMarkdown()` for preview, client-side Turndown `htmlToMarkdown()` for DOM-to-markdown conversion
- **Auth**: reuses Joplin Server `sessionId` cookie (path `/`, TTL 12h)
- **DB access**: reads directly from Joplin Server's `items` table; writes go through stock Joplin Server API (`PUT /api/items/...`) with `x-api-auth` header
- **Static assets**: htmx served as vendored file (`public/htmx.min.js`), no npm/bundler dependency

### Request Flow

1. Browser hits nginx (`https://joplinweb.021407.xyz`) -> forwards to `http://10.0.1.2:5444`
2. `app-web` checks `sessionId` cookie against Joplin Server session
3. Fragment endpoints return HTML chunks; htmx swaps them into the DOM
4. Writes serialize note/folder to Joplin format and PUT to stock Joplin Server API

### UI Layout

3-column desktop layout:
- **Column 1 (220px, collapsible)**: NOTEBOOKS sidebar — folder list with note counts, "+" new folder button, hamburger toggle to collapse
- **Column 2 (280px)**: Note list — "+ New note" button, search input, scrollable note titles (inline markdown rendered)
- **Column 3 (flex)**: Editor — folder dropdown (move notes), note title (contenteditable with inline markdown), toolbar, preview/edit toggle, autosave status, delete button
- **Status bar**: username, theme picker, logout

3 themes: Matrix (green on black), Dark (blue-gray), Light (white/blue). Persisted in localStorage.

### Editor Behavior

- Notes open in **preview mode by default** (contenteditable rendered markdown)
- Toggle pencil/eye icon switches between preview and raw textarea
- Toolbar works in both modes (execCommand in preview, text insertion in textarea)
- Image resize via mouse drag in preview mode
- Auto-title: first non-empty line of body populates the title (unless manually edited)
- Title field is contenteditable div with inline markdown rendering (bold, italic, strikethrough, underline, code)
- Blank lines are stored as `<br>` in markdown; the sticky `md` toggle hides them in edit mode via `cleanForDisplay()` / `dirtyForSave()`
- Checkbox rows in preview are `div.md-checkbox`; click only the icon area to toggle, label text should remain editable/selectable

## Core Rules

1. Do not modify Joplin Server source for thin-client features unless explicitly approved.
2. Server authoritative. Browser ephemeral.
3. Reuse Joplin Server auth/session behavior through sidecar compatibility layer.
4. Preserve sync compatibility for other Joplin clients.
5. Do not build new browser-local DB architecture.
6. `packages/app-web` should expose and consume app-oriented APIs, not raw SQL or sync API for normal UI behavior.
7. Thin client does not need feature parity with desktop/mobile.

## Service Responsibilities

### Stock Joplin Server

Owns:
- login/session/auth source of truth
- sync endpoints
- canonical storage rules
- existing user/session tables

### `packages/app-web`

Owns:
- thin-client UI (SSR HTML + htmx)
- sidecar API endpoints (fragment + JSON)
- session validation using Joplin Server DB/session data
- server-side markdown rendering
- resource upload/serving
- app-specific view models and request shaping
- local transient UI state only (theme, sidebar collapsed)
- PWA shell/assets

## File Map

### Entry / Server
- `server.js` — entry point, starts HTTP server
- `app/createServer.js` — all HTTP routes (fragment endpoints, JSON API, proxy, SSR, preview, upload, resource serving). Contains `parseBody`, `parseMultipart`, `readRawBody`

### Templates / UI
- `app/templates.js` — all HTML rendering and inline client-side JS:
  - `layoutPage()` — full SSR page shell
  - `folderListFragment()`, `noteListFragment()`, `editorFragment()` — htmx fragment renderers
  - `renderMarkdown()` — server-side markdown-to-HTML (headings, bold, italic, strikethrough, underline, code, code blocks, blockquotes, unordered/ordered lists, checkboxes, images, links, blank line preservation)
  - `renderInlineMarkdown()` — inline-only markdown for titles (bold, italic, strikethrough, underline, code)
  - `htmlToMarkdown()` / `getTurndown()` — client-side DOM-to-markdown converter and Turndown rules (checkboxes, underline, `<strike>`, empty blocks, Joplin resources)
  - `togglePreview()`, `syncPV()`, `syncTitle()`, `activatePV()` — editor mode switching and contenteditable wiring
  - `initImgResize()` — mouse drag image resize
  - `autoTitle()`, `initAutoTitle()` — auto-populate title from first line
  - `wrapSel()`, `insertPfx()`, `insertTxt()` — toolbar actions
  - `uploadFile()`, `handleDrop()` — media insertion

### Auth
- `app/auth/cookies.js` — cookie parsing
- `app/auth/sessionService.js` — session validation against Joplin Server DB

### Data
- `app/items/itemService.js` — DB reads: folders, notes, search, resource blobs/metadata, `decodeItemContent`, `mapNoteRow`, `mapFolderRow`
- `app/items/itemWriteService.js` — serialization + upstream writes: `serializeNote`, `serializeFolder`, `serializeResource`, `createResource`, `updateNote`

### Static Assets
- `public/htmx.min.js` — htmx 2.0.4 (~50KB, ~14KB gzipped)
- `public/styles.css` — 3 themes, 3-column layout, editor/preview styles, collapsible sidebar
- `public/icon.svg`, `public/manifest.webmanifest`, `public/service-worker.js`

### Tests
- `tests/cookies.test.js`
- `tests/createServer.test.js` — 24 tests
- `tests/itemService.test.js`
- `tests/itemWriteService.test.js` — 3 tests
- Run: `node --test packages/app-web/tests/*.test.js`

### Deployment
- `docker-compose.app-web.yml`
- `.env.app-web` — `APP_WEB_PORT=5444`, `JOPLOCK_PUBLIC_BASE_URL=https://joplock.021407.xyz`, `JOPLIN_SERVER_PUBLIC_URL=https://joplin.021407.xyz`
- `.env.app-web-sample`
- `Dockerfile`
- Build+deploy: `docker compose -f docker-compose.app-web.yml --env-file .env.app-web up -d --build app-web`
- Fast deploy: `npm --prefix packages/app-web run deploy:docker`
- Generate PWA icons/splash assets: `yarn workspace @joplin/app-web run generate:pwa-assets`

### GHCR image publish
- workflow: `.github/workflows/docker-publish-app-web.yml`
- image: `ghcr.io/<owner>/joplock-app-web`
- branch pushes publish branch/sha tags
- default branch also publishes `latest`
- tags matching `app-web-v*` publish version tags too

## Joplin Data Model Notes

- Items table: `items` with `owner_id`, `jop_id`, `jop_parent_id`, `jop_type`, `jop_updated_time`, `content` (bytea, valid JSON)
- Model types: Note=1, Folder=2, Resource=4
- DB stores note content as JSON (`title`, `body`, etc). `decodeItemContent` does `JSON.parse()`
- Serialized format (for API writes): markdown-style metadata lines at bottom, blank line separator, body text above. `BaseItem.unserialize()` parses bottom-up
- Resource metadata: `root:/<32-char-id>.md:` (type 4). Binary blob: `root:/.resource/<id>:` (raw bytes)
- Upload via `PUT api/items/root:/<path>:/content` with multipart form (`file` field)
- Notes reference resources as `![alt](:/resource_id)`

## Design Decisions

### Blank line preservation
Extra blank lines (3+ consecutive newlines) are preserved as `<div class="md-blank-line">` in preview. The `htmlToMarkdown` converter turns each back into `\n`. The `.join('')` on rendered blocks prevents inter-element text nodes that caused expansion bugs. Whitespace-only text nodes containing `\n` are skipped in `htmlToMarkdown` as defense-in-depth.

### Contenteditable checkbox behavior
Checkboxes in preview use a leading icon text node (`☐`/`☑`) plus `\u00a0` so the caret lands after the icon. This has a few gotchas:
- Empty-checkbox detection must strip both normal spaces and `\u00a0`, not just `.trim()`
- Enter handling must also detect the caret when the selection sits in the parent container immediately after a checkbox node
- Click handling must only toggle when the click lands on the icon area; clicking label text should place the caret normally
- `activatePV()` can run repeatedly after preview/edit toggles, so event listeners must be guarded with `pv.dataset.pvInit` to avoid duplicate handlers

### Preview-default editor
Notes open in contenteditable preview mode. This avoids showing raw markdown to users who just want to read/browse. The pencil icon switches to raw textarea for advanced editing.

### htmx SSR (no client framework)
Zero client-side state. All rendering happens server-side. htmx swaps HTML fragments. This keeps the browser thin and avoids framework complexity. The tradeoff is that rich interactions (WYSIWYG, image resize) require inline JS in the template.

### PWA shell
`app-web` is installable as a PWA. Current pieces:
- `public/manifest.webmanifest`
- `public/service-worker.js`
- generated PNG icons: `public/icon-192.png`, `public/icon-512.png`, `public/maskable-icon-*.png`, `public/apple-touch-icon.png`
- generated Apple startup images under `public/apple-splash/`
- asset generator script: `scripts/generatePwaAssets.mjs`

Notes:
- iPhone splash screens come from explicit `<link rel="apple-touch-startup-image">` tags in `templates.js`
- Android splash/install behavior comes from manifest icons, `theme_color`, `background_color`, and `display`
- service worker should cache only shell/static assets, not notes or API responses

### Shared Postgres database
`app-web` connects to the same Postgres database as Joplin Server. No separate DB, no data duplication. Reads go direct to DB; writes go through Joplin Server's API to preserve server-side validation and sync compatibility.

### Separate-host add-on mode
Preferred production shape now:
- existing Joplin Server keeps its own public host and root paths (example: `https://joplin.021407.xyz`)
- Joplock runs on a different host (example: `https://joplock.021407.xyz`)
- `JOPLIN_SERVER_PUBLIC_URL` must be set to the real public Joplin Server URL for upstream Host/Origin headers
- `JOPLOCK_PUBLIC_BASE_URL` is Joplock's own public host
- `JOPLIN_PUBLIC_BASE_PATH` can be empty when upstream Joplin runs at `/`

## Where Not To Build

Avoid these for new thin-client architecture:
- `packages/app-mobile/docker-web/`
- browser-local vault blob flow
- browser SQLite WASM persistence for main app state
- OPFS/IndexedDB-as-authority web plan
- React Native web reuse as architectural base
- direct browser calls to raw DB or sync-table structures

## Write Safety

Must not:
- let browser write raw DB rows
- expose sync item schema to frontend
- bypass item/resource semantics in sidecar write paths

Prefer:
- service layer for all writes
- request validation before writes
- shared Joplin code reuse where practical for serialization/validation

## Coding Guidance

Follow repository standards from `CLAUDE.md`:
- tabs for indentation
- single quotes for strings
- `//` comments only, no jsdoc
- minimal whitespace churn
- run `yarn updateIgnored` after adding new TypeScript files

Additional:
- keep sidecar/frontend boundary clean
- avoid cross-app churn in `packages/lib` unless necessary
- if changing shared code, note impact on desktop/mobile/CLI/server
- inline JS in templates must double-escape regex chars (`\\s`, `\\n`) since it's inside template literals
- `\u00a0` and template-literal escaping have both caused editor regressions; be careful when changing checkbox text handling

## Verification

- Run tests: `node --test packages/app-web/tests/*.test.js` (31 tests, all should pass)
- Rebuild: `docker compose -f docker-compose.app-web.yml --env-file .env.app-web up -d --build app-web`
- Fast deploy: `npm --prefix packages/app-web run deploy:docker`
- Live: `https://joplinweb.021407.xyz`
- Default Joplin Server admin: `admin@localhost` / `admin`

## Current State

### Done
- Full 3-column layout with collapsible folder sidebar
- Note CRUD (create, read, update, delete)
- Folder CRUD
- Search
- Contenteditable WYSIWYG preview (default mode) with toolbar
- Raw textarea editing mode (toggle)
- Image/resource upload, storage, and serving
- Image resize via drag
- Auto-title from first line
- Inline markdown rendering in titles and note list
- Blank line preservation (stable round-trip)
- Underline support (`++text++`) in renderers and Turndown
- Ordered list rendering
- Preview checkbox toggle and Enter behavior fixes
- 3 themes with persistence
- Autosave (1s debounce)
- Folder selector (move notes between folders)
- Keyboard shortcuts (Ctrl+B, Ctrl+I)
- PWA manifest and service worker
- 31 passing tests
- Live deployment

### Git History
- Branch: `joplock-dev`
- Commits: `d57f04269` through `a7bc7e2cd` (9 commits)
- Uncommitted: none in `packages/app-web` after committing current preview/editor fixes

### Next
- Consider split-pane editor (textarea + live preview side by side) as alternative to contenteditable WYSIWYG
- Polish mobile/responsive layout
- Note sorting options
- Notebook nesting (sub-folders)
