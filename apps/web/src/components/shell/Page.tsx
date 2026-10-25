import type { ReactNode } from 'react';
import { PageBand } from './PageBand.tsx';

interface Props {
  title: string;
  eyebrow?: string;
  subtitle?: ReactNode;
  /** The browser tab's title; defaults to the page title. */
  documentTitle?: string;
  bandActions?: ReactNode;
  band?: ReactNode;
  children: ReactNode;
}

/** A page: its document title, the band, and the content container. */
export function Page({
  title,
  eyebrow,
  subtitle,
  documentTitle,
  bandActions,
  band,
  children,
}: Props) {
  return (
    <>
      <title>{`${documentTitle ?? title} | ClinVar GKM browser`}</title>
      <PageBand title={title} eyebrow={eyebrow} subtitle={subtitle} actions={bandActions}>
        {band}
      </PageBand>
      <div className="mx-auto w-full max-w-7xl px-4 py-8">{children}</div>
    </>
  );
}
