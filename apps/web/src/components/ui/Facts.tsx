import type { ReactNode } from 'react';

/** Label/value pairs in the band of an entity page. */
export function Facts({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-band-muted-foreground">{label}</dt>
          <dd className="[&_a]:text-band-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
