import { useEffect, useRef, useState } from 'react';
import { drawWind } from '@/lib/wind';

type Phase = 'idle' | 'sailing' | 'docked' | 'lost';

/** What the line under the buttons says, for a cursor and for a finger. */
const SAY: Record<Phase, [mouse: string, touch: string]> = {
  idle: ['Click the water to set sail. Your cursor is the wind.', 'Tap the water to set sail. Your finger is the wind.'],
  sailing: [
    'Keep off the red rocks. The current pulls you down and off the map.',
    'Keep off the red rocks. The current pulls you down and off the map.',
  ],
  docked: ['Docked. Click to sail again.', 'Docked. Tap to sail again.'],
  lost: ['Lost at sea. Click to try again.', 'Lost at sea. Tap to try again.'],
};

/** The wind's reach from the cursor, in px, and its push at the cursor itself. */
const WIND_REACH = 260;
const WIND_PUSH = 300;
/** The current: a steady pull down and a little to the left, px/s. */
const CURRENT = { x: -14, y: 34 };
const DRAG = 1.8;
const TOP_SPEED = 150;
const BOAT_R = 11;
const DOCK_R = 26;
const ROCKS = 5;
/** Where the boat waits, as a share of the sea. */
const START = { x: 0.07, y: 0.58 };

interface Rock {
  x: number;
  y: number;
  r: number;
  speed: number;
}

interface Ripple {
  x: number;
  y: number;
  at: number;
}

interface World {
  w: number;
  h: number;
  boat: { x: number; y: number; vx: number; vy: number; heading: number };
  harbour: { x: number; y: number };
  rocks: Rock[];
  ripples: Ripple[];
  cursor: { x: number; y: number } | null;
  lastRipple: { x: number; y: number } | null;
  phase: Phase;
  t: number;
}

function newWorld(w: number, h: number): World {
  const rocks: Rock[] = Array.from({ length: ROCKS }, (_, i) => ({
    x: w * (0.28 + (i / ROCKS) * 0.58) + (Math.random() - 0.5) * w * 0.08,
    y: h * (0.16 + Math.random() * 0.68),
    r: 8 + Math.random() * 6,
    speed: 22 + Math.random() * 22,
  }));
  return {
    w,
    h,
    boat: { x: START.x * w, y: START.y * h, vx: 0, vy: 0, heading: 0 },
    harbour: { x: w - Math.max(72, w * 0.07), y: h * 0.4 },
    rocks,
    ripples: [],
    cursor: null,
    lastRipple: null,
    phase: 'idle',
    t: 0,
  };
}

function step(world: World, dt: number) {
  const { boat, cursor } = world;
  world.t += dt;
  // The wind: away from the cursor, strongest at it, gone past its reach.
  if (cursor) {
    const dx = boat.x - cursor.x;
    const dy = boat.y - cursor.y;
    const d = Math.hypot(dx, dy);
    const push = Math.max(0, 1 - d / WIND_REACH) * WIND_PUSH;
    if (d > 1 && push > 0) {
      boat.vx += (dx / d) * push * dt;
      boat.vy += (dy / d) * push * dt;
    }
  }
  boat.vx += CURRENT.x * dt;
  boat.vy += CURRENT.y * dt;
  const drag = Math.exp(-DRAG * dt);
  boat.vx *= drag;
  boat.vy *= drag;
  const speed = Math.hypot(boat.vx, boat.vy);
  if (speed > TOP_SPEED) {
    boat.vx *= TOP_SPEED / speed;
    boat.vy *= TOP_SPEED / speed;
  }
  if (speed > 12) boat.heading = Math.atan2(boat.vy, boat.vx);
  boat.x += boat.vx * dt;
  boat.y += boat.vy * dt;
  // The top and the sides hold the boat; only the bottom lets it go.
  if (boat.x < BOAT_R) {
    boat.x = BOAT_R;
    boat.vx = 0;
  } else if (boat.x > world.w - BOAT_R) {
    boat.x = world.w - BOAT_R;
    boat.vx = 0;
  }
  if (boat.y < BOAT_R) {
    boat.y = BOAT_R;
    boat.vy = 0;
  }

  for (const rock of world.rocks) {
    rock.x -= rock.speed * dt;
    if (rock.x < -rock.r) rock.x = world.w + rock.r;
  }
  if (Math.hypot(boat.x - world.harbour.x, boat.y - world.harbour.y) < DOCK_R) world.phase = 'docked';
  else if (world.rocks.some((r) => Math.hypot(boat.x - r.x, boat.y - r.y) < r.r + BOAT_R - 2)) world.phase = 'lost';
  else if (boat.y > world.h + BOAT_R) world.phase = 'lost';
}

interface Palette {
  fg: string;
  accent: string;
  line: string;
  bg: string;
}

