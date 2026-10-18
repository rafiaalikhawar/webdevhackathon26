# Configuration guide

All secrets live in `relay-crm/.env` (git-ignored). Never put them in `VITE_*` variables or source files.
Per-workspace provider credentials are entered on the Integrations page and stored server-side (encrypted once the secret-encryption milestone lands).

## Core
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Runtime DB user `relay_app` (not owner, no BYPASSRLS) |
| `MIGRATION_DATABASE_URL` | Owner user, used only by `npm run db:migrate` |
| `APP_ORIGIN` | Allowed browser origin (CSRF/CORS). `http://localhost:5173` in dev |
| `PORT` | API port (3001) |
| `SECRETS_KEY` | 32-byte hex key that encrypts provider secrets (`openssl rand -hex 32`). Losing it makes stored secrets unreadable |
| `PUBLIC_BASE_URL` | Public HTTPS base that providers call. Twilio signatures are computed against it |
| `INTEGRATIONS_SKIP_VERIFY=1` | Dev/test only: skip live credential checks on save. Ignored in production |
| `TWILIO_API_BASE`, `POLAR_API_BASE`, `TELEGRAM_API_BASE`, `GOOGLE_TOKEN_URL`, `GOOGLE_CALENDAR_BASE` | Override provider URLs (used by the stub-provider tests) |

## Public HTTPS URL for webhooks
Twilio, Polar, Meta and Google call you back (the Integrations page shows your exact per-workspace URLs), so they need a public HTTPS address.
Dev: `cloudflared tunnel --url http://localhost:3001` (or `ngrok http 3001`). Use the printed URL as the webhook base.

## Providers (set up in this order)
1. **Polar (sandbox)** – sandbox.polar.sh → create an organization → Settings → create an access token (scopes: checkouts write, products read, orders read) and any one-time product (copy its ID). Webhook endpoint `https://<public>/api/webhooks/polar/<workspaceId>`; events `order.paid`, `checkout.updated`, `refund.created`, `refund.updated`; copy the endpoint's secret. Relay sets the price per payment request on that product. Sandbox only by default; `POLAR_API_BASE` switches the API host.
2. **Twilio WhatsApp sandbox** – Console → Messaging → Try it out → WhatsApp. Phones join by sending the join phrase. Set "When a message comes in" to `https://<public>/api/webhooks/twilio/<workspaceId>/inbound` and the status callback to `.../status`. Needs Account SID + Auth Token.
3. **Google Calendar** – Google Cloud project → enable Calendar API → OAuth consent screen (Testing, add test users) → OAuth client (Web). Redirect URI `https://<public>/api/oauth/google/callback`. Needs Client ID + Secret.
4. **Telegram (notifications)** – talk to @BotFather → `/newbot` → token. Each employee messages the bot once, then enters their chat id on their profile.

## WhatsApp via Meta Cloud API (alternative to Twilio)
Per-workspace, entered on the Integrations page (encrypted at rest): access token, app secret, a verify token you invent, Phone number ID (and optionally the WhatsApp Business Account ID).
- Callback URL (shown on the page): `https://<public>/api/webhooks/whatsapp/<workspaceId>`. In Meta → WhatsApp → Configuration, paste it with the same verify token, then subscribe to the `messages` field.
- The app secret is under App settings → Basic. The temporary test token expires after about 24 hours; replace it on the Integrations page.
- Free-form replies work only within 24 hours of the customer's last message; otherwise send an approved template. Test numbers reach only allowed recipients.
- `META_GRAPH_API_VERSION` (optional, default `v23.0`) sets the Graph API version.

## Alternatives to Twilio
Requirement I1 names Twilio, but accepts equivalents only as SMS; if you swap, keep the same adapter interface (verify signature, send, status callback, dedupe by message id).
- **Meta WhatsApp Cloud API** – free test number, official, closest to the Twilio sandbox. Best swap.
- **Vonage Messages API** – WhatsApp/SMS sandbox, signed webhooks (JWT).
- **MessageBird / Bird**, **Infobip**, **Plivo** – SMS, trial credit.
- **Telegram bot as the "messaging" channel** – no phone needed, easiest to demo, but it is not what the brief names, so confirm with the judges before relying on it.

## Adding a new provider
1. Add an adapter in `server/integrations/<name>.ts` exposing `verifyWebhook`, `send`, and `parseEvent`.
2. Register it in the provider map and add a row type to `integrations`.
3. Add the route under `/api/webhooks/<name>` that verifies the signature first, then writes to `integration_events` (unique on provider event id) so replays are ignored.
4. Add its fields to the Integrations page and an audit event for connect/change/remove.

## Running everything locally
```bash
docker compose --env-file .env up -d database
npm run db:migrate      # applies every db/NNN_*.sql in order
npm run api             # :3001
npm run worker          # deadlines + alert outbox
npm run dev             # :5173
npm test && npm run test:http && npm run test:integrations
```
Dev login credentials live in your untracked `.env` (`DEV_LOGIN_*`). Per-workspace provider keys are entered on the Integrations page, never in `.env`.
