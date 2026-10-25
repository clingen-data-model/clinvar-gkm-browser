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
  key: z.int(),
  statementId: z.string(),
  parentKey: z.int().nullable(),
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

export const GeneDetail = Gene.extend({
  variantCount: z.int(),
  scvCount: z.int(),
  classifications: z.array(ClassificationCount),
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

/** A path parameter holding an integer id. */
export const IntId = z.coerce.number().int().positive();
