# ClinVar-GKM Browser: Architecture Research (DuckDB-WASM vs server vs hybrids)

Research date: 2026-10-24. Labels used below:
- **[V]** = verified from a primary or near-primary source (link and date given)
- **[M]** = measured by me in this session
- **[I]** = my inference or judgement, not a sourced fact

---

## 0. TL;DR recommendation

Build **(e) a server-first hybrid**:

1. A Fastify 5 API with **native DuckDB (`@duckdb/node-api` 2.0) over local copies of app-specific derived parquet / a `.duckdb` file**, plus precomputed aggregate tables. This serves every page (gene, condition, submitter, variant, conflicts) and search/autocomplete.
2. From day one, make the pipeline emit **app-tailored derived parquet files** (flattened, sorted, row groups sized for range reads, files under 512 MB, versioned immutable paths) and publish them to R2 behind a custom domain with a cache rule. The server reads them, and so could a browser later.
3. Put a **query-backend interface** in the shared contracts package, so the same filter spec can run either as an HTTP call to the API or as SQL in a DuckDB-WASM worker. Add the browser engine later, behind a flag ("explore mode": heavy ad-hoc filtering or offline use with OPFS), and only if benchmarks justify it.

Do not start with pure-browser (b) or browser+OPFS (c) as the only path. As of Oct 2026 DuckDB-WASM has open correctness and performance bugs in exactly the features (c) needs. Its npm `latest` tag is a dev build. iOS Safari memory is tight. Do not build a desktop app (d). Signing and update overhead buys little over native DuckDB or Python against the public R2 parquet, which power users can already use.

---

## 1. DuckDB-WASM: state as of October 2026

