import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { releasesQuery } from '../../lib/api/queries.ts';
import { useRelease } from '../../lib/release.ts';

/**
 * The ClinVar release shown, and with more than one served, a choice of them: choosing one
 * rewinds the whole browser to it (lib/release.ts). A date between releases shows the one before.
 */
export function ReleasePicker() {
  const { data } = useQuery(releasesQuery());
  const requested = useRelease();
  const navigate = useNavigate();
  const current = data?.current;
  if (data === undefined || current == null) return null;
  const dates = data.data
    .map((r) => r.clinvarRelease)
    .sort()
    .reverse();
  const shown = requested === undefined ? current : (dates.find((d) => d <= requested) ?? current);
  if (dates.length < 2) {
    return (
      <span
        className="text-sm whitespace-nowrap text-muted-foreground"
        title="The ClinVar release shown"
      >
        ClinVar {shown}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-sm whitespace-nowrap text-muted-foreground">
      <label htmlFor="release-picker">ClinVar</label>
      <select
        id="release-picker"
        value={shown}
        title="The ClinVar release shown; choose another to see the data as of it"
        className="rounded border border-border bg-background px-1 py-0.5 text-foreground"
        onChange={(event) => {
          const release = event.target.value === current ? undefined : event.target.value;
          void navigate({ to: '.', search: (prev) => ({ ...prev, release }) });
        }}
      >
        {dates.map((d) => (
          <option key={d} value={d}>
            {d}
            {d === current ? ' (latest)' : ''}
          </option>
        ))}
      </select>
      {shown === current ? null : (
        <Link to="." search={(prev) => ({ ...prev, release: undefined })}>
          Latest
        </Link>
      )}
    </span>
  );
}
