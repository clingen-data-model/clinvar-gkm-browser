-- ClinVar GKM browser: derived database schema, version 1.
--
-- Built from one ClinVar-GKM parquet release (v1/1.1) by load.sql. See docs/schema.md for the
-- design, the source of every column, and the load order.
--
-- Conventions:
--   * Upstream numeric ids become INTEGER keys named <entity>_id (variation_id 10 for 'clinvar:10').
--     GA4GH digest ids (VRS, refget) and therapy hashes stay VARCHAR, as published.
--   * Surrogate keys, where upstream has no usable id, are INTEGER columns named <entity>_key.
--   * DuckDB can't add a FOREIGN KEY after CREATE TABLE, so every constraint is declared here and
--     tables are created (and loaded) parents first.
--   * Closed vocabularies are lookup tables seeded below, not ENUMs, so they carry labels and
--     ordering, and a value upstream adds fails the load at its FOREIGN KEY instead of loading
--     silently. Adding one is a schema version bump.

-- ---------------------------------------------------------------------------------------------
-- Release metadata

CREATE TABLE release (
    clinvar_release      DATE      NOT NULL,  -- ClinVar's release date, e.g. 2026-10-18
    parquet_build_date   TIMESTAMP NOT NULL,  -- when ClinVar-GKM built the parquet set
    gkm_schema_version   VARCHAR   NOT NULL,  -- ClinVar-GKM's schema version, e.g. 1.1.0
    gkm_dataset          VARCHAR   NOT NULL,  -- e.g. clinvar_2026_10_18_v2_6_0
    derived_schema       INTEGER   NOT NULL,  -- this schema's version
    loaded_at            TIMESTAMP NOT NULL
);

CREATE TABLE source_file (
    name    VARCHAR PRIMARY KEY,  -- e.g. scv.parquet
    size    BIGINT  NOT NULL,
    sha256  VARCHAR NOT NULL
);

-- References the data breaks, found by reference-checks.sql (generated from the REFERENCES
-- clauses in this file, enforced or not) after the load. One row per dangling value. The data is
-- kept as upstream published it; this table says where it doesn't hold together.
CREATE TABLE reference_issue (
    child_table    VARCHAR NOT NULL,
    child_column   VARCHAR NOT NULL,
    parent_table   VARCHAR NOT NULL,
    parent_column  VARCHAR NOT NULL,
    missing_value  VARCHAR NOT NULL,
    row_count      BIGINT  NOT NULL
);

-- ---------------------------------------------------------------------------------------------
-- Vocabularies

-- The classification vocabulary follows ClinGen's BigQuery tooling, so this app agrees with the
-- curator reports built there: clingen-data-model/clinvar-ingest-bq-tools,
-- scripts/dataset-preparation/00-setup-translation-tables.sql at 2ca57d8 (2026-10-20):
-- clinvar_proposition_types, clinvar_clinsig_types, status_definitions, submission_level.

