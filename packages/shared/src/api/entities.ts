// Entity responses: what a detail page needs in one request (docs/api.md#resources).
import { z } from 'zod';

const Gene = z.object({ geneId: z.int(), symbol: z.string() });

export const VariantGene = Gene.extend({
  /** Null when upstream names a gene its gene table lacks (docs/schema.md#faithful-to-upstream). */
  symbol: z.string().nullable(),
  relationshipType: z.string(),
  source: z.string(),
});

export const VariantHgvs = z.object({
  expression: z.string().nullable(),
  syntax: z.string().nullable(),
  nucleotideType: z.string().nullable(),
  proteinExpression: z.string().nullable(),
  maneSelect: z.boolean(),
  manePlus: z.boolean(),
  molecularConsequences: z.array(z.string()).nullable(),
});

export const Xref = z.object({ system: z.string(), code: z.string(), relation: z.string() });

/** A node of a VCV statement tree: root, submission level, or somatic tier. */
export const AggregateStatement = z.object({
  statementId: z.string(),
  parentStatementId: z.string().nullable(),
  classificationType: z.string(),
  nodeKind: z.enum(['root', 'level', 'tier']),
  submissionLevel: z.string().nullable(),
  tier: z.string().nullable(),
  contributes: z.boolean().nullable(),
  classification: z.string().nullable(),
  conflictingExplanation: z.string().nullable(),
  reviewStatus: z.string().nullable(),
  stars: z.int().nullable(),
  scvCount: z.int(),
});

export const VariantDetail = z.object({
  variationId: z.int(),
  vcvAccession: z.string(),
  vcvVersion: z.int().nullable(),
  name: z.string(),
  variationType: z.string(),
  subclassType: z.string(),
  cytogeneticLocation: z.string().nullable(),
  vrs: z
    .object({
      id: z.string(),
      kind: z.enum(['allele', 'copy_number']),
      sequenceAccession: z.string().nullable(),
      start: z.int().nullable(),
      end: z.int().nullable(),
      hgvsG: z.string().nullable(),
      spdi: z.string().nullable(),
      vcfKey: z.string().nullable(),
    })
    .nullable(),
  vrsIssue: z.string().nullable(),
  genes: z.array(VariantGene),
  hgvs: z.array(VariantHgvs),
  xrefs: z.array(Xref),
  aggregates: z.array(AggregateStatement),
  scvCount: z.int(),
});
export type VariantDetail = z.infer<typeof VariantDetail>;

const ConditionRef = z.object({ conditionId: z.int(), name: z.string() });

/** An SCV as a row in a list: enough for a table, not every field. */
export const ScvRow = z.object({
  scvId: z.int(),
  accession: z.string(),
  version: z.int(),
  variationId: z.int(),
  submitter: z.object({ submitterId: z.int(), name: z.string().nullable() }),
  classificationType: z.string(),
  /** ClinVar's text as submitted, e.g. `Likely Benign`. */
  classification: z.string().nullable(),
  /** The normalized term (docs/data.md#conflicts): code, label and bucket; null if unmapped. */
  term: z.string().nullable(),
  termLabel: z.string().nullable(),
  bucket: z.enum(['P', 'V', 'B', 'O', 'N']).nullable(),
  submissionLevel: z.string(),
  reviewStatus: z.string(),
  stars: z.int(),
  collectionMethods: z.array(z.string()).nullable(),
  dateLastEvaluated: z.iso.date().nullable(),
  dateSubmitted: z.iso.date().nullable(),
  conditions: z.array(ConditionRef),
  comment: z.string().nullable(),
  /**
   * In a list filtered by one gene: how this SCV's variant relates to that gene, and the other
   * genes on the variant's gene list (the first few, and how many). Null otherwise.
   */
  geneRelationship: z
    .object({
      relationship: z.enum(['single', 'overlap', 'spanning', 'near', 'asserted']),
      otherGenes: z.array(z.string()),
      otherGeneCount: z.int(),
    })
    .nullable(),
});
export type ScvRow = z.infer<typeof ScvRow>;

export const ScvDetail = ScvRow.extend({
  classificationCode: z.string().nullable(),
  submittedClassification: z.string().nullable(),
  direction: z.string(),
  strength: z.string().nullable(),
  assertionCriteria: z.string().nullable(),
  dateCreated: z.iso.date().nullable(),
  localKey: z.string().nullable(),
  predicate: z.string(),
  modeOfInheritance: z.string().nullable(),
  penetrance: z.string().nullable(),
  geneContext: z
    .object({
      geneId: z.int().nullable(),
      symbol: z.string().nullable(),
      source: z.string().nullable(),
    })
    .nullable(),
  submittedGeneSymbols: z.array(z.string()).nullable(),
  submittedConditions: z.array(
    z.object({
      name: z.string().nullable(),
      medgenId: z.string().nullable(),
      conditionId: z.int().nullable(),
      resolution: z.string().nullable(),
    }),
  ),
  citations: z.array(
    z.object({
      pmid: z.string().nullable(),
      doi: z.string().nullable(),
      urls: z.array(z.string()).nullable(),
      name: z.string().nullable(),
    }),
  ),
  vcvStatementId: z.string(),
  rcvStatementId: z.string(),
});
export type ScvDetail = z.infer<typeof ScvDetail>;

