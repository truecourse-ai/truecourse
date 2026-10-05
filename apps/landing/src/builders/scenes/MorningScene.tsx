import { easeOut, span, useClock } from '../motion';
import { LockScreen, type LockNote } from './LockScreen';

/**
 * The hero: the same phone as the evening, on a calm morning. The AI CTO's
 * texts about the night, a fix it made and tested, a bug it stopped before
 * it went live and what users struggled with, and between them the month's
 * revenue growing. They land one after another once the phone is in view,
 * and stay.
 */

const NOTES: LockNote[] = [
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
    app: 'stripe',
    time: '7:00 AM',
    title: '+$4,600 this month',
    body: '12 new subscriptions, none cancelled.',
  },
  {
    app: 'cto',
    time: '7:30 AM',
    title: 'AI CTO',
    body: 'Good morning, Dana. 9 people got stuck on the signup form this week. Want me to fix it?',
  },
];

const EACH = 1.1;
const LENGTH = 0.6 + NOTES.length * EACH;

export function MorningScene() {
  const { ref, t } = useClock(LENGTH, LENGTH, true);
  const shown = NOTES.map((_, i) => easeOut(span(t, 0.6 + i * EACH, 1 + i * EACH)));
  return (
    <div ref={ref} className="bs-morning">
      <LockScreen
        time="7:30"
        notes={NOTES}
        shown={shown}
        label="A phone's lock screen in the morning, with three texts from the AI CTO. Checkout broke at 2:10 AM and it fixed and tested it. It stopped a change that would have broken team invites. Stripe reports 4,600 dollars in new revenue this month. And 9 people got stuck on the signup form this week, with an offer to fix it."
      />
    </div>
  );
}
