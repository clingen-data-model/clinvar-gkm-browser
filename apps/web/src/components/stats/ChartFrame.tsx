// What every statistics chart shares: an SVG in fixed coordinates, scaled to the page; colors
// that follow the theme on screen and are written out in their light values on export; a
// tooltip; and downloads as SVG and PNG that look the same in a slide as on the page.

import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { Paint } from '../../lib/stats.ts';

/** Charts draw in this width unless they ask for another; heights vary. 960 × 540 is a 16:9 slide. */
export const WIDTH = 960;
export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Text and chrome colors: the theme's on screen, light values on export. */
const INK = {
  primary: { css: 'var(--foreground)', light: '#101828' },
  muted: { css: 'var(--muted-foreground)', light: '#4a5565' },
  grid: { css: 'var(--border)', light: '#e5e7eb' },
  surface: { css: 'var(--background)', light: '#ffffff' },
} as const;
export type Ink = keyof typeof INK;

/** Fill props for a series color. */
export function fill(paint: Paint) {
  return {
    style: { fill: `light-dark(${paint.light}, ${paint.dark})` } satisfies CSSProperties,
    'data-export-fill': paint.light,
  };
}

/** Fill props for a label set inside a series color. */
export function fillInk(paint: Paint) {
  return {
    style: { fill: `light-dark(${paint.inkLight}, ${paint.inkDark})` } satisfies CSSProperties,
    'data-export-fill': paint.inkLight,
  };
}

export function inkFill(ink: Ink) {
  return {
    style: { fill: INK[ink].css } satisfies CSSProperties,
    'data-export-fill': INK[ink].light,
  };
}

export function inkStroke(ink: Ink) {
  return {
    style: { stroke: INK[ink].css } satisfies CSSProperties,
    'data-export-stroke': INK[ink].light,
  };
}

export function strokePaint(paint: Paint) {
  return {
    style: { stroke: `light-dark(${paint.light}, ${paint.dark})` } satisfies CSSProperties,
    'data-export-stroke': paint.light,
  };
}

type PaintProps = { style: CSSProperties } & Record<`data-export-${string}`, string>;

/** Several paint props on one element: their styles and export colors together. */
export function both(...parts: PaintProps[]): PaintProps {
  const out: PaintProps = { style: {} };
  for (const part of parts) Object.assign(out, { ...part, style: { ...out.style, ...part.style } });
  return out;
}

/** A rectangle with its top corners rounded: a column's data end. */
export function topRounded(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, w / 2, h);
  return `M${String(x)},${String(y + h)}V${String(y + rr)}Q${String(x)},${String(y)} ${String(x + rr)},${String(y)}H${String(x + w - rr)}Q${String(x + w)},${String(y)} ${String(x + w)},${String(y + rr)}V${String(y + h)}Z`;
}

/** A rectangle with all four corners rounded. */
export function rounded(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, w / 2, h / 2);
  return `M${String(x + rr)},${String(y)}H${String(x + w - rr)}Q${String(x + w)},${String(y)} ${String(x + w)},${String(y + rr)}V${String(y + h - rr)}Q${String(x + w)},${String(y + h)} ${String(x + w - rr)},${String(y + h)}H${String(x + rr)}Q${String(x)},${String(y + h)} ${String(x)},${String(y + h - rr)}V${String(y + rr)}Q${String(x)},${String(y)} ${String(x + rr)},${String(y)}Z`;
}

/** What a tooltip shows for one point: a heading and its values, value first. */
export interface TipContent {
  heading: string;
  rows: { key: string; value: string; detail?: string; paint?: Paint | undefined }[];
}

interface Props {
  /** The drawing's width: WIDTH for a chart across the page, less for one beside another. */
  width?: number;
  height: number;
  /** The chart's accessible name; the table beside it has the values. */
  label: string;
  /** The source lines drawn under the chart, kept in downloads. */
  source: readonly string[];
  /** File name for downloads, without extension. */
  fileName: string;
  /** Points a pointer or the arrow keys can show: their x center (chart units) and content. */
  points: { x: number; tip: TipContent }[];
  /** Highlights the active point, if any (drawn on top, left out of downloads). */
  highlight?: (index: number) => ReactNode;
  children: ReactNode;
}

/**
 * The chart's SVG with its source line, tooltip and downloads. Pointer and arrow keys pick the
 * nearest point; the chart is one tab stop, and its table has every value without hovering.
 */
