#!/usr/bin/env python3
"""Extract all PDF books to plain text files for agent consumption."""
import os, sys
from pypdf import PdfReader

BOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
TXT_DIR = os.path.join(BOOKS_DIR, "txt")
os.makedirs(TXT_DIR, exist_ok=True)

pdfs = sorted(f for f in os.listdir(BOOKS_DIR) if f.endswith(".pdf"))
print(f"Found {len(pdfs)} PDFs to extract\n")

for pdf_name in pdfs:
    pdf_path = os.path.join(BOOKS_DIR, pdf_name)
    txt_name = pdf_name.replace(".pdf", ".txt")
    txt_path = os.path.join(TXT_DIR, txt_name)

    if os.path.exists(txt_path) and os.path.getsize(txt_path) > 1000:
        print(f"SKIP (exists): {txt_name}")
        continue

    print(f"Extracting: {pdf_name} ... ", end="", flush=True)
    try:
        reader = PdfReader(pdf_path)
        num_pages = len(reader.pages)
        text_parts = []
        for i, page in enumerate(reader.pages):
            page_text = page.extract_text() or ""
            text_parts.append(f"\n{'='*60}\nPAGE {i+1} of {num_pages}\n{'='*60}\n{page_text}")

        full_text = "\n".join(text_parts)
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(full_text)

        print(f"OK — {num_pages} pages, {len(full_text):,} chars → {txt_name}")
    except Exception as e:
        print(f"ERROR: {e}")

print("\nDone.")
