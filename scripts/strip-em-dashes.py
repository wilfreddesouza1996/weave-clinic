#!/usr/bin/env python3
"""Strip every em-dash from weave.clinic HTML, with context-aware replacements.

Context rules (applied in order):
  1. Brand mark "Weave — Centre for Integrative Psychiatry" → "Weave Centre for Integrative Psychiatry"
  2. Inside <title>...</title>          → ": "
  3. Inside <meta property="og:title">  → ": "
  4. Everywhere else                    → ", "
  5. The bare em-dash "—" with no spaces around it → ","
  6. HTML entity "&mdash;" → handled by first replacing it to "—" then running rules

Skipped paths (Wilfred's voice / book content — leave alone):
  - learn/psychotherapy/WP-*/  (PDF-style book volumes)
  - kundly/                    (personal product voice)
  - admin/                     (internal tooling, not user-visible)

Also skipped: /weave-cases/, /tmop-explainer/  (research / clinical content)

Idempotent — running again finds zero em-dashes.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path("/Users/wilfreddsouza/M4-Workspace/weave-site")

SKIP_PATH_FRAGMENTS = (
    "/learn/psychotherapy/WP-",
    "/kundly/",
    "/admin/",
    "/weave-cases/",
    "/tmop-explainer/",
    "/DeepBlue/",
    "/buy/",   # not built by us in-session
    "/.wrangler/",
    "/node_modules/",
)

EM = "—"          # —
EN = "–"          # – (en-dash, NOT replaced — used for ranges like 45–60 min)


def replace_in_text(text: str) -> tuple[str, int]:
    """Run context-aware replacement across one HTML file's contents."""
    n_total = 0

    # Step 0 — normalise the HTML entity to the actual character so the rules see one form
    text, n0 = re.subn(r"&mdash;", EM, text)
    n_total += n0

    # Step 1 — brand mark (drop the dash entirely; "Weave Centre" reads as one name)
    text, n1 = re.subn(
        rf"Weave\s*{EM}\s*Centre for Integrative Psychiatry",
        "Weave Centre for Integrative Psychiatry",
        text,
    )
    n_total += n1

    # Step 2 — inside <title>...</title>: " — " → ": "
    def fix_title(m: re.Match) -> str:
        inner = m.group(1)
        inner_fixed = re.sub(rf"\s*{EM}\s*", ": ", inner)
        return f"<title>{inner_fixed}</title>"

    text, n2 = re.subn(r"<title>(.+?)</title>", fix_title, text, flags=re.DOTALL)
    n_total += n2

    # Step 3 — inside <meta property="og:title" content="...">: " — " → ": "
    def fix_og_title(m: re.Match) -> str:
        full = m.group(0)
        return re.sub(rf"\s*{EM}\s*", ": ", full)

    text, n3 = re.subn(
        r'<meta property="og:title" content="[^"]*"\s*/?>',
        fix_og_title,
        text,
    )
    n_total += n3

    # Step 4 — everywhere else: " — " → ", "
    # Both spaces present (the most common prose form)
    text, n4 = re.subn(rf"\s+{EM}\s+", ", ", text)
    n_total += n4

    # Step 5 — bare em-dash with no surrounding spaces (rare): replace with comma
    text, n5 = re.subn(EM, ",", text)
    n_total += n5

    # Cleanup artifacts produced by the replacements:
    # - ", |" (comma immediately before a pipe) — happens when we just stripped a dash
    text, n6 = re.subn(r",\s+\|", " |", text)
    n_total += n6
    # - duplicate ", , " — happens when adjacent dashes get replaced
    text, n7 = re.subn(r",\s*,\s*", ", ", text)
    n_total += n7
    # - leading comma on a line (unlikely, defensive)
    text, n8 = re.subn(r"^\s*,\s+", "", text, flags=re.MULTILINE)
    n_total += n8

    return text, n_total


def should_process(path: Path) -> bool:
    s = str(path)
    if not s.endswith(".html"):
        return False
    return not any(frag in s for frag in SKIP_PATH_FRAGMENTS)


def main() -> int:
    files = sorted(p for p in ROOT.rglob("*.html") if should_process(p))
    grand_total = 0
    touched = 0
    for f in files:
        original = f.read_text()
        new, n = replace_in_text(original)
        if n == 0:
            continue
        touched += 1
        grand_total += n
        f.write_text(new)
        rel = str(f.relative_to(ROOT))
        print(f"  {rel:60s} {n:>4d} replacements")
    print()
    print(f"Total: {grand_total} replacements across {touched} files (of {len(files)} scanned).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
