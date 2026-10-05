import type { ReactNode } from 'react';
import { Stage } from '../Stage';
import { Mail } from '../icons';

/**
 * The iPhone lock screen both phone scenes draw on: the hero's calm morning,
 * where the AI CTO's texts are all there is, and the evening, where the
 * alarms pile up. Notifications land newest on top; how far each one has
 * landed (0 to 1) is the scene's to say.
 */

export type LockApp = 'appstore' | 'mail' | 'stripe' | 'cto';

export interface LockNote {
  app: LockApp;
  time: string;
  title: string;
  body: string;
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
}: {
  label: string;
  /** The clock, as the lock screen shows it. */
  time: string;
  notes: LockNote[];
  /** How far each note has landed, 0 hidden to 1 in place. */
  shown: number[];
}) {
  return (
    <Stage width={380} height={800} label={label}>
      <div className="bs-iphone">
        <span className="bs-iphone-button left one" />
        <span className="bs-iphone-button left two" />
        <span className="bs-iphone-button right" />
        <div className="bs-iphone-screen bs-lock">
          <div className="bs-lock-island" />
          <div className="bs-lock-time">{time}</div>
          <div className="bs-lock-notes">
            {notes.map((n, i) => {
              const k = shown[i]!;
              if (k <= 0) return null;
              return (
                <div
                  key={i}
                  className="bs-lock-note"
                  style={{ order: -i, opacity: k, transform: `translateY(${(1 - k) * -18}px) scale(${0.96 + 0.04 * k})` }}
                >
                  <span className={`bs-lock-app ${n.app}`}>{APP[n.app]}</span>
                  <span className="bs-lock-text">
                    <span className="bs-lock-head">
                      <b>{n.title}</b>
                      <span>{n.time}</span>
                    </span>
                    <span>{n.body}</span>
                  </span>
                </div>
              );
            })}
          </div>
          <span className="bs-ios-home light" />
        </div>
      </div>
    </Stage>
  );
}
