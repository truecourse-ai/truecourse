import type { ReactNode } from 'react';
import {
  BarChart3,
  Boxes,
  Clapperboard,
  Contact,
  CreditCard,
  GraduationCap,
  HeartPulse,
  MessagesSquare,
  ShoppingCart,
  Smartphone,
  Store,
  Users,
} from 'lucide-react';
import { easeOut, span, useClock } from '../motion';

/**
 * Who is behind it, without names. On the right the kinds of applications
 * the team has built stream out of the distance: each starts small and
 * blurred far back, comes forward sharp, and fades as it passes, one after
 * another without end. On the left the track record counts up.
 */

const KINDS: { label: string; icon: ReactNode }[] = [
  { label: 'ERP', icon: <Boxes /> },
  { label: 'Healthtech', icon: <HeartPulse /> },
  { label: 'CRM', icon: <Contact /> },
  { label: 'Fintech', icon: <CreditCard /> },
  { label: 'Collaborative apps', icon: <MessagesSquare /> },
  { label: 'MediaTech', icon: <Clapperboard /> },
  { label: 'E-commerce', icon: <ShoppingCart /> },
  { label: 'Edtech', icon: <GraduationCap /> },
  { label: 'Marketplaces', icon: <Store /> },
  { label: 'Consumer mobile apps', icon: <Smartphone /> },
  { label: 'HR platforms', icon: <Users /> },
  { label: 'Analytics dashboards', icon: <BarChart3 /> },
];

/** Where each kind sits across the view, as a share of half its width and height. */
const SPOTS: [number, number][] = [
  [-0.55, -0.45],
  [0.5, -0.2],
  [-0.2, 0.5],
  [0.6, 0.45],
  [-0.65, 0.1],
  [0.15, -0.6],
  [0.45, 0.15],
  [-0.4, -0.1],
  [0.05, 0.25],
  [-0.6, 0.55],
  [0.65, -0.5],
  [-0.1, -0.35],
];

/** How long one kind takes to come from the back and pass. */
const LOOP = 9;
const FAR = -1600;
const NEAR = 120;

export function TrackRecord() {
  const { ref, t } = useClock(LOOP, LOOP * 0.55);
  return (
    <div
      ref={ref}
      className="bs-depth"
      role="img"
      aria-label="The kinds of applications the team has built stream out of the distance one after another, ERP, healthtech, CRM, fintech, collaborative apps, MediaTech, e-commerce, edtech, marketplaces, consumer mobile apps, HR platforms and analytics dashboards."
    >
      {KINDS.map((k, i) => {
        const p = (t / LOOP + i / KINDS.length) % 1;
        const z = FAR + (NEAR - FAR) * p;
        const opacity = easeOut(span(p, 0, 0.35)) * (1 - easeOut(span(p, 0.7, 0.94)));
        const blur = (1 - span(p, 0, 0.55)) * 4;
        const [x, y] = SPOTS[i]!;
        return (
          <div
            key={k.label}
            className="bs-depth-kind"
            style={{
              opacity,
              filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined,
              transform: `translate(-50%, -50%) translate3d(calc(${x} * var(--half-w)), calc(${y} * var(--half-h)), ${z.toFixed(0)}px)`,
              zIndex: Math.round(p * 100),
            }}
          >
            <span className="bs-glyph">{k.icon}</span>
            {k.label}
          </div>
        );
      })}
    </div>
  );
}

/** The track record, counted up once it is in view. */
export function TrackStats() {
  const { ref, t } = useClock(2.4, 2.4, true);
  const years = Math.round(35 * easeOut(span(t, 0.2, 1.8)));
  const rise = (a: number) => {
    const k = easeOut(span(t, a, a + 0.6));
    return { opacity: k, transform: `translateY(${(1 - k) * 12}px)` };
  };
  return (
    <div ref={ref}>
      <ul className="bs-track-stats">
        <li style={rise(0.1)}>
          <b>{years}+ years</b>
          <span>leading engineering, combined</span>
        </li>
        <li style={rise(0.5)}>
          <b>Thousands</b>
          <span>of enterprises served</span>
        </li>
        <li style={rise(0.9)}>
          <b>Millions</b>
          <span>of people using what we built</span>
        </li>
      </ul>
    </div>
  );
}
