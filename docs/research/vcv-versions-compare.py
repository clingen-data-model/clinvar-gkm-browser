"""Compare each extracted VariationArchive between two releases: version, dates, submission
counts, the germline classification, and which SCVs (accession.version, submitter) were added or
removed (docs/research/vcv-versions-and-scv-removals.md).

Usage: python3 -I docs/research/vcv-versions-compare.py <dir> <label a> <label b> <variation id>...
Reads <dir>/VCV<id padded to 9>_<label>.xml, as vcv-versions-extract.py writes them."""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

d, a, b, *ids = sys.argv[1:]
def read(vid, label):
    r = ET.parse(Path(d) / f"VCV{int(vid):09d}_{label}.xml").getroot()
    scvs = {}
    for ca in r.iter("ClinicalAssertion"):
        acc = ca.find("ClinVarAccession")
        cls = ca.find("Classification/GermlineClassification")
        scvs[acc.get("Accession")] = (acc.get("Version"), acc.get("SubmitterName"), cls.text if cls is not None else None)
    g = r.find("ClassifiedRecord/Classifications/GermlineClassification")
    return {
        "version": r.get("Version"), "last_updated": r.get("DateLastUpdated"), "status": r.get("RecordStatus"),
        "submissions": r.get("NumberOfSubmissions"), "submitters": r.get("NumberOfSubmitters"),
        "germline": (g.findtext("Description"), g.findtext("ReviewStatus")) if g is not None else None,
        "scvs": scvs,
    }
for vid in ids:
    x, y = read(vid, a), read(vid, b)
    print(f"== VCV{int(vid):09d}: version {x['version']} -> {y['version']}, DateLastUpdated {x['last_updated']} -> {y['last_updated']}, "
          f"submissions {x['submissions']} -> {y['submissions']}, submitters {x['submitters']} -> {y['submitters']}")
    if x["germline"] != y["germline"]:
        print(f"   germline: {x['germline']} -> {y['germline']}")
    else:
        print(f"   germline unchanged: {x['germline']}")
    for acc in sorted(x["scvs"].keys() - y["scvs"].keys()):
        v, who, c = x["scvs"][acc]; print(f"   removed {acc}.{v} ({who}: {c})")
    for acc in sorted(y["scvs"].keys() - x["scvs"].keys()):
        v, who, c = y["scvs"][acc]; print(f"   added   {acc}.{v} ({who}: {c})")
    for acc in sorted(x["scvs"].keys() & y["scvs"].keys()):
        if x["scvs"][acc] != y["scvs"][acc]:
            print(f"   changed {acc}: {x['scvs'][acc]} -> {y['scvs'][acc]}")
