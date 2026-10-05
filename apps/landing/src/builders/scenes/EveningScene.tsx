import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { easeOut, span, useClock } from '../motion';
import { LockScreen, type LockNote } from './LockScreen';

/** What goes wrong, beside the phone; each lights up when its first notification lands. */
const PAINS = ['Bugs reach users first', 'Production is a black box', 'Users struggle in silence', 'Customers leave'];

interface Note extends LockNote {
  /** The problem this notification is. */
  pain: number;
}

const NOTES: Note[] = [
  { app: 'appstore', time: '6:12 PM', title: 'New review ★☆☆☆☆', body: '"Invites never arrive."', pain: 0 },
  { app: 'mail', time: '6:40 PM', title: 'Northwind', body: 'Is the app down??', pain: 1 },
  { app: 'stripe', time: '7:05 PM', title: 'Subscription cancelled', body: 'Northwind, $79 a month', pain: 3 },
  { app: 'stripe', time: '7:22 PM', title: '31 checkouts abandoned today', body: 'Most stopped at the payment step.', pain: 2 },
  { app: 'mail', time: '7:48 PM', title: 'Acme Dental', body: "Still can't log in. Third time this week.", pain: 1 },
  { app: 'stripe', time: '8:12 PM', title: 'Subscription cancelled', body: 'Bloom Studio, $29 a month', pain: 3 },
  { app: 'stripe', time: '8:30 PM', title: 'Subscription cancelled', body: 'Acme Dental, $49 a month', pain: 3 },
];

/** How far apart the notifications land. */
const EACH = 0.9;
const LENGTH = NOTES.length * EACH + 0.6;

/**
 * What lands on a solo builder's phone, on its lock screen: a bad
 * review, customers asking if the app is down, people giving up at checkout,
 * and cancellations. Once the phone is in view the notifications land one
 * after another, newest on top, and the evening stays; beside the phone,
 * each problem lights up as its first notification lands.
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
          <LockScreen
            time={NOTES[latest]!.time.replace(' PM', '')}
            notes={NOTES}
            shown={shown}
            label="A phone's lock screen. A one-star review, customers asking if the app is down and 31 abandoned checkouts arrive one after another, and three customers cancel their subscriptions over the evening."
          />
        </div>
      </div>
    </div>
  );
}
