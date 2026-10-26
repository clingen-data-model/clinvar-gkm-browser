# ClinVar GKM browser: the local app

Status: draft, 24 October 2026. How the app runs as a container on a user's machine: what the user runs, how the app gets ClinVar-GKM data and keeps it current, the SQL console, private variant lists, security, and laptop limits. [architecture.md](architecture.md) explains why the app has a server at all; [data.md](data.md) describes the data.

**Decided 24 October 2026:**
- **Distribution:** a container image run locally with podman. We use the podman CLI; users are pointed to Podman Desktop for its UI.
- **Data:** the app downloads ClinVar-GKM's published parquet as-is and reshapes it locally, inside the container. No separate app-release bucket for now. Upstream format changes, or extra files published beside ClinVar-GKM's, come later if a reshaped form proves much better.
- **Persistence:** data lives in a podman volume, so restarts, code changes and image rebuilds don't re-download anything.
- **Architecture:** build for the local podman machine first (linux/arm64 on Apple Silicon). Multi-arch images come later.
- **First target:** local containers. A multi-user hosted version comes later, but design decisions must not rule it out (see [Designing for a hosted version later](#designing-for-a-hosted-version-later)).
- **Publishing:** a GitHub repo and ghcr.io images come later; for now everything is local images.

## What the user does

```sh
podman volume create clinvar-browser-data
podman run -d --name clinvar-browser \
  -p 127.0.0.1:8080:8080 \
  -v clinvar-browser-data:/data \
  localhost/clinvar-gkm-browser:dev
```

Then open http://localhost:8080. Podman Desktop does the same through its UI: pull the image, create the volume, set the port and start.

- **First start:** the page shows that no data is loaded yet and offers to download the current ClinVar-GKM release, with its size (13.2 GB today). The download and the processing after it run in the background with progress shown; the browser can be closed meanwhile. `CLINVAR_AUTO_DOWNLOAD=1` skips the prompt for scripted setups.
- **After that:** the app opens straight to the latest prepared release.
- **Upgrading the image** means recreating the container with the same volume; nothing is downloaded again. If the new image reshapes the data differently, it rebuilds its tables from the parquet already in the volume.

## What runs inside

One process, as in gencc: a Fastify server that
- serves the built React app from the image;
- serves the REST API at `/api/v1`, used by the React app and documented with OpenAPI at `/api/v1/docs`, so scripts on the same machine can use it too;
- runs queries with embedded DuckDB;
- downloads ClinVar-GKM parquet, verifies it, and builds the app's tables from it.

The browser and API share one origin (`localhost:8080`), so there's no CORS and no configuration. The browser never touches data files; it gets JSON and streamed exports from the API.

```
browser ──HTTP──▶ container: Fastify ─┬─ web app (static files in the image)
                                     ├─ /api/v1 ── DuckDB ── /data (podman volume)
                                     ├─ SQL console worker ── DuckDB, read-only
                                     └─ data manager ──HTTPS──▶ data.clinvar-gkm.org
```

## Data in the volume

```
/data/
  source/<clinvar-release>/     ClinVar-GKM parquet as downloaded, plus its manifest and index entries
  derived/<schema>/<clinvar-release>/<table>.parquet, manifest.json
                                the app's tables, built from source/
  workspace/                    saved queries, uploaded lists, settings (SQLite and DuckDB files)
  tmp/                          downloads in progress, DuckDB spill files
```

- **`source/`** holds the 22 published parquet files unchanged (13.2 GB). The SQL console can query them directly, so the full GA4GH records are always available, not just the columns the app's tables keep.
- **`derived/`** holds one directory of parquet files per ClinVar release (about 1.9 GB), which the server queries through DuckDB views: the flattened, re-keyed, sorted tables in [data.md](data.md#derived-model). They are still separate tables with foreign keys, just with fewer hops between them than upstream. `<schema>` is the derivation version built into the image. When an image with a new derivation version starts, it rebuilds from `source/` and offers to delete the old files. This is also the development loop: change the derivation code, rebuild the image, restart, and the tables rebuild from the parquet already downloaded.
- **`workspace/`** holds the user's own things. It's separate from the data so data can be deleted and re-downloaded without losing saved work.

## Getting and refreshing data

- **Source:** `https://data.clinvar-gkm.org/v1/1.1/index.json` lists every file with its size and sha256; `parquet/manifest.json` names the ClinVar release. The app downloads the 22 parquet files, a few at a time, with resume on interruption. At the 68 MB/s measured from here that's about 4 minutes; on slower connections, longer.
- **Verification:** each file's sha256 is checked against the index fetched when the download started. Because ClinVar-GKM overwrites the parquet in place each week, a mismatch may mean upstream rebuilt mid-download. The app then fetches the index again, and starts over if the release changed, so `source/` never mixes files from two builds.
- **Derivation:** DuckDB reads `source/`, loads a scratch database in `tmp/`, checks and validates it, and writes `derived/<schema>/<release>/` as parquet. It takes 2.5 minutes on the development Mac with DuckDB limited to 4 GB ([schema.md](schema.md#results)). The process's resident memory still peaks around 8 GB, so it must be tested inside a 4 GiB podman machine.
- **Updates:** at startup and then daily, the app fetches the index (a few KB). When a new ClinVar release is out, a banner offers it with its size; `CLINVAR_AUTO_UPDATE=1` downloads it unattended. Since every file is rewritten each week, an update is a full 13.2 GB download.
- **Old releases:** by default the app keeps the source for the latest release only, plus derived files for the last two releases (configurable), which appear in a release selector. Peak disk during an update is two sources plus the derived files.
- **History:** each release the app processes adds to its local history tables ([data.md](data.md#history)). An install builds up history from the day it starts; earlier history needs the backfill described there.
- **Offline:** once a release is prepared, nothing needs the network. The update check fails quietly.
- **Load on ClinVar-GKM's bucket:** 22 whole-file downloads per user per week, which is the use the bucket is meant for. The per-IP limit (250 requests per 10 s) doesn't come into play.

## The SQL console

A tab beside the regular pages, for things the UI and REST API don't support yet.

- **What it can query:** the derived tables, the raw ClinVar-GKM tables (as views over `source/`), and the user's uploaded lists. A schema browser lists tables and columns, with notes for the nested GA4GH structs.
- **Editor and results:** CodeMirror with SQL highlighting and completion of table and column names; results in a paged table; export of the full result as TSV or parquet; cancel button; query history; saved queries in `workspace/`.
- **Starting points:** example queries for common tasks (SCVs for a submitter in a gene, conflicts between two labs, unpacking an HGVS list), so a user can begin from a working query.
- **Isolation:** queries run in a separate worker with its own DuckDB instance and memory limit, so a runaway query can't take down the pages. Databases are attached read-only; `enable_external_access` is off, with an allow-list for the `source/` directory, and the configuration is locked so a query can't turn it back on. Check that the DuckDB version we pin supports the allow-list settings.
- **API:** `POST /api/v1/sql`, with a statement timeout (configurable) and a cap on rows returned inline. Exports stream without a cap.
- **The path to new features:** queries people save and repeat are candidates for proper pages and API endpoints.

## Private variant lists

A user uploads a list, the app matches it against ClinVar, and the results become a filterable list like any other: by gene, classification, conflict, submitter. Nothing leaves the machine. Planned for M3.

- **Inputs:** VCF (GRCh38 first); lists of ClinVar variation IDs, VCV/RCV/SCV accessions, rsIDs, ClinGen CA IDs, VRS IDs, or HGVS expressions.
- **Matching identifiers** is a join against the derived tables.
- **Matching VCF records** is mostly a join too. Each ClinVar-GKM allele's `data` carries a gnomAD-style VCF key (`chrom-pos-ref-alt` on GRCh38, left-aligned as in VCF) for 99.98% of alleles (4,597,540 of 4,598,672 in 2026-10-18). The derivation stores it, split into columns, in `allele` ([schema.md](schema.md)). A VCF record that is left-aligned and split into one alternate allele per line (`bcftools norm -m -any`) matches on those columns. The remaining work:
  - normalizing uploads the same way, which needs the reference sequence for indels that aren't already left-aligned;
  - GRCh37 uploads, which need liftover or a GRCh37 key;
  - the 1,132 alleles without a key.
  VRS normalization (`vrs-python`, or theferrit32/vrs-rust) is a fallback, not the main path. Decide the details in M3.
- **Storage:** uploaded lists and their matches go in `workspace/` and stay there until the user deletes them. They are never sent to any outside service: no external annotation APIs are called with list contents.
- **Output:** the matched list joins every page's filters ("only variants in my list") and the SQL console (as a table), and exports with ClinVar data added.

## Security

A server on localhost is still a server, and the browser lets any website send requests to it.

- **Bind to localhost.** Docs and examples always use `-p 127.0.0.1:8080:8080`; a plain `-p 8080:8080` publishes the port to the local network.
- **Check the Host header.** Accept only `localhost`, `127.0.0.1` and `[::1]` (plus configured names), to block DNS rebinding. That's a malicious site pointing its own domain at 127.0.0.1 and then reading the API, including uploaded lists.
- **Check Origin on state-changing requests** (downloads, deletions, uploads, saved queries, SQL): same-origin only, so another site can't trigger them.
- **SQL console** isolation as above.
- **gencc's headers** (strict CSP, nosniff, frame denial) carry over.
- **The image runs as a non-root user.** Downloads are verified by sha256 against the index, which is fetched over HTTPS.

## Laptop limits

Measured on the development machine (24 October 2026): podman 5.3.1, `podman-machine-default` on Apple Silicon (applehv), 7 CPUs, **4 GiB memory**, 100 GiB disk with 40 GB free.

- **Memory.** Containers on macOS run inside the podman machine's VM, so the VM's memory is the ceiling. DuckDB's memory limit comes from an env var, with a default below the container's limit (check whether DuckDB reads the cgroup limit itself). M0 measures derivation and the main pages at 4 GiB. If derivation needs more, the docs explain `podman machine set --memory` (the machine has to be stopped first) and Podman Desktop's equivalent setting.
- **Disk.** About 13.2 GB of source, plus the derived files (M0 measures them; the guess is 1–3 GB each), plus spill space during derivation, plus a second source during an update. Plan on 35 GB free; the UI shows the space needed before each download.
- **Image architecture.** linux/arm64 for now, built and run locally. Later, a multi-arch image (an OCI index with linux/arm64 and linux/amd64) lets `podman pull` choose the right one automatically. Check that `@duckdb/node-api` ships linux-arm64 and linux-amd64 binaries.
- **Image size:** about 330 MB for gencc on `node:26-slim`. DuckDB's native binding adds tens of MB. No data in the image.

## Development workflow

**Decided 24 October 2026: develop natively, not in a container.** The container is the distribution target, so the code is written to run the same way in both (next section). Container builds come once there's something to distribute.

- **Run:** `pnpm dev` on macOS, as in gencc, with `CLINVAR_DATA_DIR=./data` (gitignored). The data directory has the same layout as the volume (`source/`, `derived/`, `workspace/`, `tmp/`), so the first download lands in `./data/source/` and is reused across restarts and code changes.
- **Rebuilding data:** a CLI subcommand (`pnpm cli derive`, later `clinvar-browser derive` in the image) rebuilds `derived/` from `source/`, for iterating on the derivation without the UI. The derivation SQL can also be run directly in the DuckDB CLI against `./data`.
- **Container checks, later:** `podman build -f deploy/Dockerfile -t localhost/clinvar-gkm-browser:dev .` and run as in [What the user does](#what-the-user-does). To avoid a second 13 GB download, copy `./data/source/` into the volume (`podman volume import`) instead of downloading again.

## Built for the container, run natively

What targeting a container changes in code we write and run natively:

- **All state under one directory.** Everything the app writes goes under `CLINVAR_DATA_DIR`: data, workspace, temp files and DuckDB spill files. Nothing is written beside the code or to the home directory. Temp files are on the same filesystem as their destination, so finished files can be moved into place atomically.
- **Configuration from env vars only,** validated with a Zod schema at startup (as gencc does); invalid config stops the process. The UI can change runtime settings (auto-update, releases kept), stored in `workspace/` and overridable by env. Expected variables:

  | Variable | Default | Notes |
  | --- | --- | --- |
  | `CLINVAR_DATA_DIR` | `./data` natively, `/data` in the image | |
  | `HOST`, `PORT` | `127.0.0.1`, `8080` | The image sets `HOST=0.0.0.0`, because inside a container the port mapping (`-p 127.0.0.1:…`) is what limits access |
  | `CLINVAR_ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1]` | Host header check |
  | `CLINVAR_SOURCE_URL` | `https://data.clinvar-gkm.org/v1/1.1/` | ClinVar-GKM base URL; overridable for testing against a local mirror |
  | `CLINVAR_AUTO_DOWNLOAD`, `CLINVAR_AUTO_UPDATE` | off | |
  | `CLINVAR_KEEP_RELEASES` | `2` | Derived releases kept |
  | `DUCKDB_MEMORY_LIMIT`, `DUCKDB_THREADS` | derived from the machine, or the container's limits | The SQL console worker gets its own, smaller limit |
  | `CLINVAR_MODE` | `local` | `hosted` later |
  | `LOG_LEVEL` | `info` | |

- **Graceful stop.** `podman stop` sends SIGTERM and kills the process 10 s later. Downloads resume from where they stopped, derivation restarts from scratch in `tmp/`, and nothing half-written ever replaces a good file. The server closes DuckDB cleanly on SIGTERM.
- **No runtime extension downloads.** DuckDB normally installs extensions from the internet on first use. That works on a laptop but breaks offline or in a locked-down container. The app turns auto-install off and uses only extensions bundled with the DuckDB binding, or installed into the image at build time. Downloads go through Node's `fetch`, not DuckDB's httpfs, so httpfs isn't needed.
- **Nothing macOS-specific** in paths, file watching or shell-outs. The production image is Linux.
- **Logs go to stdout and to rotated, gzipped files.** pino (Fastify's logger) writes JSON lines to two destinations through `pino.multistream`:
  - **stdout,** so `podman logs` and the terminal running `pnpm dev` show them;
  - **`$CLINVAR_DATA_DIR/logs/server.log`,** through `rotating-file-stream` (3.2.x, no dependencies). It rotates daily or at a size limit, gzips rotated files (`server-<date>.log.gz`), and deletes the oldest past a file count or total size.

  Settings: `LOG_FILE` (on by default; `off` for stdout only), `LOG_ROTATE_SIZE` (default `50M`), `LOG_ROTATE_INTERVAL` (default `1d`), `LOG_MAX_FILES` (default `14`). Logs are on the data volume, so they outlive the container and a user can attach them to a bug report.
  - Node's standard library has no rotation; it would mean writing our own with `fs` and `zlib`. `pino-roll`, pino's rotating transport, rotates but doesn't compress.
  - Uploaded variant lists and SQL console queries are never logged in full, only their sizes, timings and errors.

## Designing for a hosted version later

Local first, but these choices keep a multi-user hosted version possible without a rewrite:

- **Per-user state goes through a workspace interface.** Saved queries, uploaded lists, watchlists and history are stored by workspace ID. Locally there is one implicit workspace; hosted, a workspace belongs to a signed-in user or a session.
- **Admin actions live under `/api/v1/admin`:** downloading, deriving and deleting releases. Locally they are open to same-origin requests; hosted, they're disabled or behind authentication, and the data is prepared by a scheduled job instead.
- **Data is read-only at request time.** Releases are immutable once built, and switching to a new release doesn't disturb in-flight requests, so many concurrent users are fine.
- **Every query has a budget:** timeouts, cancellation and paging from the start. Heavy work (derivation, SQL console, list matching) runs off the request path.
- **The SQL console is isolated by design,** with its own process or worker and memory limit. Hosted, it could be offered with tighter limits, or turned off.
- **Uploaded lists** stay inside a workspace and are never shared or logged. A hosted version could expire them, or leave the feature local-only.
- **URLs carry the release and all state,** so links already work as shareable links once there's a public site.
- **Config comes from env vars,** so hosted settings are configuration rather than code.

## Open questions

1. **Derivation memory and time at 4 GiB:** M0.
2. **Keep the raw ClinVar-GKM tables as views over parquet,** or import them into DuckDB too? Views cost no extra disk. Import would make raw-table queries in the SQL console faster, at the cost of roughly doubling disk use.
3. **VCF indel matching:** reference sequence approach and implementation (above). M3.
4. **When a new derivation version arrives:** rebuild automatically on startup, or ask first? Rebuilding blocks pages until it finishes, unless the old derived files keep serving meanwhile.
