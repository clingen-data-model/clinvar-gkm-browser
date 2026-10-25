import { Vocabularies } from '@cvb/shared/api';
import { DIMENSIONS, FILTERS } from '@cvb/shared/query';
import type { Database } from '../../data/database.ts';

export async function vocabularies(db: Database, release: string): Promise<Vocabularies> {
  const [types, terms, statuses, levels] = await Promise.all([
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
  ]);
  return Vocabularies.parse({
    classificationTypes: types,
    terms,
    reviewStatuses: statuses,
    submissionLevels: levels,
    filters: FILTERS.map(({ name, label, description }) => ({ name, label, description })),
    dimensions: DIMENSIONS.map(({ name, label }) => ({ name, label })),
  });
}
