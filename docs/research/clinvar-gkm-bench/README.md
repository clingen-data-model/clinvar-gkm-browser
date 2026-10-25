# ClinVar-GKM remote query benchmark

Scripts used on 24 October 2026 to time DuckDB (CLI 1.5.5) queries against the published parquet at `https://data.clinvar-gkm.org/v1/1.1/parquet`, as a proxy for DuckDB-WASM. Results are in [../clinvar-gkm-data.md](../clinvar-gkm-data.md#3-remote-query-latency-duckdb-155-cli-over-https-as-a-proxy-for-duckdb-wasm-m).

- `run2.sh <label> <threads> <timeout_s> <sql>` runs one query in a fresh DuckDB process with HTTP logging, and prints wall time, request count, bytes and per-request latency percentiles. `{B}` in the SQL is replaced with the base URL. Logs go to `logs/` next to the script (set `BENCH_DIR` to change that); `logs/` is not committed.
- `batch2.sh` is one batch of the queries in the results table.
- `describe.sql` produced [../clinvar-gkm-parquet-describe.txt](../clinvar-gkm-parquet-describe.txt).

Mind the bucket's rate limit (250 requests per 10 s per IP) and its maintainers' note that R2 is for downloads, not a query endpoint. Run these sparingly.
