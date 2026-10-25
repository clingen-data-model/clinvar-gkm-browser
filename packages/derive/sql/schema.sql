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

-- Classification types: the code in a proposition or statement id (SCV000056982-ASSOC,
-- VCV000051592.122-G-PATH-CP). Lane G is germline, S somatic.
CREATE TABLE classification_type (
    code              VARCHAR PRIMARY KEY,
    lane              VARCHAR NOT NULL CHECK (lane IN ('G', 'S')),
    proposition_type  VARCHAR NOT NULL UNIQUE,
    label             VARCHAR NOT NULL,
    statement_level   BOOLEAN NOT NULL  -- false: only targeted by SCV evidence lines (DIAG, PROG, TR)
);

INSERT INTO classification_type VALUES
    ('PATH',    'G', 'VariantPathogenicityProposition',                'Pathogenicity',                     true),
    ('NP',      'G', 'ClinvarNotProvidedProposition',                  'Not provided',                      true),
    ('DR',      'G', 'ClinvarDrugResponseProposition',                 'Drug response',                     true),
    ('OTH',     'G', 'ClinvarOtherProposition',                        'Other',                             true),
    ('RF',      'G', 'ClinvarRiskFactorProposition',                   'Risk factor',                       true),
    ('ASSOC',   'G', 'ClinvarAssociationProposition',                  'Association',                       true),
    ('AFF',     'G', 'ClinvarAffectsProposition',                      'Affects',                           true),
    ('CDFS',    'G', 'ClinvarConflictingDataFromSubmitterProposition', 'Conflicting data from submitters',  true),
    ('PROTECT', 'G', 'ClinvarProtectiveProposition',                   'Protective',                        true),
    ('CS',      'G', 'ClinvarConfersSensitivityProposition',           'Confers sensitivity',               true),
    ('UNDEF',   'G', 'ClinvarUndefinedProposition',                    'Undefined',                         true),
    ('ONCO',    'S', 'VariantOncogenicityProposition',                 'Oncogenicity',                      true),
    ('SCI',     'S', 'VariantClinicalSignificanceProposition',         'Somatic clinical impact',           true),
    ('DIAG',    'S', 'VariantDiagnosticProposition',                   'Diagnostic',                        false),
    ('PROG',    'S', 'VariantPrognosticProposition',                   'Prognostic',                        false),
    ('TR',      'S', 'VariantTherapeuticResponseProposition',          'Therapeutic response',              false);

-- Submission levels: an SCV's quality.name, and the level suffix of aggregate statements.
CREATE TABLE submission_level (
    code          VARCHAR PRIMARY KEY,
    quality_name  VARCHAR NOT NULL UNIQUE,
    precedence    INTEGER NOT NULL  -- the highest level present sets an aggregate's call; FLAG never does
);

INSERT INTO submission_level VALUES
    ('PG',   'practice guidelines',            5),
    ('EP',   'expert panel',                   4),
    ('CP',   'criteria provided',              3),
    ('NOCP', 'no assertion criteria provided', 2),
    ('NOCL', 'no classification',              1),
    ('FLAG', 'flagged',                        0);

-- Review statuses, SCV and aggregate, with ClinVar's star rating.
CREATE TABLE review_status (
    status  VARCHAR PRIMARY KEY,
    stars   INTEGER NOT NULL CHECK (stars BETWEEN 0 AND 4)
);

INSERT INTO review_status VALUES
    ('practice guideline',                                   4),
    ('reviewed by expert panel',                             3),
    ('criteria provided, multiple submitters, no conflicts', 2),
    ('criteria provided, multiple submitters',               2),
    ('criteria provided, conflicting classifications',       1),
    ('criteria provided, single submitter',                  1),
    ('no assertion criteria provided',                       0),
    ('no classification provided',                           0),
    ('flagged submission',                                   0);

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
    classification_code     VARCHAR,  -- primaryCoding.code, e.g. likely_benign
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
