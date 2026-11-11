import type { ScvVersion } from '@cvb/shared/api';
import { holdsIn, ReleaseSpan } from './ReleaseSpan.tsx';
import { VcvVersionLink } from './VcvVersionList.tsx';

/** An SCV's versions, newest first, each as of its last release, with the VCV versions it was in. */
export function ScvVersionTable({
  versions,
  shown,
}: {
  versions: ScvVersion[];
  /** The release the page shows. */
  shown: string;
}) {
  return (
    <table className="text-sm">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          <th className="py-1 pr-4 font-normal">Version</th>
          <th className="py-1 pr-4 font-normal">Classification</th>
          <th className="py-1 pr-4 font-normal">Review status</th>
          <th className="py-1 pr-4 font-normal">Last evaluated</th>
          <th className="py-1 pr-4 font-normal">Releases</th>
          <th className="py-1 font-normal">VCV versions</th>
        </tr>
      </thead>
      <tbody>
        {[...versions].reverse().map((v) => (
          <tr key={`${String(v.version)}-${v.from}`} className="border-b border-border align-top">
            <td className="py-1 pr-4 whitespace-nowrap">
              {v.version}
              {holdsIn(v, shown) ? <span className="text-muted-foreground"> (shown)</span> : null}
            </td>
            <td className="py-1 pr-4">{v.classification ?? '—'}</td>
            <td className="py-1 pr-4">{v.reviewStatus ?? '—'}</td>
            <td className="py-1 pr-4 whitespace-nowrap">{v.dateLastEvaluated ?? '—'}</td>
            <td className="py-1 pr-4 text-muted-foreground">
              <ReleaseSpan span={v} />
            </td>
            <td className="py-1">
              {v.vcvVersions.map((x, i) => (
                <span key={`${String(x.version)}-${x.from}`}>
                  {i === 0 ? '' : ', '}
                  <VcvVersionLink variationId={v.variationId} version={x} />
                </span>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
