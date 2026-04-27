#!/usr/bin/env python3
"""Inject SEO metadata + back-link into the 13 WP-XX psychotherapy volume pages.

Each volume is a standalone book-styled HTML doc rendered to PDF. Originally
written without web-SEO concerns. This script adds:
  - <meta name="viewport">         (mobile rendering)
  - <meta name="description">      (SERP snippet)
  - <meta name="keywords">         (long-tail terms)
  - <link rel="canonical">         (avoid dup-content penalty)
  - Open Graph tags                (social sharing)
  - schema.org LearningResource    (rich result eligibility)
  - .pt-back navigation link       (internal linking + UX; hidden in print)

The injection is idempotent — running twice is safe. The script looks for a
sentinel comment (`<!-- weave-seo-block -->`) and skips files where it's
already present.
"""
import re
from pathlib import Path

VOLUMES = {
    "WP-01-Sprint": {
        "h1": "Whole-Syllabus Sprint",
        "desc": "Free open-access psychotherapy sprint volume — the entire psychotherapy syllabus condensed into a single 2–3 hour read for psychiatry residents. The night-before-the-exam review.",
        "keywords": "psychotherapy sprint, psychotherapy syllabus India, psychiatry exam prep, MD psychiatry psychotherapy, DNB psychotherapy, INI-CET psychotherapy, RGUHS psychotherapy",
    },
    "WP-02-Foundations": {
        "h1": "History, Common Factors & Ethics",
        "desc": "Foundations of psychotherapy — history, common factors (Wampold), therapeutic alliance, ethics, research methodology, and outcome studies. Free open-access volume for psychiatry residents.",
        "keywords": "psychotherapy foundations, history of psychotherapy, therapeutic alliance, common factors Wampold, psychotherapy ethics, psychotherapy research methods",
    },
    "WP-03-Psychodynamic": {
        "h1": "Psychodynamic Psychotherapy",
        "desc": "Psychodynamic psychotherapy — Freud through contemporary practice. Drive theory, ego psychology, object relations, self psychology, relational and intersubjective approaches. Free for psychiatry residents.",
        "keywords": "psychodynamic psychotherapy notes, Freud, ego psychology, object relations, self psychology, psychiatry psychotherapy, MD DNB psychiatry",
    },
    "WP-04-CBT": {
        "h1": "Cognitive Behaviour Therapy",
        "desc": "Cognitive Behaviour Therapy — Beck and Ellis. Cognitive models, automatic thoughts, schemas, thought records, cognitive restructuring, behavioural experiments, and disorder-specific protocols. Free for psychiatry residents.",
        "keywords": "CBT notes psychiatry, cognitive behaviour therapy, Beck Ellis CBT, thought records, cognitive restructuring, CBT protocols, psychiatry psychotherapy",
    },
    "WP-05-Behaviour-Therapy": {
        "h1": "Behaviour Therapy",
        "desc": "Behaviour therapy — classical and operant conditioning, systematic desensitization, exposure and response prevention (ERP), behavioural activation, contingency management. Free volume for psychiatry residents.",
        "keywords": "behaviour therapy notes, classical conditioning, operant conditioning, systematic desensitization, exposure therapy, behavioural activation, ERP",
    },
    "WP-06-Third-Wave": {
        "h1": "Third Wave: DBT, ACT, MBCT, CFT, Schema Therapy",
        "desc": "Third-wave CBT therapies — Linehan's DBT, Hayes's ACT, Segal's MBCT, Gilbert's compassion-focused therapy (CFT), and Young's schema therapy. Mechanism, technique, evidence. Free for psychiatry residents.",
        "keywords": "DBT skills training, ACT therapy notes, MBCT notes, schema therapy, CFT compassion focused, third wave CBT, Linehan DBT, Young schema therapy",
    },
    "WP-07-Humanistic-Existential": {
        "h1": "Humanistic & Existential Therapies",
        "desc": "Humanistic and existential therapies — Rogers's person-centred therapy, Perls's Gestalt, Yalom's existential approach, Maslow, and Frankl's logotherapy. Free for psychiatry residents.",
        "keywords": "humanistic therapy, existential therapy, person centred therapy Rogers, Gestalt therapy Perls, Yalom existential, logotherapy Frankl",
    },
    "WP-08-Specialized-Modalities": {
        "h1": "Specialized Modalities: IPT, EMDR, MBT, TFP, MI, EFT, TA",
        "desc": "Specialized psychotherapy modalities — interpersonal therapy (IPT), EMDR for trauma, mentalisation-based therapy (MBT), transference-focused psychotherapy (TFP), motivational interviewing (MI), emotion-focused therapy (EFT), transactional analysis (TA).",
        "keywords": "IPT interpersonal therapy, EMDR trauma, MBT mentalisation, TFP transference focused, motivational interviewing MI, EFT emotion focused therapy, transactional analysis",
    },
    "WP-09-Group-Family-Couples": {
        "h1": "Group, Family & Couples Therapy",
        "desc": "Group, family and couples therapy — Yalom's therapeutic factors and group process, Minuchin's structural family therapy, Bowen's intergenerational model, Gottman couples research.",
        "keywords": "group therapy Yalom, structural family therapy Minuchin, Bowen family systems, Gottman couples therapy, family therapy notes",
    },
    "WP-10-Special-Populations": {
        "h1": "Special Populations",
        "desc": "Psychotherapy for special populations — child and adolescent psychotherapy, psychosis-adapted therapy (CBTp, MBT-ED), and culturally adapted therapy for Indian patients.",
        "keywords": "child adolescent psychotherapy, CBTp psychosis, culturally adapted therapy India, psychotherapy special populations",
    },
    "WP-11-Disorder-Specific-Map": {
        "h1": "Disorder-Specific Therapy Map",
        "desc": "Master table mapping every major psychiatric disorder to first-line and second-line psychotherapy, with evidence tier and Cochrane references. The viva cheat sheet.",
        "keywords": "psychotherapy by disorder, first line psychotherapy, evidence based psychotherapy, Cochrane psychotherapy, viva cheat sheet, psychiatry disorder map",
    },
    "WP-12-Landmark-Papers": {
        "h1": "Landmark Psychotherapy Trials",
        "desc": "Canonical psychotherapy trials every psychiatrist should know — STAR*D, NIMH TDCRP, Linehan 1991, Bateman & Fonagy 2008, Young schema RCTs. Findings and clinical impact.",
        "keywords": "landmark psychotherapy trials, STAR D, NIMH TDCRP, Linehan 1991 DBT trial, Bateman Fonagy MBT, Young schema therapy RCT",
    },
    "WP-13-Question-Bank": {
        "h1": "130+ Psychotherapy MCQs with Explanations",
        "desc": "Comprehensive psychotherapy question bank — 130+ single-best-answer MCQs with detailed explanations and references across every modality. Built for INI-CET, NEET SS and exit exam practice.",
        "keywords": "psychotherapy MCQs, psychiatry MCQs free, INI-CET psychiatry MCQs, NEET SS psychiatry, psychotherapy question bank, MD psychiatry exam prep",
    },
}

