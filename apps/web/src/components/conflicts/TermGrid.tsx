import type { SummaryResponse, Vocabularies } from '@cvb/shared/api';
import { Link } from '@tanstack/react-router';
import { LEVEL_CLASS, levelOf, termOf } from '../../lib/conflicts.ts';

interface Props {
  summary: SummaryResponse;
  vocab: Vocabularies;
  /** Axis titles: the rows' side and the columns' side. Null for pairs without sides. */
  sides: [string, string] | null;
  /** The selected cell, to highlight: [row term code, column term code]. */
  selected: [string, string] | null;
}

/**
 * Variants by the pair of terms submitted: rows one side's term, columns the other's, each cell
 * colored by the conflict that pair makes. A cell links to its pairs. Without sides, a pair's
 * order is arbitrary, so the grid folds onto one triangle and a cell means either order.
 */
export function TermGrid({ summary, vocab, sides, selected }: Props) {
  const order = (key: string) => {
    const t = termOf(vocab, key);
    return t === undefined ? Number.MAX_SAFE_INTEGER : vocab.terms.indexOf(t);
  };
  const counts = new Map<string, number>();
  const rowKeys = new Set<string>();
  const colKeys = new Set<string>();
  for (const r of summary.rows) {
    let row = String(r['a.term']);
    let col = String(r['b.term']);
    if (sides === null && order(row) < order(col)) [row, col] = [col, row];
    rowKeys.add(row);
    colKeys.add(col);
    if (sides === null) {
      rowKeys.add(col);
      colKeys.add(row);
    }
    counts.set(`${row}|${col}`, (counts.get(`${row}|${col}`) ?? 0) + Number(r['variants']));
  }
  const rows = [...rowKeys].sort((x, y) => order(x) - order(y));
  const cols = [...colKeys].sort((x, y) => order(x) - order(y));
  const label = (key: string) => termOf(vocab, key)?.label ?? key.split(':')[1] ?? key;
  const code = (key: string) => key.split(':')[1] ?? key;
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="term-grid" className="mb-10">
      <h2 id="term-grid" className="mb-1">
        Classifications compared
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Variants by the two classifications in each pair
        {sides === null ? '' : `: ${sides[0]} (rows) against ${sides[1]} (columns)`}. A variant can
        appear in several cells. Select a count to list its pairs.
      </p>
      <div className="overflow-x-auto">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th />
              {cols.map((col) => (
                <th key={col} scope="col" className="px-2 py-1 text-left align-bottom font-medium">
                  {label(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row}>
                <th scope="row" className="py-1 pr-3 text-left font-medium whitespace-nowrap">
                  {label(row)}
                </th>
                {cols.map((col, j) => {
                  if (sides === null && j > i) return <td key={col} />;
                  const n = counts.get(`${row}|${col}`) ?? 0;
                  const level = levelOf(termOf(vocab, row), termOf(vocab, col));
                  const isSelected = selected?.[0] === code(row) && selected[1] === code(col);
                  return (
                    <td
                      key={col}
                      className={`border border-background px-2 py-1 text-right ${n === 0 ? '' : (LEVEL_CLASS[String(level)] ?? '')} ${isSelected ? 'outline-2 outline-ring' : ''}`}
                    >
                      {n === 0 ? (
                        <span className="text-muted-foreground">0</span>
                      ) : (
                        <Link
                          to="."
                          hash="pairs"
                          search={(s) =>
                            sides === null
                              ? { ...s, terms: `${code(row)},${code(col)}`, pairs_page: undefined }
                              : {
                                  ...s,
                                  'a.term': code(row),
                                  'b.term': code(col),
                                  pairs_page: undefined,
                                }
                          }
                          className="text-foreground"
                        >
                          {n.toLocaleString()}
                        </Link>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
