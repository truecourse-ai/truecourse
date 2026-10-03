import { useEffect } from 'react';
import { trackEvent } from '@/lib/posthog';

/**
 * Records how far down the /builders page a visitor reads: the first time each
 * section with one of `ids` comes into view, `builders_section_viewed` fires
 * once with that section's id.
 */
export function useSectionViews(ids: string[]) {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const seen = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (!entry.isIntersecting || seen.has(id)) continue;
          seen.add(id);
          io.unobserve(entry.target);
          trackEvent('builders_section_viewed', { section: id });
        }
      },
      // A section counts once its top passes the upper 60% of the screen,
      // however tall it is.
      { rootMargin: '0px 0px -40% 0px' },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [ids]);
}
