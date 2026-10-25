# ClinVar GKM browser: architecture

Status: draft, 24 October 2026. Where queries run, and why. The question raised at the start was whether the app needs a server at all: in-browser DuckDB could query the parquet straight from R2, a desktop app (Electron) could query local copies, or the two could be combined, with data downloaded piecemeal and kept on the client's disk. This doc compares those options against the data as it is published today. The measurements are in [research/clinvar-gkm-data.md](research/clinvar-gkm-data.md); the survey of browser and desktop technology is in [research/architecture-options.md](research/architecture-options.md).

## Recommendation

**Start with a server; keep the door open for in-browser queries.** A Fastify server with embedded DuckDB serves every page from per-release parquet tables derived from ClinVar-GKM (decided 25 October 2026, [schema.md](schema.md)). App-shaped, sorted parquet could later be published too, so an in-browser DuckDB "explore" mode can be added, behind the same query contract, if benchmarks justify it. No desktop app.

**Decided 24 October 2026:**
- The server ships as a container image that users run locally with podman, with the API and web app on `localhost`.
- It downloads ClinVar-GKM's published parquet as-is into a podman volume and builds its own tables from it.
- A multi-user hosted version comes later, from the same image; decisions now must leave room for it.

See [local-app.md](local-app.md).

The short reasons:
- The published files can't serve interactive pages from the browser. This was measured, not assumed (next section).
- Even reshaped files leave the browser near its limits for the joins ClinVar pages need: 6.9M SCVs against 4.7M variants, a 4 GB WebAssembly memory cap, and DuckDB-WASM's spill-to-disk currently broken.
- Our users share deep links to specific views. A server gives a fast first page; a browser engine first downloads about 5.5 MB of WebAssembly (brotli-compressed), then fetches data.
- A server matches the gencc stack and deployment we already run.

## What the published data allows

ClinVar-GKM publishes 22 parquet files (13.2 GB) at `https://data.clinvar-gkm.org/v1/1.1/parquet/`. CORS allows browser reads and range requests work, so browser access itself is possible. Measured on 24 October 2026 with the DuckDB 1.5.5 CLI as a proxy for DuckDB-WASM:

| Query | Time | Requests | Data read |
| --- | --- | --- | --- |
| Row count, schema | 0.45 s | 3 | 1.3 MB |
| Search a small table (conditions) | 0.4 s | 4 | 0.6 MB |
| One SCV by accession | 3.9 s | 28 | 25 MB |
| One variant by ID | 66–174 s | 41–44 | 37–40 MB |
| All SCVs for one variant (8 threads) | 71 s | 520 | 429 MB |
| All propositions for one variant | over 300 s (timed out) | | |
| Filter by gene symbol | 82 s | 122 | |
| Group-by over all SCVs | 10.9 s (2.0 s with 8 threads) | 115 | |

Why lookups are slow:
- **The rows aren't sorted** by any key. Row-group statistics can't skip anything, so a lookup reads the key column of every row group.
- **Statements don't carry the variant.** SCVs link to their variant only through a proposition table of 27.9M rows.
- **Big files bypass the cache.** Nine files over 512 MB (98% of the bytes) are too large for Cloudflare's edge cache. Range requests on them go to R2 every time, with p95 latency of 5.2 s and stalls up to 58 s. Small, edge-cached files answer in about 120 ms.
- **The bucket is rate-limited and not meant for queries.** It allows 250 requests per 10 s per IP, has a manual cost kill switch, and its docs say R2 is "designed for file downloads, not as a remote query endpoint".
- **There's no fixed version to query.** The parquet is overwritten in place each week, with no dated copies. A browser session that spans a rebuild could read files from two different releases.

Upstream has a design (not built) for pre-joined, key-sorted lookup files of about 578 MB a month, in files under 512 MB. It measures one variant's lookup at 16 requests and 1.2 MB, against 399 requests and 331 MB today. That would make browser lookups feasible, but not browser-side joins and aggregates over the whole dataset.

## Options

| Option | Fits | Doesn't fit |
| --- | --- | --- |
| **(a) Server.** Fastify + DuckDB over a local per-release file | Fast first page; all joins and aggregates; small client; matches gencc | One VM to run; we pay for query load |
| **(b) Browser only.** DuckDB-WASM querying parquet over HTTP range requests | Static hosting; no server | Not viable on the published files (table above). On reshaped files: OK for lookups and small tables, too slow and memory-bound for whole-dataset aggregates and conflict analysis |
| **(c) Browser with a local cache.** DuckDB-WASM plus the browser's private file storage (OPFS), downloading slices on demand | Repeat visits and offline use; heavy users pay their own compute | Persistence works only on Chromium desktop; multiple tabs aren't supported; spilling to disk is broken (wrong results in an open October 2026 issue); a 4 GB wasm32 cap and much less on iOS. A research tool, not a default |
| **(d) Desktop app.** Electron or Tauri with native DuckDB on downloaded data | Unlimited memory and disk; offline | Signing and notarization on macOS and Windows, auto-update, per-platform builds; Electron adds about 85–250 MB plus 66 MB of DuckDB bindings; Tauri uses Safari's engine on macOS. Most of the benefit is available more cheaply (next section) |
| **(e) Hybrid.** Server for pages and search; derived, sorted parquet on our own bucket for an optional in-browser explore mode | Server strengths now, and a browser option later at little extra cost | Two query backends to test. Mitigated by one shared query-spec-to-SQL compiler |

