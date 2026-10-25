#!/bin/bash
# usage: run2.sh <label> <threads> <timeout_s> <sql>  ({B} -> base URL). Logs HTTP to logs/<slug>/, prints summary.
LABEL="$1"; TH="$2"; TO="$3"; SQL="${4//\{B\}/https://data.clinvar-gkm.org/v1/1.1/parquet}"
D="${BENCH_DIR:-$(cd "$(dirname "$0")" && pwd)}"
SLUG=$(echo "$LABEL" | tr -c 'a-zA-Z0-9' '_' | cut -c1-40)
L=$D/logs/$SLUG; rm -rf $L; mkdir -p $L
cat > $L/q.sql <<SQL
LOAD httpfs;
CALL enable_logging('HTTP', storage='file', storage_path='$L', storage_buffer_size=1);
SET threads=$TH; SET http_retries=4;
.mode box
$SQL;
SQL
S=$(python3 -c 'import time;print(time.time())')
timeout $TO /opt/homebrew/bin/duckdb < $L/q.sql > $L/out.txt 2>&1; RC=$?
E=$(python3 -c 'import time;print(time.time())')
python3 -I - "$L" "$LABEL" "$TH" "$S" "$E" "$RC" <<'PY'
import sys,re,csv,statistics
L,label,th,s,e,rc=sys.argv[1:]
rows=list(csv.DictReader(open(L+'/duckdb_log_entries.csv'))) if __import__('os').path.exists(L+'/duckdb_log_entries.csv') else []
durs=[];bytes_=0;st={};cache={};n=0
for r in rows:
    m=r['message']; n+=1
    d=re.search(r"'duration_ms': (\d+)",m); durs.append(int(d.group(1)) if d else 0)
    s_=re.search(r"'status': (\w+)",m); st[s_.group(1)]=st.get(s_.group(1),0)+1
    if "'type': GET" in m:
        cl=re.search(r"Content-Length=(\d+)",m); bytes_+=int(cl.group(1)) if cl else 0
    c=re.search(r"cf-cache-status=(\w+)",m)
    if c: cache[c.group(1)]=cache.get(c.group(1),0)+1
durs.sort()
q=lambda p: durs[min(len(durs)-1,int(p*len(durs)))] if durs else None
print(f"## {label} | threads={th} | wall={float(e)-float(s):.1f}s | exit={rc}{' (TIMEOUT)' if rc=='124' else ''} | requests={n} | MB={bytes_/1e6:.1f} | req_ms p50={q(.5)} p95={q(.95)} max={durs[-1] if durs else None} sum={sum(durs)/1000:.1f}s | status={st} | cf={cache}")
PY
grep -E '│|Error' $L/out.txt | head -12
