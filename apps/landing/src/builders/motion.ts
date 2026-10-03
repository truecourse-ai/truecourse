import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The clock and easing the /builders scenes are drawn with. A scene is a pure
 * function of its time `t`: every element's place, opacity and text is worked
 * out from `t` on each frame, the way a film's frame is, so a scene can loop,
 * pause off screen and stand still at its most telling frame.
 */

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
/** Progress of `t` through the span `a`..`b`, clamped to 0..1. */
export const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
export const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 4);
export const easeInOut = (x: number) => (x < 0.5 ? 8 * x ** 4 : 1 - Math.pow(-2 * x + 2, 4) / 2);
export const backOut = (x: number) => {
  const c1 = 1.7;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/** Fades and rises in over `a`..`a+dur`, and out over `out`..`out+0.5` when given. */
export function enter(t: number, a: number, dur = 0.5, out?: number, rise = 14) {
  const i = easeOut(span(t, a, a + dur));
  const o = out == null ? 0 : easeInOut(span(t, out, out + 0.5));
  return { opacity: i * (1 - o), transform: `translateY(${(1 - i) * rise - o * 8}px)` };
}

/** The first `n` characters of `text` once typing starts at `a`, at `cps` per second. */
export function typed(text: string, t: number, a: number, cps = 28) {
  return text.slice(0, Math.max(0, Math.floor((t - a) * cps)));
}

/**
 * A clock for one scene. It runs only while the scene is on screen, so a
 * scene scrolled past keeps its place; it loops, or with `once` plays to
 * `length` and holds there. Under reduced motion it stands at `still`, the
 * frame that tells the scene's story on its own.
 */
export function useClock(length: number, still: number, once = false) {
  const ref = useRef<HTMLDivElement>(null);
  const at = useRef(0);
  const [t, setT] = useState(0);

  /** Jumps the scene to time `to`, as a click on one of its steps does. */
  const seek = useCallback((to: number) => {
    at.current = to;
    setT(to);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      at.current = still;
      setT(still);
      return;
    }
    let raf = 0;
    let shown = false;
    let last = 0;
    const tick = (now: number) => {
      if (!shown) {
        raf = 0;
        return;
      }
      const next = at.current + Math.min(0.05, (now - last) / 1000);
      at.current = once ? Math.min(next, length) : next % length;
      last = now;
      setT(at.current);
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        shown = !!entry?.isIntersecting;
        if (shown && !raf) {
          last = performance.now();
          raf = requestAnimationFrame(tick);
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [length, still, once]);

  return { ref, t, seek };
}

/**
 * Scales a scene drawn at a fixed `width` by `height` to the width of its
 * column, so one drawing serves a desktop and a phone alike.
 */
export function useFit(width: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setK(el.clientWidth / width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return { ref, k };
}

/** Phone width, where a scene draws its narrow layout. */
export const NARROW = '(max-width: 640px)';

/** Whether the page is at phone width, kept current as the window changes. */
export function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return narrow;
}
