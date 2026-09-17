import { useEffect, useRef } from 'react';
import { AppLink } from './AppLink';
import { Reveal } from './Reveal';
import { BoatGlyph } from './Sailboat';
import { Clouds } from './Clouds';
import { WAVE, Waves } from './Waves';
import { useReveal } from '@/lib/useReveal';
import { drawWind } from '@/lib/wind';
import { HomeTour } from '@/screens/HomeTour';

const GITHUB_URL = 'https://github.com/truecourse-ai/truecourse';

/** The baseline's drawing space: stretched to the hero's width, 160px tall. */
const LINE_W = 1440;
const LINE = WAVE;
/** The boat's size on the line, in px per glyph unit. */
const BOAT_K = 0.42;
/** The boat's own way, px/s along the line, and the most the wind adds. */
const DRIFT = 12;
const GUST = 320;
const TOP_SPEED = 220;
/** The wind's reach from the cursor, in px. */
const WIND_REACH = 240;

export function Hero() {
  // The baseline sits at the bottom of the hero, often below the fold, so it
  // draws when it comes into view rather than on load.
  const line = useReveal<SVGSVGElement>({ threshold: 0.5, rootMargin: '0px' });
  const boat = useRef<SVGGElement>(null);
  const hero = useRef<HTMLElement>(null);
  const wind = useRef<HTMLCanvasElement>(null);
  // The tour starts on the same signal as the stage's settle-in.
  const stage = useReveal<HTMLDivElement>();

  // The boat rides the line from the first paint and, once the line is in
  // view, makes its slow way across and back, coming about at each end, bobbing, heeled to the water under it. The
  // cursor is the wind: near the boat it pushes it on from behind or holds it
  // back from ahead, its streaks drawn on a sheet over the hero. The line is
  // stretched to the hero's width, so the glyph is counter-scaled to keep its
  // shape. Under reduced motion it sits still, a third of the way across.
  useEffect(() => {
    if (!line.visible) return;
    const svg = line.ref.current;
    const path = svg?.querySelector<SVGPathElement>('.hero-crest');
    const hull = boat.current;
    const host = hero.current;
    const sheet = wind.current;
    const ctx = sheet?.getContext('2d');
    if (!svg || !path || !hull || !host || !sheet || !ctx) return;
    const total = path.getTotalLength();
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cursor: { x: number; y: number } | null = null;
    const place = (u: number, t: number, way: number, dir: number) => {
      const rect = svg.getBoundingClientRect();
      const sx = LINE_W / Math.max(1, rect.width);
      const l = u * total;
      const p = path.getPointAtLength(l);
      const q = path.getPointAtLength(Math.min(total, l + 2));
      const heel = (Math.atan2(q.y - p.y, (q.x - p.x) / sx) * 180) / Math.PI;
      const bob = still ? 0 : Math.sin(t / 900) * 1.5;
      const roll = still ? 0 : Math.sin(t / 1400) * 2.5 + way / 30;
      hull.setAttribute(
        'transform',
        `translate(${p.x} ${p.y + bob}) scale(${sx} 1) rotate(${heel + roll}) scale(${dir * BOAT_K} ${BOAT_K}) translate(-50 -80)`,
      );
      return { x: rect.left + p.x / sx, y: rect.top + p.y };
    };
    if (still) {
      place(0.3, 0, 0, 1);
      return;
    }
    const onMove = (e: PointerEvent) => {
      cursor = { x: e.clientX, y: e.clientY };
    };
    const onLeave = () => {
      cursor = null;
    };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);

    const fg = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim() || '#111827';
    let drawn = false;
    const blow = (t: number, at: { x: number; y: number }) => {
      const box = host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(box.width * dpr);
      const h = Math.round(box.height * dpr);
      if (sheet.width !== w || sheet.height !== h) {
        sheet.width = w;
        sheet.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (drawn) ctx.clearRect(0, 0, box.width, box.height);
      drawn = cursor
        ? drawWind(
            ctx,
            { x: cursor.x - box.left, y: cursor.y - box.top },
            { x: at.x - box.left, y: at.y - box.top },
            t / 1000,
            WIND_REACH,
            fg,
          )
        : false;
    };

    const t0 = performance.now();
    let last = t0;
    let u = 0.3;
    let dir = 1;
    let way = 0;
    let at = place(u, 0, 0, dir);
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const rect = svg.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      const t = now - t0;
      if (cursor) {
        const dx = at.x - cursor.x;
        const d = Math.hypot(dx, at.y - cursor.y);
        const push = Math.max(0, 1 - d / WIND_REACH);
        if (d > 1) way += Math.sign(dx) * push * GUST * dt;
      }
      blow(t, at);
      way *= Math.exp(-1.6 * dt);
      way = Math.max(-TOP_SPEED, Math.min(TOP_SPEED, way));
      u += ((DRIFT * dir + way) * dt) / Math.max(1, rect.width);
      // At either end the boat comes about and sails the other way.
      if (u > 1) {
        u = 1;
        dir = -1;
        way = -Math.abs(way);
      } else if (u < 0) {
        u = 0;
        dir = 1;
        way = Math.abs(way);
      }
      at = place(0.04 + u * 0.92, t, way, dir);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, [line.visible, line.ref]);

  return (
    <section className="hero" id="top" ref={hero}>
      <Clouds className="hero-clouds" />
      <Clouds className="hero-clouds" layout="narrow" />
      <svg
        ref={line.ref}
        className={`hero-line${line.visible ? ' visible' : ''}`}
        viewBox={`0 0 ${LINE_W} 160`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <Waves />
        <path className="hero-crest" d={LINE} pathLength={1} />
        <g ref={boat} className="hero-boat" transform="translate(472 92) scale(0.42) translate(-50 -80)">
          <BoatGlyph />
        </g>
      </svg>
      <canvas ref={wind} className="hero-wind" aria-hidden="true" />
      <div className="wrap hero-inner">
        <Reveal as="p" className="kicker" delay={20} rise>
          The IDE for product owners
        </Reveal>
        <Reveal as="h1" delay={60} rise>
          AI writes the code. You own what it does.
        </Reveal>
        <Reveal as="p" className="sub" delay={140} rise>
          Every requirement you wrote, proven on every pull request before a bug reaches anyone.
        </Reveal>
        <Reveal className="cta-row" delay={220} rise>
          <AppLink className="btn btn-primary" placement="hero">
            Get started
          </AppLink>
          <a className="btn" href={GITHUB_URL} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        </Reveal>
        <div
          ref={stage.ref}
          className={`reveal rise hero-stage${stage.visible ? ' visible' : ''}`}
          style={{ ['--delay' as string]: '300ms' }}
        >
          <HomeTour visible={stage.visible} />
        </div>
      </div>
    </section>
  );
}
