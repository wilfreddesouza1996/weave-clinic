# Kundly Admin Dashboard

Wilfred-only queue dashboard for the Kundly seeker pipeline. Lives at:

- **Local:** http://localhost:8090/admin/kundly.html
- **Production:** https://weave.clinic/admin/kundly.html (gate behind Cloudflare Access in prod)

## Purpose

A single page that lets Wilfred:

1. See incoming seeker submissions in a queue (sorted oldest or newest first)
2. Click into one to read the full narrative chapter-by-chapter
3. Drive the pipeline forward with manual status transitions: pick up → mark awaiting sign-off → sign off → mark delivered
4. Decline gently with a reason written to the audit log
5. View the latest 50 pipeline events for debugging

## Files

```
weave-site/admin/
├── kundly.html         ← single-page dashboard
├── kundly.css          ← admin styles, reuses Weave palette
├── kundly-admin.js     ← vanilla JS + Supabase client
└── README.md           ← this file
```

## Setup — service role key

The dashboard talks to Supabase using the **service_role key**. This key bypasses RLS so the browser can read everything Wilfred needs.

**Before opening this page locally:**

1. Open `weave-site/admin/kundly.html`
2. Find the line near the top inside `<script>`:

   ```js
   const SUPABASE_SERVICE_ROLE_KEY = '__REPLACE_BEFORE_DEPLOY__';
   ```

3. Replace `__REPLACE_BEFORE_DEPLOY__` with the actual service_role key from the Supabase dashboard (Settings → API → `service_role` secret)
4. Save. Refresh the page. The connection pill in the top-right should turn green.

**NEVER commit the real key.** Reset to `__REPLACE_BEFORE_DEPLOY__` before any `git add weave-site/admin/`.

A `_headers` file at the site root sends `X-Robots-Tag: noindex, nofollow` for `/admin/*` so the page is not indexed even if leaked.

## Status ladder

The full status flow recorded in `threadwriter_seekers.status`:

```
in_progress
   ↓
submitted              ← seeker hits Submit on weave.clinic/kundly
   ↓
spark_generating
   ↓
spark_ready            ← Edge Function delivered the instant Spark
   ↓
picked_up              ← Wilfred clicked Pick up in this dashboard
   ↓
warp_drafting
   ↓
weave_running
   ↓
letter_drafted
   ↓
loupe_passed
   ↓
awaiting_signoff       ← Wilfred reads the letter
   ↓
signed_off             ← Wilfred approved
   ↓
delivered              ← WhatsApp send confirmed
```

Side branches: `crisis_escalated`, `declined_gently`, `withdrawn`, `spark_failed_graceful`.

## Where the files live on disk

When Wilfred picks up a seeker, he runs the command the dashboard shows. That populates a folder on his Mac:

```
~/clinical/_kundly/SK-XXXX/
├── narrative-draft.md
├── upr-fragment.json
├── safety-screen.json
├── seeker-metadata.yaml
└── reflection-letter.pdf  (after Loom + CouchOp)
```

Nothing in this folder ever leaves the local machine. The Supabase row only holds the chapter JSON, the Spark, the status, and timestamps.

## Local commands the dashboard tells you about

When you click **Pick up** in the dashboard, the status flips to `picked_up` in Supabase, and a code block appears in the action panel telling you to run:

```sh
python3 ~/.claude/skills/kundly/scripts/ingest-seeker.py SK-XXXX
```

That script reads the row from Supabase and writes the local folder. Then to actually run the Weave pipeline:

```sh
python3 ~/.claude/skills/kundly/scripts/run-weave-pipeline.py SK-XXXX
```

Both scripts update Supabase status as they run, so the queue view stays in sync.

## How to bring back deleted seeker rows

You can't. The `threadwriter_pipeline_events` and `threadwriter_letters` tables both `ON DELETE CASCADE` from `threadwriter_seekers`, and the DPDP right-to-erasure flow is intentionally final. Hard-delete is permanent.

If a seeker emails asking to be erased, run the erasure SQL through Supabase MCP. There is no undo.

## Auth/security notes

- **v1:** unguessable URL + service_role key in HTML. Wilfred uses this only on his Mac. Acceptable for the soft-launch window.
- **v1.5:** put the page behind Cloudflare Access (Google SSO restricted to Wilfred's email) before any external traffic.
- **Never** ship a build with the service_role key checked in. The CI should fail if it sees anything other than `__REPLACE_BEFORE_DEPLOY__` in `kundly.html`.
- The `noindex, nofollow` header on `/admin/*` is in `weave-site/_headers`.

## Empty-state behaviour

If no seekers match the active filter, the queue and events views show a calm empty state. The stats cards show `0` instead of `—`. This is the expected state today (database is empty as of 2026-04-07).

## Tabs

- **#queue** — default view, queue + stats
- **#events** — last 50 pipeline events
- **#sk/SK-XXXX** — detail view for a single seeker
