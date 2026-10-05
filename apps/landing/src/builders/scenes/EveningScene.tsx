import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Stage } from '../Stage';
import { easeOut, span, useClock } from '../motion';
import { Chat, Mail } from '../icons';

/** What goes wrong, beside the phone; each lights up when its first notification lands. */
const PAINS = ['Bugs reach users first', 'Production is a black box', 'Users struggle in silence', 'Customers leave'];

type App = 'messages' | 'appstore' | 'mail' | 'stripe';

interface Note {
  app: App;
  time: string;
  title: string;
  body: string;
  /** The problem this notification is, if it is one; a friend's texts are not. */
  pain?: number;
}

const NOTES: Note[] = [
  { app: 'messages', time: '6:05 PM', title: 'Alex', body: 'Still on for 7?' },
  { app: 'appstore', time: '6:12 PM', title: 'New review ★☆☆☆☆', body: '"Invites never arrive."', pain: 0 },
  { app: 'mail', time: '6:40 PM', title: 'Northwind', body: 'Is the app down??', pain: 1 },
  { app: 'messages', time: '7:05 PM', title: 'Alex', body: 'We started without you' },
  { app: 'stripe', time: '7:22 PM', title: '31 checkouts abandoned today', body: 'Most stopped at the payment step.', pain: 2 },
  { app: 'mail', time: '7:48 PM', title: 'Acme Dental', body: "Still can't log in. Third time this week.", pain: 1 },
  { app: 'messages', time: '7:55 PM', title: 'Alex', body: 'Movie starts at 8, where are you?' },
  { app: 'stripe', time: '8:30 PM', title: 'Subscription cancelled', body: 'Acme Dental, $49 a month', pain: 3 },
];

const APP: Record<App, { name: string; icon: ReactNode }> = {
  messages: { name: 'Messages', icon: <Chat /> },
  appstore: { name: 'App Store', icon: <span className="bs-lock-glyph">A</span> },
  mail: { name: 'Mail', icon: <Mail /> },
  stripe: { name: 'Stripe', icon: <span className="bs-lock-glyph">S</span> },
};

/** How far apart the notifications land. */
const EACH = 1.1;
const LENGTH = NOTES.length * EACH + 0.6;

/**
 * A Saturday evening of building alone, on a phone's lock screen: a friend's
 * texts about the evening's plans in between a bad review, customers asking if the app is down, people
 * giving up at checkout, and a cancellation. Once the phone is in view the
 * notifications land one after another, newest on top, and the evening stays;
 * beside the phone, each problem lights up as its first notification lands.
 */
export function EveningScene({ children }: { children?: ReactNode }) {
  const { ref, t } = useClock(LENGTH, LENGTH, true);
  const shown = NOTES.map((_, i) => easeOut(span(t, i * EACH, i * EACH + 0.4)));
  const latest = shown.reduce((last, k, i) => (k > 0 ? i : last), 0);
  const lit = PAINS.map((_, p) => NOTES.some((n, i) => n.pain === p && shown[i]! > 0.5));

  return (
    <div ref={ref}>
      <div className="bs-evening">
        <div className="bs-evening-copy">
          {children}
          <ul className="bs-evening-pains">
            {PAINS.map((p, i) => (
              <li key={p} className={cn(lit[i] && 'on', i === PAINS.length - 1 && 'cost')}>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="bs-evening-phone">
          <Stage width={380} height={800} label="A phone's lock screen on a Saturday evening. Between texts from a friend about plans for the evening, a one-star review, customers asking if the app is down and 31 abandoned checkouts arrive, and the evening ends with a cancelled subscription.">
            <div className="bs-iphone">
              <span className="bs-iphone-button left one" />
              <span className="bs-iphone-button left two" />
              <span className="bs-iphone-button right" />
              <div className="bs-iphone-screen bs-lock">
                <div className="bs-lock-island" />
                <div className="bs-lock-date">Saturday, October 11</div>
                <div className="bs-lock-time">{NOTES[latest]!.time.replace(' PM', '')}</div>
                <div className="bs-lock-notes">
                  {NOTES.map((n, i) => {
                    const k = shown[i]!;
                    if (k <= 0) return null;
                    return (
                      <div
                        key={i}
                        className="bs-lock-note"
                        style={{ order: -i, opacity: k, transform: `translateY(${(1 - k) * -18}px) scale(${0.96 + 0.04 * k})` }}
                      >
                        <span className={`bs-lock-app ${n.app}`}>{APP[n.app].icon}</span>
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
        </div>
      </div>
    </div>
  );
}
