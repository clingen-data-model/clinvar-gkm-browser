import type { VcvVersion } from '@cvb/shared/api';
import { Link } from '@tanstack/react-router';
import { holdsIn, ReleaseSpan } from './ReleaseSpan.tsx';

/**
 * A variant's VCV versions, each linking to the variant as of its first release (the latest
 * version to the current one). The version in the release shown is marked.
 */
export function VcvVersionList({
  variationId,
  versions,
  shown,
}: {
  variationId: number;
  versions: VcvVersion[];
  /** The release the page shows. */
  shown: string;
}) {
  return (
    <ul className="text-sm">
      {[...versions].reverse().map((v) => (
        <li key={`${String(v.version)}-${v.from}`} className="flex gap-3 py-0.5">
          <VcvVersionLink variationId={variationId} version={v} />
          <span className="text-muted-foreground">
            <ReleaseSpan span={v} />
          </span>
          {holdsIn(v, shown) ? <span className="text-muted-foreground">(shown)</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** A VCV version, linking to its variant as of the version's first release. */
export function VcvVersionLink({
  variationId,
  version,
}: {
  variationId: number;
  version: VcvVersion;
}) {
  return (
    <Link
      to="/variants/$id"
      params={{ id: variationId }}
      search={(prev) => ({ ...prev, release: version.to === null ? undefined : version.from })}
    >
      {version.version === null ? 'no VCV' : `version ${String(version.version)}`}
    </Link>
  );
}
