import type { ReactNode } from 'react';
import { enter, typed, useClock } from '../motion';
import { Mark, People, Pulse, Shield } from '../icons';

const LENGTH = 14;
const OUT = 12.8;

type Tone = 'ok' | 'warn' | 'fail' | 'info';

interface Item {
  at: number;
  icon: ReactNode;
  tone: Tone;
  title: string;
  detail: string;
  /** The chip it opens with; `settled` is what it turns into, and when. */
  chip: [string, Tone];
  settled?: { at: number; chip: [string, Tone]; tone: Tone };
}

const ITEMS: Item[] = [
  {
    at: 1.9,
    icon: <Shield />,
    tone: 'warn',
    title: '3 changes checked before they went live',
    detail: 'Stopped one bug. Team invites sent no email.',
    chip: ['Blocked', 'warn'],
    settled: { at: 4.6, chip: ['Fixed', 'ok'], tone: 'ok' },
  },
  {
    at: 2.9,
    icon: <Pulse />,
    tone: 'fail',
    title: 'Checkout failed for 14 people at 2:10 AM',
    detail: "Caused by Tuesday's payment change. Fixed at 2:24 AM.",
    chip: ['Outage', 'fail'],
    settled: { at: 5.6, chip: ['Resolved', 'ok'], tone: 'ok' },
  },
  {
    at: 3.9,
    icon: <People />,
    tone: 'info',
    title: "23 people can't find Export on their phone",
    detail: 'Top user problem this week. A fix is ready.',
    chip: ['New', 'info'],
  },
];

/**
 * The hero: the AI CTO's morning message. Overnight it checked the changes,
 * caught an outage and found its cause, and found what users struggle with,
 * one line each, settling from alarm to resolved while the reader watches.
 * Drawn in the page's own flow, so it reads at any width.
 */
export function MorningReport() {
  const { ref, t } = useClock(LENGTH, 9);
  const greeting = "Good morning, Dana. Here's how Acme Portal did overnight.";

  return (
    <div
      ref={ref}
      className="bs-card bs-report"
      style={enter(t, 0.1, 0.7, OUT, 30)}
      role="img"
      aria-label="A morning message from the AI CTO. Three changes checked and one bug stopped, a checkout outage found and fixed overnight, and the top user problem found."
    >
      <div className="bs-report-head" aria-hidden="true">
        <span className="bs-avatar">
          <Mark />
        </span>
        <b>AI CTO</b>
        <span className="bs-muted">7:30 AM</span>
      </div>
      {/* The whole greeting holds its space unseen while the typed one is drawn over it, so the card never grows as it types. */}
      <p className="bs-report-say" aria-hidden="true">
        <span className="bs-say-room">{greeting}</span>
        <span className="bs-say-typed">
          {typed(greeting, t, 0.8, 40)}
          {t < 2.2 && <span className="bs-caret" style={{ opacity: Math.floor(t * 3) % 2 ? 0 : 1 }} />}
        </span>
      </p>
      <ul className="bs-report-list" aria-hidden="true">
        {ITEMS.map((item) => {
          const done = item.settled && t >= item.settled.at;
          const tone = done ? item.settled!.tone : item.tone;
          const [chip, chipTone] = done ? item.settled!.chip : item.chip;
          return (
            <li key={item.title} style={enter(t, item.at, 0.55)}>
              <span className={`bs-tile tone-${tone}`}>{item.icon}</span>
              <span className="bs-report-text">
                <b>{item.title}</b>
                <span>{item.detail}</span>
              </span>
              <span key={chip} className={`bs-chip tone-${chipTone} bs-pop`}>
                {chip}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="bs-report-foot" style={enter(t, 6.6, 0.6)} aria-hidden="true">
        <span className="bs-live" />
        <b>All systems healthy.</b>
        <span className="bs-muted">Nothing needs attention.</span>
      </div>
    </div>
  );
}
