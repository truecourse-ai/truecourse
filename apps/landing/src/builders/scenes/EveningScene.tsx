import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { easeOut, span, useClock } from '../motion';
import { LockScreen, clockTime, floodMinutes, glowLevel, lockClock, type LockNote } from './LockScreen';

/** What goes wrong, beside the phone; each lights up when its first notification lands. */
const PAINS = ['Bugs reach users first', 'Production is a black box', 'Users struggle in silence', 'Customers leave'];

interface Note extends LockNote {
  /** The problem this notification is. */
  pain: number;
}

/** The evening before the flood: a review, worried customers, the first cancellations. */
const BEFORE: Note[] = [
  { app: 'appstore', time: '6:12 PM', title: 'New review ★☆☆☆☆', body: '"Invites never arrive."', pain: 0 },
  { app: 'mail', time: '6:40 PM', title: 'Northwind', body: 'Is the app down??', pain: 1 },
  { app: 'stripe', time: '7:05 PM', title: 'Subscription cancelled', body: 'Northwind, $79 a month', pain: 3 },
  { app: 'stripe', time: '7:22 PM', title: '31 checkouts abandoned today', body: 'Most stopped at the payment step.', pain: 2 },
  { app: 'mail', time: '7:48 PM', title: 'Acme Dental', body: "Still can't log in. Third time this week.", pain: 1 },
  { app: 'stripe', time: '8:12 PM', title: 'Subscription cancelled', body: 'Bloom Studio, $29 a month', pain: 3 },
  { app: 'stripe', time: '8:30 PM', title: 'Subscription cancelled', body: 'Acme Dental, $49 a month', pain: 3 },
];

/** Then the cancellations keep coming, on into the night, from 8:41 PM. */
const FLOOD: [customer: string, perMonth: number][] = [
  ['Harbor Legal', 99],
  ['Pine & Co', 49],
  ['Lumen Clinic', 79],
  ['Oak Street CPA', 99],
  ['Riverside Dental', 49],
  ['Summit Advisors', 79],
  ['Maple Law', 99],
  ['Brightside Tax', 49],
  ['Cedar Health', 79],
  ['Atlas Bookkeeping', 29],
  ['Northstar Wealth', 99],
  ['Bluebird Studio', 29],
  ['Granite Partners', 79],
  ['Elm Family Law', 49],
  ['Coastal Accounting', 99],
  ['Willow Therapy', 49],
  ['Ironwood Legal', 99],
  ['Juniper Tax', 29],
  ['Redwood Clinic', 79],
  ['Sterling CPA', 99],
];

const AT_MINUTE = floodMinutes(20 * 60 + 41, FLOOD.length);

const cancelled = [...BEFORE.filter((n) => n.title === 'Subscription cancelled').map((n) => Number(n.body.match(/\$(\d+)/)![1])), ...FLOOD.map(([, m]) => m)];
const lost = cancelled.reduce((sum, m) => sum + m, 0);

const NOTES: Note[] = [
  ...BEFORE,
  ...FLOOD.map(([customer, perMonth], i): Note => ({
    app: 'stripe',
    time: clockTime(AT_MINUTE[i]!),
    title: 'Subscription cancelled',
    body: `${customer}, $${perMonth} a month`,
    pain: 3,
  })),
  {
    app: 'stripe',
    time: clockTime(AT_MINUTE[FLOOD.length - 1]! + 2),
    title: `−$${lost.toLocaleString('en-US')} this month`,
    body: `${cancelled.length} subscriptions cancelled, 1 new.`,
    pain: 3,
  },
];

/**
 * When each notification lands. The gaps shrink as the evening goes on until
 * the cancellations pour in almost at once; the month's loss lands last,
 * after a beat.
 */
const FIRST_GAP = 1.0;
const SPEEDUP = 0.78;
const MIN_GAP = 0.07;
const LAST_BEAT = 0.7;
const AT = NOTES.reduce<number[]>((at, _, i) => {
  const gap = i === NOTES.length - 1 ? LAST_BEAT : Math.max(MIN_GAP, FIRST_GAP * SPEEDUP ** (i - 1));
  at.push(i === 0 ? 0 : at[i - 1]! + gap);
  return at;
}, []);
const LENGTH = AT[AT.length - 1]! + 0.6;

/**
 * What lands on a solo builder's phone, on its lock screen: a bad
 * review, customers asking if the app is down, people giving up at checkout,
 * cancellation after cancellation and the month's revenue falling. Once the
 * phone is in view the notifications land faster and faster, newest on top,
 * and the evening stays; beside the phone,
 * each problem lights up as its first notification lands.
 */
export function EveningScene({ children }: { children?: ReactNode }) {
  const { ref, t } = useClock(LENGTH, LENGTH, true);
  const shown = AT.map((at) => easeOut(span(t, at, at + 0.25)));
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
            glow={{ tone: 'bad', level: glowLevel(t, AT) }}
            time={lockClock(NOTES[latest]!.time)}
            notes={NOTES}
            shown={shown}
            label="A phone's lock screen. A one-star review, customers asking if the app is down and 31 abandoned checkouts arrive one after another, then cancellations pour in faster and faster, and the month ends over 1,500 dollars down."
          />
        </div>
      </div>
    </div>
  );
}
