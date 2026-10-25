#!/usr/bin/env python3
"""Build a small ClinVar RCV-format XML subset via NCBI E-utilities.

For each gene: esearch -> variation IDs; esummary -> RCV accessions;
efetch rettype=clinvarset -> ClinVarSet elements. All RCVs of every selected
variant are included so per-variant comparisons are complete.
Usage: build_subset.py OUTFILE DATED GENE[:CONFLICT_ONLY_LIMIT] ...
"""
import json, re, sys, time, urllib.parse, urllib.request

EU = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'

def get(url, data=None):
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode() if data else None)
            with urllib.request.urlopen(req, timeout=120) as f:
                body = f.read()
            time.sleep(0.4)
            return body
        except Exception as e:
            print('retry', attempt, e, file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(url)

def esearch(term, retmax=100000):
    body = get(EU + 'esearch.fcgi?' + urllib.parse.urlencode(
        {'db': 'clinvar', 'term': term, 'retmax': retmax, 'retmode': 'json'}))
    return json.loads(body)['esearchresult']['idlist']

def summarize(chunk, out):
    body = get(EU + 'esummary.fcgi', {'db': 'clinvar', 'id': ','.join(chunk), 'retmode': 'json'})
    try:
        res = json.loads(body)['result']
    except (KeyError, ValueError):
        if len(chunk) > 1 and b'max size' in body:
            mid = len(chunk) // 2
            summarize(chunk[:mid], out)
            summarize(chunk[mid:], out)
            return
        if len(chunk) == 1 and b'max size' in body:
            print('skipping oversized variant', chunk, file=sys.stderr)
            return
        print('esummary retry', body[:200], file=sys.stderr)
        time.sleep(5)
        return summarize(chunk, out)
    for uid in res.get('uids', []):
        out.update(res[uid]['supporting_submissions'].get('rcv', []))

def rcvs_for(ids):
    out = set()
    for i in range(0, len(ids), 300):
        summarize(ids[i:i + 300], out)
    return out

def main():
    outfile, dated = sys.argv[1], sys.argv[2]
    all_rcvs = set()
    for spec in sys.argv[3:]:
        gene, _, limit = spec.partition(':')
        if limit:
            ids = esearch(f'{gene}[gene] AND clinsig_has_conflicts[prop]')[:int(limit)]
        else:
            ids = esearch(f'{gene}[gene]')
        cache = f'rcvcache_{gene}_{limit or "all"}.json'
        try:
            rcvs = set(json.load(open(cache)))
        except OSError:
            rcvs = rcvs_for(ids)
            json.dump(sorted(rcvs), open(cache, 'w'))
        print(f'{gene}: {len(ids)} variants, {len(rcvs)} RCVs', file=sys.stderr)
        all_rcvs |= rcvs
    all_rcvs = sorted(all_rcvs)
    print(f'total RCVs: {len(all_rcvs)}', file=sys.stderr)
    seen = set()
    n = 0
    with open(outfile, 'w', encoding='utf-8') as out:
        out.write('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n')
        out.write(f'<ReleaseSet Type="full" Dated="{dated}">\n')
        for i in range(0, len(all_rcvs), 200):
            chunk = all_rcvs[i:i + 200]
            body = get(EU + 'efetch.fcgi', {'db': 'clinvar', 'id': ','.join(chunk), 'rettype': 'clinvarset'}).decode('utf-8')
            for m in re.finditer(r'<ClinVarSet .+?</ClinVarSet>', body, re.DOTALL):
                acc = re.search(r'Acc="(RCV\d+)"', m.group(0)).group(1)
                if acc in seen:
                    continue
                seen.add(acc)
                out.write(m.group(0) + '\n')
                n += 1
            print(f'  fetched {i + len(chunk)}/{len(all_rcvs)} -> {n} sets', file=sys.stderr)
        out.write('</ReleaseSet>\n')
    print(f'wrote {n} ClinVarSets', file=sys.stderr)

main()
