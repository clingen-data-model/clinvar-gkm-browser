import { useRouterState } from '@tanstack/react-router';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** Wait this long before showing anything, so fast changes don't flicker. */
const SHOW_AFTER_MS = 300;
/** Once shown, stay at least this long, so it doesn't flash. */
const MIN_SHOWN_MS = 400;
/** After this long, say that big comparisons take a while. */
const SLOW_AFTER_MS = 5000;

/**
 * `on`, delayed: true only once `on` has lasted `showAfterMs`, and then for at least `minShownMs`
 * even if `on` ends sooner.
 */
function useDelayedFlag(on: boolean, showAfterMs: number, minShownMs: number): boolean {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    if (on) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setShown(true);
      }, showAfterMs);
      return () => {
        clearTimeout(timer);
      };
    }
    const timer = setTimeout(
      () => {
        setShown(false);
      },
      Math.max(0, shownAt.current + minShownMs - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [on, showAfterMs, minShownMs]);
  return shown;
}

/**
 * Whether the page is waiting for data, as the user should see it: the router is loading a
 * page (a navigation, or a filter or page change, whose loaders fetch the data), for longer
 * than a moment. Preloads on hovering a link don't count; the page isn't waiting for those.
 */
export function useBusy(): { busy: boolean; slow: boolean } {
  const pending = useRouterState({ select: (s) => s.status === 'pending' });
  return {
    busy: useDelayedFlag(pending, SHOW_AFTER_MS, MIN_SHOWN_MS),
    slow: useDelayedFlag(pending, SLOW_AFTER_MS, 0),
  };
}

/**
 * The app's one loading indicator: a bar sweeping across the top of the window and a pill in
 * the corner, while the page underneath (dimmed by AppShell) is out of date. Screen readers
 * hear it through the pill's status region, which stays mounted so the change is announced.
 */
export function BusyIndicator({ busy, slow }: { busy: boolean; slow: boolean }) {
  return (
    <>
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-x-0 top-0 z-50 h-1 overflow-hidden ${busy ? '' : 'hidden'}`}
      >
        <div className="h-full w-1/3 animate-busy-sweep bg-link motion-reduce:w-full motion-reduce:animate-none" />
      </div>
      <div role="status" className={`fixed right-4 bottom-4 z-50 ${busy ? '' : 'sr-only'}`}>
        {busy ? (
          <span className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm shadow-lg">
            <LoaderCircle
              aria-hidden="true"
              className="size-4 animate-spin text-link motion-reduce:animate-none"
            />
            {slow ? 'Still working: large comparisons can take a while…' : 'Loading…'}
          </span>
        ) : null}
      </div>
    </>
  );
}
