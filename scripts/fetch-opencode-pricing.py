#!/usr/bin/env python3
"""抓取 OpenCode 官方报价页，生成 reference/ 下的价格快照。

只做一件事：把 opencode.ai 的 Zen / Go 文档里的表格原样落成 markdown，
附上抓取日期与出处。价格会变，重跑本脚本即可刷新。

用法：python3 scripts/fetch-opencode-pricing.py
"""

from __future__ import annotations

import html
import re
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REFERENCE = ROOT / "reference"

SOURCES = {
    "opencode-zen-pricing": "https://opencode.ai/docs/zen/",
    "opencode-go-pricing": "https://opencode.ai/docs/go/",
}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8", "replace")


def tables(page: str) -> list[list[list[str]]]:
    out: list[list[list[str]]] = []
    for raw_table in re.findall(r"<table.*?</table>", page, flags=re.S):
        rows: list[list[str]] = []
        for raw_row in re.findall(r"<tr.*?</tr>", raw_table, flags=re.S):
            cells = [
                html.unescape(re.sub(r"<[^>]+>", "", cell)).strip()
                for cell in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", raw_row, flags=re.S)
            ]
            if cells:
                rows.append(cells)
        if rows:
            out.append(rows)
    return out


def to_markdown(rows: list[list[str]]) -> str:
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "|" + "---|" * width]
    for row in rows[1:]:
        lines.append("| " + " | ".join(c.replace("|", "\\|") for c in row) + " |")
    return "\n".join(lines)


def main() -> None:
    REFERENCE.mkdir(exist_ok=True)
    fetched = date.today().isoformat()

    for slug, url in SOURCES.items():
        page = fetch(url)
        found = tables(page)
        parts = [
            f"# OpenCode 报价快照 — {slug}",
            "",
            f"- 出处：<{url}>",
            f"- 抓取日期：{fetched}",
            "- 说明：本文件由 `scripts/fetch-opencode-pricing.py` 从官方文档自动生成，不要手改。",
            "",
        ]
        for idx, table in enumerate(found):
            header = " ".join(table[0])
            if "$" not in " ".join(" ".join(r) for r in table) and "Free" not in " ".join(
                " ".join(r) for r in table
            ):
                continue
            parts += [f"## 表 {idx}：{header}", "", to_markdown(table), ""]
        (REFERENCE / f"{slug}.md").write_text("\n".join(parts), encoding="utf-8")
        print(f"wrote reference/{slug}.md ({len(found)} tables scanned)")


if __name__ == "__main__":
    main()
