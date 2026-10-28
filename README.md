# Kwal-ity AI Lead Qualifier

Every website enquiry, caught, checked, sorted by AI, filed in GoHighLevel and sent to the sales team in Slack with a suggested reply. **Nothing is ever sent to the customer automatically.** A person reads the draft and decides.

Built for Kwal-ity Electrical, a demo electrical business in Sydney, Australia. The business, people and phone numbers in this repo are fictional.

## What happens to each enquiry

| Step | What it does |
|---|---|
| 1. Saved first | The enquiry is written to disk before anything else runs, so it can never be lost. |
| 2. Checked | Details are cleaned up, the phone number is formatted (+61), and missing details are listed. Spam signals are flagged. |
| 3. Duplicate check | Same person and same message within 72 hours is marked as a duplicate. |
| 4. Sorted by AI | Claude reads it against the business's own rules in `rules.md`: **qualified**, **needs a look**, or **not a fit**, with a one-line reason and flags such as urgent or existing customer. |
| 5. Reply drafted | A suggested reply in Australian English, 120 words or fewer, with no prices, dates or promises. Saved as a draft only. |
| 6. Filed in GoHighLevel | The contact is found or created (never duplicated), tagged with the verdict, and a note holds the message, the verdict and the draft under `SUGGESTED REPLY — DRAFT, NOT SENT`. |
| 7. Sales team alerted | Qualified and needs-a-look leads get a Slack card with everything needed to decide. Not-a-fit leads skip the card and appear in the daily report, so a person can overrule the AI. |
| 8. Done | Logged, and counted in the daily report. |

**If anything fails**, the lead is kept safe in `data/dead/`, an alert goes to the ops channel in Slack, and one command re-runs it from the step it reached. If Slack itself is down, the alert is written to `data/ALERTS.txt`.

**A daily report** posts to Slack at 5pm Sydney time, even on a quiet day ("0 leads"), so silence is never mistaken for "all fine".

## Safety by design

- **No send function exists.** The GoHighLevel token only has contact permissions, so even a bug cannot message a lead.
- **Keys live only in `.env`**, which is never committed. Scripts report key names, never values.
- **Enquiry text is treated as untrusted.** It reaches the AI as data inside tags, the AI runs with no tools, and its output is checked before anything uses it. An enquiry that tries to instruct the AI is flagged.
- **The AI never sees full contact details.** It gets the name, suburb, service, message and email domain only.
- **The rules are plain English** in `rules.md`. The code holds no qualification logic.

## Setup (Windows, Mac or Linux)

You need:

- Node.js 22.9 or newer: https://nodejs.org
- Claude Code, installed and logged in (`claude` in a terminal). The demo uses that login for the AI. For an always-on production run, use the business's own Anthropic API key so usage bills to their account; see `CLOUD-PLAN.md`.
- A GoHighLevel sub-account with a **Private Integration** token that has **contacts.readonly and contacts.write only** (Settings, then Private Integrations).
- Two Slack incoming webhooks, one for leads and one for alerts and reports (https://api.slack.com/apps, then Incoming Webhooks). One webhook also works; alerts then go to the leads channel.

Then:

1. Copy `.env.example` to `.env` and fill in `GHL_TOKEN`, `GHL_LOCATION_ID`, `SLACK_LEADS_WEBHOOK` and `SLACK_ALERTS_WEBHOOK`.
2. Run `npm run check`. It should say "All keys set".
3. Run `npm start` and open http://localhost:3000.
4. Click a sample (for example "Good lead"), press **Send enquiry**, and watch each step light up in the panel on the right.

There is nothing to install with `npm install`: the project has no dependencies.

**Before go-live in a real GoHighLevel account:** check for workflows triggered by "Contact Created" or "Contact Tag". This system never sends anything, but a GoHighLevel workflow could.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Starts the form and the agent on http://localhost:3000 |
| `npm run check` | Shows which keys are set (names only) |
| `npm run replay` | Re-runs every failed lead in `data/dead/` |
| `npm run replay -- <id>` | Re-runs one failed lead |
| `npm run digest` | Posts the lead report to Slack now |

## Changing how leads are sorted

Edit `rules.md` in plain English. No code changes and no restart are needed: the next enquiry uses the new rules. The three most common changes:

1. **Add a service:** add a line under "Our services".
2. **Change the service area:** edit "Where we work".
3. **Change what counts as qualified:** edit the "Qualified" and "Needs a look" lists. When a lead matches both, "needs a look" wins.

The AI prompts are in `src/prompts/sort.md` and `src/prompts/draft.md` if the tone or format of the draft needs to change.

## Reading the log

Every step writes one line to `data/log.jsonl` (time, lead id, step, status, detail), and the same lines appear in the terminal:

```
[ok] 20261028200537-0bb5dc  sort      Needs a look: Existing customer with urgent fault.
[ok] 20261028200537-0bb5dc  crm       New contact created. Tags: intake-agent, source-website, ai-needs-look. Note added.
[XX] 20261028194809-a666c2  crm       GHL_TOKEN or GHL_LOCATION_ID is not set in .env
```

`ok` is done, `..` is running, `!!` is a retry, `--` is a skipped step, and `XX` is a failure (an alert was sent).

Finished leads are in `data/done/`, failed ones in `data/dead/`, and anything in `data/inbox/` is re-run automatically on the next start.

## Settings

All optional, in `.env`:

| Setting | Default | Meaning |
|---|---|---|
| `BUSINESS_NAME` | Kwal-ity Electrical | Used in drafts and the report |
| `PORT` / `HOST` | 3000 / 127.0.0.1 | Where the form is served (local only by default) |
| `TIMEZONE` / `DIGEST_HOUR` | Australia/Sydney / 17 | When the daily report posts |
| `DEDUPE_WINDOW_HOURS` | 72 | How long a repeat counts as a duplicate |
| `CONFIDENCE_FLOOR` | 0.7 | Below this, the AI's call becomes "needs a look" |
| `SORT_MODEL` / `DRAFT_MODEL` | haiku / sonnet | AI models for sorting and drafting |

## Status

Working end to end on a local machine: the form, the live panel, checks, duplicate detection, AI sorting and drafting, GoHighLevel contacts with tags and notes, Slack cards, failure alerts, replay and the daily report.

Not built yet:

- Unit tests and the 10-case test bench (`npm test`, `npm run bench`)
- Cloud deployment, public-form spam protection and rate limits (planned in `CLOUD-PLAN.md`)

`CLAUDE.md` is the full build specification and acceptance rubric.

## License

MIT. Free to use, change and share; see `LICENSE`.