## Desktop app

The case for Electron is power users who want to run heavy or unusual queries without a server's limits. Three cheaper routes cover that:
- **Use the app database directly.** The container derives per-release parquet tables into its volume, beside the raw parquet; the SQL console queries both, and if we later publish derived files, anyone can open them in the DuckDB CLI, Python or R, which is how many of these users already work.
- **Run the server locally.** The server is one container image. `podman run` (or `docker run`) gives the whole app on a laptop; it downloads its own data, with no hosted quotas and no app signing. Chosen 24 October 2026; see [local-app.md](local-app.md).
- **An explore mode in the browser** (stage 2 below) covers ad-hoc filtering for users who won't install anything.

If an Electron shell is still wanted later, it would wrap the same server and web app, so nothing here closes that off.

## Staged path

1. **Stage 0, derivation.** Code in this repo that reads ClinVar-GKM's parquet as published (about 4 minutes to download at the measured 68 MB/s, checked against the sha256 sums in `index.json`) and builds the tables in [data.md](data.md#derived-model) into one DuckDB file, sorted by their main lookup keys. It runs inside the app container ([local-app.md](local-app.md#getting-and-refreshing-data)).
2. **Stage 1, server in a local container.** Fastify with `@duckdb/node-api`. It downloads the source parquet into a podman volume, runs the derivation, and opens the result read-only. Filters are a Zod query spec, compiled to SQL in a shared package and mirrored in URL parameters. New releases are swapped in atomically: download, derive, validate, open, switch, close the old file. A SQL console and private variant lists come with this stage.
3. **Later, if the reshaped data proves much faster:** change ClinVar-GKM's published format upstream, or publish the derived files beside it, so containers (and anyone else) can skip the local derivation. Sorted parquet in files under 512 MB would also serve the in-browser option below.
4. **Hosted, later.** The same image as a multi-user public site, with data prepared by a scheduled job ([local-app.md](local-app.md#designing-for-a-hosted-version-later)).
5. **In-browser engine, only if the numbers justify it.** A DuckDB-WASM worker, lazy-loaded on an explore route, running the same spec-to-SQL compiler against published sorted parquet, with optional OPFS caching. Mosaic is a candidate for linked charts and filters; it can target server or browser DuckDB.

**Decision rule for the in-browser engine:** build it only if warm DuckDB-WASM answers the canonical queries in under about 1 s with fewer than 20 range requests, and the main joins fit in 2 GB of browser memory.

## Search

- **Genes, conditions, submitters** (about 120k names): either a static vocabulary file searched in a web worker (MiniSearch or FlexSearch), or a server endpoint. Start with the server; the static file is cheap to add for instant autocomplete.
- **Accessions, rsIDs, HGVS** (millions of strings): server-side prefix search over a sorted table in DuckDB, with normalization of HGVS input. Free-text search over comments and condition names uses DuckDB full-text search on the server.
- Unlike ClinVar Miner, which redirected only on exact matches and fell back to a Google site search, search shows ranked results by type.

## Experiments

Run in M0 and record results in this repo. Fuller list in [research/architecture-options.md](research/architecture-options.md).

1. Size of each derived table and of the release file; derivation time from download to finished file.
2. Server p50/p95 for about ten canonical queries (variant page, gene page, submitter page, condition page, conflict list for a gene, submitter-versus-submitter, a crosstab with filters, a 100k-row export, search) at concurrency 1, 10 and 50. Sorted tables with zone maps only, then with ART indexes.
3. Whether DuckDB's file stays fast with several concurrent read connections, or whether point lookups favour a second store (Postgres or SQLite) beside it.
4. Conflict pairs: precomputed table size against computing per query (see [data.md](data.md#conflicts)).
5. Derivation time, peak memory and spill size from the published parquet, with DuckDB limited to 4 GB (the podman machine's memory), run natively.
6. Only if the in-browser engine is in view: DuckDB-WASM against the derived parquet on Chrome, Firefox, Safari and iOS, cold and warm, with and without the built-in httpfs (which can fetch whole files) and threads. Record time, range requests, bytes and memory. Compare with hyparquet for lookups.

## Open questions

1. **`@duckdb/node-api` under gencc's `strictDepBuilds`.** It ships prebuilt binaries in per-platform packages. Check that they install without a build script, or record an `allowBuilds` entry.
2. **DuckDB version.** The research reports DuckDB 2.0.0 LTS released 21 October 2026, with 1.5 supported until March 2027. Pin 1.5.x for M0 and move to 2.0 once `@duckdb/node-api` and the parquet files written by upstream are confirmed compatible.
3. **Later: publish derived files, or change ClinVar-GKM's format?** Only once local derivation shows what shape helps. Decided 24 October 2026 to start with the published files as they are.
