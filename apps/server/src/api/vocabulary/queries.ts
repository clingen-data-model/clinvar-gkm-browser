import { Vocabularies } from '@cvb/shared/api';
import {
  CONDITION_MATCH_LABELS,
  CONFLICT_LEVELS,
  CONFLICT_STATUSES,
  FILTERS,
  GENE_RELATIONSHIPS,
  RESOURCES,
  type Resource,
} from '@cvb/shared/query';
import type { Database } from '../../data/database.ts';

export async function vocabularies(db: Database, release: string): Promise<Vocabularies> {
  const [types, terms, statuses, levels, placeholders] = await Promise.all([
    db.query(
      release,
      `SELECT code, lane, label, conflict_detectable AS "conflictDetectable"
       FROM classification_type WHERE statement_level ORDER BY display_order`,
    ),
    db.query(
      release,
      `SELECT classification_type AS "classificationType", term, label, significance, bucket
       FROM classification_term ORDER BY classification_type, display_order`,
    ),
    db.query(
      release,
      `SELECT status, stars, current FROM review_status ORDER BY rank DESC, status`,
    ),
    db.query(
      release,
      `SELECT code, quality_name AS label, rank FROM submission_level ORDER BY rank DESC`,
    ),
    db.query(release, `SELECT id AS condition_id FROM condition WHERE placeholder ORDER BY 1`),
  ]);
  const dimensions = (r: Resource) =>
    [...r.dimensions.values()].map(({ name, label }) => ({ name, label }));
  return Vocabularies.parse({
    classificationTypes: types,
    terms,
    reviewStatuses: statuses,
    submissionLevels: levels,
    filters: FILTERS.map(({ name, label, description }) => ({ name, label, description })),
    dimensions: {
      scvs: dimensions(RESOURCES.scvs),
      pairs: dimensions(RESOURCES.pairs),
      variants: dimensions(RESOURCES.variants),
    },
    conflictLevels: CONFLICT_LEVELS,
    conflictStatuses: CONFLICT_STATUSES,
    conditionMatches: Object.entries(CONDITION_MATCH_LABELS).map(([code, label]) => ({
      code,
      label,
    })),
    geneRelationships: Object.entries(GENE_RELATIONSHIPS).map(([code, r]) => ({
      code,
      label: r.label,
    })),
    placeholderConditions: placeholders.map((r) => r['condition_id']),
  });
}
