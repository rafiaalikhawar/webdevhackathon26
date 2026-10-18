# Relay — Every lead, accounted for.

A premium Attio-inspired CRM foundation for the Unified Business Management Platform brief.

## Release status: development milestone 1

This repository contains **two distinct deliverables**:

1. A responsive React interface, published as a private interactive review build. It uses synthetic, in-memory sample records. Record changes reset on reload; only dashboard visibility preferences use localStorage. It does not collect credentials or pretend to deliver messages, payments or invitations.
2. A NestJS + PostgreSQL backend foundation with a schema, session authentication, workspace authorization, CRM endpoints, transactional routing, and a deadline worker. The review UI is **not yet connected to this API**. Integration adapters and several workflows are still to be implemented.

This is not a production release. See `docs/IMPLEMENTATION_STATUS.md` for the exact scope, test evidence and outstanding work. No existing project files or database were reused.

## Project structure

- `src/` — React interface, design system, sample dataset and interactions.
- `server/main.ts` — API controllers and error translation.
- `server/auth.ts` — Argon2id passwords, opaque cookie sessions, CSRF and login throttling.
- `server/policy.ts` — permissions, record scope and value projection.
- `server/lead-service.ts` — assignment, acknowledgment, escalation and row locking.
- `server/db.ts` — PostgreSQL connections, transaction boundary and audit writes.
- `server/worker.ts` — durable deadline processing and recovery when capacity returns.
- `server/migrate.ts`, `db/` — schema migration and runtime role configuration.
- `tests/foundation.test.ts` — database, policy and authentication checks against PGlite.
- `docs/` — requirements decisions, architecture and next milestones.

## Review the interface locally

Requirements: Node.js 24 and npm. Dependencies are pinned by package-lock.json.

```bash
npm ci
npm run dev
```

Open the address printed by Vite. The interface is sample mode only in this release.

Useful review flows:

- Overview → New lead → open the contact → Acknowledge → Activity.
- Leads → Filter → combine status, source and owner → Save view.
- Opportunities → change a card's stage using its selector (keyboard/touch friendly) or drag-and-drop.
- Settings → Pipelines → try deleting a populated stage. The preview blocks it.
- Profile → Preview permissions as User. Opportunity values disappear; navigation and record scope adapt. This is a visual demonstration, not a security boundary.
- Integrations → inspect the clearly disconnected provider setup states.

## Start PostgreSQL

Use a local PostgreSQL 16+ installation or the included Docker Compose service. The compose service binds PostgreSQL only to localhost and uses a persistent volume.

Set `POSTGRES_OWNER_PASSWORD` in your local shell or untracked environment configuration, then run:

```bash
docker compose up -d database
```

Do not commit this password. Do not run `docker compose down -v` unless you intend to delete the database volume.

Copy `.env.example` to `.env`. Configure the migration URL with the database owner account and runtime URL with a separate application account. Percent-encode special characters in URL passwords.

Run migrations using the owner URL:

```bash
npm run db:migrate
```

As the database owner, execute `db/runtime-role.sql` once. Set the runtime password interactively with `psql`'s `\password relay_app` command. Put the resulting runtime connection URL in `.env` as `DATABASE_URL`. Keep the owner URL for migrations only.

The runtime account must not be a superuser, must not have BYPASSRLS, and must not own tables. Production API startup rejects superuser/BYPASSRLS credentials. Apply the same restriction to the worker. Audit update/delete is also rejected by a database trigger.

Run the services in separate terminals:

```bash
npm run api
npm run worker
```

The API listens on port 3001. Vite proxies `/api` to it during development. **Proxy availability does not mean the sample UI is integrated**; API interactions currently require an API client or the upcoming live-mode frontend.

## API authentication flow

1. POST `/api/auth/signup` with JSON `email`, a password of at least 12 characters, `name`, and `workspace`. Include the configured `Origin` header.
2. The response sets an HttpOnly session cookie and returns a CSRF token and workspace ID.
3. Send the session cookie and `X-Workspace-Id` on authenticated requests. Mutating requests also need `X-CSRF-Token` and a matching `Origin`.
4. Use `/api/auth/login` to obtain a fresh session. Sessions expire after eight hours. `/api/auth/logout` revokes the active session.
5. Create leads with POST `/api/leads`; read with GET `/api/leads`. Acknowledge with POST `/api/leads/:id/acknowledge`, supplying the current `version`.

All endpoint inputs are validated. A user must have the applicable permission, membership in the requested workspace, and the required record scope. `workspace_id` is not accepted as a body override. Client-side role selectors are never trusted by the API.

Production requires `NODE_ENV=production`, an HTTPS `APP_ORIGIN`, a non-owner runtime DB role, TLS at the ingress, and a compatible same-origin frontend deployment. Deployment of this backend is a separate upcoming milestone.

## Verification

```bash
npm test
npm run typecheck:server
npm run build
```

The tests use PGlite, an embedded PostgreSQL engine, and do not require an external PostgreSQL server. They check constraints, routing, repeat-processing, rollback, row security, password hashing, sessions, CSRF, and disk persistence after reopening the engine.

These are **not** a replacement for HTTP end-to-end tests on PostgreSQL, multiple concurrent workers, process crash/restart tests, browser accessibility tests, or real-provider sandbox tests. Those gates remain open.

## External integrations

The schema includes Twilio, Meta WhatsApp, Polar, Google Calendar and Telegram integration records, events, messages, payments, refunds, appointments, notification destinations and a transactional outbox. Provider adapters, signature verification, OAuth flows and the outbound outbox consumer are not implemented yet. No provider credentials are needed for this milestone, and none are stored in this repository.

Provider setup instructions will be finalized when those adapters are implemented and verified against current provider documentation. Never put provider secrets in Vite environment variables or source files.

## Backup and recovery

The development PostgreSQL volume preserves records across service restarts. A persistent volume is not a backup. Before production, configure encrypted scheduled PostgreSQL backups, retention, and a tested restore process. SQL migrations run inside a transaction and use an advisory lock to prevent overlapping initial migrations.
