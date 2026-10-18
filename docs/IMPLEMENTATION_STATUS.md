# Development status — milestone 1

## Delivered

### Interface review build

- Overview, actionable sample metrics, pipeline distribution, team availability, attention queue and upcoming appointments.
- Leads, contacts, recovery, company cards, pipeline board/list, customer drawer with activity/opportunities/appointments/payments.
- Search, command palette, status/source/owner filters, session-only saved views, sample lead creation, notes, acknowledgment, reassignment and stage changes.
- Inbox drafts, payments, calendar, integrations, team, audit, workspace settings, assignment defaults, pipeline stages, field definitions and role preview.
- Clear disconnected-provider and sample-data states. Success/error feedback. Keyboard focus handling for drawers/dialogs. Responsive layout rules.

### Backend foundation

- NestJS API structure, PostgreSQL schema and atomic initial migration.
- Argon2id password hashing; expiring opaque cookie sessions; logout revocation; origin/CSRF checks; persistent login throttling.
- Authenticated workspace and action permission checks. Own-record scope and opportunity value projection.
- Composite workspace foreign keys, row-level policies, version checks, append-only audit trigger.
- Lead creation, routing, acknowledgment, manual reassignment, absence reassignment, deadline worker and capacity recovery.
- CRM detail/notes/archive, initial opportunity creation/stage transition, custom field creation/value validation, safe stage deletion.
- Role creation and membership role assignment; assignment-rule updates; notification and integration status reads.
- Schema coverage for the full requested entity list, including integration events, payments/refunds and durable outbox intent.

## Milestone 2 — live application (added)

Verified against real PostgreSQL (Docker), the non-owner `relay_app` role with row-level security, and a running API plus worker.

- **UI is wired to the API.** Sign up / sign in / sign out, invitation acceptance, session-expiry handling, loading and error states. Leads, contacts, opportunities, stages, custom fields, team availability, assignment rules, saved views, dashboard preferences and audit entries all read and write live data. The UI is updated by a server-sent-events stream (`/api/events`) with a 30-second fallback refresh.
- **New endpoints:** `/api/bootstrap`, stages (add/rename/reorder/required fields), pipelines, lead status, opportunity edit/archive, contact edit/opt-out, saved filters, escalation levels, capacity, workspace rename, invitations (one-time link returned to the inviter), public web-form capture, per-user alert destination.
- **Integrations (server):** AES-256-GCM encrypted per-workspace secrets, masked in the API; credential verification on save; Twilio WhatsApp (signed inbound/status webhooks, send, retry, de-duplication, opt-out, contact matching, lead capture); Stripe Checkout (signed webhooks with timestamp tolerance, idempotent events, expiry, failure, partial/full refunds); Google Calendar OAuth2 (signed state, refresh, revoked-access detection, busy-time conflicts, create/reschedule/cancel, stored as UTC instants plus zone); Telegram escalation alerts through a durable outbox with bounded retry and backoff; integration event history.
- **Integrations (UI):** Integrations page (status, last success, last error, limits, webhook URLs, history, per-user chat id), inbox send/retry/opt-out banner, payment requests with copyable link, calendar connect/book/reschedule/cancel with time zones.

## Verification evidence (milestone 2)

- `npm test` — 14 PGlite checks pass.
- `npm run test:http` — 1 live HTTP flow: two workspaces, cross-workspace reads rejected, CSRF/origin rejection, permission denial for a User, invitation, web form, audit.
- `npm run test:integrations` — 5 live flows against local stub providers: forged/stale signatures rejected and recorded, duplicate webhook deliveries ignored, failed sends retried, opt-out enforced, refunds reflected, escalation alert delivered with lead/source/reason/link, OAuth state forgery rejected, token refresh, double-booking blocked, revoked access flagged as needing reconnection, workspace isolation of calendar connections.
- Browser: sign-up, lead creation and acknowledgment through the UI; Integrations, Payments and Calendar pages render.

## Milestone 3 (added)

Roles and permissions editor (create/edit/delete roles, assign to members, Owner-only access levels), escalation-chain editor with designated backups, multiple pipelines with their own stages/fields and stage rename/reorder, audit log with server-side filters (event, user, date) and paging, hosted public web form at `/form/<workspaceId>` plus embed snippet, and SSE push. Covered by a second live HTTP test (roles, chain, pipelines, audit filters, SSE push, unauthenticated stream rejected).

Note: sign-up/login are rate limited per IP and email (15-minute window). Repeated test runs can hit 429; clear with `TRUNCATE login_attempts` on the dev database.

## Not verified / still open

- **No real provider sandbox has been exercised.** The adapters follow the providers' documented signature and API shapes and pass against stubs, but Twilio, Stripe, Google and Telegram need your keys and a public HTTPS URL (see CONFIGURATION.md) before real-world behavior is proven.
- Multi-process concurrency, crash/restart with active timers, and load behavior are untested.
- Invitation email delivery, password reset, session list/revoke-all, Owner transfer.
- UI gaps: typed custom-field inputs on the opportunity detail page, server-side export, companies page, public-form CORS for embedding on other domains (the iframe embed works).
- Browser accessibility/contrast audit and responsive pass on the new screens.
- Production deployment, backups/restore, monitoring.
