import { Popover } from '@base-ui/react/popover';
import { fieldHistoryRows, type FieldPeriod } from '@cvb/shared/api';
import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { count } from '../../lib/text.ts';
import { EarliestReleaseNote, holdsIn, ReleaseSpan } from './ReleaseSpan.tsx';

interface Props {
  /** The field's name, e.g. "Classification": the popup's title and the trigger's name. */
  label: string;
  /** The field's periods, oldest first (from the API). */
  periods: FieldPeriod[];
  /** The release the page shows, whose period is marked. */
  shown: string;
  /** A value's row as a link to the record as of the row's first release. */
  link: (period: FieldPeriod, children: ReactNode, close: () => void) => ReactNode;
}

/**
 * The values a field held over the releases served, behind a button beside the field saying how
 * often it changed ("3 changes"): each with the releases it held in, newest first, linking to the
 * record as of that release. Releases the record wasn't in (say, an aggregate call with no
 * submissions of its type) are a row of their own, "none", so every step between rows is a
 * change. Nothing when the field held one value throughout.
 */
export function FieldHistory({ label, periods, shown, link }: Props) {
  const [open, setOpen] = useState(false);
  const rows = fieldHistoryRows(periods);
  if (rows.length < 2) return null;
  const summary = count(rows.length - 1, 'change');
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`${label} history: ${summary}`}
        className="ml-1 inline-flex items-center gap-0.5 rounded-sm px-1 align-middle text-xs whitespace-nowrap text-muted-foreground hover:text-foreground"
      >
        {summary}
        <ChevronDown aria-hidden size={12} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} align="start" className="z-30">
          <Popover.Popup className="max-w-md rounded-md border border-border bg-background p-3 text-sm shadow-lg">
            <Popover.Title className="mb-2 text-xs font-semibold text-muted-foreground">
              {label} by release
            </Popover.Title>
            <table>
              <tbody>
                {[...rows].reverse().map((p) => (
                  <tr key={p.from} className="align-top">
                    <td className="py-0.5 pr-3">
                      {/* No link for "none": an SCV's page as of a release without it is a 404. */}
                      {p.absent ? (
                        <span className="text-muted-foreground italic">none</span>
                      ) : (
                        link(p, p.value ?? '—', () => {
                          setOpen(false);
                        })
                      )}
                    </td>
                    <td className="py-0.5 pr-2 text-muted-foreground">
                      <ReleaseSpan span={p} />
                    </td>
                    <td className="py-0.5 text-muted-foreground">
                      {holdsIn(p, shown) ? '(shown)' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <EarliestReleaseNote spans={rows} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The release to link a period to: its first, or none (the current release) while it holds. */
export function periodRelease(period: FieldPeriod): string | undefined {
  return period.to === null ? undefined : period.from;
}
