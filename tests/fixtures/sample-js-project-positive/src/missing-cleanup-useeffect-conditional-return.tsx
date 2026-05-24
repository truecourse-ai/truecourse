/**
 * useEffect that conditionally attaches an event listener and returns
 * the matching cleanup from inside the same `if` block. The listener
 * is correctly removed when the effect tears down — the cleanup just
 * doesn't sit at the top of the callback body.
 */

import { useEffect } from 'react';

declare function getFormContainer(): HTMLElement | null;
declare function recordBlur(): void;

export function AutoSaveOnBlur({ enabled }: { enabled: boolean }): null {
  useEffect(() => {
    const container = getFormContainer();

    const handleBlur = (): void => {
      recordBlur();
    };

    if (container && enabled) {
      container.addEventListener('blur', handleBlur, true);
      return () => {
        container.removeEventListener('blur', handleBlur, true);
      };
    }
  }, [enabled]);

  return null;
}
