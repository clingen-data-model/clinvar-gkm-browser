import { formatTick, LINE_PAINT, niceTicks } from '../../lib/stats.ts';
import { both, ChartFrame, fill, inkFill, inkStroke, strokePaint } from './ChartFrame.tsx';

const TABULAR = { style: { fontVariantNumeric: 'tabular-nums' } } as const;

export interface LinePoint {
  release: string;
  value: number;
  /** The value as the tooltip and end label show it. */
  text: string;
  /** More for the tooltip: the count behind a share, the whole. */
  detail?: string;
}

// Narrower than a full-width chart: two sit side by side, and their text stays readable.
const LINE_WIDTH = 640;
const PLOT = { left: 64, right: 560, top: 20, bottom: 236 };
const HEIGHT = 272;

const day = (release: string) => Date.parse(`${release}T00:00:00Z`);

/**
 * One series over the releases, on a time axis (releases aren't evenly spaced). The axis spans
 * round ticks around the values rather than from zero, so a small change shows; the ticks say
 * where it starts. The last value is labelled at the line's end.
 */
export function LineChart({
  points,
  label,
  source,
  fileName,
  format,
}: {
  points: LinePoint[];
  label: string;
  source: readonly string[];
  fileName: string;
  /** Formats an axis tick. */
  format?: (n: number, max: number) => string;
}) {
  const values = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const lo = ticks[0] ?? 0;
  const hi = ticks.at(-1) ?? 1;
  const first = day(points[0]?.release ?? '');
  const last = day(points.at(-1)?.release ?? '');
  const xOf = (release: string) =>
    last === first
      ? (PLOT.left + PLOT.right) / 2
      : PLOT.left + ((day(release) - first) / (last - first)) * (PLOT.right - PLOT.left);
  const yOf = (v: number) => PLOT.bottom - ((v - lo) / (hi - lo || 1)) * (PLOT.bottom - PLOT.top);
  const laid = points.map((p) => ({ ...p, x: xOf(p.release), y: yOf(p.value) }));
  const path = laid.map((p, i) => `${i === 0 ? 'M' : 'L'}${String(p.x)},${String(p.y)}`).join('');
  const tickText = format ?? formatTick;
  // Dates need about 90 units; label every few, counting back from the latest.
  const every = Math.max(
    1,
    Math.ceil(90 / ((PLOT.right - PLOT.left) / Math.max(points.length - 1, 1))),
  );
  const end = laid.at(-1);

  return (
    <ChartFrame
      width={LINE_WIDTH}
      height={HEIGHT}
      label={label}
      source={source}
      fileName={fileName}
      points={laid.map((p) => ({
        x: p.x,
        tip: {
          heading: p.release,
          rows: [
            { key: label, value: p.text, ...(p.detail === undefined ? {} : { detail: p.detail }) },
          ],
        },
      }))}
      highlight={(i) => {
        const p = laid[i];
        if (p === undefined) return null;
        return (
          <>
            <line
              x1={p.x}
              x2={p.x}
              y1={PLOT.top}
              y2={PLOT.bottom}
              strokeWidth={1}
              {...inkStroke('muted')}
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={6}
              strokeWidth={2}
              {...both(fill(LINE_PAINT), inkStroke('surface'))}
            />
          </>
        );
      }}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PLOT.left}
            x2={PLOT.right}
            y1={yOf(t)}
            y2={yOf(t)}
            strokeWidth={1}
            {...inkStroke('grid')}
          />
          <text
            x={PLOT.left - 8}
            y={yOf(t) + 4}
            fontSize={12}
            textAnchor="end"
            {...both(inkFill('muted'), TABULAR)}
          >
            {tickText(t, hi)}
          </text>
        </g>
      ))}
      {laid.map((p, i) =>
        (laid.length - 1 - i) % every === 0 ? (
          <text
            key={p.release}
            x={p.x}
            y={PLOT.bottom + 20}
            fontSize={12}
            textAnchor="middle"
            {...inkFill('muted')}
          >
            {p.release}
          </text>
        ) : null,
      )}
      <path
        d={path}
        fill="none"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        {...strokePaint(LINE_PAINT)}
      />
      {laid.map((p) => (
        <circle
          key={p.release}
          cx={p.x}
          cy={p.y}
          r={4}
          strokeWidth={2}
          {...both(fill(LINE_PAINT), inkStroke('surface'))}
        />
      ))}
      {end === undefined ? null : (
        <text x={end.x + 10} y={end.y + 4} fontSize={13} fontWeight={600} {...inkFill('primary')}>
          {end.text}
        </text>
      )}
    </ChartFrame>
  );
}
