"""Merge exact FishBase Chinese common names into the offline taxon index.

The input is the FishBase Chinese common-name table exported from the official
site with ``showAll=yes``. Matching is performed only on the exact scientific
name in the second table column; no translation or fuzzy matching is applied.
Existing Wikidata entries remain authoritative for names already present.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

from opencc import OpenCC


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INDEX = ROOT / "app" / "data" / "species_chinese_names.json"
ASFIS_PATH = ROOT / "app" / "data" / "asfis_2026_1.csv"
FISHBASE_BASE_URL = "https://www.fishbase.se/"
FISHBASE_SOURCE_URL = "https://www.fishbase.se/ComNames/scriptlist.php?script=Chinese&showAll=yes"
FISHBASE_SOURCE_NAME = "FishBase 官方中文名称表"
HAN_RE = re.compile(r"[\u3400-\u9fff]")
TO_SIMPLIFIED = OpenCC("t2s")


class _FishBaseTableParser(HTMLParser):
    """Extract common-name/scientific-name pairs from the commonTable only."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._table_depth = 0
        self._in_table = False
        self._in_row = False
        self._in_cell = False
        self._cell_text: list[str] = []
        self._cell_href: str | None = None
        self._cells: list[tuple[str, str | None]] = []
        self.rows: list[tuple[str, str, str | None]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "table" and "commonTable" in str(attributes.get("class") or "").split():
            self._in_table = True
            self._table_depth = 1
            return
        if self._in_table and tag == "table":
            self._table_depth += 1
            return
        if not self._in_table:
            return
        if tag == "tr":
            self._in_row = True
            self._cells = []
            return
        if tag == "td" and self._in_row:
            self._in_cell = True
            self._cell_text = []
            self._cell_href = None
            return
        if tag == "a" and self._in_cell and self._cell_href is None:
            self._cell_href = attributes.get("href")

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._cell_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if not self._in_table:
            return
        if tag == "td" and self._in_cell:
            text = " ".join("".join(self._cell_text).split())
            self._cells.append((text, self._cell_href))
            self._in_cell = False
            return
        if tag == "tr" and self._in_row:
            if len(self._cells) >= 2:
                common_name, _common_href = self._cells[0]
                scientific_name, scientific_href = self._cells[1]
                if HAN_RE.search(common_name) and scientific_name:
                    self.rows.append((TO_SIMPLIFIED.convert(common_name), scientific_name, scientific_href))
            self._in_row = False
            self._cells = []
            return
        if tag == "table":
            self._table_depth -= 1
            if self._table_depth <= 0:
                self._in_table = False


def _candidate_score(name: str) -> tuple[int, int, int, str]:
    """Prefer a specific species name over a short genus-level alias."""
    compact = name.replace(" ", "").replace("\u3000", "")
    return (
        int("属" not in compact),
        int("（" not in compact and "(" not in compact),
        len(compact),
        compact,
    )


def parse_fishbase_html(path: Path) -> dict[str, dict[str, object]]:
    parser = _FishBaseTableParser()
    parser.feed(path.read_text(encoding="utf-8-sig", errors="replace"))
    candidates: dict[str, list[dict[str, object]]] = {}
    for chinese_name, scientific_name, href in parser.rows:
        candidates.setdefault(scientific_name, []).append({
            "name": chinese_name,
            "source_url": urljoin(FISHBASE_BASE_URL, href or ""),
        })

    result: dict[str, dict[str, object]] = {}
    for scientific_name, options in candidates.items():
        unique = {str(item["name"]): item for item in options}
        selected = sorted(unique.values(), key=lambda item: _candidate_score(str(item["name"])))[-1]
        result[scientific_name] = {
            "name": str(selected["name"]),
            "language": "zh",
            "source_name": FISHBASE_SOURCE_NAME,
            "source_url": str(selected["source_url"]),
            "aliases": sorted(unique),
        }
    return result


def merge_index(index_path: Path, fishbase_html: Path) -> dict[str, object]:
    payload = json.loads(index_path.read_text(encoding="utf-8"))
    entries = dict(payload.get("entries") or {})
    fishbase_entries = parse_fishbase_html(fishbase_html)
    eligible_names: set[str] = set()
    with ASFIS_PATH.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            scientific_name = str(row.get("Scientific_Name") or "").strip()
            if scientific_name and not str(row.get("Chinese_name") or "").strip():
                eligible_names.add(scientific_name.casefold())
    existing_keys = {str(existing).casefold() for existing in entries}
    added = 0
    for scientific_name, entry in fishbase_entries.items():
        key = scientific_name.casefold()
        if key not in eligible_names or key in existing_keys:
            continue
        entries[scientific_name] = entry
        existing_keys.add(key)
        added += 1
    payload.update({
        "version": datetime.now(UTC).strftime("%Y.%m.%d"),
        "generated_at": datetime.now(UTC).isoformat(),
        "source_name": "Wikidata + FishBase",
        "source_url": f"{payload.get('source_url') or 'https://www.wikidata.org/wiki/Wikidata:Main_Page'}; {FISHBASE_SOURCE_URL}",
        "fishbase_source_name": FISHBASE_SOURCE_NAME,
        "fishbase_source_url": FISHBASE_SOURCE_URL,
        "fishbase_candidate_count": sum(key in eligible_names for key in (name.casefold() for name in fishbase_entries)),
        "fishbase_added_count": added,
        "entry_count": len(entries),
        "entries": dict(sorted(entries.items(), key=lambda item: item[0].casefold())),
    })
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fishbase-html", type=Path, required=True)
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    output = args.output or args.index
    payload = merge_index(args.index, args.fishbase_html)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "version": payload["version"],
        "fishbase_candidate_count": payload["fishbase_candidate_count"],
        "fishbase_added_count": payload["fishbase_added_count"],
        "entry_count": payload["entry_count"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
