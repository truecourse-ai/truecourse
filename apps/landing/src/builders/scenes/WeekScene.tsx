import type { ReactNode } from 'react';
import { easeOut, span } from '../motion';
import { useScrollSteps } from '../useScrollSteps';

/** How the day went: fine, or gone wrong. */
type Tone = 'ok' | 'bad';

interface Day {
  day: string;
  line: string;
  note: { app: string; time: string; title: string; text: string };
  tone: Tone;
  /** What the day comes to, under it; for the bad days, the problem it is. */
  tag: string;
}

const DAYS: Day[] = [
  {
    day: 'Monday',
    line: 'Team invites go live. They look fine.',
    note: { app: 'GitHub', time: '4:02 PM', title: 'Change is live', text: 'Team invites are up.' },
    tone: 'ok',
    tag: 'Seems fine',
  },
  {
    day: 'Tuesday',
    line: "A customer can't add their team and leaves a one-star review.",
    note: { app: 'App Store', time: '9:12 AM', title: 'New review ★☆☆☆☆', text: '"Invites never arrive."' },
    tone: 'bad',
    tag: 'Bugs reach users first',
  },
  {
    day: 'Wednesday',
    line: 'The app breaks at 3 AM. A customer reports it at 9.',
    note: { app: 'Mail', time: '3:12 AM', title: 'Customer', text: '"Is the app down??"' },
    tone: 'bad',
    tag: 'Production is a black box',
  },
  {
    day: 'Thursday',
    line: '31 people give up at billing. Nobody writes in.',
    note: { app: 'Stripe', time: '2:40 PM', title: '31 checkouts abandoned', text: 'Support inbox has 0 new.' },
    tone: 'bad',
    tag: 'Users struggle in silence',
  },
  {
    day: 'Friday',
    line: "Still guessing what broke. Wednesday's customer cancels.",
    note: { app: 'Stripe', time: '11:05 AM', title: 'Subscription cancelled', text: '"Too many problems lately."' },
    tone: 'bad',
    tag: 'Customers leave',
  },
];

/** How long one day takes to come in once the scroll reaches it. */
const EACH = 1.7;

/**
 * A week of building alone, Monday to Friday, in plain words: each day comes
 * up with what happened and the notification it arrived as, underlined with
 * what it comes to: one day for each of the three problems the AI CTO takes
 * on, and Friday for the customers they cost. The section
 * is pinned while the page scrolls through it, and each stretch of scroll
 * brings in the next day, and scrolling back up takes it away again; nothing
 * moves on by itself. Laid out in the page's
 * own flow: five across, or one under another on a phone, where it is not
 * pinned and every day shows at once.
 */
export function WeekScene({ children }: { children?: ReactNode }) {
  const { pin, step, u, pinned } = useScrollSteps(DAYS.length, EACH, EACH);
  /** Scene time: every day before the current one in full, the current one `u` in; every day where it is not pinned. */
  const t = pinned ? step * EACH + u : DAYS.length * EACH;

  return (
    <div ref={pin} className="bs-pin bs-pin-week">
      <div className="bs-pin-sticky">
        {children}
        <div role="img" aria-label="Five days of building alone. Monday team invites go live. Tuesday a customer leaves a one-star review because invites never arrive, so bugs reach users first. Wednesday the app breaks at 3 AM and a customer reports it, because production is a black box. Thursday 31 people give up at billing and nobody writes in, because users struggle in silence. Friday Wednesday's customer cancels, and customers leave.">
          <div className="bs-plain" aria-hidden="true">
            {DAYS.map((d, i) => {
              const at = i * EACH;
              const k = easeOut(span(t, at, at + 0.6));
              const card = easeOut(span(t, at + 0.3, at + 0.8));
              const rule = easeOut(span(t, at + 0.7, at + 1.3));
              return (
                <div key={d.day} className="bs-plain-day" style={{ opacity: 0.15 + 0.85 * k }}>
                  <b>{d.day}</b>
                  <p>{d.line}</p>
                  <div className={`bs-note ${d.tone}`} style={{ opacity: card, transform: `translateY(${(1 - card) * 12}px)` }}>
                    <span className="bs-note-text">
                      <span className="bs-note-app">
                        {d.note.app} <span>{d.note.time}</span>
                      </span>
                      <b>{d.note.title}</b>
                      <span>{d.note.text}</span>
                    </span>
                  </div>
                  <span className={`bs-plain-rule ${d.tone}`} style={{ transform: `scaleX(${rule})` }} />
                  <span className={`bs-plain-pain ${d.tone}`} style={{ opacity: rule }}>
                    {d.tag}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
