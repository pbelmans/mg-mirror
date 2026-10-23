#!/usr/bin/env python3
"""Prepare the pinned MGP snapshot for Hugo and browser-side search (stdlib only)."""

import argparse
from collections import Counter, defaultdict
from datetime import date
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
COMMIT = "4eedeace69aec175001e397623ed6fcbc0dcbf67"
REPOSITORY = "https://github.com/Erdos-Projects/summer26-math-genealogy"
SOURCE = f"https://media.githubusercontent.com/media/Erdos-Projects/summer26-math-genealogy/{COMMIT}/data/processed/data-new.json"
SHA256 = "939d037f7e22fc9bec004c8d2778b8f2f141172f40f3b0bb930c6ec6b7dd4509"
SHARDS = 16
FEATURED = [6967, 18231, 7298, 31245, 8014, 91093]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def country_name(value):
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", value or "")


def prepare(source):
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != SHA256:
        raise ValueError(f"Snapshot checksum mismatch: expected {SHA256}, got {digest}")
    records = json.loads(source.read_text())["nodes"]
    if len(records) != 338532 or len({r["id"] for r in records}) != len(records):
        raise ValueError("Unexpected number of records or duplicate MGP identifiers")
    by_id = {str(r["id"]): r for r in records}
    countries = sorted({country_name(r["country"]) for r in records if r["country"]})
    schools = sorted({r["school"] for r in records if r["school"]})
    subjects = sorted({r["subject"] for r in records if r["subject"]})
    school_ids = {s: i for i, s in enumerate(schools)}
    country_ids = {s: i for i, s in enumerate(countries)}
    subject_ids = {s: i for i, s in enumerate(subjects)}
    school_counts = Counter(r["school"] for r in records if r["school"])
    country_counts = Counter(country_name(r["country"]) for r in records if r["country"])
    subject_counts = Counter(r["subject"] for r in records if r["subject"])
    year_counts = Counter(r["year"] for r in records if r["year"] and 1900 <= r["year"] <= 2026)
    for r in records:
        # Display formatting is added separately; source values are kept intact.
        r["country_display"] = country_name(r["country"])
    index = [[] for _ in range(SHARDS)]
    for r in sorted(records, key=lambda r: r["id"]):
        index[r["id"] % SHARDS].append([
            r["id"], r["name"] or "Name not recorded", r["year"],
            school_ids.get(r["school"], -1), country_ids.get(r["country_display"], -1),
            subject_ids.get(r["subject"], -1), len(r["students"]),
        ])
    output = ROOT / "static/data"
    output.mkdir(parents=True, exist_ok=True)
    index_bytes = 0
    gzip_bytes = 0
    for i, rows in enumerate(index):
        path = output / f"search-{i:02}.json"
        write_json(path, rows)
        raw = path.read_bytes()
        index_bytes += len(raw)
        gzip_bytes += len(gzip.compress(raw))
    catalog = {"schools": schools, "countries": countries, "subjects": subjects,
               "shards": SHARDS, "records": len(records), "commit": COMMIT}
    write_json(output / "catalog.json", catalog)
    # A small ID-only list makes random record selection uniform and independent of search.
    write_json(output / "ids.json", sorted(int(i) for i in by_id))
    # Full relationships for graph expansion; loaded per 1,000 IDs, never all at once.
    graph = defaultdict(dict)
    for r in records:
        graph[r["id"] // 1000][str(r["id"])] = [r["name"] or "Name not recorded", r["year"], r["advisors"], r["students"]]
    for bucket, rows in graph.items():
        write_json(output / "graph" / f"{bucket}.json", rows)
    mirror = {
        "count": len(records), "countries": len(countries), "institutions": len(schools),
        "subjects": len(subjects), "commit": COMMIT, "source": SOURCE,
        "repository": REPOSITORY, "sha256": SHA256, "prepared": date.today().isoformat(),
        "featured": [by_id[str(i)] for i in FEATURED],
        "most_students": sorted(records, key=lambda r: (-len(r["students"]), r["id"]))[:20],
        "top_countries": [{"name": n, "count": c} for n, c in country_counts.most_common(15)],
        "top_schools": [{"name": n, "count": c} for n, c in school_counts.most_common(30)],
        "all_subjects": [{"name": n, "count": subject_counts[n]} for n in subjects],
        "years": [{"year": y, "count": year_counts[y]} for y in sorted(year_counts)],
        "missing": {k: sum(not r[k] for r in records) for k in ("name", "year", "thesis", "school", "country", "subject")},
        "index_bytes": index_bytes, "index_gzip_bytes": gzip_bytes,
    }
    write_json(ROOT / "data/records.json", by_id)
    write_json(ROOT / "data/mirror.json", mirror)
    write_json(output / "provenance.json", {k: mirror[k] for k in ("count", "commit", "source", "repository", "sha256", "prepared", "index_bytes", "index_gzip_bytes")})
    print(f"Prepared {len(records):,} records, {len(schools):,} institutions, {len(countries):,} countries.")
    print(f"Search index: {index_bytes / 1e6:.2f} MB JSON; {gzip_bytes / 1e6:.2f} MB with HTTP gzip.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Use an already downloaded snapshot (checksum verified)")
    parser.add_argument("--force", action="store_true", help="Rebuild generated data")
    args = parser.parse_args()
    manifest = ROOT / "static/data/provenance.json"
    if not args.force and not args.source and manifest.exists() and (ROOT / "data/records.json").exists():
        previous = json.loads(manifest.read_text())
        if previous.get("sha256") == SHA256:
            print(f"Data already prepared: {previous['count']:,} records.")
            return
    cache = ROOT / ".cache/data-new.json"
    if args.source:
        prepare(args.source)
        return
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        temporary = cache.with_suffix(".download")
        print(f"Downloading the pinned snapshot from {REPOSITORY}…", flush=True)
        try:
            with urllib.request.urlopen(SOURCE, timeout=120) as response, temporary.open("wb") as output:
                shutil.copyfileobj(response, output)
            temporary.replace(cache)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
    prepare(cache)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        sys.exit(str(error))
