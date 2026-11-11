# ClinVar GKM browser: statistics

Status: built on the `stats` branch, 11 November 2026 (planned 10 November). A page of whole-ClinVar figures that people cite in slides, papers and grant applications, starting from two slides that have been used before and the system-level trends in issue #3. Covers 2026-06-27 onward, the releases in the history ([history.md](history.md)); earlier years need a backfill, which is a separate, later piece of work.

## Figures

The first set. Each has a slug, used in its URL and its API path. All are about germline pathogenicity, ClinVar's classification type `PATH`.

| Slug | What it shows | Over |
| --- | --- | --- |
| `aggregate-classification` | Every variant's aggregate classification, in the categories below; one 100% bar per release | chosen releases |
| `submitter-agreement` | Variants by how their classification was reached: expert panel or practice guideline, discordant, several concordant submitters, a single submitter | one release |
| `single-submitter-classification` | The aggregate classification of single-submitter variants, in the same categories | one release |
| `vus-submissions` | SCVs classifying a variant as uncertain significance, as a count and as a share of pathogenicity SCVs | releases |
| `clinsig-conflict-variants` | Variants with a clinically significant conflict, each counted once | releases |
| `clinsig-conflict-submissions` | SCVs in a clinically significant conflict, each counted once, on both sides (2 P and 1 B is 3 SCVs) | releases |

The first slide is `aggregate-classification` for a few releases; the second is `submitter-agreement` beside `single-submitter-classification`.

## Definitions

Every figure states its definitions beside it, and lists exactly what each category contains in the release shown, so a cited number can be checked and regrouped.

### Aggregate classification categories

A variant's aggregate classification is the `classification` of its `vcv_statement` root for `PATH`. It isn't always one term: ClinVar joins the terms of the contributing SCVs with "/" ("Pathogenic/Likely pathogenic"). On 2026-10-18 there are 33 distinct labels. Two aren't terms ("Conflicting classifications of pathogenicity" and "no classifications from unflagged records"); each of the other 31 splits on "/" into terms in `classification_term`, and all of a label's terms have the same significance.

