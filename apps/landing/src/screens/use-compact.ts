import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 640px)';

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/**
 * Whether a screen should draw its phone layout: fewer columns and no sidebar,
 * so the text stays legible once the SVG is scaled to a narrow viewport. The
 * prerender draws the full layout; a phone switches after hydration.
 */
export function useCompact(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
