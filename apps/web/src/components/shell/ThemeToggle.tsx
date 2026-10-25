import { Monitor, Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import {
  getThemePreference,
  setThemePreference,
  subscribeThemePreference,
  type ThemePreference,
} from '../../lib/theme.ts';

const next = { system: 'light', light: 'dark', dark: 'system' } as const;
const label = { system: 'System', light: 'Light', dark: 'Dark' } as const;
const icon = { system: Monitor, light: Sun, dark: Moon } as const;

/** Cycles system → light → dark, and announces the new choice to screen readers. */
export function ThemeToggle() {
  const preference = useSyncExternalStore<ThemePreference>(
    subscribeThemePreference,
    getThemePreference,
    () => 'system',
  );
  const Icon = icon[preference];
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setThemePreference(next[preference]);
        }}
        aria-label={`Color theme: ${label[preference]}. Switch to ${label[next[preference]]}`}
        title={`Color theme: ${label[preference]}`}
        className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Icon aria-hidden="true" className="size-5" />
      </button>
      <span role="status" className="sr-only">
        {`Color theme: ${label[preference]}`}
      </span>
    </>
  );
}