The categories come from the terms' columns in ClinGen's clinvar-ingest-bq-tools table [`clinvar_clinsig_types`, at 2ca57d8](https://github.com/clingen-data-model/clinvar-ingest-bq-tools/blob/2ca57d89bf1d9e93a68d01bf43fac5c02fdc0dc8/scripts/dataset-preparation/00-setup-translation-tables.sql#L30-L99) (the vocabulary [data.md](data.md#conflicts) follows; unchanged on its `main` as of 10 November 2026): `significance` (2 pathogenic side, 1 uncertain, 0 benign side), `strength_code` (definitive or likely; none for the combined P/LP and B/LB) and `penetrance_level` (low, or risk allele).

| Category | Rule | Labels on 2026-10-18 | Variants | Share |
| --- | --- | --- | --- | --- |
| Pathogenic | significance 2, no penetrance level, every term definitive | Pathogenic | 220,113 | 4.96% |
| Likely pathogenic | significance 2, no penetrance level, not every term definitive | Likely pathogenic; Pathogenic/Likely pathogenic | 182,782 | 4.12% |
| Low penetrance / risk allele | significance 2, any term with a penetrance level | 16 labels, e.g. Pathogenic, low penetrance; Established risk allele; Pathogenic/Likely pathogenic/Likely risk allele | 299 | 0.01% |
| Conflict: P/LP vs VUS/LB/B | conflicting, a contributing SCV of significance 2 | | 31,131 | 0.70% |
| VUS | significance 1 | Uncertain significance; VUS-high, -mid, -low; Uncertain risk allele; and their combinations | 2,423,161 | 54.64% |
| Conflict: VUS vs LB/B | conflicting, no contributing SCV of significance 2 | | 151,098 | 3.41% |
| Likely benign | significance 0, not every term definitive | Likely benign; Benign/Likely benign | 1,227,981 | 27.69% |
| Benign | significance 0, every term definitive | Benign | 198,046 | 4.47% |
| No classification | all of the variant's SCVs are flagged | no classifications from unflagged records | 145 | 0.003% |

Decided 10 November 2026:
- **P/LP counts as Likely pathogenic and B/LB as Likely benign,** as on the slide; under the rule that's because neither combined term is definitive.
- **Low penetrance and risk alleles are their own category,** not folded into Pathogenic or Likely pathogenic by strength: penetrance is a separate axis, and a category that isn't on the slide is less confusing than an aggressive merge. A label with any such term goes there, so Pathogenic and Likely pathogenic hold only the plain terms. Uncertain risk allele is significance 1, so it's VUS.
- **A label no rule covers** (a new term upstream) shows as "Unmapped", never dropped, and a test fails on it.
- **`strength_code` and `penetrance_level` belong in `classification_term`,** so SQL can use them; they're seeded in `schema.sql` at the next rebuild. Until then the stats code carries them as a small map keyed by term code, citing bq-tools.

**The conflict split** reads the root's `conflicting_explanation` ("Likely pathogenic(1); Uncertain significance(1)"), which lists the contributing SCVs' terms. On 2026-10-18 it agrees with a split computed from the contributing SCVs themselves on all 182,227 conflicting variants that have one. Two conflicting variants have none, both expert panels disagreeing with each other (variants 12982 and 133206); for those the split reads their contributing SCVs.

**Checked against the slide (10 November 2026):** our 2026-06-27 release against the slide's "July 2026" bar (4.2 million variants), before the low penetrance / risk allele category was split out. Every category is within 0.2 points: Pathogenic 5.0 (slide 5.0), Likely pathogenic 3.8 (3.8), P/LP conflict 0.6 (0.6), VUS 55.2 (55.4), VUS/LB/B conflict 3.2 (3.2), Likely benign 27.1 (27.0), Benign 5.0 (4.9), of 4,273,584 variants.

### Submitters

**A variant's submitters are the distinct submitters of its contributing SCVs** (decided 10 November 2026): those at the submission level ClinVar's aggregate is computed from, the `vcv_statement` level node with `contributes`. That's how ClinVar's own review status counts them. Counting all SCVs would put variants like 9339 in the wrong group: OMIM's 2002 Pathogenic (no assertion criteria) and Labcorp's 2024 VUS (criteria provided). ClinVar's aggregate is VUS, "criteria provided, single submitter", and OMIM's doesn't count; counted over all SCVs it has two submitters who disagree, yet isn't a conflict, so it would land in "several concordant". 73,208 variants have one contributing submitter and more in all.

`submitter-agreement` takes the first that applies:

| Group | Rule | Variants, 2026-10-18 | Share |
| --- | --- | --- | --- |
| Expert panel or practice guideline | aggregate review status | 22,701 | 0.5% |
| Discordant | aggregate is conflicting (including 687 where one submitter's SCVs conflict) | 182,227 | 4.1% |
| Several concordant submitters | more than one contributing submitter | 764,147 | 17.2% |
| Single submitter | one contributing submitter | 3,465,681 | 78.1% |

The slide (July 2024) had 0.6, 4.4, 14.7 and 80.3.

### Clinically significant conflicts

These differ enough that the figures offer a choice, in a dropdown that's part of the URL:

| Definition | Variants, 2026-10-18 | SCVs, both sides |
| --- | --- | --- |
| **ClinVar's aggregate** (the default): the aggregate is conflicting and a contributing SCV is P/LP | 31,131 | 116,455, the contributing SCVs of those variants |
| **Pairs, same condition** (ClinVar Miner's level 5; our conflict pages' default): two SCVs of the variant are P/LP and VUS/LB/B and share a condition | 18,304 | 59,072 |
| **Pairs, any condition** | 41,739 | 180,223 |

The aggregate counts only contributing SCVs; pairs count every submission level, so variant 9339 is a pair conflict and not an aggregate one. Pairs come from `scv_classification_pair` ([data.md](data.md#conflicts)) under the conflict pages' defaults: two different submitters, neither SCV flagged. The condition rule is a choice too: same condition (the default), same or either unspecified, or any.

## API

- `GET /api/stats`: the figures, each with slug, title, description and whether it's one release or several.
- `GET /api/stats/:slug`: one figure's data. `release` for a one-release figure; `releases` (a list) or `every=month` (the first release of each month) for a trend; figure options such as `conflict=aggregate|pairs-same-condition|pairs-any-condition`. The response is long-format rows (release, category, count, and for categories the original labels), the totals, and the definitions. `format=csv` gives the rows as CSV.

**Computed per request, no new tables** (decided 10 November 2026). The figures don't depend on the request beyond their parameters, and the data changes only when a new image is deployed, so results are cached in memory by figure and parameters. Measured on this Mac (14 cores, over the history of 19 releases, 2026-06-27 to 2026-10-31): the aggregate classification of every release, 0.6 s; VUS SCVs of every release, 0.4 s; level-5 pairs of every release, under 0.1 s; `submitter-agreement` for one release, 0.8 s. Through the server (10 November 2026, the same Mac, each figure over all 19 releases, uncached): aggregate classification 1.6 s; VUS SCVs 0.7 s; SCVs in an aggregate conflict 1.2 s; pair conflicts 0.1 s; `submitter-agreement` 0.3 s and `single-submitter-classification` 0.4 s for one release. Variants in an aggregate conflict reuse the aggregate classification's cached counts. Cloud Run has 4 vCPUs, so these need measuring there; if one is too slow, `history.sh` can write a small stats table per release instead.

The figures' SQL is in `src/api/stats/queries.ts`, one entry per figure in a registry, as filters are.

## Pages

Built 11 November 2026 (the `stats` branch).

- **`/stats`:** every figure with its default options, one section each with `id` set to its slug, so `/stats#aggregate-classification` links to it, and a list of figures at the top. Each section loads on its own, so the first figure is up before the last is counted. The header links to it.
- **`/stats/<slug>`:** one figure with its options (which releases, what counts as a conflict, the condition rule), all in the URL, so a link reproduces exactly what was cited. An option the figure doesn't take is left out of the request rather than sent.
- Both follow the header's release picker: a trend runs up to the release chosen.

A figure's page has: the chart; its definitions, with a link to bq-tools' vocabulary at the commit followed (not to this doc: `main` moves on from what a deployed app counts, and the page itself carries every rule); a citation (the figure, the releases, ClinVar-GKM, the page's URL with its options, the reader's date) and the counts as CSV or JSON; a table of the numbers (for accessibility, and for copying into a paper); and what each category contains in the release shown, every label counted with its count, from the same rows as the chart.

### Charts

**Hand-drawn SVG, no chart library** (decided 10 November 2026; `apps/web/src/components/stats/`). A library wouldn't remove the hard part, which is placing text. What keeps them stable when the numbers change:
- **Fixed coordinates:** a chart across the page draws 960 units wide, one of two side by side 640, scaled to the page. Positions are arithmetic on the data, never on rendered text.
- **Fixed number formats:** counts with thousands separators; shares to one decimal (two on the line charts, whose shares are under 2%), rounded by largest remainder so each release's shares add up to exactly 100.0. That can differ from rounding each alone by 0.1: single submitters on 2026-10-18 are 78.147%, shown as 78.2% so the four groups add up. A share that rounds to zero but isn't shows as "<0.1%".
- **Labels only where they fit:** a share is printed inside its segment only if the segment is at least 16 units tall (48 wide), or wide enough for its text in a bar; otherwise it's in the tooltip and the table. With many columns, dates are labelled every few columns, counting back from the latest.
- **Fixed strings:** SVG can't wrap text, but the category names are ours, so legends are a column beside the columns or a three-column grid under a bar. Titles and definitions are HTML around the chart; the source (releases, ClinVar-GKM, the app and the figure's path) is drawn under it, so it stays with a download.
- **Self-contained export:** on screen, colors follow the theme through CSS (`light-dark()`); a download writes each element's light color onto it, drops hover marks, and adds a white ground and the font, so it looks the same in a slide whichever theme it was downloaded from. PNG is that SVG drawn at 3× (2880 × 1560 for the classification columns).
- **Hover and keyboard:** a pointer, or the arrow keys once the chart has focus (one tab stop per chart), picks the nearest point and shows every value at it, value first; the table has them all without hovering. Each chart is an image with a name saying so.
- **Tests:** the rounding, ticks and paints (`apps/web/src/lib/stats.test.ts`); in the browser, every figure drawn, axe on the overview and two figure pages, options in the URL reaching the CSV link and the citation, and the keyboard tooltip.

**Which chart for which figure** (decided 11 November 2026):
- **Classification over releases:** 100% stacked columns, one per release, with the category legend beside them, as on the slide. By default the last release of each month (5 columns now); every release is an option.
- **One whole in one release** (`submitter-agreement`, `single-submitter-classification`): a single tall segmented bar with its shares printed where they fit and a legend of names. Not a pie: parts laid along one line compare more exactly than angles. A pie is easy to add if presenters want the slide's.
- **Counts over releases** (the VUS and conflict trends): two line charts side by side, the count and the share of the whole, each with its own axis, rather than one chart with two scales. Lines run on a time axis (releases aren't evenly spaced) whose ticks span the values, not from zero, so a change of a few percent shows; the ticks say where it starts. Every release by default.

**Colors.** The categories follow the app's significance pills (pathogenic red, uncertain amber, benign green) with the conflicts and low penetrance between, in stack order; groups with no meaning in color (`submitter-agreement`) take a validated categorical palette's first slots in fixed order (blue, orange, aqua, amber), and lines its blue. Each mode was checked against the app's own backgrounds (white, and `oklch(16% 0.01 260)` in dark mode) for an OKLCH lightness band and chroma floor, and for every pair that touches in the stack, separation of at least 8 (OKLab ΔE × 100) under simulated protanopia and deuteranopia and at least 15 with normal vision. Light mode's likely pathogenic, VUS and likely benign are under 3:1 against white, so labels inside them are near-black and every chart has its table.

| Category | Light | Dark |
| --- | --- | --- |
| Pathogenic | `#c62f2f` | `#e66767` |
| Likely pathogenic | `#ef8c89` | `#ab3c3a` |
| Low penetrance / risk allele | `#6250d6` | `#9085e9` |
| Conflict: P/LP vs VUS/LB/B | `#c0418a` | `#d55181` |
| VUS | `#eda100` | `#c98500` |
| Conflict: VUS vs LB/B | `#2a78d6` | `#3987e5` |
| Likely benign | `#6cc58a` | `#0b7a4e` |
| Benign | `#008300` | `#4aaa3c` |
| No classification, Unmapped | `#898781` | `#898781` |

Reconsider a library if we want scatter plots, maps or interaction beyond tooltips.

## Steps

1. ~~Shared contracts~~ and 2. ~~server~~ (11 November 2026): the figure list, options and long-format response, the category rules, the six figures' SQL, the routes, the cache and CSV, with tests over the fixture and a two-release history.
3. ~~Web~~ (11 November 2026): the charts, the figure pages and the overview, with browser tests.
4. Measure each figure on Cloud Run; decide on caching ahead of requests or a stats table if needed.
5. At the next rebuild: `strength_code` and `penetrance_level` into `classification_term`, and the stats code reads them from there.

## Open questions

1. **A pie for `submitter-agreement`,** as on the slide? A segmented bar for now (above).
2. **Earlier years:** the slides go back to 2023. A backfill (NCBI's archived `variant_summary` files, or bq-tools' BigQuery tables) is later work ([data.md](data.md#history)).
