# Joplock App-Web Agent Guide

## Purpose

This directory owns thin-client frontend and sidecar API planning for `joplock`.

Use this guide when working on `packages/app-web` and its integration with stock Joplin Server.

## Product Direction

- Joplin Server stays unmodified
- `packages/app-web` becomes distinct thin-client frontend plus sidecar API/runtime
- reuse existing Joplin Server auth/session/user model through compatible sidecar logic
- keep compatibility with desktop/mobile/CLI clients
- make browser thin and untrusted
- avoid browser-local authoritative note/resource storage
- provide installable PWA shell, but no offline notes/editing
- keep UI distinct from other Joplin clients

## Core Rules

1. Do not modify Joplin Server source for thin-client features unless explicitly approved later.
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
- thin-client UI
- sidecar API endpoints
- session validation using Joplin Server DB/session data
- app-specific view models and request shaping
- local transient UI state only
- PWA shell/assets

## Where Not To Build Final Architecture

Avoid these for new thin-client architecture:
- `packages/app-mobile/docker-web/`
- browser-local vault blob flow
- browser SQLite WASM persistence for main app state
- OPFS/IndexedDB-as-authority web plan
- React Native web reuse as architectural base
- direct browser calls to raw DB or sync-table structures

## Functional Scope

First versions should focus on:
- login reuse through existing Joplin Server session
- folder tree
- note list
- note view/edit
- search
- resources/attachments basics
- theme/settings basics
- sync status/trigger if safe

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
- sidecar may read Joplin Server DB/session internals, but frontend must not depend on them

## Data Model Guidance

Current server stores sync-compatible items. Thin client needs app-friendly API over same data.

Preferred sequence:
1. start with sidecar reads/writes using existing Joplin Server storage model
2. hide all of that behind `/api/web/*`
3. add projection/index layer only when performance or query complexity demands it

## Write Safety Guidance

Must not do:
- let browser write raw DB rows
- expose sync item schema to frontend
- bypass item/resource semantics in sidecar write paths

Prefer:
- service layer for all writes
- request validation before writes
- shared Joplin code reuse where practical for serialization/validation

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
- keep sidecar/frontend boundary clean
- avoid cross-app churn in `packages/lib` unless necessary
- if changing shared code, note impact on desktop/mobile/CLI/server

## Verification Guidance

Preferred checks depend on touched area.

Examples:
- sidecar auth changes: unit tests for cookie/session parsing + integration tests for authenticated endpoints
- note API changes: integration tests for note CRUD and mapping
- frontend shell changes: build package, component tests, auth smoke checks
- shared model changes: targeted tests plus impact review

Minimum expectation for significant work:
- touched package(s) build
- no auth/session regressions for sidecar session reuse
- thin-client routes protected correctly
- integration tests added for new API behavior

## Current Intent

Near-term target:
- sidecar auth middleware
- `GET /api/web/me`
- then folders/notes read endpoints
- then minimal polished web UI

Keep architecture aligned with:
- stock Joplin Server backend
- distinct thin-client frontend/API in `packages/app-web`
- low browser trust
