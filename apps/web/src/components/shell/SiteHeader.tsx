import { Link } from '@tanstack/react-router';
import { ReleasePicker } from './ReleasePicker.tsx';
import { SearchBox } from './SearchBox.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link to="/" className="shrink-0 text-lg font-semibold text-foreground no-underline">
          ClinVar GKM browser
        </Link>
        <div className="min-w-64 flex-1">
          <SearchBox />
        </div>
        <nav aria-label="Site" className="flex items-center gap-4">
          <a href="/api/v1/docs" className="text-sm">
            API
          </a>
          <ReleasePicker />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