### Versions
- **[V] DuckDB core:** 1.5.0 shipped 2026-03-09, with patches through 1.5.6 (2026-09-28). **DuckDB 2.0.0 LTS ("Cinnamon Teal") shipped 2026-10-21**, with support until at least Oct 2027. 1.5 support was extended to March 2027. Sources: [1.5.0](https://duckdb.org/2026/03/09/announcing-duckdb-150), [1.5.6](https://duckdb.org/2026/09/28/announcing-duckdb-156), [2.0.0](https://duckdb.org/2026/10/21/announcing-duckdb-200). Your local native 1.5.x is therefore one major version behind as of three days ago.
- **[V/M] DuckDB-WASM npm versioning is confusing.** On 2026-10-24, `npm view @duckdb/duckdb-wasm dist-tags` gives `latest: 1.33.1-dev57.0` (published 2026-06-22) and `next: 1.33.1-dev110.0` (2026-10-22). The last tagged GitHub release is v1.33.0 (16 Dec 2025), which its notes describe as having "no real differences from 1.32.0" ([releases](https://github.com/duckdb/duckdb-wasm/releases)). So the default `latest` install is a dev build.
  - [V] `latest` (dev57) embeds DuckDB v1.5.4 ([issue #2277](https://github.com/duckdb/duckdb-wasm/issues/2277)).
  - [M] I installed `next` (dev110) and ran `SELECT version()`, which returned **`v2.0.0-dev88614`**. PR #2285 "Bump to duckdb v2.0.0" was merged 2026-10-21.
  - [V] The docs site says "The latest stable version of the DuckDB WebAssembly client is 2.0.0" ([docs 2.0 overview](https://duckdb.org/docs/2.0/clients/wasm/overview.html)), but no stable npm tag matches that yet. **Plan to pin exact versions.**
- [V] The repo is very active: 20+ commits in the week of Oct 14–22, 2026, covering a built-in HTTPFS build, threaded extension loading, and an Emscripten 6.0.9 move. There are 204 open issues (gh API, 2026-10-24).

### Memory
- **[V] 4 GB cap.** The docs say "WebAssembly limits the amount of available memory to 4 GB and browsers may impose even stricter limits" ([docs](https://duckdb.org/docs/2.0/clients/wasm/overview.html)).
- **[V/M] No memory64 build of DuckDB-WASM exists.** The `next` package ships only `duckdb-base.wasm` and `duckdb-threads.wasm`, both wasm32 [M]. A GitHub search for memory64 in duckdb-wasm finds only an unrelated 2 GiB `registerFileBuffer` issue (#1705).
- **[V] Browser memory64 support** ([caniuse](https://caniuse.com/wf-wasm-memory64)): Chrome 133+, Firefox 134+. **Safari: not supported through 26.5 / iOS 26.5.** [V] SpiderMonkey measured memory64 code as often 10% to over 2x slower than wasm32 ([spidermonkey.dev, 2025-01-15](https://spidermonkey.dev/blog/2025/01/15/is-memory64-actually-worth-using.html)). [I] Even if DuckDB ships memory64, Safari users stay on the 4 GB path, so design for the 4 GB limit or less.
- **[V] Practical per-tab limits.** These come from WebKit bug reports, not documented caps:
  - Chrome desktop allows 4 GB. Chrome mobile is roughly 500–700 MB in practice.
  - Firefox historically capped at 2 GB.
  - Safari kills the tab rather than failing `memory.grow()` ([WebKit 221530](https://bugs.webkit.org/show_bug.cgi?id=221530)).
  - iOS 17 sometimes has only about 300 MB reliably, and about 1 GB on first load ([WebKit 269777](https://bugs.webkit.org/show_bug.cgi?id=269777)).
  - [I] Treat iOS as a lookup-only target.
- **[V] Spilling to disk is not usable.**
  - `temp_directory='opfs://…'` fails unless every temp file is pre-registered ([#2061](https://github.com/duckdb/duckdb-wasm/issues/2061), open, last comment 2026-10-08 asking for an ETA).
  - When pre-registered, the query traps with "memory access out of bounds" after spilling a few hundred MB ([#2271](https://github.com/duckdb/duckdb-wasm/issues/2271), Oct 2026).
  - With `temp_directory` set, a spilled hash join returns **wrong row counts** and then hangs, on both `latest` and `next`, while native DuckDB is correct ([#2277](https://github.com/duckdb/duckdb-wasm/issues/2277), open, 2026-10-17).
  - **Conclusion: in the browser, every query must fit in memory.**

### Threading and COOP/COEP
- [V] "By default, the WebAssembly client only uses a single thread. Multithreading is available but still experimental" ([overview](https://duckdb.org/docs/2.0/clients/wasm/overview.html)).
- [V] The threaded bundle requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Without them the client "simply runs single-threaded." Extensions published only for `wasm_mvp`/`wasm_eh` "will not load into" the threaded bundle ([instantiation docs](https://duckdb.org/docs/2.0/clients/wasm/instantiation.html)). [M] In the `next` build, the bundle names have changed to `base`/`threads` (the docs still describe `mvp`/`eh`/`coi`), which shows the API is in flux.
- [V] `COEP: credentialless` is the lower-friction option, but third-party compatibility tables say Safari does not support it ([MDN COEP](https://developer.mozilla.org/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)). [I] Under `require-corp`, every cross-origin resource (R2 parquet, fonts, any embedded widget) needs CORP/CORS headers. That is manageable, but it is a cost.

### HTTP / range-request behaviour over remote parquet
- [V] The docs say "The JavaScript httpfs implementation fetches only the required byte ranges", but "reading through the built-in httpfs extension may currently download the whole file instead" ([overview](https://duckdb.org/docs/2.0/clients/wasm/overview.html), citing [#2153](https://github.com/duckdb/duckdb-wasm/issues/2153), open since 2025-12-16).
- **[V] A concrete regression.** In [#2228](https://github.com/duckdb/duckdb-wasm/issues/2228) (open, comment dated 2026-08-16), one user tested `count(*)` on a 703 MB public parquet file on source.coop with duckdb-wasm 1.32.0:
  - With the built-in backend it downloaded **the whole 703 MB** (~27 s). Large scans also failed with a misleading "ZSTD Decompression failure."
  - With `SET builtin_httpfs = false; LOAD httpfs;` it fetched 1.3 MB in 3 range requests (~2 s), matching native CLI behaviour.
  - Range detection also depends on reading `Content-Range` from a probe, so **R2's CORS policy must expose `Content-Range`** (plus `Content-Length`, `ETag`, `Accept-Ranges`).
- **[V] I/O is synchronous and sequential.** In open issue [#1723](https://github.com/duckdb/duckdb-wasm/issues/1723) (2024), a maintainer says: "we're always sitting in a C++ callstack when doing I/O which restricts us to single blocking http reads (via XHR)". The reporter found it faster to download a whole 500 MB / 34-row-group file than to range-read a subset of columns. [I] Each row-group or column-chunk read therefore costs a full round trip, roughly 30–150 ms to R2. A query touching 40 column chunks can spend seconds just on latency. DuckDB 2.0 advertises async I/O natively, but nothing confirms it applies to the WASM file system. **This needs a benchmark.**
- [V] On Firefox, a range-request failure seen with GitHub-hosted files was fixed by Firefox sending `Accept-Encoding: identity` ([#1932](https://github.com/duckdb/duckdb-wasm/issues/1932), comments 2026-03). That issue is not R2-specific.
- [V] An older issue reports corrupt cache reads of the native `.duckdb` format over HTTP ([#1957](https://github.com/duckdb/duckdb-wasm/issues/1957), open, 2025-06). [I] Prefer parquet over ATTACHing a remote `.duckdb` file in the browser.

### OPFS
- [V] The DuckDB blog post "Persistent Databases in the Browser with DuckDB-Wasm and OPFS" ([2026-09-18](https://duckdb.org/2026/09/18/opfs-wasm)) covers the following:
  - `opfs://file.duckdb` gives a real persistent DB file plus a WAL. `COPY … TO 'opfs://x.parquet'` and reading from `opfs://` also work.
  - Tested versions are 1.32.0 and 1.33.1-dev64.0+. **The npm `latest` build (dev57) "creates the OPFS files but never writes to them, so nothing persists."**
  - A file can have only one handle at a time, and multi-tab behaviour is "deferred to a follow-up post."
  - You must `CHECKPOINT` explicitly because tabs close without shutdown.
  - The browser can evict OPFS. DuckDB-WASM cannot itself move files into or out of OPFS; you download with `fetch` and write them yourself.
- [V] A third-party project (AdhocDB) reports persistent OPFS DuckDB working only in Chromium desktop, with Firefox and Chrome Android falling back to in-memory ([github.com/mstrahov/adhocdb](https://github.com/mstrahov/adhocdb)). This is unconfirmed by DuckDB.
- [V] OPFS `FileSystemSyncAccessHandle` is Baseline "widely available since March 2023", dedicated workers only ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle)).
- [V] Quotas ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)):
  - Chrome: up to 60% of disk per origin.
  - Firefox: best-effort storage gets min(10% of disk, 10 GiB); persistent storage gets up to 50%.
  - Safari 17+: about 60%.
  - **Safari deletes script-written storage for origins with no user interaction in 7 days of browser use** when tracking prevention is on. `navigator.storage.persist()` prompts in Firefox and is auto-decided in Chrome and Safari.
  - [I] Several GB of ClinVar parquet fits easily in OPFS on desktop. Treat it as a cache, never as the source of truth.

### Extensions
- [V] Core extensions listed for WASM: autocomplete, excel, **fts**, icu, inet, json, parquet, **spatial**, sqlite, tpcds, tpch. httpfs is a JS re-implementation. Extensions are fetched from a CDN on `LOAD` and their signatures are checked ([extensions docs](https://duckdb.org/docs/2.0/clients/wasm/extensions.html)). [I] FTS works, but building an FTS index over millions of rows inside the tab is impractical. You would prebuild it, and the ATTACH-a-remote-`.duckdb` path is the fragile one (#1957).

### Bundle size and cold start
- [M] `@duckdb/duckdb-wasm@1.33.1-dev110.0`:
  - `duckdb-base.wasm` is 33.75 MB raw, **8.41 MB gzip -9, 5.51 MB brotli -11**. The threads build is about the same.
  - The npm package unpacks to 149 MB.
  - Node blocking init plus first query from local disk took about 460 ms on an M-series Mac.
- [V] In Chromium A/B testing in PR [#2278](https://github.com/duckdb/duckdb-wasm/pull/2278) (Oct 2026, open), page-to-first-query was about 745 ms. The PR, by letting Chrome code-cache the module, gets repeat loads to about 655 ms and cuts `db.open()` from 230 to 87 ms. PR [#2287](https://github.com/duckdb/duckdb-wasm/pull/2287) experiments with WICG Cross-Origin Storage to share the module across sites.
- [V] The Harvard LIL Data.gov archive explorer (DuckDB-WASM over about 1 GB of sorted parquet metadata on source.coop; [blog 2025-10-24](https://lil.law.harvard.edu/blog/2025/10/24/rethinking-data-discovery-for-libraries-and-digital-humanities/)) reports that "the large DuckDB-Wasm binary adds significant latency." The team is evaluating hyparquet and Arquero instead.

### Known pain points (summary)
1. Release and tag confusion (the `latest` tag is a dev build), with regressions between versions: range detection and OPFS persistence.
2. `builtin_httpfs` downloading whole files.
3. Sequential, synchronous range reads.
4. 4 GB cap with no working spill, plus wrong-result bugs when spilling.
5. Threads need cross-origin isolation, and extension-platform mismatches.
6. A 5.5–8.4 MB compressed engine on first visit.
7. Safari/iOS memory instability.
8. Practitioner reports (HN, Oct 2025, [thread](https://news.ycombinator.com/item?id=45774571)): a team dropped DuckDB-WASM for a REST API, citing feature-parity gaps, OOMs and first-load time.

---

## 2. Alternatives for browser-side querying

| Tool | Status (2026-10) | Strengths | When it beats DuckDB-WASM |
|---|---|---|---|
| **hyparquet** (+ hyparquet-compressors) | [V/M] npm 1.31.5, 2026-10-18; pure JS, zero deps, MIT ([repo](https://github.com/hyparam/hyparquet)) | Tiny, about 10 KB for the core per a third-party note. Async range reads via `asyncBufferFromUrl`. `columns`/`rowStart`/`rowEnd`. Assembles structs. ZSTD via the add-on package. Powers hyperparam.app and HighTable. | Point lookups and paging over a **pre-sorted, pre-sharded** file: "show gene X's variants" or "page 3 of this table". There is no SQL, joins or aggregation, so you write the pruning logic yourself. Near-zero cold start. |
| **parquet-wasm** + Arrow JS | [V/M] npm 0.9.0 (2026-09-25); Rust arrow/parquet | About 1.2 MB brotli full, about 456 KB read-only. Outputs Arrow, which pairs with Arquero or Mosaic. | Decoding whole row groups to Arrow quickly when you do your own filtering. Smaller than DuckDB. No SQL. |
| **DataFusion WASM** | [V] `datafusion-wasm` npm page says "on the way"; only experiments exist ([splitgraph](https://github.com/splitgraph/experimental-datafusion-webassembly)) | | Not production-ready for this use. |
| **SQLite-WASM + OPFS** | [V/M] `@sqlite.org/sqlite-wasm` 3.54.1 (2026-10-19). VFS options `opfs`, `opfs-sahpool` (fastest, no COOP/COEP), `opfs-wl` (3.53+) ([persistence docs](https://sqlite.org/wasm/doc/trunk/persistence.md)) | B-tree indexes make **indexed point lookups** very cheap. Mature and small. | Read-heavy indexed lookups over a downloaded DB (for example a per-gene or "my genes" offline cache). Poor at wide aggregations compared with columnar engines. |
| **sql.js-httpvfs** (range-request SQLite) | [V] Read-only. The original dates from 2021, and its README itself recommends rebuilding on wa-sqlite ([npm](https://npmjs.com/package/sql.js-httpvfs)) | With a well-indexed DB, a lookup costs a few KB in a few requests. | Static "lookup by key" with no server. Fragile, and slow for anything that is not indexed: "only works well if your database and indexes are structured well." |
| **Mosaic / vgplot** | [V/M] `@uwdata/mosaic-core` 0.34.1. Coordinator can target DuckDB-WASM **or** a server (`duckdb-server`, Python; the Node server is discouraged due to "persistent quality issues" with the Node DuckDB client) ([mosaic server](https://idl.uw.edu/mosaic/server)) | Linked, crossfiltered views with pre-aggregated materialized views. Benchmarks reach billion-row scale with server DuckDB ([IEEE VIS 2023](https://content.ieeevis.org/year/2023/paper_v-full-1150.html)). | Not an alternative engine; it is a viz layer that works with **either** backend. Good fit for a "dashboard/explore" page. [I] Its client/server switch is a pattern to copy. |
| **Perspective** | [V/M] Now `@perspective-dev/*` 5.6.1 (2026-10-23). The old `@finos/perspective` stopped at 3.8.0. 5.0 added a **DuckDB virtual server** (pushdown SQL to Python DuckDB or duckdb-wasm) ([MotherDuck newsletter Aug 2026](https://motherduck.com/blog/duckdb-ecosystem-newsletter-august-2026.md)) | Pivot/grid UI streaming from DuckDB. | For a power-user pivot grid. Heavy. Optional later. |

[I] **Rule of thumb.** Use hyparquet when the data layout already does the work: sorted and sharded so that one or two range reads answer the question. Use DuckDB-WASM when users need arbitrary SQL, group-by or joins on data that fits in about 1–2 GB of memory. Use SQLite-WASM for indexed lookups on a downloaded subset. Use a server when the data does not fit, for iOS, for first-visit latency, or for search.

---

## 3. Cloudflare R2 specifics

- **[V] Pricing** ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)):

  | | Standard | Infrequent Access |
  |---|---|---|
  | Storage | $0.015/GB-mo | $0.01 |
  | Class A | $4.50/M | $9.00/M |
  | **Class B (GetObject, HeadObject)** | **$0.36/M** | $0.90/M + $0.01/GB retrieval |
  | **Egress** | **free** | free |

  - The free tier (Standard only) covers 10 GB-month of storage, 1M Class A and 10M Class B per month.
  - [V] Each range GET is billed as a GET ([Protomaps cloud storage docs](https://docs.protomaps.com/pmtiles/cloud-storage)).
  - [I] Example: 100k sessions × 200 range GETs = 20M Class B = **$3.60/month** with no CDN caching. Request cost is negligible at ClinVar-scale traffic. **Latency, not cost, is the constraint.** Stay on Standard, because IA charges per-GB retrieval and Class B costs 2.5× more.
- **[V] Public access:**
  - The `r2.dev` URL "is rate-limited and should only be used for development". Caching, WAF and access controls require a **custom domain** ([public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)).
  - Public buckets cannot list contents at the root, so publish a manifest JSON.
  - Disable r2.dev when using a custom domain.
- **[V] CDN caching:**
  - Only certain extensions are cached by default and **`.parquet` is not one of them**, so you need a Cache Rule ("cache everything") ([default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)).
  - **Max cacheable file size is 512 MB on Free/Pro/Business** (5 GB Enterprise). The limit applies to the full file size, and "Requesting a small range does not bypass this limit."
  - Cloudflare can fetch from the origin in 1 MiB-aligned ranges and serve ranges from partially cached files. On a cold miss the first origin request may omit `Range` ([range requests](https://developers.cloudflare.com/cache/reference/range-requests/), updated 2026-09-14).
  - **[I] Implication: keep each published app file under 512 MB**, and use versioned, immutable paths (`/v2026-10-01/…`) with long TTLs. Smart Tiered Cache is recommended.
- **[V] CORS** ([R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)):
  - JSON policy with `AllowedOrigins`, `AllowedMethods`, `AllowedHeaders`, `ExposeHeaders` and `MaxAgeSeconds`. Browsers may cap `MaxAgeSeconds` at 2 h.
  - Purge the cache after a CORS change.
  - Suggested policy: GET and HEAD; allow headers `range`, `if-match`, `if-none-match`; expose `Content-Range`, `Content-Length`, `ETag`, `Accept-Ranges`.
  - The `Content-Range` exposure matters for DuckDB-WASM's range detection (#2228).
- **[V/I] Presigned vs public.** Presigned URLs still need CORS. DuckDB-WASM range detection has a history of breaking on presigned S3 URLs because HEAD returns 403 (#2228, [#1367](https://github.com/duckdb/duckdb-wasm/issues/1367)). The data is public, so **use public plus a custom domain**.

---

## 4. Desktop: Electron vs Tauri (and PWA)

- [V/M] **Electron** 45.0.0 is current on npm. Reported installers range from about 85 MB (hello world) to about 250 MB, with higher idle memory ([third-party comparisons](https://tech-insider.org/tauri-vs-electron-2026/), methodology varies). `@duckdb/node-api` 2.0.0-r.1 (2026-10-21) uses Node-API bindings. [M] `@duckdb/node-bindings-darwin-arm64` unpacks to 66 MB per platform, which adds to the app. [I] Node-API is ABI-stable, so Electron rebuilds are usually unnecessary; verify in an experiment.
- [V/M] **Tauri** CLI is 2.12.4. Installers are about 3–10 MB because Tauri uses the OS webview. Native DuckDB would come from the Rust `duckdb` crate ([crates.io](https://crates.io/crates/duckdb), [M] 1.20000.0 published 2026-10-22; [I] the version scheme appears to encode DuckDB 2.0.0). [I] Caveats:
  - The macOS webview is WKWebView and Linux uses WebKitGTK, so any in-webview WASM inherits Safari limits.
  - The backend is Rust, a second language outside your TS monorepo.
- [V] **Signing burden:**
  - macOS needs an Apple Developer ID plus notarization (Apple program $99/yr; general knowledge).
  - Windows: Microsoft's Artifact (formerly Trusted) Signing costs about $9.99/month. **Individuals are eligible only in the US and Canada.** It builds SmartScreen reputation over time, and **EV certificates no longer bypass SmartScreen instantly (since 2024)** ([Microsoft Learn: code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)). A third-party claim that individual onboarding was paused in March 2026 is unverified.
  - Auto-update means electron-updater or tauri-plugin-updater plus a signed update feed.
- **[I] PWA + OPFS** gives most of the "download it, use it offline, persist across sessions" benefit with none of the signing or update overhead. It does not lift the 4 GB memory cap, and Safari eviction rules apply. Users who truly need unlimited local querying can already point the DuckDB CLI, Python or R at the public R2 parquet. **A well-documented "query the data yourself" page (with copy-paste SQL) is a better investment than a desktop app.**

---

## 5. Precedents

| Project | Architecture | Scale | Lessons |
|---|---|---|---|
| **ClinVar Miner** (predecessor) | [V] Python Flask + **SQLite** (`db.py` uses `sqlite3`), server-rendered ([eilbecklab/clinvar-miner](https://github.com/eilbecklab/clinvar-miner)) | All ClinVar releases | A classic server was sufficient. |
| **gnomAD browser** | [V] React + GraphQL API backed by **Elasticsearch 6 + Redis** ([broadinstitute/gnomad-browser](https://github.com/broadinstitute/gnomad-browser) graphql-api/package.json) | Hundreds of millions of variants | The leading genomics browser is server-backed. No DuckDB-WASM. |
| **igv.js / JBrowse 2** | [V] Static hosting with **range requests on indexed files** (BAM/BAI, tabix, bigWig). Requires CORS exposing Range ([igv.js data server reqs](https://igv.org/doc/igvjs/Data-Server-Requirements/), [JBrowse](https://jbrowse.org/jb2/docs/config_guides/serving_data/)) | Multi-GB files per track | Range-reads from static storage work well in genomics **when the file has a purpose-built index** and access is by locus. Supports the idea of per-gene / position-sorted shards. |
| **Protomaps / PMTiles** | [V] Single-file archives on **R2**; a Cloudflare Worker turns tile URLs into range reads; R2 recommended for zero egress ([docs](https://docs.protomaps.com/deploy/cloudflare)) | Planet file about 110–120 GB | Range-read-from-R2 at large scale works. They put a Worker plus edge cache in front rather than having clients range-read directly, for caching and latency. [V] Cloudflare/R2 latency was reported as slower than AWS. |
| **Harvard LIL Data.gov archive explorer** | [V] DuckDB-WASM over sorted, compressed parquet on source.coop, no server ([blog 2025-10-24](https://lil.law.harvard.edu/blog/2025/10/24/rethinking-data-discovery-for-libraries-and-digital-humanities/)) | About 1 GB of metadata (18 TB archive) | Works, but "required careful data engineering". The binary adds latency, and they are evaluating hyparquet/Arquero. This is the closest analogue to option (b). |
| **PUDL Data Viewer** (Catalyst Coop) | [V] Hosted viewer with search, preview, filter and sort, plus CSV export up to 5M rows. Parquet on public S3 is also queryable remotely by users' own DuckDB ([PUDL data access](https://docs.catalyst.coop/pudl/en/stable/data_access.html)) | Many tables, millions of rows | "Publish parquet + hosted viewer + let power users query directly" is the same shape I recommend. I did not verify the viewer's engine. |
| **Mosaic** | [V] Same client against DuckDB-WASM **or** server DuckDB. "DuckDB-WASM in the browser fares well, though is limited (compared to a DuckDB server)" ([why mosaic](https://idl.uw.edu/mosaic/why-mosaic)) | 10K–1B rows in benchmarks ([arXiv 2507.19690](https://arxiv.org/pdf/2507.19690)) | A swappable backend is a proven pattern. |
| **Observable Framework / Evidence.dev** | [V] Both use DuckDB-WASM for in-page SQL, with data loaders or build-time queries to **shrink data before it reaches the browser** ([Kosara DuckCon slides](https://blobs.duckdb.org/events/duckcon5/robert-kosara-a-duck-for-your-dashboard.pdf)). Observable pins duckdb-wasm 1.29.0 because of range regressions (#2228) | Typically MB to low hundreds of MB in the browser | Precompute aggregates and ship small files. |
| **Overture explorers / Development Seed** | [V] DuckDB-WASM + spatial over GeoParquet bbox stats, "multi-million-row SQL queries" client-side ([DevSeed 2025-10-08](https://developmentseed.org/blog/2025-10-08-spatial-access-lab)) | Subsets of large GeoParquet | Works when files are sorted and partitioned for pruning. |

[I] **Pattern across precedents.** Serverless browser querying succeeds at about 1 GB of well-sorted data with a tolerant audience. Large-scale, high-traffic scientific browsers (gnomAD) stay server-backed. Range-read genomics tools rely on purpose-built indexes, not ad-hoc SQL. I found no DuckDB-WASM ClinVar or variant browser in production (searched 2026-10-24).

---

## 6. Search and autocomplete

[I] Estimated cardinalities (unverified; measure from the data): genes about 20–45k symbols; conditions tens of thousands of MedGen/MONDO names plus synonyms; submitters about 2–3k; variants / HGVS strings several million; ClinVar variation IDs several million.

**Without a server**
- **Small vocabularies** (genes, conditions, submitters): ship one static JSON or Arrow file, roughly 0.5–2 MB gzip [I], and search in memory with MiniSearch (7.2.0) or FlexSearch (0.8.212) in a worker. [V] FlexSearch's own benchmarks show it much faster than MiniSearch, but these are author-published numbers on a single book ([flexsearch](https://github.com/nextapps-de/flexsearch)). Prefix plus fuzzy over about 100k strings is easy in the browser [I].
- **Millions of HGVS/IDs**:
  - **Option 1:** prefix-sharded static index files on R2, for example `/search/hgvs/<normalized 3–4 char prefix>.json` or bucketed by gene symbol, each a few KB to hundreds of KB, fetched on keystroke after N characters [I].
  - **Option 2:** a sorted parquet "name → id" table with small row groups, binary-searched via hyparquet range reads [I].
  - **Option 3:** Pagefind-style chunked indexes. [V] Pagefind builds from HTML; its docs show chunking (27 chunks for 2.5k pages) but give no million-record numbers ([pagefind](https://pagefind.app/docs/)).
  - **Option 4:** DuckDB-WASM `fts` is available [V], but you would need a prebuilt index file and remote `.duckdb` ATTACH (see the #1957 risk). Not recommended.
- [V] tantivy-wasm: npm shows 3.1.18, but I did not verify maturity. Orama 3.x exists. I would not add either before the simple options are measured.

**With a server (recommended)**
- [I] Native DuckDB in the API process:
  - Prefix matches on a lower-cased, sorted name table: `WHERE name_lc >= ? AND name_lc < ?` on a sorted table or ART index. This is sub-millisecond to low-millisecond for millions of rows.
  - The `fts` extension (BM25, stemming; [V] no phrase queries or highlighting per a [third-party write-up](https://wikidocs.net/blog/@jaehong/12731/)) for free-text condition search.
  - Trigram-style fuzzy search via `jaro_winkler_similarity` / `levenshtein` on candidate sets.
  - Alternatively, keep small vocabularies in a Node-side FlexSearch index and send HGVS/ID lookups to DuckDB.
- [I] A server endpoint also enables variant normalization search: parse an HGVS / SPDI / VRS input and resolve it to a canonical variant. That needs real code (and possibly a reference service), so it is impractical to do fully client-side.

---

## 7. Evaluation of options (a)–(e) [I]

| | First-visit latency | Ad-hoc heavy filters | iOS/mobile | Ops cost | Engineering risk (Oct 2026) | Linkable/SEO pages |
|---|---|---|---|---|---|---|
| (a) Server + native DuckDB | Best (small JS, JSON) | Good (native, multi-core, spills to disk) | Best | One small VM | Low; matches the sibling stack | Easy |
| (b) Pure DuckDB-WASM over R2 | Worst (5.5–8.4 MB engine plus sequential range round trips) | OK if data fits in about 1–2 GB | Poor | ~zero | Medium-high (#2153, #2228, #1723, tag churn) | Weak |
| (c) WASM + OPFS | Bad first time, good afterwards | Good after download, but still a 4 GB cap and no working spill | Poor | ~zero | High (OPFS persistence bug in `latest`, spill wrong results #2277, Firefox/Android fallback) | Weak |
| (d) Desktop app | n/a (install) | Best | n/a | Signing, updates, support | High overhead for little gain | None |
| (e) Server-first hybrid with derived parquet | Best | Server now; browser explore mode later | Best | One VM plus R2 | Low now, optional later | Easy |

Why (a)/(e) fits ClinVar specifically [I]:
- Most ClinVar Miner-style pages are **keyed lookups plus group-by counts** (by gene, submitter, condition, significance, review status, conflicts). They are cheap to precompute and serve.
- "Several million variants × several million submissions" with nested GA4GH structs will be **at or over the comfortable browser limit** once you join submissions to variants and conditions. Native DuckDB on a VM handles it in milliseconds, with disk spill.
- The audience is curators and clinicians who often deep-link and share URLs. Fast first paint and stable URLs matter more than zero hosting cost.
- Hosting cost is trivial at this scale either way. R2 is about $0 to a few dollars a month, and the VM you would run anyway for the sibling project.

---

## 8. Staged plan (keeps options open)

**Stage 0: data contract (do first, benefits every option)**
- Add a `browser-derived` step to the ClinVar-GKM pipeline. It reads the GA4GH parquet with native DuckDB and writes:
  - `variants_flat.parquet`: one row per variant, scalar columns for gene, chromosome/position, variation ID, aggregate classification, review status, condition IDs (list), submitter count and conflict flag. Sorted by (gene, position), ZSTD, row groups of about 64k–128k rows [I].
  - `submissions_flat.parquet`: one row per SCV, flattened. Sorted by (gene, variant) or by submitter, possibly both as two copies (cheap at this size).
  - Precomputed aggregate tables: per gene, per submitter, per condition, and per (submitter × significance) and other ClinVar Miner-style crosstabs.
  - Search vocab files: genes, conditions + synonyms, submitters as JSON/Arrow; HGVS/ID lookup as a sorted table and/or prefix shards.
  - A `manifest.json` with release, schema version, file list, sizes and row counts.
- Keep every published file **under 512 MB**, using partitions or shards if needed. Use **versioned immutable paths** on an R2 custom domain with a cache-everything rule and the CORS policy from §3. Keep the raw GKM datasets as they are for power users.

**Stage 1: server MVP (sibling stack)**
- Fastify 5 + `@duckdb/node-api` (pin 2.0.x, or 1.5.x to match the pipeline). On deploy or startup, sync the release's derived files from R2 to local disk, or build a local `.duckdb` from them.
- Zod contracts define a **declarative query spec** (entity, filters, group-by, sort, page) rather than endpoint-specific shapes. The server compiles the spec to parameterized SQL.
- React 19 + TanStack Router/Query. URL search params mirror the query spec, which gives shareable links.
- Search endpoints: autocomplete for genes, conditions and submitters (or a static vocab JSON on the client), plus a server HGVS/ID lookup.

**Stage 2: optional client engine (only if Stage 1 data shows demand for heavy ad-hoc exploration)**
- Implement `QueryBackend` twice: `HttpBackend` (exists) and `DuckDbWasmBackend` (worker; pinned version; `SET builtin_httpfs=false; LOAD httpfs;` if still needed). The spec→SQL compiler lives in a shared package and runs in both places.
- "Explore mode": lazy-load DuckDB-WASM only on that route. Optionally "download this gene set / submitter's data for offline use" into OPFS, as parquet files or an `opfs://` DB, desktop Chromium first.
- Use Mosaic/vgplot for linked views, since it can point at either backend.

**Stage 3: only if justified.** Static-only mirror (no VM) for resilience, or a PWA offline package. A desktop app only if a real user group demands it.

---

## 9. Experiments and benchmarks to run

Use the real derived files. Pin versions: DuckDB native 1.5.x **and** 2.0.0; duckdb-wasm at a specific `next` build and at 1.32.0.

1. **Data sizing.** Row counts and compressed sizes of each derived table at ZSTD level 3 vs 9, and row-group sizes of 32k / 128k / 1M rows. Footer size and number of row groups per file. Combine with the other agent's raw numbers.
2. **Nested-struct pruning.** On the raw GA4GH files, test whether filters on nested struct fields prune row groups in native DuckDB and in WASM (`EXPLAIN ANALYZE`, bytes read). If not, the flattened derived files are mandatory, not optional.
3. **Server baseline.** Fastify + node-api over local files, with about 10 canonical queries (gene page; submitter page; condition page; conflicts across the whole of ClinVar; faceted counts over all submissions with 3 filters; HGVS lookup; autocomplete). Measure p50/p95 at concurrency 1/10/50 and RSS. Target p95 under 200 ms.
4. **DuckDB-WASM over R2.** The same queries from Chrome, Firefox and Safari desktop, plus iOS Safari and Android Chrome. Run cold (first visit) and warm (engine cached), with and without `builtin_httpfs=false`, and with and without the COI threads bundle. Record total time, **number of range requests, bytes transferred** and peak wasm memory (`performance.measureUserAgentSpecificMemory` or a duckdb `memory_limit` sweep). Compare R2 custom domain with cache warm vs cold vs r2.dev.
5. **hyparquet head-to-head** for "gene X variants page 1" and "variation ID lookup" on the sorted files: time to first row and bytes.
6. **Round-trip latency.** TTFB of single range GETs to R2 via the custom domain (cache hit vs miss) from 3–4 geographies. This determines whether sequential DuckDB-WASM reads are tolerable.
7. **Memory ceiling.** The largest join/aggregation (submissions × variants × conditions) that completes in WASM under 2 GB and 3.5 GB `memory_limit`, and on iOS. Find the point where it fails.
8. **OPFS.** Download `submissions_flat` (or a per-gene shard) to OPFS, then measure re-open time, query speed and quota on Chrome, Firefox and Safari. Confirm persistence across restart with the pinned version (the `latest` OPFS bug), and observe Safari's 7-day behaviour.
9. **Search.** Build the vocab JSON and measure gzip size and MiniSearch vs FlexSearch index build time and query latency in a worker on a mid-range phone. Build HGVS prefix shards and measure shard count, size distribution and keystroke latency. Compare with the server prefix query on DuckDB.
10. **Bundle and cold start.** Lighthouse/WebPageTest on the SPA with and without lazily loading DuckDB-WASM (5.5 MB br engine). Confirm the wasm is served with `Content-Encoding: br` and long cache headers.
11. **Electron sanity (only if Stage 3 is ever considered).** Check that `@duckdb/node-api` loads in Electron 45 without a rebuild, and measure packaged app size.

Decision rule [I]: if experiments 4 and 6 show warm DuckDB-WASM answering the canonical queries in under about 1 s on desktop with under 20 range requests, and experiment 7 shows the main joins fit in 2 GB, then an "explore mode" (Stage 2) is worth building. Otherwise stay server-only and invest in precomputed aggregates.

---

## 10. Source list (accessed 2026-10-24)

- DuckDB releases: https://duckdb.org/2026/03/09/announcing-duckdb-150 · https://duckdb.org/2026/09/28/announcing-duckdb-156 · https://duckdb.org/2026/10/21/announcing-duckdb-200
- DuckDB-WASM docs: https://duckdb.org/docs/2.0/clients/wasm/overview.html · https://duckdb.org/docs/2.0/clients/wasm/instantiation.html · https://duckdb.org/docs/2.0/clients/wasm/extensions.html
- DuckDB OPFS blog (2026-09-18): https://duckdb.org/2026/09/18/opfs-wasm
- DuckDB-WASM releases: https://github.com/duckdb/duckdb-wasm/releases
- Issues: #2153 https://github.com/duckdb/duckdb-wasm/issues/2153 · #2228 https://github.com/duckdb/duckdb-wasm/issues/2228 · #1723 https://github.com/duckdb/duckdb-wasm/issues/1723 · #2061 https://github.com/duckdb/duckdb-wasm/issues/2061 · #2271 https://github.com/duckdb/duckdb-wasm/issues/2271 · #2277 https://github.com/duckdb/duckdb-wasm/issues/2277 · #1932 https://github.com/duckdb/duckdb-wasm/issues/1932 · #1957 https://github.com/duckdb/duckdb-wasm/issues/1957 · #1367 https://github.com/duckdb/duckdb-wasm/issues/1367
- PRs: #2278 https://github.com/duckdb/duckdb-wasm/pull/2278 · #2287 https://github.com/duckdb/duckdb-wasm/pull/2287
- Memory64: https://caniuse.com/wf-wasm-memory64 · https://spidermonkey.dev/blog/2025/01/15/is-memory64-actually-worth-using.html
- WebKit memory: https://bugs.webkit.org/show_bug.cgi?id=221530 · https://bugs.webkit.org/show_bug.cgi?id=269777
- MDN storage quotas: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria · OPFS sync handle: https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle · COEP: https://developer.mozilla.org/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy
- R2: https://developers.cloudflare.com/r2/pricing/ · https://developers.cloudflare.com/r2/buckets/public-buckets/ · https://developers.cloudflare.com/r2/buckets/cors/
- Cloudflare cache: https://developers.cloudflare.com/cache/reference/range-requests/ · https://developers.cloudflare.com/cache/concepts/default-cache-behavior/
- hyparquet: https://github.com/hyparam/hyparquet · parquet-wasm: https://unpkg.com/parquet-wasm@0.7.2/README.md · datafusion-wasm: https://www.npmjs.com/package/datafusion-wasm
- SQLite WASM persistence: https://sqlite.org/wasm/doc/trunk/persistence.md · sql.js-httpvfs: https://npmjs.com/package/sql.js-httpvfs
- Mosaic: https://idl.uw.edu/mosaic/server · https://idl.uw.edu/mosaic/why-mosaic · https://content.ieeevis.org/year/2023/paper_v-full-1150.html · https://arxiv.org/pdf/2507.19690
- Perspective DuckDB virtual server: https://motherduck.com/blog/duckdb-ecosystem-newsletter-august-2026.md
- Harvard LIL: https://lil.law.harvard.edu/blog/2025/10/24/rethinking-data-discovery-for-libraries-and-digital-humanities/ · HN discussion: https://news.ycombinator.com/item?id=45774571
- igv.js: https://igv.org/doc/igvjs/Data-Server-Requirements/ · JBrowse: https://jbrowse.org/jb2/docs/config_guides/serving_data/
- Protomaps: https://docs.protomaps.com/deploy/cloudflare · https://docs.protomaps.com/pmtiles/cloud-storage
- PUDL: https://docs.catalyst.coop/pudl/en/stable/data_access.html
- Dev Seed: https://developmentseed.org/blog/2025-10-08-spatial-access-lab
- Kosara DuckCon: https://blobs.duckdb.org/events/duckcon5/robert-kosara-a-duck-for-your-dashboard.pdf
- gnomAD browser: https://github.com/broadinstitute/gnomad-browser · ClinVar Miner: https://github.com/eilbecklab/clinvar-miner
- Windows signing: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- Tauri vs Electron (third-party): https://tech-insider.org/tauri-vs-electron-2026/
- FlexSearch: https://github.com/nextapps-de/flexsearch · Pagefind: https://pagefind.app/docs/
- Package versions: from `npm view` / crates.io API on 2026-10-24 (duckdb-wasm, hyparquet, parquet-wasm, sqlite-wasm, @duckdb/node-api, electron, @tauri-apps/cli, flexsearch, minisearch, mosaic-core, @perspective-dev/*, duckdb crate).
