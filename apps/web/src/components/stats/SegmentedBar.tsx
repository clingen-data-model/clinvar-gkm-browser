import { formatCount, formatShare, paints, roundedShares } from '../../lib/stats.ts';
import { ChartFrame, fill, fillInk, inkFill, inkStroke, rounded } from './ChartFrame.tsx';

const LEFT = 8;
const RIGHT = 952;
const BAR_Y = 16;
const BAR_HEIGHT = 32;
const GAP = 2;
const LEGEND_COLUMNS = 3;
const LEGEND_ROW = 26;

/**
 * One whole split into its parts, read at a glance: a tall segmented bar, each part its share
 * of the width with its share printed inside where it fits, and a legend of names in bar order.
 */
export function SegmentedBar({
  categories,
  counts,
  label,
  source,
  fileName,
}: {
  categories: string[];
  counts: ReadonlyMap<string, number>;
  label: string;
  source: readonly string[];
  fileName: string;
}) {
  const paint = paints(categories);
  const values = categories.map((c) => counts.get(c) ?? 0);
  const total = values.reduce((a, b) => a + b, 0);
  const shares = roundedShares(values);
  const widths = values.map((v) => (total === 0 ? 0 : (v / total) * (RIGHT - LEFT)));
  const blocks = categories.map((name, i) => ({
    name,
    x: LEFT + widths.slice(0, i).reduce((a, b) => a + b, 0),
    w: widths[i] ?? 0,
    count: values[i] ?? 0,
    share: shares[i] ?? 0,
  }));
  const legendTop = BAR_Y + BAR_HEIGHT + 24;
  const height = legendTop + Math.ceil(categories.length / LEGEND_COLUMNS) * LEGEND_ROW;
  const visible = blocks.filter((b) => b.w > 0);

  return (
    <ChartFrame
      height={height}
      label={label}
      source={source}
      fileName={fileName}
      points={visible.map((b) => ({
        x: b.x + b.w / 2,
        tip: {
          heading: b.name,
          rows: [
            { key: 'share', value: formatShare(b.share, b.count) },
            { key: 'count', value: formatCount(b.count) },
          ],
        },
      }))}
      highlight={(i) => {
        const b = visible[i];
        if (b === undefined) return null;
        return (
          <rect
            x={b.x - 1}
            y={BAR_Y - 3}
            width={b.w + 2}
            height={BAR_HEIGHT + 6}
            rx={5}
            fill="none"
            strokeWidth={1.5}
            {...inkStroke('primary')}
          />
        );
      }}
    >
      {visible.map((b) => {
        const p = paint.get(b.name);
        if (p === undefined) return null;
        const w = Math.max(b.w - GAP, 0.5);
        const text = formatShare(b.share, b.count);
        // About 8 units a character at 13 px, plus padding either side.
        const fits = w >= text.length * 8 + 12;
        return (
          <g key={b.name}>
            <path d={rounded(b.x, BAR_Y, w, BAR_HEIGHT)} {...fill(p)} />
            {fits ? (
              <text
                x={b.x + 8}
                y={BAR_Y + BAR_HEIGHT / 2 + 4.5}
                fontSize={13}
                fontWeight={600}
                {...fillInk(p)}
              >
                {text}
              </text>
            ) : null}
          </g>
        );
      })}
      {categories.map((name, i) => {
        const p = paint.get(name);
        if (p === undefined) return null;
        const lx = LEFT + (i % LEGEND_COLUMNS) * ((RIGHT - LEFT) / LEGEND_COLUMNS);
        const ly = legendTop + Math.floor(i / LEGEND_COLUMNS) * LEGEND_ROW;
        return (
          <g key={name}>
            <rect x={lx} y={ly} width={12} height={12} rx={2} {...fill(p)} />
            <text x={lx + 20} y={ly + 11} fontSize={14} {...inkFill('primary')}>
              {name}
            </text>
          </g>
        );
      })}
    </ChartFrame>
  );
}
