#!/bin/bash
cd "$(dirname "$0")"
./run2.sh "5 scv nested filter Pathogenic count" 1 300 "SELECT count(*) n FROM '{B}/scv.parquet' WHERE classification.name = 'Pathogenic'"
./run2.sh "6 scv groupby cls x quality t1" 1 300 "SELECT classification.name AS cls, quality.name AS q, count(*) n FROM '{B}/scv.parquet' GROUP BY ALL ORDER BY n DESC LIMIT 6"
./run2.sh "6b scv groupby cls x quality t8" 8 300 "SELECT classification.name AS cls, quality.name AS q, count(*) n FROM '{B}/scv.parquet' GROUP BY ALL ORDER BY n DESC LIMIT 6"
./run2.sh "4 gene_context_name BRCA1 count" 1 300 "SELECT count(*) n FROM '{B}/propositionPathogenicity.parquet' WHERE gene_context_name = 'BRCA1'"
./run2.sh "7 vcv for variant 10 id prefix" 1 300 "SELECT id, classification.name AS cls, extensions FROM '{B}/vcv.parquet' WHERE id LIKE 'VCV000000010.%'"
./run2.sh "3b SCVs for variant t8" 8 300 "SELECT s.id, s.classification.name AS cls, s.contributions, p.object_id FROM '{B}/scv.parquet' s JOIN (SELECT id, object_id FROM '{B}/propositionPathogenicity.parquet' WHERE subject_variant_id = 'clinvar:10') p ON s.proposition_id = p.id"
./run2.sh "8 scv data for one id" 1 300 "SELECT data FROM '{B}/scv.parquet' WHERE id = 'clinvar.submission:SCV000020176.2'"
