import fitz
import sys

path = '/Users/wilfreddsouza/M4-Workspace/weave-site/learn/psychotherapy/sources/books/dbt-adolescents.pdf'
doc = fitz.open(path)

start = int(sys.argv[1])
end = int(sys.argv[2])
chars = int(sys.argv[3]) if len(sys.argv) > 3 else 1600

for i in range(start, min(end, len(doc))):
    text = doc[i].get_text()
    if text.strip():
        print(f'=== PAGE {i+1} ===')
        print(text[:chars])
        print()
