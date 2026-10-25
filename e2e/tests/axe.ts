import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** Accessibility checks for a page (WCAG 2.1 AA). */
export function axe(page: Page): AxeBuilder {
  return new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
}
