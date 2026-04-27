#!/usr/bin/env python3
"""SEO meta — pass 2. Knock down remaining warnings from the audit.

- Shorten descriptions on learn articles still over 160c
- Shorten the psychotherapy hub title (76c -> <70)
- Shorten /buy/reading-the-patient/ title (74c -> <70)
- Add GA4 to tmop-explainer
- Add canonical to DeepBlue (Next.js page; insert via index.html edit)
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path("/Users/wilfreddsouza/M4-Workspace/weave-site")
GA4_ID = "G-CQF603DJ1W"

META_FIXES: dict[str, tuple[str | None, str | None]] = {
    # Shorten over-160 descriptions on learn articles
    "learn/adhd-in-adults.html": (
        None,
        "ADHD in adults is real, common, and often missed, especially in women. How it works, how assessment goes, and what treatment looks like at Weave.",
    ),
    "learn/addictions.html": (
        None,
        "The opposite of addiction is connection. How alcohol, gambling, gaming, and scrolling become problems, what's underneath, and how recovery works.",
    ),
    "learn/chronic-pain.html": (
        None,
        "Pain that persists after the injury heals is real, not imagined. How chronic pain and somatization work in the brain, and what helps in psychiatry.",
    ),
    "learn/supplements.html": (
        None,
        "Magnesium, omega-3, vitamin D, B12, ashwagandha. Which supplements help mental health, which don't, and how to think about them with your doctor.",
    ),
    "learn/sexual-health.html": (
        None,
        "Sexual problems that have a psychiatric or medication-related cause. How to tell, what to bring up with your doctor, and what treatment looks like.",
    ),
    "learn/psychosis.html": (
        None,
        "Psychosis is treatable, often misunderstood. What it is, what it isn't, what to do when someone you love is experiencing it, and how recovery works.",
    ),
    "your-rights.html": (
        None,
        "Your rights as a psychiatry patient in India: confidentiality, consent, hospitalisation, the Mental Healthcare Act 2017, and what we can promise you.",
    ),
    # Title under 70c
    "learn/psychotherapy/index.html": (
        "Weave Psychotherapy Curriculum: 13 Free Volumes for Residents",
        None,
    ),
    "buy/reading-the-patient/index.html": (
        "Reading the Patient: Clinical Pocketbook for Indian Residents",
        None,
    ),
}


def fix_meta(file: Path, new_title: str | None, new_desc: str | None) -> int:
    text = file.read_text()
    n = 0
    if new_title:
        text2 = re.sub(r"<title>[^<]*</title>", f"<title>{new_title}</title>", text, count=1)
        if text2 != text:
            n += 1
            text = text2
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
    text2, n = re.subn(r"(<head>|<head[^>]*>)", r"\1\n" + GA4_BLOCK, text, count=1)
    if n == 1:
        file.write_text(text2)
        return True
    return False


def add_canonical_to_deepblue() -> bool:
    """DeepBlue is a Next.js page. Inject a canonical <link> + canonical og:url."""
    f = ROOT / "DeepBlue/index.html"
    text = f.read_text()
    if 'rel="canonical"' in text:
        return False
    # Insert canonical right before the existing <title> tag in the head
    canonical_tag = '<link rel="canonical" href="https://weave.clinic/DeepBlue/"/>'
    og_url_tag = '<meta property="og:url" content="https://weave.clinic/DeepBlue/"/>'
    text2 = text.replace(
        '<title>DeepBlue',
        canonical_tag + og_url_tag + '<title>DeepBlue',
        1,
    )
    if text2 != text:
        f.write_text(text2)
        return True
    return False


def main() -> int:
    print("=== Meta fixes (pass 2) ===")
    total = 0
    for rel, (title, desc) in META_FIXES.items():
        path = ROOT / rel
        if not path.exists():
            print(f"  MISSING: {rel}")
            continue
        n = fix_meta(path, title, desc)
        total += n
        print(f"  {rel:50s} {n} edits")
    print(f"  Total: {total}")

    print()
    print("=== GA4 on tmop-explainer ===")
    f = ROOT / "tmop-explainer/index.html"
    if f.exists():
        added = add_ga4(f)
        print(f"  {'GA4 added' if added else 'already present'}")

    print()
    print("=== Canonical on DeepBlue ===")
    added = add_canonical_to_deepblue()
    print(f"  {'canonical + og:url added' if added else 'already present'}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
