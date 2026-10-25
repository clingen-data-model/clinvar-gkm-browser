// The user's color theme choice. "system" follows the OS; "light" and "dark" override it by
// setting data-theme on <html>. index.html applies a stored choice before first paint.

export type ThemePreference = 'system' | 'light' | 'dark';

// index.html's bootstrap script reads the same key.
const STORAGE_KEY = 'cvb-theme';
const listeners = new Set<() => void>();

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Storage can be unavailable (privacy settings); fall back to the OS preference.
  }
  return 'system';
}

function apply(preference: ThemePreference): void {
  if (preference === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset['theme'] = preference;
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // The choice still applies to this page.
  }
  apply(preference);
  for (const listener of listeners) listener();
}

/** For useSyncExternalStore. Also follows changes made in other tabs. */
export function subscribeThemePreference(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    apply(getThemePreference());
    listener();
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