function drawBoat(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, p: Palette) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading + Math.PI / 2);
  const k = 0.3;
  ctx.scale(k, k);
  ctx.translate(-50, -50);
  ctx.fillStyle = p.fg;
  ctx.beginPath();
  ctx.moveTo(46, 8);
  ctx.lineTo(46, 66);
  ctx.lineTo(14, 66);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = p.accent;
  ctx.beginPath();
  ctx.moveTo(54, 22);
  ctx.lineTo(54, 66);
  ctx.lineTo(82, 66);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = p.fg;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(26, 80);
  ctx.lineTo(74, 80);
  ctx.stroke();
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, world: World, p: Palette) {
  const { w, h, boat, harbour } = world;
  ctx.clearRect(0, 0, w, h);

  // The course: a suggestion, from where the boat starts to the harbour.
  ctx.save();
  ctx.strokeStyle = p.accent;
  ctx.globalAlpha = 0.3;
  ctx.setLineDash([4, 6]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(START.x * w, START.y * h);
  ctx.bezierCurveTo(w * 0.35, h * 0.64, w * 0.6, h * 0.24, harbour.x, harbour.y);
  ctx.stroke();
  ctx.restore();

  // Ripples where the wind has been.
  for (const r of world.ripples) {
    const age = (world.t - r.at) / 1.2;
    ctx.beginPath();
    ctx.arc(r.x, r.y, 6 + age * 44, 0, Math.PI * 2);
    ctx.strokeStyle = p.accent;
    ctx.globalAlpha = 0.35 * (1 - age);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // The wind itself, while it reaches the boat.
  if (world.cursor && world.phase === 'sailing') drawWind(ctx, world.cursor, boat, world.t, WIND_REACH, p.fg);

  // The rocks: the red the failed requirement wears.
  for (const rock of world.rocks) {
    ctx.beginPath();
    ctx.arc(rock.x, rock.y, rock.r + 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rock.x, rock.y, rock.r, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444';
    ctx.fill();
  }

  // The harbour: the green of a proved one, its ring breathing.
  const pulse = 1 + Math.sin(world.t * 2.2) * 0.12;
  ctx.beginPath();
  ctx.arc(harbour.x, harbour.y, DOCK_R * pulse, 0, Math.PI * 2);
  ctx.strokeStyle = '#10b981';
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(harbour.x, harbour.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#10b981';
  ctx.fill();

  if (world.phase !== 'lost') drawBoat(ctx, boat.x, boat.y, boat.heading, p);
}

function palette(): Palette {
  const css = getComputedStyle(document.documentElement);
  return {
    fg: css.getPropertyValue('--fg').trim() || '#111827',
    accent: css.getPropertyValue('--accent').trim() || '#15803d',
    line: css.getPropertyValue('--line').trim() || '#e5e7eb',
    bg: css.getPropertyValue('--bg').trim() || '#ffffff',
  };
}

/**
 * The sea below the closing words: the boat from the hero, the cursor as the
 * wind, a harbour to reach and rocks to miss. It waits for a click, then the
 * current pulls, so standing still loses too. Touch works the
 * same way, the finger for the cursor.
 */
export function Voyage() {
  const sea = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    const coarse = window.matchMedia('(hover: none) and (pointer: coarse)');
    const read = () => setTouch(coarse.matches);
    read();
    coarse.addEventListener('change', read);
    return () => coarse.removeEventListener('change', read);
  }, []);

  useEffect(() => {
    const host = sea.current;
    const el = canvas.current;
    if (!host || !el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    let world = newWorld(host.clientWidth, host.clientHeight);
    let colors = palette();
    let raf = 0;
    let last = 0;
    let inView = false;

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = host.clientWidth;
      const h = host.clientHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (w !== world.w || h !== world.h) {
        world = newWorld(w, h);
        setPhase(world.phase);
      }
      draw(ctx, world, colors);
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
      last = now;
      if (world.phase === 'sailing') {
        step(world, dt);
        if (world.phase !== 'sailing') setPhase(world.phase);
      } else {
        world.t += dt;
      }
      world.ripples = world.ripples.filter((r) => world.t - r.at < 1.2);
      draw(ctx, world, colors);
      if (inView) raf = requestAnimationFrame(frame);
    };
    const run = () => {
      if (!raf && inView) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };

    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      world.cursor = { x, y };
      if (world.phase !== 'sailing') return;
      const lastRipple = world.lastRipple;
      if (!lastRipple || Math.hypot(x - lastRipple.x, y - lastRipple.y) > 18) {
        world.ripples.push({ x, y, at: world.t });
        world.lastRipple = { x, y };
      }
      run();
    };
    const onLeave = () => {
      world.cursor = null;
    };
    // A click sets sail, and after a voyage sets a new one.
    const onDown = (e: PointerEvent) => {
      if (world.phase === 'docked' || world.phase === 'lost') {
        world = newWorld(host.clientWidth, host.clientHeight);
      }
      if (world.phase === 'idle') {
        world.phase = 'sailing';
        setPhase('sailing');
      }
      onMove(e);
    };

    const seen = new IntersectionObserver(
      (entries) => {
        inView = entries.some((entry) => entry.isIntersecting);
        if (inView) run();
      },
      { threshold: 0.2 },
    );
    seen.observe(host);
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const recolor = () => {
      colors = palette();
      draw(ctx, world, colors);
    };
    const sized = new ResizeObserver(fit);
    sized.observe(host);
    fit();
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointerleave', onLeave);
    scheme.addEventListener('change', recolor);
    return () => {
      cancelAnimationFrame(raf);
      seen.disconnect();
      sized.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointerleave', onLeave);
      scheme.removeEventListener('change', recolor);
    };
  }, []);

  return (
    <>
      <p className="sea-say" aria-live="polite">
        {SAY[phase][touch ? 1 : 0]}
      </p>
      <div className={`sea${phase === 'sailing' ? ' sailing' : ''}`} ref={sea}>
        <canvas ref={canvas} aria-label="A sailing game: blow the boat to the harbour with your cursor" />
      </div>
    </>
  );
}
