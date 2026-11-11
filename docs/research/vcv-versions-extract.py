"""Pull chosen VariationArchive records out of a ClinVar VCV release XML (.xml.gz), streaming
(docs/research/vcv-versions-and-scv-removals.md).

Usage: python3 -I docs/research/vcv-versions-extract.py <release.xml.gz> <out dir> <label> <variation id>...
Writes <out dir>/VCV<id padded to 9>_<label>.xml for each id found, each checked to parse as XML.
The release file puts each VariationArchive's start tag on a line of its own, so records are
found line by line (much faster than a full XML parse of ~60 GB) and only they are parsed.
"""

import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

path, out_dir, label, *ids = sys.argv[1:]
wanted = {int(i) for i in ids}
out = Path(out_dir)
start = re.compile(r'<VariationArchive\b[^>]*\bVariationID="(\d+)"')
decompress = [shutil.which("pigz") or "gzip", "-dc", path]
found: dict[int, list[str]] = {}
current: int | None = None
lines: list[str] = []
with subprocess.Popen(decompress, stdout=subprocess.PIPE, text=True, encoding="utf-8") as proc:
    assert proc.stdout is not None
    for line in proc.stdout:
        if current is None:
            m = start.search(line)
            if m and int(m.group(1)) in wanted:
                current, lines = int(m.group(1)), [line]
        else:
            lines.append(line)
        if current is not None and "</VariationArchive>" in line:
            found[current] = lines
            current = None
            if len(found) == len(wanted):
                proc.kill()  # everything wanted is in hand
                break
for vid, record in found.items():
    text = "".join(record)
    root = ET.fromstring(text)  # raises if the cut isn't one well-formed element
    target = out / f"VCV{vid:09d}_{label}.xml"
    target.write_text(text, encoding="utf-8")
    print(f"{target}: {root.get('Accession')}.{root.get('Version')}, {len(text):,} bytes")
missing = wanted - found.keys()
if missing:
    print(f"not found in {path}: {sorted(missing)}", file=sys.stderr)
    sys.exit(1)
