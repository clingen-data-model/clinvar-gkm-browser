import { formatCount, formatShare, paints, roundedShares } from '../../lib/stats.ts';
import { both, ChartFrame, fill, fillInk, inkFill, inkStroke, topRounded } from './ChartFrame.tsx';

const TABULAR = { style: { fontVariantNumeric: 'tabular-nums' } } as const;

export interface Column {
  /** Under the column: the release, and the whole it splits (e.g. "4,273,584 variants"). */
  label: string;
  sublabel: string;
  counts: ReadonlyMap<string, number>;
}

const PLOT = { left: 56, right: 660, top: 16, bottom: 420 };
const LEGEND_X = 692;
const HEIGHT = 476;
const GAP = 2;

/**
 * Each column one whole (a release), split into the categories as shares, stacked in their
 * order with the first on top. A share is printed inside its segment only where it fits; the
 * legend names the categories, and the table has every number.
 */
export function StackedColumns({
  categories,
  columns,
  label,
  source,
  fileName,
}: {
  categories: string[];
  columns: Column[];
  label: string;
  source: readonly string[];
  fileName: string;
}) {
  const paint = paints(categories);
  const band = (PLOT.right - PLOT.left) / Math.max(columns.length, 1);
  const width = Math.min(96, band * 0.6);
  const plotHeight = PLOT.bottom - PLOT.top;
  // Dates need about 80 units side by side; with many columns, label every few, counting back
  // from the last so the latest is always labelled.
  const labelEvery = Math.ceil(80 / band);
  const labelled = (i: number) => (columns.length - 1 - i) % labelEvery === 0;

  const laid = columns.map((column, i) => {
    const counts = categories.map((c) => column.counts.get(c) ?? 0);
    const total = counts.reduce((a, b) => a + b, 0);
    const shares = roundedShares(counts);
    const x = PLOT.left + band * i + (band - width) / 2;
    // Stacked from the bottom, so the first category ends on top.
    let y = PLOT.bottom;
    const segments = categories
      .map((name, j) => ({ name, count: counts[j] ?? 0, share: shares[j] ?? 0 }))
      .reverse()
      .map((s) => {
        const h = total === 0 ? 0 : (s.count / total) * plotHeight;
        y -= h;
        return { ...s, y, h };
      });
    return { column, x, total, segments, top: segments.findLast((s) => s.h > 0)?.name };
  });

  return (
    <ChartFrame
      height={HEIGHT}
      label={label}
      source={source}
      fileName={fileName}
      points={laid.map((c) => ({
        x: c.x + width / 2,
        tip: {
          heading: `${c.column.label}: ${c.column.sublabel}`,
          rows: [...c.segments].reverse().map((s) => ({
            key: s.name,
            value: formatShare(s.share, s.count),
            detail: formatCount(s.count),
            paint: paint.get(s.name),
          })),
        },
      }))}
      highlight={(i) => {
        const c = laid[i];
        if (c === undefined) return null;
        return (
          <rect
            x={c.x - 3}
            y={PLOT.top - 3}
            width={width + 6}
            height={plotHeight + 6}
            rx={6}
            fill="none"
            strokeWidth={1.5}
            {...inkStroke('primary')}
          />
        );
      }}
    >
      {[0, 25, 50, 75, 100].map((t) => {
        const y = PLOT.bottom - (t / 100) * plotHeight;
        return (
          <g key={t}>
            <line
              x1={PLOT.left}
              x2={PLOT.right}
              y1={y}
              y2={y}
              strokeWidth={1}
              {...inkStroke('grid')}
            />
            <text
              x={PLOT.left - 8}
              y={y + 4}
              fontSize={12}
              textAnchor="end"
              {...both(inkFill('muted'), TABULAR)}
            >
              {`${String(t)}%`}
            </text>
          </g>
        );
      })}
      {laid.map((c, i) => (
        <g key={c.column.label}>
          {c.segments.map((s) => {
            if (s.h <= 0) return null;
            const p = paint.get(s.name);
            if (p === undefined) return null;
            // The gap is taken from the segment's top, so the stack keeps its baseline.
            const h = Math.max(s.h - GAP, 0.5);
            const y = s.y + (s.h - h);
            // A 13 px label needs about 16 units of height and 48 of width.
            const fits = s.h >= 16 && width >= 48;
            return (
              <g key={s.name}>
                {s.name === c.top ? (
                  <path d={topRounded(c.x, y, width, h)} {...fill(p)} />
                ) : (
                  <rect x={c.x} y={y} width={width} height={h} {...fill(p)} />
                )}
                {fits ? (
                  <text
                    x={c.x + width / 2}
                    y={y + h / 2 + 4.5}
                    fontSize={13}
                    fontWeight={600}
                    textAnchor="middle"
                    {...fillInk(p)}
                  >
                    {formatShare(s.share, s.count)}
                  </text>
                ) : null}
              </g>
            );
          })}
          <text
            x={c.x + width / 2}
            y={PLOT.bottom + 22}
            fontSize={13}
            textAnchor="middle"
            {...inkFill('primary')}
          >
            {labelled(i) ? c.column.label : ''}
          </text>
          <text
            x={c.x + width / 2}
            y={PLOT.bottom + 40}
            fontSize={12}
            textAnchor="middle"
            {...inkFill('muted')}
          >
            {band >= 110 ? c.column.sublabel : ''}
          </text>
        </g>
      ))}
      <line
        x1={PLOT.left}
        x2={PLOT.right}
        y1={PLOT.bottom}
        y2={PLOT.bottom}
        strokeWidth={1}
        {...inkStroke('muted')}
      />
      {categories.map((name, i) => {
        const p = paint.get(name);
        if (p === undefined) return null;
        const y = PLOT.top + 4 + i * 26;
        return (
          <g key={name}>
            <rect x={LEGEND_X} y={y} width={12} height={12} rx={2} {...fill(p)} />
            <text x={LEGEND_X + 20} y={y + 11} fontSize={14} {...inkFill('primary')}>
              {name}
            </text>
          </g>
        );
      })}
    </ChartFrame>
  );
}
