import type { ReactNode } from 'react';

interface Props {
  title: string;
  /** Above the title: what kind of page this is, e.g. "Variant". */
  eyebrow?: string | undefined;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

/** The band under the header: the page's title, and on entity pages, facts in `children`. */
export function PageBand({ title, eyebrow, subtitle, actions, children }: Props) {
  return (
    <div className="bg-band text-band-foreground">
      <div className="mx-auto w-full max-w-7xl px-4 pt-6 pb-4">
        {eyebrow === undefined ? null : (
          <p className="text-sm tracking-wide text-band-muted-foreground uppercase">{eyebrow}</p>
        )}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h1 className="text-band-title font-normal break-words">{title}</h1>
          {actions}
        </div>
        {subtitle === undefined ? null : (
          <div className="mt-1 text-band-muted-foreground">{subtitle}</div>
        )}
      </div>
      {children === undefined ? null : (
        <div className="bg-band-secondary">
          <div className="mx-auto w-full max-w-7xl px-4 py-3">{children}</div>
        </div>
      )}
    </div>
  );
}
