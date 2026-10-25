import { useNavigate } from '@tanstack/react-router';
import { ConflictSearch } from '../../lib/conflicts.ts';

const METHODS = [
  'clinical testing',
  'curation',
  'research',
  'literature only',
  'provider interpretation',
  'reference population',
  'case-control',
  'in vitro',
  'in vivo',
  'phenotyping only',
  'not provided',
];

type SideKey = 'a.min_stars' | 'b.min_stars' | 'a.method' | 'b.method';

/** The same value on each of the given side keys; empty clears them. */
function sideChanges(keys: SideKey[], value: string): Partial<Record<SideKey, string | undefined>> {
  const out: Partial<Record<SideKey, string | undefined>> = {};
  for (const k of keys) out[k] = value === '' ? undefined : value;
  return out;
}

interface Props {
  search: ConflictSearch;
  /**
   * The two sides' labels ("Submissions from GeneDx", "Other submissions"); null for a view
   * without sides (a gene's or condition's conflicts), where one set of filters applies to both.
   */
  sides: [string, string] | null;
}

/**
 * How submissions are compared: which conditions count as the same, whether flagged submissions
 * take part, and the review status and collection method of each side. All in the URL.
 */
export function ConflictOptions({ search, sides }: Props) {
  const navigate = useNavigate();
  const set = (changes: Partial<ConflictSearch>) => {
    void navigate({
      to: '.',
      search: (s) => ({ ...s, ...changes, labs_page: undefined, pairs_page: undefined }),
      replace: true,
    });
  };
  const sideFilters = (label: string, stars: SideKey[], methods: SideKey[]) => (
    <fieldset className="flex flex-wrap items-end gap-3">
      <legend className="mb-1 text-sm font-semibold">{label}</legend>
      <label className="flex flex-col text-xs text-muted-foreground">
        Minimum stars
        <select
          value={search[stars[0] ?? 'a.min_stars'] ?? ''}
          onChange={(e) => {
            set(sideChanges(stars, e.target.value));
          }}
          className="mt-0.5 rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
        >
          <option value="">Any</option>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={String(n)}>
              {n} or more
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-xs text-muted-foreground">
        Collection method
        <select
          value={search[methods[0] ?? 'a.method'] ?? ''}
          onChange={(e) => {
            set(sideChanges(methods, e.target.value));
          }}
          className="mt-0.5 rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
        >
          <option value="">Any</option>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
  return (
    <div className="mb-8 flex flex-wrap items-end gap-x-8 gap-y-4 rounded-lg border border-border p-4">
      {sides === null
        ? sideFilters(
            'Submissions compared',
            ['a.min_stars', 'b.min_stars'],
            ['a.method', 'b.method'],
          )
        : [
            sideFilters(sides[0], ['a.min_stars'], ['a.method']),
            sideFilters(sides[1], ['b.min_stars'], ['b.method']),
          ]}
      <label className="flex flex-col text-xs text-muted-foreground">
        Conditions
        <select
          value={search.condition_match ?? 'strict'}
          onChange={(e) => {
            const rule = ConflictSearch.shape.condition_match.parse(e.target.value);
            set({ condition_match: rule === 'strict' ? undefined : rule });
          }}
          className="mt-0.5 rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
        >
          <option value="strict">Compare only for the same condition</option>
          <option value="wildcard">Same condition, or not provided/specified</option>
          <option value="any">Compare regardless of condition</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={search.flagged === 'include'}
          onChange={(e) => {
            set({ flagged: e.target.checked ? 'include' : undefined });
          }}
        />
        Include flagged submissions
      </label>
    </div>
  );
}
