#!/usr/bin/env python3
"""Extract keyword contexts from a downloaded HTML page (plain text around keywords).

Usage: extract_text.py <html_path> <keyword> [<keyword> ...]
Run with -I: reads a path passed as an argument, never executes downloaded content.
"""
import html
import re
import sys


def main() -> None:
    path = sys.argv[1]
    keywords = sys.argv[2:]
    raw = open(path, encoding="utf-8", errors="replace").read()
    raw = re.sub(r"<script.*?</script>", " ", raw, flags=re.S)
    raw = re.sub(r"<style.*?</style>", " ", raw, flags=re.S)
    text = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    text = re.sub(r"\s+", " ", text)
    for kw in keywords:
        hits = 0
        for m in re.finditer(re.escape(kw), text):
            s = max(0, m.start() - 280)
            print(f">>> [{kw}] ...{text[s:m.end() + 300]}...")
            print()
            hits += 1
            if hits >= 3:
                break
        if hits == 0:
            print(f">>> [{kw}] no match")


if __name__ == "__main__":
    main()