export function ChartFrame({
  width = WIDTH,
  height,
  label,
  source,
  fileName,
  points,
  highlight,
  children,
}: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const total = height + 8 + source.length * 18;

  const nearest = (clientX: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (box === undefined || points.length === 0) return null;
    const x = ((clientX - box.left) / box.width) * width;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs((points[best]?.x ?? 0) - x)) best = i;
    });
    return best;
  };
  const onKey = (event: KeyboardEvent) => {
    if (points.length === 0) return;
    const last = points.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: Math.min((active ?? -1) + 1, last),
      ArrowLeft: Math.max((active ?? points.length) - 1, 0),
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next === undefined) {
      if (event.key === 'Escape') setActive(null);
      return;
    }
    event.preventDefault();
    setActive(next);
  };

  const tip = active === null ? undefined : points[active];
  return (
    <figure className="m-0">
      <div className="relative">
        <svg
          ref={svg}
          viewBox={`0 0 ${String(width)} ${String(total)}`}
          role="img"
          aria-label={`${label}. Use the arrow keys to read each point; the table below has every value.`}
          tabIndex={0}
          className="block h-auto w-full rounded focus-visible:outline-2"
          style={{ fontFamily: FONT }}
          onPointerMove={(e) => {
            setActive(nearest(e.clientX));
          }}
          onPointerLeave={() => {
            setActive(null);
          }}
          onKeyDown={onKey}
          onBlur={() => {
            setActive(null);
          }}
        >
          {children}
          {source.map((line, i) => (
            <text key={line} x={8} y={height + 18 + i * 18} fontSize={12} {...inkFill('muted')}>
              {line}
            </text>
          ))}
          {active !== null && highlight !== undefined ? (
            <g data-export="omit">{highlight(active)}</g>
          ) : null}
        </svg>
        {tip === undefined ? null : <Tooltip tip={tip.tip} at={tip.x / width} />}
      </div>
      <Downloads svg={svg} fileName={fileName} />
    </figure>
  );
}

function Tooltip({ tip, at: left }: { tip: TipContent; at: number }) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-2 z-10 max-w-xs rounded border border-border bg-background px-3 py-2 text-sm shadow-md"
      style={
        left < 0.6
          ? { left: `calc(${String(left * 100)}% + 16px)` }
          : { right: `calc(${String((1 - left) * 100)}% + 16px)` }
      }
    >
      <p className="font-semibold">{tip.heading}</p>
      <table className="mt-1">
        <tbody>
          {tip.rows.map((r) => (
            <tr key={r.key}>
              <td className="pr-2 text-right font-semibold whitespace-nowrap tabular-nums">
                {r.value}
              </td>
              <td className="pr-2 text-right whitespace-nowrap text-muted-foreground tabular-nums">
                {r.detail ?? ''}
              </td>
              <td className="text-muted-foreground">
                {r.paint === undefined ? null : (
                  <span
                    aria-hidden="true"
                    className="mr-1.5 inline-block h-0.5 w-3 align-middle"
                    style={{ background: `light-dark(${r.paint.light}, ${r.paint.dark})` }}
                  />
                )}
                {r.key}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The chart as a standalone SVG: light colors written in, hover marks left out, a white ground. */
function standalone(svg: SVGSVGElement): string {
  const copy = svg.cloneNode(true);
  if (!(copy instanceof SVGSVGElement)) throw new Error('not an SVG');
  for (const el of copy.querySelectorAll('[data-export="omit"]')) el.remove();
  for (const el of copy.querySelectorAll<SVGElement>('[data-export-fill]')) {
    el.setAttribute('fill', el.dataset['exportFill'] ?? '');
    el.style.removeProperty('fill');
    el.removeAttribute('data-export-fill');
  }
  for (const el of copy.querySelectorAll<SVGElement>('[data-export-stroke]')) {
    el.setAttribute('stroke', el.dataset['exportStroke'] ?? '');
    el.style.removeProperty('stroke');
    el.removeAttribute('data-export-stroke');
  }
  for (const attribute of ['role', 'aria-label', 'tabindex', 'class', 'style']) {
    copy.removeAttribute(attribute);
  }
  const [, , w, h] = (copy.getAttribute('viewBox') ?? '').split(' ').map(Number);
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(w));
  copy.setAttribute('height', String(h));
  copy.setAttribute('font-family', FONT);
  const ground = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  ground.setAttribute('width', '100%');
  ground.setAttribute('height', '100%');
  ground.setAttribute('fill', INK.surface.light);
  copy.insertBefore(ground, copy.firstChild);
  return new XMLSerializer().serializeToString(copy);
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

async function png(svgText: string, scale: number): Promise<Blob> {
  const image = new Image();
  image.src = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width * scale;
  canvas.height = image.height * scale;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('no canvas');
  context.scale(scale, scale);
  context.drawImage(image, 0, 0);
  URL.revokeObjectURL(image.src);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b === null) reject(new Error('no PNG'));
      else resolve(b);
    }, 'image/png');
  });
}

function Downloads({
  svg,
  fileName,
}: {
  svg: React.RefObject<SVGSVGElement | null>;
  fileName: string;
}) {
  const button =
    'rounded border border-border px-2 py-1 text-sm text-foreground hover:bg-muted min-h-6';
  return (
    <figcaption className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      Download the chart:
      <button
        type="button"
        className={button}
        onClick={() => {
          if (svg.current === null) return;
          save(new Blob([standalone(svg.current)], { type: 'image/svg+xml' }), `${fileName}.svg`);
        }}
      >
        SVG
      </button>
      <button
        type="button"
        className={button}
        onClick={() => {
          if (svg.current === null) return;
          void png(standalone(svg.current), 3).then((b) => {
            save(b, `${fileName}.png`);
          });
        }}
      >
        PNG
      </button>
    </figcaption>
  );
}
