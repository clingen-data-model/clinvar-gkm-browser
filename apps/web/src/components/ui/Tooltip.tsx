import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { ReactNode } from 'react';

interface Props {
  /** What the tooltip says. It is also the trigger's accessible name. */
  content: string;
  /** The trigger's visible content, such as an icon. */
  children: ReactNode;
  className?: string;
}

/**
 * Extra detail on hover or keyboard focus. Touch screens don't show it, so nothing a reader
 * needs may live only here; the trigger's accessible name carries the same text.
 */
export function Tooltip({ content, children, className = '' }: Props) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger
        delay={200}
        aria-label={content}
        className={`inline-flex cursor-help items-center rounded-sm align-middle ${className}`}
      >
        {children}
      </BaseTooltip.Trigger>
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner sideOffset={6} className="z-30">
          <BaseTooltip.Popup className="max-w-xs rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-lg">
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
