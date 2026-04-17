# Joplock Agent Guide

## Purpose

This branch builds `joplock`: built-in thin-client web interface for Joplin Server.

Use this guide when working on `joplock-dev` and related branches.

## Product Direction

- extend existing `packages/server`
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
6. Prefer adding new thin-client server modules over patching mobile-web experiments.
7. Thin client does not need feature parity with desktop/mobile.

## Branch Strategy

- long-term work should branch from upstream `dev`
- keep fork close to `laurent22/joplin`
- import upstream server changes regularly
- avoid depending on old `feature/fs-driver-encryption` history

## Where New Work Should Go

Primary area:
- `packages/server`

Expected additions:
- web app routes under `packages/server/src/routes/webapp/` or similar
- thin-client API under `packages/server/src/routes/api/web/`
- supporting services/models under `packages/server/src/services/webapp/` or similar
- static/built frontend assets served by server

## Where Not To Build Final Architecture

Avoid these for new thin-client architecture:
- `packages/app-mobile/docker-web/`
- browser-local vault blob flow
- browser SQLite WASM persistence for main app state
- OPFS/IndexedDB-as-authority web plan
- `packages/app-web/` scaffold from old plan unless explicitly revived with new reasoning

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

## Coding Guidance

Follow repository standards from `CLAUDE.md`:
- tabs
- single quotes
- minimal whitespace churn
- `//` comments only
- avoid `any`
- run `yarn updateIgnored` after adding new TypeScript files

Additional branch guidance:
- keep changes isolated to server/web thin-client areas where possible
- avoid cross-app churn in `packages/lib` unless necessary
- if changing shared code, note impact on desktop/mobile/CLI/server

## Verification Guidance

Preferred checks depend on touched area.

Examples:
- server route changes: targeted server tests, lint, typecheck
- frontend shell changes: build frontend, smoke-test auth and API calls
- shared model changes: targeted tests plus impact review

Minimum expectation for significant work:
- build passes for touched package(s)
- no auth/session regressions for server login flow
- thin-client routes protected correctly

## Current Intent

Near-term target:
- authenticated `/app`
- thin-client API endpoints for folders and notes
- minimal but polished web UI

Keep architecture aligned with:
- same Joplin Server backend
- distinct thin-client frontend
- low browser trust