-- Classification types: the code in a proposition or statement id (SCV000056982-ASSOC,
-- VCV000051592.122-G-PATH-CP). Lane G is germline, S somatic. conflict_detectable: whether two
-- SCVs of this type can conflict (bq-tools' clinvar_proposition_types.conflict_detectable).
CREATE TABLE classification_type (
    code                 VARCHAR PRIMARY KEY,
    lane                 VARCHAR NOT NULL CHECK (lane IN ('G', 'S')),
    proposition_type     VARCHAR NOT NULL UNIQUE,
    label                VARCHAR NOT NULL,
    statement_level      BOOLEAN NOT NULL,  -- false: only targeted by SCV evidence lines (DIAG, PROG, TR)
    conflict_detectable  BOOLEAN NOT NULL,
    display_order        INTEGER NOT NULL
);

INSERT INTO classification_type VALUES
    ('PATH',    'G', 'VariantPathogenicityProposition',                'Pathogenicity',                     true,  true,  10),
    ('SCI',     'S', 'VariantClinicalSignificanceProposition',         'Somatic clinical impact',           true,  false, 11),
    ('ONCO',    'S', 'VariantOncogenicityProposition',                 'Oncogenicity',                      true,  true,  12),
    ('AFF',     'G', 'ClinvarAffectsProposition',                      'Affects',                           true,  false, 20),
    ('ASSOC',   'G', 'ClinvarAssociationProposition',                  'Association',                       true,  false, 30),
    ('CDFS',    'G', 'ClinvarConflictingDataFromSubmitterProposition', 'Conflicting data from submitters',  true,  false, 35),
    ('CS',      'G', 'ClinvarConfersSensitivityProposition',           'Confers sensitivity',               true,  false, 40),
    ('DR',      'G', 'ClinvarDrugResponseProposition',                 'Drug response',                     true,  false, 50),
    ('NP',      'G', 'ClinvarNotProvidedProposition',                  'Not provided',                      true,  false, 60),
    ('OTH',     'G', 'ClinvarOtherProposition',                        'Other',                             true,  false, 70),
    ('PROTECT', 'G', 'ClinvarProtectiveProposition',                   'Protective',                        true,  false, 80),
    ('RF',      'G', 'ClinvarRiskFactorProposition',                   'Risk factor',                       true,  false, 90),
    ('UNDEF',   'G', 'ClinvarUndefinedProposition',                    'Undefined',                         true,  false, 95),
    ('PROG',    'S', 'VariantPrognosticProposition',                   'Prognostic',                        false, false, 100),
    ('DIAG',    'S', 'VariantDiagnosticProposition',                   'Diagnostic',                        false, false, 110),
    ('TR',      'S', 'VariantTherapeuticResponseProposition',          'Therapeutic response',              false, false, 120);

-- Classification terms, per classification type (bq-tools' clinvar_clinsig_types). source_code is
-- ClinVar-GKM's classification.primaryCoding.code, lower-cased: the key an SCV is matched on.
-- significance: 2 P/LP (clinically significant), 1 uncertain, 0 B/LB (not significant).
-- bucket: P, V, B for the conflict-detectable types; O (other) and N (not provided) elsewhere.
CREATE TABLE classification_term (
    classification_type  VARCHAR NOT NULL REFERENCES classification_type (code),
    term                 VARCHAR NOT NULL,  -- bq-tools' code: p, lp, vus-h, era, t1, ...
    source_code          VARCHAR NOT NULL,
    label                VARCHAR NOT NULL,
    significance         INTEGER NOT NULL CHECK (significance BETWEEN 0 AND 2),
    bucket               VARCHAR NOT NULL CHECK (bucket IN ('P', 'V', 'B', 'O', 'N')),
    display_order        INTEGER NOT NULL,
    PRIMARY KEY (classification_type, term),
    UNIQUE (classification_type, source_code)
);

INSERT INTO classification_term VALUES
    ('PATH', 'p',      'pathogenic',                        'Pathogenic',                        2, 'P', 10),
    ('PATH', 'lp',     'likely pathogenic',                 'Likely pathogenic',                 2, 'P', 11),
    ('PATH', 'p/lp',   'pathogenic/likely pathogenic',      'Pathogenic/Likely pathogenic',      2, 'P', 12),
    ('PATH', 'p-lp',   'pathogenic, low penetrance',        'Pathogenic, low penetrance',        2, 'P', 13),
    ('PATH', 'lp-lp',  'likely pathogenic, low penetrance', 'Likely pathogenic, low penetrance', 2, 'P', 14),
    ('PATH', 'era',    'established risk allele',           'Established risk allele',           2, 'P', 15),
    ('PATH', 'lra',    'likely risk allele',                'Likely risk allele',                2, 'P', 16),
    ('PATH', 'vus',    'uncertain significance',            'Uncertain significance',            1, 'V', 20),
    ('PATH', 'vus-h',  'vus-high',                          'VUS-high',                          1, 'V', 21),
    ('PATH', 'vus-m',  'vus-mid',                           'VUS-mid',                           1, 'V', 22),
    ('PATH', 'vus-l',  'vus-low',                           'VUS-low',                           1, 'V', 23),
    ('PATH', 'ura',    'uncertain risk allele',             'Uncertain risk allele',             1, 'V', 25),
    ('PATH', 'b',      'benign',                            'Benign',                            0, 'B', 30),
    ('PATH', 'lb',     'likely benign',                     'Likely benign',                     0, 'B', 31),
    ('PATH', 'b/lb',   'benign/likely benign',              'Benign/Likely benign',              0, 'B', 32),
    ('ONCO', 'o',      'oncogenic',                         'Oncogenic',                         2, 'P', 10),
    ('ONCO', 'lo',     'likely oncogenic',                  'Likely oncogenic',                  2, 'P', 11),
    ('ONCO', 'vus',    'uncertain significance',            'Uncertain significance',            1, 'V', 20),
    ('ONCO', 'b',      'benign',                            'Benign',                            0, 'B', 30),
    ('ONCO', 'lb',     'likely benign',                     'Likely benign',                     0, 'B', 31),
    ('ONCO', 'b/lb',   'benign/likely benign',              'Benign/Likely benign',              0, 'B', 32),
    ('SCI',  't1',     'tier 1',                            'Tier I (Strong)',                   2, 'O', 10),
    ('SCI',  't2',     'tier 2',                            'Tier II (Potential)',               2, 'O', 11),
    ('SCI',  't3',     'tier 3',                            'Tier III (Unknown)',                1, 'O', 20),
    ('SCI',  't4',     'tier 4',                            'Tier IV (Benign/Likely benign)',    0, 'O', 32),
    ('AFF',     'aff',     'affects',                          'Affects',                          2, 'O', 100),
    ('ASSOC',   'assoc',   'association',                      'Association',                      2, 'O', 110),
    ('ASSOC',   'assocnf', 'association not found',            'Association not found',            0, 'O', 111),
    ('CDFS',    'cdfs',    'conflicting data from submitters', 'Conflicting data from submitters', 1, 'O', 115),
    ('CS',      'cs',      'confers sensitivity',              'Confers sensitivity',              2, 'O', 120),
    ('DR',      'dr',      'drug response',                    'Drug response',                    2, 'O', 130),
    ('NP',      'np',      'not provided',                     'Not provided',                     0, 'N', 140),
    ('OTH',     'oth',     'other',                            'Other',                            0, 'O', 150),
    ('PROTECT', 'protect', 'protective',                       'Protective',                       0, 'O', 160),
    ('RF',      'rf',      'risk factor',                      'Risk factor',                      2, 'O', 170);

-- Submission levels: an SCV's quality.name, and the level suffix of aggregate statements.
-- rank as in bq-tools' submission_level; the highest present sets an aggregate's call, and FLAG
-- never does.
CREATE TABLE submission_level (
    code          VARCHAR PRIMARY KEY,
    quality_name  VARCHAR NOT NULL UNIQUE,
    rank          INTEGER NOT NULL UNIQUE
);

INSERT INTO submission_level VALUES
    ('PG',   'practice guidelines',            4),
    ('EP',   'expert panel',                   3),
    ('CP',   'criteria provided',              1),
    ('NOCP', 'no assertion criteria provided', 0),
    ('NOCL', 'no classification',              -1),
    ('FLAG', 'flagged',                        -3);

-- Review statuses, SCV and aggregate, with bq-tools' rank (status_definitions) and ClinVar's
-- stars (the rank, floored at 0). Includes statuses ClinVar has retired, for older releases.
CREATE TABLE review_status (
    status   VARCHAR PRIMARY KEY,
    rank     INTEGER NOT NULL,
    stars    INTEGER NOT NULL CHECK (stars BETWEEN 0 AND 4),
    current  BOOLEAN NOT NULL  -- false: retired by ClinVar in 2024
);

INSERT INTO review_status VALUES
    ('practice guideline',                                     4,  4, true),
    ('reviewed by expert panel',                               3,  3, true),
    ('criteria provided, multiple submitters, no conflicts',   2,  2, true),
    ('criteria provided, multiple submitters',                 2,  2, true),
    ('criteria provided, conflicting classifications',         1,  1, true),
    ('criteria provided, single submitter',                    1,  1, true),
    ('no assertion criteria provided',                         0,  0, true),
    ('no classification provided',                             -1, 0, true),
    ('no classification for the single variant',               -2, 0, true),
    ('no classifications from unflagged records',              -3, 0, true),
    ('flagged submission',                                     -3, 0, true),
    ('criteria provided, conflicting interpretations',         1,  1, false),
    ('no assertion provided',                                  -1, 0, false),
    ('no interpretation for the single variant',               -2, 0, false);

-- ---------------------------------------------------------------------------------------------
-- Genome: VRS objects

CREATE TABLE sequence_reference (
    sequence_reference_id  VARCHAR PRIMARY KEY,  -- refget id, 'SQ.<digest>'
    accession              VARCHAR NOT NULL,     -- RefSeq, e.g. NC_000017.11
    molecule_type          VARCHAR NOT NULL      -- genomic, mRNA, RNA
);

CREATE TABLE location (
    location_id            VARCHAR PRIMARY KEY,  -- 'ga4gh:SL.<digest>'
    sequence_reference_id  VARCHAR NOT NULL REFERENCES sequence_reference (sequence_reference_id),
    loc_start              BIGINT,  -- interbase; NULL when the start is an uncertain range
    loc_end                BIGINT,  -- interbase; NULL when the end is an uncertain range
    loc_start_min          BIGINT,
    loc_start_max          BIGINT NOT NULL,
    loc_end_min            BIGINT NOT NULL,
    loc_end_max            BIGINT
);

CREATE TABLE allele (
    allele_id                   VARCHAR PRIMARY KEY,  -- 'ga4gh:VA.<digest>'
    location_id                 VARCHAR NOT NULL REFERENCES location (location_id),
    hgvs_g                      VARCHAR,  -- e.g. NC_000016.10:g.376236G>A
    spdi                        VARCHAR,
    -- gnomAD-style VCF key, chrom-pos-ref-alt on GRCh38, left-aligned as in VCF. Split into
    -- columns for matching uploaded VCF records.
    vcf_key                     VARCHAR,
    vcf_chrom                   VARCHAR,
    vcf_pos                     BIGINT,
    vcf_ref                     VARCHAR,
    vcf_alt                     VARCHAR,
    state_type                  VARCHAR NOT NULL,  -- LiteralSequenceExpression or ReferenceLengthExpression
    state_sequence              VARCHAR,
    state_length                BIGINT,
    state_repeat_subunit_length BIGINT
);

CREATE TABLE copy_number (
    copy_number_id  VARCHAR PRIMARY KEY,  -- 'ga4gh:CN.<digest>' (count) or 'ga4gh:CX.<digest>' (change)
    kind            VARCHAR NOT NULL CHECK (kind IN ('count', 'change')),
    location_id     VARCHAR NOT NULL REFERENCES location (location_id),
    copies          INTEGER,  -- count only
    copy_change     VARCHAR,  -- change only: gain or loss
    CHECK ((kind = 'count') = (copies IS NOT NULL)),
    CHECK ((kind = 'change') = (copy_change IS NOT NULL))
);

-- ---------------------------------------------------------------------------------------------
-- Genes and variants

CREATE TABLE gene (
    gene_id  INTEGER PRIMARY KEY,  -- NCBI Gene id
    symbol   VARCHAR NOT NULL
);

-- One row per ClinVar variation (VCV). A variant is defined by at most one VRS object: an allele,
-- or a copy-number variant with its defining location. 12.9k variants have neither.
CREATE TABLE variant (
    variation_id                 INTEGER PRIMARY KEY,
    vcv_version                  INTEGER,  -- from the VCV statements; NULL if ClinVar has no VCV for it
    name                         VARCHAR NOT NULL,
    clinvar_variation_type       VARCHAR NOT NULL,  -- e.g. single nucleotide variant, Deletion
    clinvar_subclass_type        VARCHAR NOT NULL,  -- SimpleAllele, Haplotype, Genotype
    categorical_variation_type   VARCHAR NOT NULL,
    defining_vrs_variation_type  VARCHAR NOT NULL,
    cytogenetic_location         VARCHAR,
    vrs_preprocessing_issue      VARCHAR,
    vrs_processing_exception     VARCHAR,
    allele_id                    VARCHAR REFERENCES allele (allele_id),
    copy_number_id               VARCHAR REFERENCES copy_number (copy_number_id),
    defining_location_id         VARCHAR REFERENCES location (location_id),
    CHECK (allele_id IS NULL OR copy_number_id IS NULL)
);

-- The variant's gene list (clinvarGeneList): every gene ClinVar relates it to, including genes a
-- large CNV only overlaps. Not the per-SCV gene context (scv.gene_context_id).
CREATE TABLE variant_gene (
    variation_id       INTEGER NOT NULL REFERENCES variant (variation_id),
    gene_id            INTEGER NOT NULL REFERENCES gene (gene_id),
    relationship_type  VARCHAR NOT NULL,  -- within single gene, genes overlapped by variant, ...
    source             VARCHAR NOT NULL,  -- submitted or calculated
    PRIMARY KEY (variation_id, gene_id)
);

-- The variant's HGVS list (clinvarHgvsList), one row per expression.
CREATE TABLE variant_hgvs (
    variation_id            INTEGER  NOT NULL REFERENCES variant (variation_id),
    ordinal                 SMALLINT NOT NULL,  -- position in ClinVar's list, from 1
    syntax                  VARCHAR,            -- hgvs.c, hgvs.g, hgvs.n, hgvs.m, hgvs.r
    expression              VARCHAR,
    nucleotide_type         VARCHAR,            -- coding, genomic, genomic top-level, non-coding
    protein_expression      VARCHAR,
    mane_select             BOOLEAN  NOT NULL,
    mane_plus               BOOLEAN  NOT NULL,
    molecular_consequences  VARCHAR[]           -- Sequence Ontology names, e.g. [missense_variant]
);

-- The variant's identifiers in other systems: dbSNP, ClinGen Allele Registry, dbVar, OMIM, ...
CREATE TABLE variant_xref (
    variation_id  INTEGER NOT NULL REFERENCES variant (variation_id),
    system        VARCHAR NOT NULL,
    code          VARCHAR NOT NULL,
    relation      VARCHAR NOT NULL
);

-- ---------------------------------------------------------------------------------------------
-- Conditions and therapies

CREATE TABLE condition (
    condition_id  INTEGER PRIMARY KEY,  -- ClinVar trait id, from 'clinvar.trait:<n>'
    name          VARCHAR NOT NULL,
    concept_type  VARCHAR NOT NULL,     -- Disease, Phenotype, Trait, Condition
    medgen_id     VARCHAR,              -- MedGen CUI; NULL for 10.6k traits
    aliases       VARCHAR[]
);

-- MONDO, OMIM, Orphanet, HPO, ... mappings of a condition.
CREATE TABLE condition_xref (
    condition_id  INTEGER NOT NULL REFERENCES condition (condition_id),
    system        VARCHAR NOT NULL,
    code          VARCHAR NOT NULL,
    name          VARCHAR,
    relation      VARCHAR NOT NULL
);

-- ClinVar TraitSets ('clinvar.traitset:<n>') and sets ClinVar-GKM mints for VCV aggregates
-- ('clinvar.conditionset:vcv-<md5>').
CREATE TABLE condition_set (
    condition_set_key    INTEGER PRIMARY KEY,
    condition_set_id     VARCHAR NOT NULL UNIQUE,
    traitset_id          INTEGER,  -- ClinVar TraitSet id; NULL for minted sets
    set_type             VARCHAR,  -- Disease, Finding, TraitChoice, DrugResponse; NULL for minted sets
    membership_operator  VARCHAR NOT NULL CHECK (membership_operator IN ('AND', 'OR'))
);

-- A set's direct members: a condition, or (in minted sets only) a TraitSet, one level deep.
CREATE TABLE condition_set_member (
    condition_set_key  INTEGER NOT NULL REFERENCES condition_set (condition_set_key),
    condition_id       INTEGER REFERENCES condition (condition_id),
    member_set_key     INTEGER REFERENCES condition_set (condition_set_key),
    CHECK ((condition_id IS NULL) <> (member_set_key IS NULL))
);

CREATE TABLE therapy (
    therapy_id  VARCHAR PRIMARY KEY,  -- 'clinvar.therapy:<sha256>'
    name        VARCHAR NOT NULL
);

CREATE TABLE therapy_group (
    therapy_group_id     VARCHAR PRIMARY KEY,  -- 'clinvar.therapygroup:<sha256>'
    membership_operator  VARCHAR NOT NULL
);

CREATE TABLE therapy_group_member (
    therapy_group_id  VARCHAR NOT NULL REFERENCES therapy_group (therapy_group_id),
    therapy_id        VARCHAR NOT NULL REFERENCES therapy (therapy_id),
    PRIMARY KEY (therapy_group_id, therapy_id)
);

CREATE TABLE submitter (
    submitter_id  INTEGER PRIMARY KEY,  -- ClinVar organization id
    name          VARCHAR NOT NULL
);

-- ---------------------------------------------------------------------------------------------
-- Aggregate statements (VCV and RCV)
--
-- Each accession is a small tree: a root statement per classification type, citing one statement
-- per submission level, each citing its SCVs. Somatic clinical impact adds a tier between level and
-- SCVs. parent_key points one step up; contributes says whether the node counts toward its
-- parent's call. Upstream's propositions are 1:1 with statements, so their object and predicate
-- are columns here.

CREATE TABLE vcv_statement (
    vcv_statement_key    INTEGER PRIMARY KEY,
    statement_id         VARCHAR NOT NULL,  -- e.g. VCV000051592.122-G-PATH-CP; unique (checked by validate.sql, not indexed)
    variation_id         INTEGER NOT NULL REFERENCES variant (variation_id),
    classification_type  VARCHAR NOT NULL REFERENCES classification_type (code),
    node_kind            VARCHAR NOT NULL CHECK (node_kind IN ('root', 'level', 'tier')),
    submission_level     VARCHAR REFERENCES submission_level (code),  -- NULL on roots
    tier                 VARCHAR CHECK (tier IN ('T1', 'T2', 'T3', 'T4')),  -- somatic clinical impact tiers only
    parent_key           INTEGER REFERENCES vcv_statement (vcv_statement_key),  -- NULL on roots
    contributes          BOOLEAN,  -- toward the parent's call; NULL on roots
    classification       VARCHAR,  -- the aggregate call, e.g. Pathogenic, Conflicting classifications of pathogenicity
    conflicting_explanation VARCHAR,  -- e.g. Pathogenic(40); Likely pathogenic(2)
    review_status        VARCHAR REFERENCES review_status (status),
    direction            VARCHAR NOT NULL,
    strength             VARCHAR,
    predicate            VARCHAR NOT NULL,
    condition_id         INTEGER REFERENCES condition (condition_id),
    condition_set_key    INTEGER REFERENCES condition_set (condition_set_key),
    CHECK ((node_kind = 'root') = (parent_key IS NULL)),
    CHECK ((node_kind = 'root') = (submission_level IS NULL)),
    CHECK ((node_kind = 'tier') = (tier IS NOT NULL)),
    CHECK (condition_id IS NULL OR condition_set_key IS NULL)
);

CREATE TABLE rcv_statement (
    rcv_statement_key    INTEGER PRIMARY KEY,
    statement_id         VARCHAR NOT NULL,  -- e.g. RCV003486676.1-G-PATH-CP; unique (checked by validate.sql, not indexed)
    rcv_accession        INTEGER NOT NULL,         -- 3486676 for RCV003486676
    rcv_version          INTEGER NOT NULL,
    variation_id         INTEGER NOT NULL REFERENCES variant (variation_id),
    classification_type  VARCHAR NOT NULL REFERENCES classification_type (code),
    node_kind            VARCHAR NOT NULL CHECK (node_kind IN ('root', 'level', 'tier')),
    submission_level     VARCHAR REFERENCES submission_level (code),
    tier                 VARCHAR CHECK (tier IN ('T1', 'T2', 'T3', 'T4')),
    parent_key           INTEGER REFERENCES rcv_statement (rcv_statement_key),
    contributes          BOOLEAN,
    classification       VARCHAR,
    conflicting_explanation VARCHAR,
    review_status        VARCHAR REFERENCES review_status (status),
    direction            VARCHAR NOT NULL,
    strength             VARCHAR,
    predicate            VARCHAR NOT NULL,
    condition_id         INTEGER REFERENCES condition (condition_id),
    condition_set_key    INTEGER REFERENCES condition_set (condition_set_key),
    CHECK ((node_kind = 'root') = (parent_key IS NULL)),
    CHECK ((node_kind = 'root') = (submission_level IS NULL)),
    CHECK ((node_kind = 'tier') = (tier IS NOT NULL)),
    CHECK (condition_id IS NULL OR condition_set_key IS NULL)
);

-- ---------------------------------------------------------------------------------------------
-- Submissions (SCV)

-- One row per SCV accession (each appears in one version per release). The proposition (1:1)
-- is folded in: variant, condition, predicate, gene context, inheritance. vcv_statement_key and
-- rcv_statement_key are the aggregate statements that cite the SCV (exactly one of each).
CREATE TABLE scv (
    scv_id                  INTEGER PRIMARY KEY,  -- 20176 for SCV000020176
    scv_version             INTEGER NOT NULL,
    variation_id            INTEGER NOT NULL REFERENCES variant (variation_id),
    submitter_id            INTEGER NOT NULL REFERENCES submitter (submitter_id),
    classification_type     VARCHAR NOT NULL REFERENCES classification_type (code),
    submission_level        VARCHAR NOT NULL REFERENCES submission_level (code),
    review_status           VARCHAR NOT NULL REFERENCES review_status (status),
    classification          VARCHAR,  -- as ClinVar shows it, e.g. Likely benign; not case-normalized
    classification_code     VARCHAR,  -- primaryCoding.code as published, e.g. likely benign
    -- The matched classification_term (on classification_type and lower(classification_code));
    -- NULL when unmapped, which is recorded in reference_issue.
    term                    VARCHAR,
    submitted_classification VARCHAR, -- the submitter's own term, where it differs
    direction               VARCHAR NOT NULL,  -- supports, disputes, neutral
    strength                VARCHAR,           -- Definitive, Likely, Strong, Potential
    collection_methods      VARCHAR[],         -- e.g. [clinical testing]; several for some SCVs
    assertion_criteria      VARCHAR,           -- specifiedBy.name, e.g. ACMG Guidelines, 2015
    description             VARCHAR,           -- the submitter's comment
    date_submitted          DATE,
    date_created            DATE,
    date_last_evaluated     DATE,
    local_key               VARCHAR,
    predicate               VARCHAR NOT NULL,
    condition_id            INTEGER REFERENCES condition (condition_id),
    condition_set_key       INTEGER REFERENCES condition_set (condition_set_key),
    mode_of_inheritance     VARCHAR,
    penetrance              VARCHAR,
    -- REFERENCES gene (gene_id) NOT ENFORCED: upstream names genes its gene table lacks
    -- (3 genes, 31 SCVs in 2026-10-18). Kept as published; listed in reference_issue.
    gene_context_id         INTEGER,
    gene_context_symbol     VARCHAR,  -- for submittedNotNormalized, the submitter's symbol(s)
    gene_context_source     VARCHAR,
    submitted_gene_symbols  VARCHAR[],
    vcv_statement_key       INTEGER NOT NULL REFERENCES vcv_statement (vcv_statement_key),
    rcv_statement_key       INTEGER NOT NULL REFERENCES rcv_statement (rcv_statement_key),
    CHECK ((condition_id IS NULL) <> (condition_set_key IS NULL))
);

-- Citations (reportedIn), one row per ClinVar citation.
CREATE TABLE scv_citation (
    scv_id         INTEGER  NOT NULL REFERENCES scv (scv_id),
    ordinal        SMALLINT NOT NULL,
    pmid           VARCHAR,
    doi            VARCHAR,
    urls           VARCHAR[],
    name           VARCHAR,
    document_type  VARCHAR
);

-- The condition(s) as the submitter gave them, with how ClinVar-GKM matched each to a trait.
CREATE TABLE scv_submitted_condition (
    scv_id                 INTEGER  NOT NULL REFERENCES scv (scv_id),
    ordinal                SMALLINT NOT NULL,
    name                   VARCHAR,
    concept_type           VARCHAR,
    medgen_id              VARCHAR,
    condition_id           INTEGER REFERENCES condition (condition_id),  -- the matched trait, if any
    normalized_resolution  VARCHAR,
    mapping_type           VARCHAR,
    mapping_ref            VARCHAR,
    mapping_value          VARCHAR
);

-- Every condition an SCV is about, with condition sets expanded (nested TraitSets included).
-- The table for condition pivots and same-condition conflict checks.
CREATE TABLE scv_condition (
    scv_id                 INTEGER NOT NULL REFERENCES scv (scv_id),
    condition_id           INTEGER NOT NULL REFERENCES condition (condition_id),
    via_condition_set_key  INTEGER REFERENCES condition_set (condition_set_key),  -- NULL when direct
    PRIMARY KEY (scv_id, condition_id)
);

-- Somatic clinical impact SCVs: the specific impact (diagnostic, prognostic, therapeutic
-- response) and its AMP/ASCO/CAP tier. Upstream's evidenceLine plus its target proposition.
CREATE TABLE scv_somatic_impact (
    scv_id                  INTEGER PRIMARY KEY REFERENCES scv (scv_id),
    impact_type             VARCHAR NOT NULL REFERENCES classification_type (code),  -- DIAG, PROG, TR
    evidence_outcome        VARCHAR,  -- Level A/B (Tier I), Level C/D (Tier II)
    direction               VARCHAR,
    predicate               VARCHAR,
    condition_id            INTEGER REFERENCES condition (condition_id),
    condition_set_key       INTEGER REFERENCES condition_set (condition_set_key),
    therapy_id              VARCHAR REFERENCES therapy (therapy_id),
    therapy_group_id        VARCHAR REFERENCES therapy_group (therapy_group_id),
    condition_qualifier_id  INTEGER REFERENCES condition (condition_id)  -- tumor type, therapeutic response only
);
