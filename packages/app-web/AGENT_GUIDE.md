# Joplock App-Web Agent Guide

## Purpose

This directory owns thin-client frontend planning and implementation for `joplock`.

Use this guide when working on `packages/app-web` and its integration with `packages/server`.

## Product Direction

- `packages/server` stays backend authority
- `packages/app-web` becomes distinct thin-client web frontend
- reuse existing Joplin Server auth/session/user model
- keep compatibility with desktop/mobile/CLI clients
- make browser thin and untrusted
- avoid browser-local authoritative note/resource storage
- provide installable PWA shell, but no offline notes/editing
- keep UI distinct from other Joplin clients

## Core Rules

1. Server authoritative. Browser ephemeral.
2. Reuse Joplin Server auth and session cookies.
3. Preserve sync compatibility for other Joplin clients.
4. Do not build new browser-local DB architecture.
5. Do not route new work through `packages/app-mobile/docker-web` unless explicitly maintaining old branch behavior.
6. `packages/app-web` should call app-oriented server APIs, not sync endpoints directly for normal UI behavior.
7. Thin client does not need feature parity with desktop/mobile.

## Package Responsibilities

### `packages/server`

Owns:
- login/session/auth
- web API endpoints
- sync compatibility
- resource delivery
- server-side note/folder/search logic
- serving built `app-web` assets

### `packages/app-web`

Owns:
- thin-client UI
- routing/navigation in browser
- API client layer
- local transient UI state only
- PWA shell/assets

## Where Not To Build Final Architecture

Avoid these for new thin-client architecture:
- `packages/app-mobile/docker-web/`
- browser-local vault blob flow
- browser SQLite WASM persistence for main app state
- OPFS/IndexedDB-as-authority web plan
- React Native web reuse as architectural base

## Functional Scope

First versions should focus on:
- login via existing server auth
- folder tree
- note list
- note view/edit
- search
- resources/attachments basics
- theme/settings basics
- sync status/trigger

Do not prioritize:
- plugins
- offline mode
- browser-local sync engine
- mobile parity
- full config parity

## Technical Constraints

- browser should keep little durable data beyond shell/session artifacts
- service worker should cache shell/assets only
- no fake offline note cache
- API should be app-oriented, not raw SQL over network
- same-origin auth and resource access preferred

## Data Model Guidance

Current server stores sync-compatible items. Thin client likely needs app-friendly API over same data.

Preferred sequence:
1. start with direct reads/writes using existing server item model
2. add projection/index layer only when performance or query complexity demands it

## Frontend Guidance

- keep UI distinct from existing Joplin clients
- prefer clean web-native layout and interactions
- avoid importing assumptions from mobile/desktop local-first startup flows
- keep local state minimal and session-scoped
- do not add offline features unless explicitly requested later

## Coding Guidance

Follow repository standards from `CLAUDE.md`:
- tabs
- single quotes
- minimal whitespace churn
- `//` comments only
- avoid `any`
- run `yarn updateIgnored` after adding new TypeScript files

Additional branch guidance:
- keep frontend/backend split clean
- avoid cross-app churn in `packages/lib` unless necessary
- if changing shared code, note impact on desktop/mobile/CLI/server

## Verification Guidance

Preferred checks depend on touched area.

Examples:
- app-web scaffold changes: build package, lint, verify server serving path assumptions
- server integration changes: targeted server tests, auth smoke checks, API checks
- shared model changes: targeted tests plus impact review

Minimum expectation for significant work:
- touched package(s) build
- no auth/session regressions for server login flow
- thin-client routes protected correctly

## Current Intent

Near-term target:
- scaffold `packages/app-web`
- authenticated `/app`
- thin-client API endpoints for folders and notes
- minimal but polished web UI

Keep architecture aligned with:
- same Joplin Server backend
- distinct thin-client frontend in `packages/app-web`
- low browser trust
