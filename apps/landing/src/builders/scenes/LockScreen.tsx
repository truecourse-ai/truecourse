import type { ReactNode } from 'react';
import { Stage } from '../Stage';
import { Mail } from '../icons';

/**
 * The iPhone lock screen both phone scenes draw on: the hero's calm morning,
 * where the AI CTO's texts are all there is, and the evening, where the
 * alarms pile up. Notifications land newest on top; how far each one has
 * landed (0 to 1) is the scene's to say. A run of Stripe notifications
 * stacks the way iOS stacks them: one card showing the newest, layers
 * peeking out beneath, and how many more it holds. Behind the phone a glow
 * says which kind of day it is, green for good news and red for bad, growing
 * as the notifications land and pulsing with each one.
 */

export type LockApp = 'appstore' | 'mail' | 'stripe' | 'cto';

export interface LockNote {
  app: LockApp;
  time: string;
  title: string;
  body: string;
}

/** The apps whose runs of notifications stack into one card. */
const STACKS: ReadonlySet<LockApp> = new Set(['stripe']);

interface Group {
  /** The index of the newest landed note in the run. */
  top: number;
  /** How many of the run's notes have landed. */
  size: number;
}

/** The landed notes, a run of one stacking app folded into a single group. */
function group(notes: LockNote[], shown: number[]): Group[] {
  const groups: Group[] = [];
  notes.forEach((n, i) => {
    if (shown[i]! <= 0) return;
    const last = groups[groups.length - 1];
    if (last && STACKS.has(n.app) && notes[last.top]!.app === n.app && last.top === i - 1) {
      last.top = i;
      last.size += 1;
    } else {
      groups.push({ top: i, size: 1 });
    }
  });
  return groups;
}

export interface Glow {
  tone: 'good' | 'bad';
  /** 0 to 1, from `glowLevel`. */
  level: number;
}

/**
 * How strong the glow is at scene time `t`, given when each notification
 * lands: it grows with the share landed and flares as each one lands.
 */
export function glowLevel(t: number, at: number[]): number {
  const landed = at.filter((a) => t >= a);
  const pulse = landed.reduce((p, a) => Math.max(p, Math.exp(-(t - a) / 0.4)), 0);
  return Math.min(1, 0.15 + 0.55 * (landed.length / at.length) + 0.3 * pulse);
}

const APP: Record<LockApp, ReactNode> = {
  appstore: <span className="bs-lock-glyph">A</span>,
  mail: <Mail />,
  stripe: <span className="bs-lock-glyph">S</span>,
  cto: <span className="bs-lock-glyph small">AI</span>,
};

export function LockScreen({
  label,
  time,
  notes,
  shown,
  glow,
}: {
  label: string;
  /** The clock, as the lock screen shows it. */
  time: string;
  notes: LockNote[];
  /** How far each note has landed, 0 hidden to 1 in place. */
  shown: number[];
  glow: Glow;
}) {
  return (
    <div className="bs-lock-wrap">
      <span
        className={`bs-phone-glow ${glow.tone}`}
        style={{ opacity: glow.level, transform: `scale(${0.85 + 0.2 * glow.level})` }}
      />
      <Stage width={380} height={800} label={label}>
      <div className="bs-iphone">
        <span className="bs-iphone-button left one" />
        <span className="bs-iphone-button left two" />
        <span className="bs-iphone-button right" />
        <div className="bs-iphone-screen bs-lock">
          <div className="bs-lock-island" />
          <div className="bs-lock-time">{time}</div>
          <div className="bs-lock-notes">
            {group(notes, shown).map(({ top, size }) => {
              const n = notes[top]!;
              const k = shown[top]!;
              const layers = Math.min(size - 1, 2);
              return (
                <div key={top} className="bs-lock-group" style={{ order: -top }}>
                  <div
                    className="bs-lock-note"
                    style={{
                      opacity: size > 1 ? 1 : k,
                      transform: `translateY(${(1 - k) * (size > 1 ? -6 : -18)}px) scale(${0.96 + 0.04 * k})`,
                    }}
                  >
                    <span className={`bs-lock-app ${n.app}`}>{APP[n.app]}</span>
                    <span className="bs-lock-text">
                      <span className="bs-lock-head">
                        <b>{n.title}</b>
                        <span>{n.time}</span>
                      </span>
                      <span>{n.body}</span>
                      {size > 1 && <span className="bs-lock-more">{size - 1} more {size === 2 ? 'notification' : 'notifications'}</span>}
                    </span>
                  </div>
                  {Array.from({ length: layers }, (_, l) => (
                    <span key={l} className={`bs-lock-layer l${l + 1}`} />
                  ))}
                </div>
              );
            })}
          </div>
          <span className="bs-ios-home light" />
        </div>
      </div>
      </Stage>
    </div>
  );
}
