# Cloud plan: Lead Intake Agent on Cloudflare Workers

Status: draft for approval, 28 Oct 2026. Nothing below is built yet.

## Goal

The same agent, always on, with no PC involved: the business's website form posts to a public address, every lead is sorted, filed in GoHighLevel and sent to Slack, failures alert the team, and the daily report posts at 5pm Sydney time whether or not anyone's computer is on.

The rubric in `CLAUDE.md` (R1 to R6) stays the acceptance test. Every non-negotiable still applies: nothing is ever sent to a lead, keys never live in code, save first and process second, nothing fails quietly, enquiry text is untrusted, and rules live in `rules.md`.

## What is checked already (28 Oct 2026)

- The Cloudflare token can create Queues, D1 databases, Workers and Turnstile widgets. A workers.dev subdomain exists. Wrangler 4.94 is installed.
- Queues are on the Workers Free plan (since Feb 2026): 10,000 operations a day, messages kept 24 hours (14 days on Paid).
- D1 accepts the `oc` (Oceania) location hint. It is a hint, not a guarantee; D1's only hard jurisdictions are `eu`, `us` and `fedramp`.
- The Workers rate limiting binding is GA. Free plan Workers may make 50 outside requests per run; one lead needs about 6.

## What changes, part by part

| Today (local) | In the cloud | Why |
|---|---|---|
| Claude Code CLI, logged in as Mike | Anthropic API with the client's own key, official SDK bundled into the Worker | The CLI can't run in a Worker, and the brief says the client supplies the AI account |
| Files in `data/inbox`, `done`, `dead` | One D1 table of leads with a `status` column (received, processing, done, dead) plus an events table | Workers have no disk. D1 is the record of truth |
| In-process queue, one at a time | Cloudflare Queue carrying lead ids, consumer set to one at a time (`max_batch_size: 1`, `max_concurrency: 1`) | Guaranteed delivery, and one-at-a-time keeps the duplicate check safe |
| `data/log.jsonl` | `events` table in D1, plus Workers Logs | Same rows, queryable, survives restarts |
| Retry 1s/4s/10s, fail fast on 400/401/403/404 | Same `retry.js` inside the consumer, plus the queue's own redelivery for crashes | Same behaviour the demo showed |
| Dead lead file + `npm run replay` | Lead row marked `dead` in D1 + Slack alert. Replay is a protected admin endpoint, and `npm run replay` calls it | Free-plan queues drop messages after 24 hours, so the failed lead must live in D1, not only in a queue |
| Crash recovery on start | An hourly scheduled job re-queues any lead stuck in `received` for more than 10 minutes | Covers a lead saved to D1 whose queue send failed |
| Daily report timer in the server | Cron trigger every hour; posts when it is 5pm in Sydney and today's report hasn't gone | Daylight saving can't move it |
| `rules.md` and prompts read from disk | Bundled into the Worker as text; `npm run deploy` publishes edits | Same files, same plain-English editing |
| Local form at localhost | Form served as a static asset on the Worker, or the business's own website form posts to `/enquiry` | Their site keeps its look |
| Behind-the-scenes panel (live stream) | Staff-only lead log page that polls the events table, behind an admin token | A public visitor should never see the internals |

## New protection a public form needs

- Cloudflare Turnstile (invisible bot check) on the form, verified on the server. The token can create the widget once we know the site's hostname.
- Rate limit per visitor IP on `POST /enquiry` (for example 5 per minute).
- CORS allow-list: only the business's own domain may post.
- Body size cap (already 20 KB), hidden honeypot field and too-fast check (already built).
- Admin endpoints (replay, report now, lead log) need a long random `ADMIN_TOKEN` secret.

## How the code is arranged

Keep the local version working (useful for demos and testing) and share one core:

