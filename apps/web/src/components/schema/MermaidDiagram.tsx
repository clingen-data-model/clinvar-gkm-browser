import { useEffect, useState, useSyncExternalStore } from 'react';
import { getThemePreference, subscribeThemePreference } from '../../lib/theme.ts';

const darkQuery = '(prefers-color-scheme: dark)';

/** The theme in effect: the user's choice, or the OS preference. */
function useDark(): boolean {
  const preference = useSyncExternalStore(subscribeThemePreference, getThemePreference);
  const systemDark = useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia(darkQuery);
      media.addEventListener('change', listener);
      return () => {
        media.removeEventListener('change', listener);
      };
    },
    () => window.matchMedia(darkQuery).matches,
  );
  return preference === 'system' ? systemDark : preference === 'dark';
}

// Mermaid keeps global configuration, so renders run one at a time.
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;

/**
 * The diagram as SVG text. Mermaid is loaded only when a page draws a diagram. Labels are SVG
 * text, not HTML, and in the page's own font stack, so the sizes Mermaid measures in the page
 * match the image it draws.
 */
function renderSvg(source: string, dark: boolean): Promise<string> {
  const run = queue.then(async () => {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'default',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      htmlLabels: false,
      // A label narrower than minEntityWidth (as measured in the page, where the policy drops
      // Mermaid's styles) is wrapped to that width; without the minimum, boxes fit their labels.
      er: { useMaxWidth: false, minEntityWidth: 0 },
      flowchart: { wrappingWidth: 400 },
    });
    counter += 1;
    const { svg } = await mermaid.render(`mermaid-${String(counter)}`, source);
    return svg;
  });
  queue = run.catch(() => undefined);
  return run;
}

interface Props {
  source: string;
  /** What the diagram shows, for its alt text. */
  label: string;
}

/**
 * A Mermaid diagram, drawn as an image. The page's policy allows no inline styles, which Mermaid's
 * SVG relies on; an SVG shown as an image keeps its own styles and can't run scripts, so the
 * policy only needs to allow blob: images.
 */
export function MermaidDiagram({ source, label }: Props) {
  const dark = useDark();
  const [image, setImage] = useState<{ url: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${dark ? 'dark' : 'light'}:${source}`;

  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    renderSvg(source, dark).then(
      (svg) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        setImage({ url, key });
        setError(null);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
      if (url !== undefined) URL.revokeObjectURL(url);
    };
  }, [source, dark, key]);

  return (
    <figure className="my-4">
      <div className="overflow-x-auto rounded border border-border p-3">
        {error !== null ? (
          <p className="text-sm text-muted-foreground">
            The diagram couldn&rsquo;t be drawn: {error}
          </p>
        ) : image === null || image.key !== key ? (
          <p className="text-sm text-muted-foreground">Drawing&hellip;</p>
        ) : (
          <img src={image.url} alt={label} className="h-auto max-w-full" />
        )}
      </div>
      <details className="mt-1 text-xs text-muted-foreground">
        <summary>Mermaid source</summary>
        <pre className="mt-1 overflow-x-auto">{source}</pre>
      </details>
    </figure>
  );
}
