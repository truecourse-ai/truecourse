import { useEffect, useState } from 'react';

/**
 * A 0..1 progress that runs once, `delay` ms after `active` turns true, eased
 * out over `duration` ms. It sits at 1 before the run starts (the prerender and
 * the no-JS page show the end state) and jumps straight to 1 under reduced
 * motion.
 */
export function useProgress(active: boolean, delay: number, duration: number): number {
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    if (!active) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    let start: number | null = null;
    setProgress(0);
    const tick = (now: number) => {
      if (start === null) start = now + delay;
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      setProgress(1 - (1 - t) ** 2);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, delay, duration]);

  return progress;
}
