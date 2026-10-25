import { Star } from 'lucide-react';

/** ClinVar's review stars, 0 to 4; the text beside them carries the meaning for screen readers. */
export function Stars({ stars }: { stars: number | null }) {
  if (stars === null) return null;
  return (
    <span
      role="img"
      aria-label={`${String(stars)} of 4 stars`}
      className="inline-flex gap-px align-middle"
    >
      {[1, 2, 3, 4].map((n) => (
        <Star
          key={n}
          aria-hidden="true"
          className={`size-3.5 ${n <= stars ? 'fill-star text-star' : 'text-border'}`}
        />
      ))}
    </span>
  );
}