```
src/core/     validate, dedupe logic, sort and draft prompt building + guardrails,
              ghl, slack, retry, note body, report builder  (fetch only, no disk)
src/node/     today's local server: CLI adapter, file storage, live panel
worker/       Worker entry: fetch (form, /enquiry, admin), queue consumer, scheduled job;
              D1 storage adapter; Anthropic API adapter
migrations/   0001_init.sql (leads, events, fingerprints, reports)
wrangler.jsonc
```

One deliberate exception to "zero runtime dependencies": the Worker bundles the official Anthropic SDK. Wrangler packs it into the Worker, so nothing is installed on anyone's machine. The local version stays dependency-free.

## AI calls on the API

- Sort: `claude-haiku-5-5`, low effort, structured output (`output_config.format`) using the schema we already have.
- Draft: `claude-sonnet-5-5`, low effort, same schema approach.
- Only the fields the AI needs are sent (name, company, suburb, service, message, email domain, yes/no for phone). Full email and phone never go to the AI, same as today.
- Estimated cost: well under 1 cent per lead (Haiku 5.5 is $0.10 / $0.50 per million tokens, Sonnet 5.5 is $2 / $10). Phase 2 measures the real figure on the bench.

## Order of work

Each phase ends with something visible. Mike approves each deploy.

| # | Phase | Done when (what you see) |
|---|---|---|
| 1 | Split out the shared core; add the deferred unit tests | `npm test` passes; the local demo still works exactly as it does now |
| 2 | Anthropic API adapter; the 10-case bench | `npm run bench` prints a score against the API and against the CLI, plus measured cost per lead |
| 3 | Worker, D1 database (Oceania hint), form, intake | Submit on a `*.workers.dev` preview; the lead row appears in D1 |
| 4 | Queue consumer runs the full pipeline | Same submit lands in GHL and as a Slack card |
| 5 | Failure path, replay endpoint, stuck-lead sweep | Wrong GHL token: alert in #lead-ops, lead marked dead; fix token, replay, lead lands |
| 6 | Hourly cron with 5pm Sydney report | `npm run digest` posts on demand; the scheduled run posts once a day |
| 7 | Turnstile, rate limit, CORS, admin token | A bot-style post is refused; the real form still works |
| 8 | Staff lead log page, README handover guide, rubric review by a fresh reviewer | Every R1 to R6 row marked PASS with evidence |
| 9 | Go-live with the business (below) | Their real form posts a real enquiry into their GHL and Slack |

Estimate: phases 1 to 8 take about a day of build and testing. Phase 9 depends on the business's accounts and DNS.

## Go-live checklist (phase 9)

- Their Cloudflare account (recommended, so their keys stay in their accounts), or Mike's account under a managed-service arrangement.
- Their Anthropic API key, GHL Private Integration token (contacts read and write only) and Slack webhooks, stored as Worker secrets with `wrangler secret put`.
- Their real services, area and rules in `rules.md`, then a bench run on real past enquiries in `test/fixtures/real/`.
- Their GHL checked for workflows triggered by "Contact Created" or "Contact Tag". Those could message a lead, and nothing in this code can stop them.
- Their website form pointed at the Worker's `/enquiry` (or the Worker's form embedded). A custom domain needs a DNS record the business or Mike adds; this build never touches DNS.
- Privacy: the enquiry is stored in Cloudflare (Oceania hint) and the AI processes it in Anthropic's infrastructure overseas. Their privacy policy should say so (Australian Privacy Principle 8).
- Workers Paid plan ($5 a month) for production: 14-day queue retention and higher CPU limits. Free is fine while building.

## Running costs (around 100 leads a month)

- Cloudflare: $0 on Free, $5 a month on Paid (recommended for production).
- Anthropic API: about $1 a month or less, confirmed in phase 2.
- GHL and Slack: their existing plans.

## What Mike needs to provide

1. An Anthropic API key for building and testing, added to the shared `.env` as `ANTHROPIC_API_KEY` (from console.anthropic.com, API keys). Never in chat.
2. A yes on the Anthropic SDK being bundled into the Worker.
3. Whose Cloudflare account hosts production.
4. A yes before each deploy (preview first, production last).
