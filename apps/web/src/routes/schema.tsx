import { createFileRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { MermaidDiagram } from '../components/schema/MermaidDiagram.tsx';
import { Page } from '../components/shell/Page.tsx';
import { type Block, diagramSections } from '../lib/doc-diagrams.ts';

const DOCS = 'https://github.com/clingen-data-model/clinvar-gkm-browser/blob/main/docs/';

/** Not linked from the app yet: how upstream's tables and ours point to each other. */
export const Route = createFileRoute('/schema')({
  component: SchemaPage,
});

/** The doc's inline Markdown: bold, code and links (relative ones to the docs on GitHub). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/).map((part, i) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link !== null) {
      const href = link[2] ?? '';
      return (
        <a key={i} href={/^https?:/.test(href) ? href : DOCS + href}>
          {link[1]}
        </a>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

/** Alt text: the section, and whether it's upstream's or ours (from the text before it). */
function diagramLabel(section: string, previous: Block | undefined): string {
  const side =
    previous?.kind === 'text' && previous.text.startsWith('Upstream') ? 'upstream' : 'derived';
  return `Entity-relationship diagram: ${section.toLowerCase()}, ${side} tables`;
}

function SchemaPage() {
  const sections = diagramSections();
  return (
    <Page
      eyebrow="About the data"
      title="Schema diagrams"
      subtitle={
        <a className="text-band-foreground" href={`${DOCS}upstream-vs-derived.md`}>
          From docs/upstream-vs-derived.md
        </a>
      }
    >
      <div className="max-w-none space-y-3">
        {sections.map((section) => (
          <section key={section.title || 'intro'} className="space-y-3">
            {section.title === '' ? null : <h2 className="mt-8">{section.title}</h2>}
            {section.blocks.map((block, i) =>
              block.kind === 'diagram' ? (
                <MermaidDiagram
                  key={i}
                  source={block.source}
                  label={diagramLabel(section.title, section.blocks[i - 1])}
                />
              ) : block.kind === 'list' ? (
                <ul key={i} className="list-disc space-y-1 pl-6">
                  {block.items.map((item, j) => (
                    <li key={j}>{inline(item)}</li>
                  ))}
                </ul>
              ) : (
                <p key={i} className="max-w-3xl">
                  {inline(block.text)}
                </p>
              ),
            )}
          </section>
        ))}
      </div>
    </Page>
  );
}