/** Counts shown on gene, condition and submitter pages, by classification type and term. */
export const ClassificationCount = z.object({
  classificationType: z.string(),
  term: z.string().nullable(),
  termLabel: z.string().nullable(),
  bucket: z.enum(['P', 'V', 'B', 'O', 'N']).nullable(),
  scvs: z.int(),
});

export const GeneRelationshipCount = z.object({
  relationship: z.enum(['single', 'overlap', 'spanning', 'near', 'asserted']),
  label: z.string(),
  variants: z.int(),
  scvs: z.int(),
});

export const GeneDetail = Gene.extend({
  /** The relationships the counts below include (the request's gene_relationship). */
  relationships: z.array(z.enum(['single', 'overlap', 'spanning', 'near', 'asserted'])),
  variantCount: z.int(),
  scvCount: z.int(),
  classifications: z.array(ClassificationCount),
  /** Variants and SCVs for each relationship, whether included or not. */
  relationshipCounts: z.array(GeneRelationshipCount),
});
export type GeneDetail = z.infer<typeof GeneDetail>;

export const SubmitterDetail = z.object({
  submitterId: z.int(),
  name: z.string(),
  scvCount: z.int(),
  variantCount: z.int(),
  classifications: z.array(ClassificationCount),
});
export type SubmitterDetail = z.infer<typeof SubmitterDetail>;

export const ConditionDetail = z.object({
  conditionId: z.int(),
  name: z.string(),
  conceptType: z.string(),
  medgenId: z.string().nullable(),
  aliases: z.array(z.string()).nullable(),
  xrefs: z.array(z.object({ system: z.string(), code: z.string(), name: z.string().nullable() })),
  scvCount: z.int(),
  variantCount: z.int(),
  classifications: z.array(ClassificationCount),
});
export type ConditionDetail = z.infer<typeof ConditionDetail>;

/** The gene page's query string: release, and which relationships to count. */
export const GeneQuery = z.object({
  release: z.iso.date().optional(),
  gene_relationship: z.union([z.string(), z.array(z.string())]).optional(),
});

/** A path parameter holding an integer id. */
export const IntId = z.coerce.number().int().positive();

/** /scv-pairs rows: two SCVs on one variant, and their conflict level. */
export const PairRow = z.object({
  variationId: z.int(),
  variantName: z.string(),
  classificationType: z.string(),
  /** 0 to 5 (docs/data.md#conflicts); null if a term is unmapped. */
  level: z.int().nullable(),
  a: ScvRow,
  b: ScvRow,
});
export type PairRow = z.infer<typeof PairRow>;

const BucketCounts = z.object({ P: z.int(), V: z.int(), B: z.int(), O: z.int(), N: z.int() });

/** /variants rows: a variant (for one classification type) and its conflict status. */
export const VariantRow = z.object({
  variationId: z.int(),
  name: z.string(),
  classificationType: z.string(),
  /** single, none, na, or the highest pair level '1' to '5', under the request's filters. */
  conflictLevel: z.string(),
  /** Pairs compared for the status. */
  pairCount: z.int(),
  genes: z.array(z.string()),
  geneCount: z.int(),
  /** ClinVar's aggregate (VCV root) call for the classification type. */
  aggregate: z
    .object({
      classification: z.string().nullable(),
      reviewStatus: z.string().nullable(),
      stars: z.int().nullable(),
    })
    .nullable(),
  scvCount: z.int(),
  submitterCount: z.int(),
  /** SCVs of the classification type by significance bucket. */
  buckets: BucketCounts,
});
export type VariantRow = z.infer<typeof VariantRow>;

/**
 * A span of releases: `from` the first release that has it, `to` the first that no longer does
 * (null while it holds). `fromStart` when `from` is the earliest release available, so it may
 * be older than that.
 */
const ReleaseSpan = z.object({
  from: z.iso.date(),
  to: z.iso.date().nullable(),
  fromStart: z.boolean(),
});

/** A VCV version of a variant, and the releases it held in. */
export const VcvVersion = ReleaseSpan.extend({ version: z.int().nullable() });
export type VcvVersion = z.infer<typeof VcvVersion>;

/** A version of an SCV, as of its last release, and the variant's VCV versions it overlapped. */
export const ScvVersion = ReleaseSpan.extend({
  version: z.int(),
  variationId: z.int(),
  classification: z.string().nullable(),
  reviewStatus: z.string().nullable(),
  dateLastEvaluated: z.iso.date().nullable(),
  vcvVersions: z.array(VcvVersion),
});
export type ScvVersion = z.infer<typeof ScvVersion>;
