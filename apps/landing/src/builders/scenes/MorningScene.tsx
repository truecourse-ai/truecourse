import { easeOut, span, useClock } from '../motion';
import { LockScreen, type LockNote } from './LockScreen';

/**
 * The hero: the same phone as the evening, on a good morning, the evening's
 * mirror. The AI CTO's texts about the night come first, a fix it made and
 * tested and a bad change it stopped; then a five-star review and a happy
 * customer, then new subscriptions pour in faster and faster, and the
 * month's revenue lands last, summed from the subscriptions shown.
 */

/** The night handled, and the first good news. */
const BEFORE: LockNote[] = [
  {
    app: 'cto',
    time: '2:24 AM',
    title: 'AI CTO',
    body: 'Checkout stopped working at 2:10 AM. I fixed it and tested it on a phone. All good now.',
  },
  {
    app: 'cto',
    time: '6:45 AM',
    title: 'AI CTO',
    body: 'Stopped one change from going live. Team invites would have sent no email. The fix is ready.',
  },
  {
    app: 'cto',
    time: '7:00 AM',
    title: 'AI CTO',
    body: 'Good morning, Dana. 9 people got stuck on the signup form this week. Want me to fix it?',
  },
  { app: 'appstore', time: '7:04 AM', title: 'New review ★★★★★', body: '"Finally works on my phone."' },
  { app: 'mail', time: '7:09 AM', title: 'Northwind', body: 'Love the new export!' },
];

/** Then the new subscriptions pour in, a minute or two apart, from 7:12 AM. */
const FLOOD: [customer: string, perMonth: number][] = [
  ['Baker & Lane CPA', 99],
  ['Clearwater Dental', 79],
  ['Hillside Law', 99],
  ['Meridian Tax', 49],
  ['Kestrel Advisors', 99],
  ['Sunny Paws Vet', 49],
  ['Fairview Clinic', 79],
  ['Copper Street Books', 29],
  ['Lakeshore Legal', 99],
  ['Brightpath Wealth', 99],
  ['Orchard Family Law', 79],
  ['Quarry Accounting', 49],
  ['Silver Birch Therapy', 49],
  ['Tidewater CPA', 99],
  ['Beacon Health', 79],
  ['Foxglove Studio', 29],
];

const am = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} AM`;
const FLOOD_START = 7 * 60 + 12;
const floodMinute = (i: number) => FLOOD_START + Math.round(i * 1.3);
const gained = FLOOD.reduce((sum, [, m]) => sum + m, 0);

const NOTES: LockNote[] = [
  ...BEFORE,
  ...FLOOD.map(([customer, perMonth], i): LockNote => ({
    app: 'stripe',
    time: am(floodMinute(i)),
    title: 'New subscription',
    body: `${customer}, $${perMonth} a month`,
  })),
  {
    app: 'stripe',
    time: am(floodMinute(FLOOD.length - 1) + 1),
    title: `+$${gained.toLocaleString('en-US')} this month`,
    body: `${FLOOD.length} new subscriptions, none cancelled.`,
  },
];

/**
 * When each notification lands: the gaps shrink until the subscriptions pour
 * in almost at once, and the month's total lands last, after a beat.
 */
const START = 0.6;
const FIRST_GAP = 1.0;
const SPEEDUP = 0.78;
const MIN_GAP = 0.07;
const LAST_BEAT = 0.7;
const AT = NOTES.reduce<number[]>((at, _, i) => {
  const gap = i === NOTES.length - 1 ? LAST_BEAT : Math.max(MIN_GAP, FIRST_GAP * SPEEDUP ** (i - 1));
  at.push(i === 0 ? START : at[i - 1]! + gap);
  return at;
}, []);
const LENGTH = AT[AT.length - 1]! + 0.6;

export function MorningScene() {
  const { ref, t } = useClock(LENGTH, LENGTH, true);
  const shown = AT.map((at) => easeOut(span(t, at, at + 0.25)));
  const latest = shown.reduce((last, k, i) => (k > 0 ? i : last), 0);
  return (
    <div ref={ref} className="bs-morning">
      <LockScreen
        time={NOTES[latest]!.time.replace(' AM', '')}
        notes={NOTES}
        shown={shown}
        label="A phone's lock screen in the morning. The AI CTO texts that it fixed and tested a checkout outage at 2:10 AM and stopped a bad change from going live. Then a five-star review and a happy customer email, then new subscriptions pour in faster and faster, and the month ends thousands of dollars up."
      />
    </div>
  );
}
