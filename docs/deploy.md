# Deploying to Google Cloud

Status: draft, 25 October 2026. How the app gets onto the web for the team, first by hand and later automatically. [local-app.md](local-app.md) covers the same image run on a laptop.

## What makes this different from a typical web app

The upstream download is 12 GB and deriving it takes minutes and several GB of memory. The result the app serves is 1.8 GB. Cloud Run's writable filesystem is held in memory, so deriving at startup would need 16 GB or more of RAM and minutes on every cold start. So:

- **Never derive where we serve.** Data is built ahead of time (by hand for now, by a scheduled build later) and served read-only.
- **The data is read-only and fixed per release,** so every instance has its own copy and they scale out without a shared database.

## First pass: images built and deployed by hand

Two images, so a code change never re-sends the data:

- **The data image** (`deploy/data.Dockerfile`): Node plus one derived release, about 2.4 GB, tagged `<release>-<derived>` (when the release was derived). Built and pushed once per derivation, so re-deriving a release (a new table, say) makes a new one.
- **The app image** (`deploy/Dockerfile`): built on the data image, adding the server's dependencies (about 100 MB) and the code and web app (under 1 MB). The registry already has the data image's layers, so pushing an app image uploads only these.

Startup takes seconds: nothing to download, nothing to derive.

1. **Build** for linux/amd64 (Cloud Run's platform) on the Mac. `scripts/build-image.sh [--push] [release]` builds the data image if it isn't there yet, then the app image, tagged `<release>-<commit>`. With `--push` it logs in and pushes both, and refuses to push uncommitted changes. The web app builds natively; only the server's dependency install runs under emulation.

2. **Check locally:** `podman run --rm -p 127.0.0.1:8080:8080 <app image>`, then open http://localhost:8080.
3. **Push** with `scripts/build-image.sh --push` (from a clean, committed tree).
4. **Deploy** the pushed app image to the Cloud Run service (below).

### The dev service (us-east1)

The commands below use `$PROJECT` for the Google Cloud project and `$PROJECT_NUMBER` for its number (`gcloud projects describe $PROJECT --format='value(projectNumber)'`). `scripts/build-image.sh` reads the project from `CLINVAR_GKM_BROWSER_PROJECT` and stops if it isn't set.

Images: `us-east1-docker.pkg.dev/$PROJECT/clinvar-gkm-browser/clinvar-gkm-browser:<release>-<commit>`. Pushing needs podman logged in: `gcloud auth print-access-token | podman login -u oauth2accesstoken --password-stdin us-east1-docker.pkg.dev`.

```sh
# Deploy (or update) the service, behind IAP: Google sign-in, no code in the app.
gcloud run deploy clinvar-gkm-browser --project=$PROJECT --region=us-east1 \
  --image=us-east1-docker.pkg.dev/$PROJECT/clinvar-gkm-browser/clinvar-gkm-browser:2026-10-18-be1c056 \
  --cpu=4 --memory=8Gi --concurrency=10 --min-instances=1 --max-instances=3 --cpu-boost \
  --set-env-vars=DUCKDB_THREADS=4,DUCKDB_MEMORY_LIMIT=4GB,CLINVAR_ALLOWED_HOSTS=clinvar-gkm-browser-$PROJECT_NUMBER.us-east1.run.app \
  --no-allow-unauthenticated --iap

# Once: let IAP call the service.
gcloud run services add-iam-policy-binding clinvar-gkm-browser --project=$PROJECT --region=us-east1 \
  --member=serviceAccount:service-$PROJECT_NUMBER@gcp-sa-iap.iam.gserviceaccount.com --role=roles/run.invoker

# Per person or group: who may sign in.
gcloud iap web add-iam-policy-binding --project=$PROJECT --resource-type=cloud-run \
  --service=clinvar-gkm-browser --region=us-east1 \
  --member=user:someone@broadinstitute.org --role=roles/iap.httpsResourceAccessor
```

The URL is `https://clinvar-gkm-browser-$PROJECT_NUMBER.us-east1.run.app`. IAP's Google-managed sign-in admits accounts in the project's organization; collaborators with other accounts need a custom OAuth client configured in IAP (still no app code). Setup reference: [Configure IAP for Cloud Run](https://docs.cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run).

### Cloud Run settings

| Setting | Value | Why |
| --- | --- | --- |
| CPU, memory | 2 vCPU, 4–8 GiB | Data is read from the image, not memory; DuckDB's working memory and spill files are in memory |
| `DUCKDB_MEMORY_LIMIT` | about half the instance's memory | Spill files (`/data/tmp`) also count against the instance's memory |
| `DUCKDB_THREADS` | the vCPU count | Don't rely on detecting it |
| `CLINVAR_ALLOWED_HOSTS` | the service's run.app host names (and a custom domain, if any) | The Host check refuses any other name |
| Minimum instances | 1 for dev (since 26 October 2026) | Avoids cold starts. A minimum instance is billed while idle, at Cloud Run's lower idle rate (roughly $2.60 a day at 4 vCPU and 8 GiB); to be checked on the bill. 0 costs nothing idle, and a cold start takes a few seconds |
| Maximum instances | 3 for dev | Bounds cost. Request-based billing charges only while requests run, so more instances cost little more; but each new instance reads its data cold (image streaming), and one Conflicts tab can push CPU high enough to start another |
| Concurrency | low (around 10) | A DuckDB query uses every core |
| Access | IAP, limited to the team's Google accounts | The app has no login and isn't hardened for anonymous traffic |

Query times measured natively on the development Mac (25 October 2026), with the server's defaults and with 2 threads and a 2 GB DuckDB limit. A Cloud Run vCPU is slower than an M-series core, so expect somewhat worse there.

| Query | Default | 2 threads |
| --- | --- | --- |
| A variant's SCVs | 0.06 s | 0.08 s |
| BRCA1's SCVs, first page with count | 0.09 s | 0.12 s |
| BRCA1 conflicts: scorecard; term grid | 0.27 s; 0.22 s | 0.86 s; 0.71 s |
| Labcorp (2M SCVs) conflicts: scorecard; labs; term grid | 0.58 s; 0.43 s; 0.38 s | 2.5 s; 1.7 s; 1.6 s |

Entity pages stay fast on 2 vCPU. Big labs' Conflicts tabs, which run six such queries at once, would take several seconds; 4 vCPU halves that.

Open questions before the first push: which Artifact Registry repository and region, IAP or Cloud Run IAM for access, and the instance size (measure queries with `DUCKDB_THREADS=2` first).

## How the data could reach the server

| Option | Startup | Query speed | Notes |
| --- | --- | --- | --- |
| **Baked into the image** (first pass) | seconds | local reads, after Cloud Run's image streaming fetches each file the first time | One image per release; rolling back is going to the previous revision. A code change pushes only the small layers |
| **Cloud Storage, mounted** (Cloud Storage FUSE volume, read-only) | seconds | slower: each read goes over the network; FUSE's file cache helps, but on Cloud Run it's held in memory | No image rebuild per release; the bucket keeps every release |
| **NFS, mounted read-only** (Filestore, or an NFS server on a small VM with a persistent disk) | seconds | close to local disk within a region | Filestore's smallest instance is 1 TiB (a few hundred dollars a month); a self-run NFS VM is cheap but ours to run. Needs a VPC connection from Cloud Run |
| Copy from Cloud Storage at startup | about a minute | local | The 1.8 GB counts against instance memory |
| DuckDB reading `gs://` directly | seconds | slowest | Needs DuckDB's httpfs extension in the image |

**Block volumes (Persistent Disk, Hyperdisk) can't be mounted on Cloud Run.** Its volume types are Cloud Storage (through FUSE), NFS, in-memory, and secrets. Both Cloud Storage and NFS mounts can be read-only, which suits the app: it writes only logs (to stdout) and DuckDB spill files (to memory). A small disk shared read-only is possible on Compute Engine or GKE instead, if we ever leave Cloud Run.

## Later: a weekly automated build

A Cloud Build pipeline, triggered by Cloud Scheduler after upstream's weekly rebuild:

1. fetch the parquet (`scripts/fetch-source.sh`, checksums verified);
2. derive (`scripts/derive.sh`), on a large build machine with a real disk;
3. copy the derived release to a Cloud Storage bucket, which keeps every release;
4. build the image with the release baked in and push it;
5. deploy it as a new Cloud Run revision.

## Production

- **Cache responses.** For a given release every response is the same for everyone, so with the release in the cache key, a CDN in front of a load balancer can serve most entity-page traffic without reaching DuckDB.
- **Compute the heaviest views ahead,** such as big labs' scorecards and lab tables, if live queries are too slow under load.
- **Scale out** with more instances and low per-instance concurrency.
- **A hosted mode** turns off local-only features (the SQL console, data management) whatever else is configured.
- **A custom domain** under `clingen.app` (HTTPS is required, as `.app` is on browsers' HSTS preload list): Cloud Run domain mapping is simplest; a global load balancer is what production would use, with CDN and Cloud Armor.
