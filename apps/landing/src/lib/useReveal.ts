import { useEffect, useRef, useState } from 'react';

/**
 * Adds the `visible` class to the returned ref's element once it scrolls into view.
 * Pair with `.reveal` in globals.css to fade-up the element. Triggers once.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(opts?: {
  rootMargin?: string;
  threshold?: number;
}) {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            obs.unobserve(entry.target);
          }
        }
      },
      {
        rootMargin: opts?.rootMargin ?? '0px 0px -10% 0px',
        threshold: opts?.threshold ?? 0.12,
      },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [opts?.rootMargin, opts?.threshold]);

  return { ref, visible };
}

