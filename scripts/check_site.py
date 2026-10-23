#!/usr/bin/env python3
"""Check generated pages, index coverage, and source relationships."""
from html.parser import HTMLParser
import argparse
import json
from pathlib import Path
import os
import random
import re

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--public", type=Path, default=ROOT / "public", help="Generated site directory")
args = parser.parse_args()
records = json.loads((ROOT / "data/records.json").read_text())
public = args.public.resolve()
assert (public / "index.html").is_file(), "Run hugo first"
expected = {int(i) for i in records}
generated = {int(p.name) for p in (public / "people").iterdir() if p.is_dir() and p.name.isdecimal() and (p / "index.html").is_file()}
assert generated == expected, f"Missing {len(expected - generated)} record pages; extra {len(generated - expected)}"
catalog = json.loads((public / "data/catalog.json").read_text())
index_ids = []
for shard in range(catalog["shards"]):
    rows = json.loads((public / f"data/search-{shard:02}.json").read_text())
    index_ids.extend(r[0] for r in rows)
assert len(index_ids) == len(expected) and set(index_ids) == expected, "Search index coverage mismatch"
graph_ids = set()
for path in (public / "data/graph").glob("*.json"):
    graph_ids.update(int(i) for i in json.loads(path.read_text()))
assert graph_ids == expected, "Graph data coverage mismatch"
size = sum((Path(directory) / name).stat().st_size for directory, _, files in os.walk(public) for name in files)
assert size < 1_000_000_000, f"Site exceeds GitHub Pages' 1 GB limit: {size:,} bytes"
assert (public / "CNAME").read_text().strip() == "mg.ncag.info", "Incorrect custom domain"


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.text = []
        self.ids = set()
        self.duplicate_ids = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            if attrs["id"] in self.ids:
                self.duplicate_ids.append(attrs["id"])
            self.ids.add(attrs["id"])
        if tag == "a" and "href" in attrs:
            self.links.append(attrs["href"])
    def handle_data(self, text):
        self.text.append(text)


sample = [6967, 18231, 7298, 31245, 8014, 91093, 193664]
sample += random.Random(0).sample(sorted(expected), 30)
for record_id in sample:
    record = records[str(record_id)]
    html = (public / f"people/{record_id}/index.html").read_text()
    page = Page()
    page.feed(html)
    assert not page.duplicate_ids, (record_id, page.duplicate_ids)
    text = " ".join(page.text)
    assert (record["name"] or "Name not recorded") in text
    assert f"data-person={record_id}" in html or f'data-person="{record_id}"' in html
    for relation in record["advisors"] + record["students"]:
        if relation in expected:
            assert f"/people/{relation}/" in page.links, f"Missing relationship {record_id} → {relation}"
for path in ("index.html", "search/index.html", "browse/index.html", "statistics/index.html", "about/index.html", "id.php/index.html", "404.html"):
    page = Page()
    page.feed((public / path).read_text())
    assert not page.duplicate_ids, (path, page.duplicate_ids)
    for link in page.links:
        match = re.fullmatch(r"/people/(\d+)/", link)
        if match:
            assert int(match[1]) in expected, (path, link)
            continue
        if link.startswith("/") and not link.startswith("//"):
            target = link.split("?", 1)[0].split("#", 1)[0]
            assert (public / target.lstrip("/") / "index.html").is_file() or (public / target.lstrip("/")).is_file(), (path, link)
print(f"Verified all {len(expected):,} record pages, search and graph coverage, and {len(sample)} sample records with their relationship links. Site: {size / 1e6:.1f} MB.")
