#!/usr/bin/env python3
"""Technical SEO audit for weave.clinic.

Walks every URL declared in sitemap.xml and checks the live response for:
  - HTTP 200
  - <title> present and reasonable length (10-70 chars)
  - meta description present and reasonable length (50-160 chars)
  - canonical link present and correct
  - exactly one <h1>
  - no `noindex` meta or robots header
  - GA4 tag fired
  - OG title + OG description present
  - JSON-LD blocks parse as valid JSON

Run: python3 scripts/seo-audit.py
Exits non-zero if any critical issue (404, noindex, missing title) found.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from urllib.error import HTTPError, URLError
from xml.etree import ElementTree

SITEMAP_URL = "https://weave.clinic/sitemap.xml"

# Length thresholds — over/under flags are warnings, not failures
TITLE_MIN, TITLE_MAX = 10, 70
DESC_MIN, DESC_MAX = 50, 160

GA4_ID = "G-CQF603DJ1W"


def fetch(url: str, timeout: int = 15) -> tuple[int, dict, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "weave-seo-audit/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8", errors="replace")
    except HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        return e.code, dict(e.headers or {}), body
    except URLError as e:
        return 0, {}, f"URLError: {e}"


def get_sitemap_urls() -> list[str]:
    status, _, body = fetch(SITEMAP_URL)
    if status != 200:
        print(f"FATAL: sitemap fetch returned {status}")
        sys.exit(2)
    ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    root = ElementTree.fromstring(body)
    return [el.text.strip() for el in root.findall(f"{ns}url/{ns}loc") if el.text]


def find(text: str, pattern: str, flags=re.DOTALL | re.IGNORECASE) -> str | None:
    m = re.search(pattern, text, flags)
    return m.group(1).strip() if m else None


def count(text: str, pattern: str, flags=re.DOTALL | re.IGNORECASE) -> int:
    return len(re.findall(pattern, text, flags))


def jsonld_blocks(text: str) -> list[tuple[str, bool]]:
    out = []
    for raw in re.findall(
        r'<script type="application/ld\+json">\s*(.+?)\s*</script>',
        text, re.DOTALL,
    ):
        try:
            json.loads(raw)
            out.append((raw[:60], True))
        except Exception:
            out.append((raw[:60], False))
    return out


def audit(url: str) -> dict:
    issues: list[str] = []
    warnings: list[str] = []

    status, headers, body = fetch(url)

    if status != 200:
        return {"url": url, "status": status, "issues": [f"HTTP {status}"], "warnings": []}

    title = find(body, r"<title>(.+?)</title>")
    desc = find(body, r'<meta name="description"\s+content="([^"]+)"\s*/?>')
    canonical = find(body, r'<link rel="canonical"\s+href="([^"]+)"')
    og_title = find(body, r'<meta property="og:title"\s+content="([^"]+)"')
    og_desc = find(body, r'<meta property="og:description"\s+content="([^"]+)"')
    h1_count = count(body, r"<h1[^>]*>")
    noindex = re.search(r'<meta name="robots"\s+content="[^"]*noindex', body, re.IGNORECASE) is not None
    has_ga4 = GA4_ID in body
    ld_blocks = jsonld_blocks(body)

    # CRITICAL
    if not title:
        issues.append("missing <title>")
    elif len(title) > TITLE_MAX:
        warnings.append(f"title length {len(title)} > {TITLE_MAX}")
    elif len(title) < TITLE_MIN:
        warnings.append(f"title length {len(title)} < {TITLE_MIN}")

    if not desc:
        issues.append("missing meta description")
    elif len(desc) > DESC_MAX:
        warnings.append(f"description length {len(desc)} > {DESC_MAX}")
    elif len(desc) < DESC_MIN:
        warnings.append(f"description length {len(desc)} < {DESC_MIN}")

    if not canonical:
        warnings.append("no canonical link")
    elif canonical != url and not canonical.endswith(url.rstrip("/").split("/")[-1] + "/"):
        # Compare permissively — allow with/without trailing slash
        if canonical.rstrip("/") != url.rstrip("/"):
            warnings.append(f"canonical mismatch: {canonical} vs {url}")

    if h1_count == 0:
        issues.append("no <h1> on page")
    elif h1_count > 1:
        warnings.append(f"{h1_count} <h1> tags (should be 1)")

    if noindex:
        issues.append("page has noindex meta robots")

    x_robots = headers.get("X-Robots-Tag", "").lower()
    if "noindex" in x_robots:
        issues.append("X-Robots-Tag: noindex header")

    if not has_ga4:
        warnings.append("GA4 tag not detected")

    if not og_title:
        warnings.append("missing og:title")
    if not og_desc:
        warnings.append("missing og:description")

    invalid_ld = [b for b in ld_blocks if not b[1]]
    if invalid_ld:
        issues.append(f"{len(invalid_ld)} invalid JSON-LD blocks")

    return {
        "url": url,
        "status": status,
        "title_len": len(title) if title else 0,
        "desc_len": len(desc) if desc else 0,
        "h1_count": h1_count,
        "ld_count": len(ld_blocks),
        "ga4": has_ga4,
        "issues": issues,
        "warnings": warnings,
    }


def main() -> int:
    print(f"Fetching sitemap: {SITEMAP_URL}")
    urls = get_sitemap_urls()
    print(f"Found {len(urls)} URLs.")
    print()

    results = []
    bad = 0
    warn = 0
    for u in urls:
        r = audit(u)
        results.append(r)
        if r["issues"]:
            bad += 1
        if r["warnings"]:
            warn += 1

        slug = u.replace("https://weave.clinic", "") or "/"
        if r.get("status") != 200:
            print(f"  [FAIL]   {slug:55s} HTTP {r.get('status')}")
        elif r["issues"]:
            print(f"  [ISSUE]  {slug:55s} {'; '.join(r['issues'])}")
        elif r["warnings"]:
            print(f"  [warn]   {slug:55s} {'; '.join(r['warnings'])}")
        else:
            print(f"  [ok]     {slug:55s} title={r['title_len']}c desc={r['desc_len']}c h1={r['h1_count']} ld={r['ld_count']}")

    print()
    print(f"Summary: {len(urls)} URLs, {bad} with critical issues, {warn} with warnings.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
