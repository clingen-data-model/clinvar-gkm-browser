// The "Diagrams" section of docs/upstream-vs-derived.md, read at build time, so the schema page
// and the doc can't disagree. The derived diagrams in it are generated from schema.sql
// (scripts/schema-diagrams.sh).

import doc from '../../../../docs/upstream-vs-derived.md?raw';

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'diagram'; source: string };

export interface DiagramSection {
  title: string;
  blocks: Block[];
}

/** A Markdown fragment's paragraphs, bullet lists and Mermaid blocks; other fences are skipped. */
function blocksOf(markdown: string): Block[] {
  const blocks: Block[] = [];
  const parts = markdown.split(/(```[a-z]*\n[\s\S]*?```)/);
  for (const part of parts) {
    const fence = /^```([a-z]*)\n([\s\S]*?)```$/.exec(part);
    if (fence !== null) {
      if (fence[1] === 'mermaid') blocks.push({ kind: 'diagram', source: fence[2] ?? '' });
      continue;
    }
    for (const para of part.split(/\n\s*\n/)) {
      // The generator's markers are HTML comments.
      const text = para.replace(/<!--[\s\S]*?-->/g, '').trim();
      if (text === '') continue;
      if (text.startsWith('- ')) {
        blocks.push({ kind: 'list', items: text.split(/\n- /).map((i) => i.replace(/^- /, '')) });
      } else {
        blocks.push({ kind: 'text', text: text.replace(/\n/g, ' ') });
      }
    }
  }
  return blocks;
}

/** The section's introduction (untitled) and each of its ### subsections. */
export function diagramSections(): DiagramSection[] {
  const start = doc.indexOf('\n## Diagrams\n');
  if (start === -1) return [];
  const end = doc.indexOf('\n## ', start + 1);
  const body = doc.slice(start + '\n## Diagrams\n'.length, end === -1 ? undefined : end);
  return body.split(/\n### /).map((chunk, i) => {
    if (i === 0) return { title: '', blocks: blocksOf(chunk) };
    const newline = chunk.indexOf('\n');
    return { title: chunk.slice(0, newline).trim(), blocks: blocksOf(chunk.slice(newline)) };
  });
}
