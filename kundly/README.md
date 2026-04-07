# weave-site/kundly/ — Kundly Public Web Tool

Status: **Phase 1 scaffold** — structure in place, content pending question-bank lock.

## Purpose

This is the public-facing Kundly web tool at `weave.clinic/kundly`. Seekers write their life story through a frictionless native form, consent, submit, receive an instant Spark, and are told their full Kundly Letter will arrive on WhatsApp in 2-4 business days.

## File layout

```
kundly/
├── README.md                  # this file
├── index.html                 # landing page — "Kundly — the psychiatry way" + Begin CTA
├── form.html                  # chapter player (state machine, one question per screen)
├── confirmation.html          # answer review + mandatory/word-count validation
├── consent.html               # version-stamped multi-layer consent
├── thanks.html                # post-submit with Spark + WhatsApp numbers + turnaround
├── safety.html                # crisis redirect (already written — uses disclaimer D8)
├── css/
│   └── kundly.css             # Weave palette, mobile-first, chapter player styles
├── js/
│   ├── supabase-client.js     # init + RLS-aware writes
│   ├── magic-link.js          # save-and-resume via email
│   └── threadwriter.js        # chapter state machine, autosave, navigation
└── content/
    └── chapters.json          # the question bank, rendered from skill references
```

## Build dependencies (blocked until prior phases complete)

| File | Blocked on |
|---|---|
| `content/chapters.json` | Bansi drafting + Wilfred reviewing the question bank (Phase 1 of skill) |
| `consent.html` copy | `references/consent-copy.md` (Phase 1 of skill — needs DPDP + research brief) |
| `index.html` hero copy | Cultural framing research (background agent running) |
| `thanks.html` spark render | Supabase migration applied + Edge Function deployed (Phase 2) |
| `form.html` logic | `chapters.json` being present |
| `js/supabase-client.js` | Supabase migration applied |

## What's already in place

- `safety.html` — crisis redirect page using canonical disclaimer D8. Complete.
- `README.md` — this file.
- Directory scaffold — css/, js/, content/.

## Admin dashboard

The Wilfred-only admin dashboard lives at `weave-site/admin/threadwriter.html` (separate directory). See `weave-site/admin/README.md`.

## Design constraints

- **Mobile-first:** 16px+ body, big tap targets, thumb-reachable next button
- **One question per screen** on mobile (chapter scroll acceptable on desktop)
- **Weave palette:** cream (#FAF7F2), terracotta (#C75B39), sage, gold — inherit from `../css/style.css`
- **Fonts:** Source Serif 4 for narrative prose, Inter for UI
- **No framework:** vanilla JS + Supabase JS client + CDN import map
- **Autosave:** debounced 500ms, visible "saved just now" indicator
- **Save-and-resume:** email-only magic link, no passwords, no account
- **Progress indicator:** arc ("Chapter 3 of 6 — Adolescence"), not a bar

## Do not ship until

- [ ] Question bank locked
- [ ] Supabase migration applied
- [ ] Edge Function `spark-generate` deployed
- [ ] Consent copy finalised against DPDP
- [ ] Safety screen keyword patterns in `data/safety-patterns.yaml`
- [ ] End-to-end test with synthetic seeker passes
- [ ] Wilfred signs off on the full flow on his phone