ROOT = Path("/Users/wilfreddsouza/M4-Workspace/weave-site/learn/psychotherapy")
SENTINEL = "<!-- weave-seo-block -->"

VOLUME_NUM = {f"WP-{i:02d}-": i for i in range(1, 14)}


def slug_for(folder: str) -> str:
    """Folder name doubles as the URL slug."""
    return folder


def build_head_block(folder: str, info: dict) -> str:
    slug = slug_for(folder)
    canonical = f"https://weave.clinic/learn/psychotherapy/{slug}/"
    h1 = info["h1"]
    desc = info["desc"]
    kw = info["keywords"]

    # Volume number for breadcrumb / schema position
    num = next((n for prefix, n in VOLUME_NUM.items() if folder.startswith(prefix)), 0)

    return f"""{SENTINEL}
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="{desc}">
<meta name="keywords" content="{kw}">
<link rel="canonical" href="{canonical}">
<link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/img/favicon-16.png">
<meta property="og:title" content="{h1} — Weave Psychotherapy Vol. {num}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{canonical}">
<meta property="og:type" content="article">
<meta property="og:image" content="https://weave.clinic/img/homepage.png">
<meta property="og:site_name" content="Weave — Centre for Integrative Psychiatry">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "LearningResource",
  "name": "{h1} — Weave Psychotherapy Vol. {num}",
  "description": "{desc}",
  "url": "{canonical}",
  "isAccessibleForFree": true,
  "inLanguage": "en",
  "educationalLevel": "Postgraduate",
  "learningResourceType": "Curriculum",
  "audience": {{"@type": "EducationalAudience", "educationalRole": "Psychiatry Postgraduate Resident"}},
  "isPartOf": {{
    "@type": "Course",
    "name": "Weave Psychotherapy Curriculum",
    "url": "https://weave.clinic/learn/psychotherapy/"
  }},
  "provider": {{
    "@type": "Organization",
    "name": "Weave — Centre for Integrative Psychiatry",
    "url": "https://weave.clinic"
  }}
}}
</script>
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {{"@type": "ListItem", "position": 1, "name": "Home", "item": "https://weave.clinic/"}},
    {{"@type": "ListItem", "position": 2, "name": "Learn", "item": "https://weave.clinic/learn/"}},
    {{"@type": "ListItem", "position": 3, "name": "Psychotherapy Curriculum", "item": "https://weave.clinic/learn/psychotherapy/"}},
    {{"@type": "ListItem", "position": 4, "name": "{h1}", "item": "{canonical}"}}
  ]
}}
</script>
<style>
.pt-back {{
  position: relative; z-index: 10;
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
  font-size: 11pt; padding: 12px 24px;
  background: #FDFBF7; border-bottom: 1px solid #E8DDD0;
}}
.pt-back a {{ color: #8F4A33; text-decoration: none; font-weight: 500; }}
.pt-back a:hover {{ text-decoration: underline; }}
@media print {{ .pt-back {{ display: none !important; }} }}
</style>
"""


BACK_NAV_HTML = (
    '<nav class="pt-back" aria-label="Breadcrumb">'
    '<a href="/">Weave</a>'
    ' / <a href="/learn/">Learn</a>'
    ' / <a href="/learn/psychotherapy/">Psychotherapy Curriculum</a>'
    "</nav>\n"
)


def inject(file: Path, folder: str, info: dict) -> str:
    text = file.read_text()
    if SENTINEL in text:
        return "skip (already injected)"

    head_block = build_head_block(folder, info)

    # Insert head_block right after <title>...</title>
    new_text, n = re.subn(
        r"(</title>)",
        r"\1\n" + head_block,
        text,
        count=1,
    )
    if n != 1:
        return "ERROR: no </title> found"

    # Insert back-nav right after <body[...]> opening tag
    new_text, n = re.subn(
        r"(<body[^>]*>)",
        r"\1\n" + BACK_NAV_HTML,
        new_text,
        count=1,
    )
    if n != 1:
        return "ERROR: no <body> found"

    file.write_text(new_text)
    return "ok"


def main():
    for folder, info in VOLUMES.items():
        path = ROOT / folder / "index.html"
        if not path.exists():
            print(f"  {folder:42s}  MISSING")
            continue
        result = inject(path, folder, info)
        print(f"  {folder:42s}  {result}")


if __name__ == "__main__":
    main()
