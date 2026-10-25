const BUCKET_CLASS = {
  P: 'bg-bucket-p',
  V: 'bg-bucket-v',
  B: 'bg-bucket-b',
  O: 'bg-bucket-o',
  N: 'bg-bucket-n',
} as const;

export type Bucket = keyof typeof BUCKET_CLASS;

interface Props {
  /** The normalized term's label, e.g. "Likely benign". */
  label: string | null;
  bucket: Bucket | null;
  /** ClinVar's text as submitted, shown when it differs from the label. */
  submitted?: string | null;
}

/** A classification, colored by significance (P/LP red, VUS amber, B/LB green). */
export function TermPill({ label, bucket, submitted = null }: Props) {
  const text = label ?? submitted ?? 'Unmapped';
  const differs =
    submitted !== null && label !== null && submitted.toLowerCase() !== label.toLowerCase();
  return (
    <span
      title={differs ? `Submitted as "${submitted}"` : undefined}
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-bucket-foreground ${bucket === null ? 'bg-bucket-n' : BUCKET_CLASS[bucket]}`}
    >
      {text}
    </span>
  );
}
