"""Build an offline Chinese taxon-name index from exact Wikidata P225 matches."""

from __future__ import annotations

import argparse
import csv
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from opencc import OpenCC


ROOT = Path(__file__).resolve().parents[1]
ASFIS_PATH = ROOT / "app" / "data" / "asfis_2026_1.csv"
OUTPUT_PATH = ROOT / "app" / "data" / "species_chinese_names.json"
SPARQL_URL = "https://query.wikidata.org/sparql"
SOURCE_URL = "https://www.wikidata.org/wiki/Wikidata:Main_Page"
LANGUAGE_PRIORITY = {"zh-cn": 0, "zh-hans": 1, "zh": 2}
CJK_RE = re.compile(r"[\u3400-\u9fff]")
TO_SIMPLIFIED = OpenCC("t2s")


def _scientific_names() -> list[str]:
    with ASFIS_PATH.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = csv.DictReader(handle)
        return sorted({
            str(row.get("Scientific_Name") or "").strip()
            for row in rows
            if str(row.get("Scientific_Name") or "").strip()
            and not str(row.get("Chinese_name") or "").strip()
        })


def _sparql(names: list[str]) -> str:
    values = " ".join(json.dumps(name, ensure_ascii=False) for name in names)
    return f"""
SELECT DISTINCT ?taxonName ?item ?zhLabel WHERE {{
  VALUES ?taxonName {{ {values} }}
  ?item wdt:P225 ?taxonName ; rdfs:label ?zhLabel .
  FILTER(LANG(?zhLabel) IN (\"zh-cn\", \"zh-hans\", \"zh\"))
}}
""".strip()


def _fetch_batch(names: list[str], retries: int = 4) -> dict[str, dict[str, str]]:
    query = _sparql(names)
    error: Exception | None = None
    for attempt in range(retries):
        try:
            url = f"{SPARQL_URL}?{urlencode({'query': query, 'format': 'json'})}"
            request = Request(url, headers={
                "Accept": "application/sparql-results+json",
                "User-Agent": "ocean-intelligence-agent/1.0",
            })
            with urlopen(request, timeout=60.0) as response:
                bindings = json.load(response).get("results", {}).get("bindings", [])
            candidates: dict[str, list[dict[str, str]]] = {}
            for binding in bindings:
                scientific_name = str(binding.get("taxonName", {}).get("value") or "").strip()
                chinese_name = TO_SIMPLIFIED.convert(str(binding.get("zhLabel", {}).get("value") or "").strip())
                language = str(binding.get("zhLabel", {}).get("xml:lang") or "").lower()
                entity_url = str(binding.get("item", {}).get("value") or "").replace("http://", "https://")
                if scientific_name not in names or not CJK_RE.search(chinese_name):
                    continue
                candidates.setdefault(scientific_name, []).append({
                    "name": chinese_name,
                    "language": language,
                    "source_url": entity_url,
                })
            return {
                scientific_name: sorted(
                    options,
                    key=lambda item: (
                        LANGUAGE_PRIORITY.get(item["language"], 9),
                        len(item["name"]),
                        item["source_url"],
                    ),
                )[0]
                for scientific_name, options in candidates.items()
            }
        except Exception as exc:  # noqa: BLE001 - preserve retries for upstream errors
            error = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Wikidata batch failed after {retries} attempts: {error}")


def build_index(batch_size: int, workers: int) -> dict[str, object]:
    scientific_names = _scientific_names()
    batches = [scientific_names[index:index + batch_size] for index in range(0, len(scientific_names), batch_size)]
    entries: dict[str, dict[str, str]] = {}
    failures: list[str] = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(_fetch_batch, batch): batch for batch in batches}
        for completed, future in enumerate(as_completed(futures), start=1):
            batch = futures[future]
            try:
                entries.update(future.result())
            except Exception as exc:  # noqa: BLE001 - report every failed batch in the artifact
                failures.append(f"{batch[0]}..{batch[-1]}: {exc}")
            print(f"[{completed}/{len(batches)}] Chinese names: {len(entries)}; failures: {len(failures)}", flush=True)
    return {
        "version": datetime.now(UTC).strftime("%Y.%m.%d"),
        "generated_at": datetime.now(UTC).isoformat(),
        "source_name": "Wikidata",
        "source_url": SOURCE_URL,
        "matching_rule": "Exact scientific-name match via Wikidata P225; zh-cn, zh-hans, then zh label priority.",
        "normalization": "OpenCC t2s conversion for a consistent Simplified Chinese interface.",
        "asfis_missing_chinese_names": len(scientific_names),
        "entry_count": len(entries),
        "failed_batch_count": len(failures),
        "failed_batches": failures,
        "entries": dict(sorted(entries.items(), key=lambda item: item[0].casefold())),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=120)
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()
    payload = build_index(max(20, args.batch_size), max(1, min(args.workers, 4)))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: payload[key] for key in ("version", "entry_count", "failed_batch_count")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
