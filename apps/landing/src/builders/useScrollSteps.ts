import { useEffect, useRef, useState } from 'react';

/** Below this width a section is not pinned. */
export const PIN_MIN_WIDTH = 900;
/**
 * How much further than a step's edge, as a share of the section's scroll,
 * the reader must scroll back before the step before it returns, so a small
 * scroll back at an edge does not flick between the two.
 */
const BACK_MARGIN = 0.04;

/**
 * Steps a pinned section through `count` steps. The section is the returned
 * `pin` element, several screens tall, whose contents stick in view while the
 * page scrolls through it. Scrolling picks the step from how far through the
 * section the reader is, going back a step only once the reader has scrolled
 * a little past its edge; nothing moves on by itself. `u` is how far into the
 * current step it has played, up to `seconds`. A step reached going forward
 * plays its entrance; one returned to going back is already played and stays
 * as it was; coming back into view replays nothing. Under reduced motion it
 * stands at `still`. `pinned` says whether the section is pinned at this
 * width; where it is not, `jump` simply shows a step, and otherwise scrolls
 * to it.
 */
export function useScrollSteps(count: number, seconds: number, still: number) {
  const pin = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [u, setU] = useState(0);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const el = pin.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let current = 0;
    let started = performance.now();
    /** The current step has not played yet, so its entrance starts when it is first seen. */
    let fresh = true;
    let raf = 0;
    let shown = false;

    const go = (next: number) => {
      if (next === current) return;
      const back = next < current;
      current = next;
      started = performance.now() - (back ? seconds * 1000 : 0);
      fresh = !back && !shown;
      setStep(next);
      setU(reduced ? still : back ? seconds : 0);
    };
    const wide = () => window.innerWidth >= PIN_MIN_WIDTH;
    const fromScroll = () => {
      const box = el.getBoundingClientRect();
      const range = box.height - window.innerHeight;
      if (range <= 0) return current;
      const through = Math.min(0.999, Math.max(0, -box.top / range));
      const target = Math.floor(through * count);
      if (target < current && through > current / count - BACK_MARGIN) return current;
      return target;
    };

    const onScroll = () => {
      if (wide()) go(fromScroll());
    };
    const onResize = () => setPinned(wide());
    const tick = (now: number) => {
      if (!shown) {
        raf = 0;
        return;
      }
      setU(Math.min((now - started) / 1000, seconds));
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([entry]) => {
      shown = !!entry?.isIntersecting;
      if (shown && !raf && !reduced) {
        if (fresh) {
          started = performance.now();
          fresh = false;
        }
        raf = requestAnimationFrame(tick);
      }
    });

    if (reduced) setU(still);
    onResize();
    if (wide()) go(fromScroll());
    io.observe(el);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [count, seconds, still]);

  const jump = (i: number) => {
    const el = pin.current;
    if (!el || window.innerWidth < PIN_MIN_WIDTH) {
      setStep(i);
      setU(0);
      return;
    }
    const top = el.getBoundingClientRect().top + window.scrollY;
    const range = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + ((i + 0.5) / count) * range, behavior: 'smooth' });
  };

  return { pin, step, u, jump, pinned };
}
