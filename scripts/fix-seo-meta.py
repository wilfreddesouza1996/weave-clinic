#!/usr/bin/env python3
"""Fix SEO meta — shorten over-limit titles + descriptions, add GA4 to WP volumes.

Each entry maps {URL slug} -> {new_title, new_description}.
Lengths kept <=70 (title) and <=160 (description) per Google SERP truncation.

Also adds the GA4 gtag snippet inside <head> on the 13 WP volume pages
(they were authored as standalone print-style HTML and never wired to GA4).

Idempotent — running twice is safe.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path("/Users/wilfreddsouza/M4-Workspace/weave-site")
GA4_ID = "G-CQF603DJ1W"

# (title, description). Both kept under SERP truncation thresholds.
# title  <=70 chars, description <=160 chars.
META_FIXES: dict[str, tuple[str, str]] = {
    # Root + sales pages (only those flagged over the limit)
    "index.html": (
        None,  # title fine
        "Psychiatry that combines neuroscience with real therapy. Online consultations across India. Free residency curriculum and psychotherapy notes.",
    ),
    "learn/index.html": (
        "Learn: Mental Health Articles & Free Psychiatry Curriculum | Weave",
        "Mental health articles for everyone, plus a free open-access curriculum for psychiatry residents: 22 exam-prep notes and 13 psychotherapy volumes.",
    ),
    "learn/for-residents/index.html": (
        "Free Psychiatry Residency Notes for MD, DNB, INI-CET, NEET SS | Weave",
        "Free study material for Indian psychiatry residents: 22 exam-prep notes, 18 deep-study modules, 13 psychotherapy volumes, 130 MCQs. For MD, DNB, RGUHS.",
    ),
    "learn/psychotherapy/index.html": (
        "Weave Psychotherapy Curriculum: 13 Free Volumes for Indian Residents | Weave",
        "Free 13-volume psychotherapy curriculum for Indian psychiatry residents: psychodynamic through third-wave, plus 130 MCQs. For MD, DNB, INI-CET, NEET SS.",
    ),
    "kundly/index.html": (
        None,
        "Tell us your story. A psychiatrist will read it carefully and write you back a reflection. Free, no diagnosis, no strings, no account needed.",
    ),
    "tmop-explainer/index.html": (
        None,
        "An interactive explainer for the Toroidal Model of Psychosis and Affect: a computational psychiatry framework grounded in active inference.",
    ),
    "buy/reading-the-patient/index.html": (
        "Reading the Patient: A Clinical Pocketbook for Indian Psychiatry Residents",
        "A pocket-sized clinical companion for Indian psychiatry residents: ward rounds, OPD, viva, OSCE. By Dr. Wilfred D'souza.",
    ),
    # WP volumes — each currently over 160c
    "learn/psychotherapy/WP-01-Sprint/index.html": (
        None,
        "The whole psychotherapy syllabus in a 2-3 hour read. The night-before-the-exam volume for Indian psychiatry residents. Free.",
    ),
    "learn/psychotherapy/WP-02-Foundations/index.html": (
        None,
        "History of psychotherapy, common factors, therapeutic alliance, ethics, research methodology, outcome studies. Free for psychiatry residents.",
    ),
    "learn/psychotherapy/WP-03-Psychodynamic/index.html": (
        None,
        "Freud through contemporary practice: drive theory, ego psychology, object relations, self psychology, relational and intersubjective approaches.",
    ),
    "learn/psychotherapy/WP-04-CBT/index.html": (
        None,
        "Beck and Ellis. Cognitive models, automatic thoughts, schemas, thought records, restructuring, behavioural experiments, disorder-specific protocols.",
    ),
    "learn/psychotherapy/WP-05-Behaviour-Therapy/index.html": (
        None,
        "Classical and operant conditioning, systematic desensitization, exposure and response prevention, behavioural activation, contingency management.",
    ),
    "learn/psychotherapy/WP-06-Third-Wave/index.html": (
        None,
        "Linehan's DBT, Hayes's ACT, Segal's MBCT, Gilbert's CFT, Young's Schema Therapy. Mechanism, technique, evidence. Free for residents.",
    ),
    "learn/psychotherapy/WP-07-Humanistic-Existential/index.html": (
        None,
        "Rogers's person-centred therapy, Perls's Gestalt, Yalom's existential approach, Maslow, Frankl's logotherapy. Free for psychiatry residents.",
    ),
    "learn/psychotherapy/WP-08-Specialized-Modalities/index.html": (
        "IPT, EMDR, MBT, TFP, MI, EFT, TA: Weave Psychotherapy Vol. 8",
        "Interpersonal therapy, EMDR for trauma, MBT, TFP, motivational interviewing, EFT, transactional analysis. Free for psychiatry residents.",
    ),
    "learn/psychotherapy/WP-09-Group-Family-Couples/index.html": (
        None,
        "Yalom's group factors, Minuchin's structural family therapy, Bowen's intergenerational model, Gottman's couples research. Free for residents.",
    ),
    "learn/psychotherapy/WP-10-Special-Populations/index.html": (
        "Special Populations: Weave Psychotherapy Vol. 10",
        "Child and adolescent psychotherapy, psychosis-adapted therapy (CBTp, MBT-ED), culturally adapted therapy for Indian patients.",
    ),
    "learn/psychotherapy/WP-11-Disorder-Specific-Map/index.html": (
        None,
        "Master table: every major psychiatric disorder mapped to first-line and second-line psychotherapy with evidence tier. The viva cheat sheet.",
    ),
    "learn/psychotherapy/WP-12-Landmark-Papers/index.html": (
        None,
        "STAR*D, NIMH TDCRP, Linehan 1991, Bateman & Fonagy 2008, Young schema RCTs. Findings and clinical impact. Free for psychiatry residents.",
    ),
    "learn/psychotherapy/WP-13-Question-Bank/index.html": (
        None,
        "130+ single-best-answer MCQs with explanations across every modality. Built for INI-CET, NEET SS, RGUHS and exit-exam practice.",
    ),
}


def fix_meta(file: Path, new_title: str | None, new_desc: str | None) -> int:
    text = file.read_text()
    n = 0

    if new_title:
        text2 = re.sub(
            r"<title>[^<]*</title>",
            f"<title>{new_title}</title>",
            text,
            count=1,
        )
        if text2 != text:
            n += 1
            text = text2
        # OG title too
        text2 = re.sub(
            r'<meta property="og:title"\s+content="[^"]*"',
            f'<meta property="og:title" content="{new_title}"',
            text,
        )
        if text2 != text:
            n += 1
            text = text2

    if new_desc:
        text2 = re.sub(
            r'<meta name="description"\s+content="[^"]*"',
            f'<meta name="description" content="{new_desc}"',
            text,
        )
        if text2 != text:
            n += 1
            text = text2
        # OG description too
        text2 = re.sub(
            r'<meta property="og:description"\s+content="[^"]*"',
            f'<meta property="og:description" content="{new_desc}"',
            text,
        )
        if text2 != text:
            n += 1
            text = text2

    if n:
        file.write_text(text)
    return n


GA4_BLOCK = f"""<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id={GA4_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('js', new Date());
  gtag('config', '{GA4_ID}');
</script>
"""


def add_ga4(file: Path) -> bool:
    text = file.read_text()
    if GA4_ID in text:
        return False
    # Inject right after <head> (or after <head><meta charset="UTF-8"> if no newline after head)
    text2, n = re.subn(
        r"(<head>)",
        r"\1\n" + GA4_BLOCK,
        text,
        count=1,
    )
    if n != 1:
        # try matching head with attrs
        text2, n = re.subn(
            r"(<head[^>]*>)",
            r"\1\n" + GA4_BLOCK,
            text,
            count=1,
        )
    if n == 1:
        file.write_text(text2)
        return True
    return False


def main() -> int:
    print("=== Meta fixes ===")
    total = 0
    for rel, (title, desc) in META_FIXES.items():
        path = ROOT / rel
        if not path.exists():
            print(f"  MISSING: {rel}")
            continue
        n = fix_meta(path, title, desc)
        total += n
        print(f"  {rel:60s} {n} edits")
    print(f"  Total meta edits: {total}")

    print()
    print("=== GA4 injection on WP volumes ===")
    for i in range(1, 14):
        match = list(ROOT.glob(f"learn/psychotherapy/WP-{i:02d}-*/index.html"))
        if not match:
            print(f"  WP-{i:02d}-X: not found")
            continue
        f = match[0]
        added = add_ga4(f)
        rel = f.relative_to(ROOT)
        print(f"  {str(rel):60s} {'GA4 added' if added else 'already present'}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
