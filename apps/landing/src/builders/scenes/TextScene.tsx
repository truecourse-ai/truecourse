import { Stage } from '../Stage';
import { easeOut, enter, span, useClock } from '../motion';
import { Mark } from '../icons';

interface Text {
  at: number;
  from: 'cto' | 'dana';
  body: string;
}

/** The thread, in the order it plays: a 2 AM alert, a morning question, a command. */
const THREAD: (Text | { at: number; time: string })[] = [
  { at: 0.4, time: 'Tonight 2:14 AM' },
  {
    at: 0.9,
    from: 'cto',
    body: "Checkout is failing for 14 people. Tuesday's payment change caused it. A fix is ready and tested. Reply YES to apply it.",
  },
  { at: 2.6, from: 'dana', body: 'YES' },
  { at: 3.5, from: 'cto', body: 'Applied. Checkout works again.' },
  { at: 5.0, time: 'Today 9:05 AM' },
  { at: 5.4, from: 'dana', body: 'What are users stuck on this week?' },
  {
    at: 6.6,
    from: 'cto',
    body: "1. 23 people can't find Export on their phone\n2. Reset email arrives late, 9 people\n3. Yearly price reads as monthly, 6 people",
  },
  { at: 8.6, from: 'dana', body: 'Fix the Export button' },
  { at: 9.9, from: 'cto', body: 'Done and tested in a real browser. Reply SHIP to put it live.' },
  { at: 11.6, from: 'dana', body: 'SHIP' },
  { at: 12.5, from: 'cto', body: 'Live.' },
];

const LENGTH = 17;
const OUT = 16.2;
/** How long the AI CTO is seen typing before each of its replies. */
const TYPING = 0.7;

const isText = (m: (typeof THREAD)[number]): m is Text => 'from' in m;

/**
 * The AI CTO by text: a phone whose thread plays out an alert answered at
 * 2 AM, a question asked over coffee, and a command given and shipped, each
 * reply arriving after a moment of typing. The thread grows from the bottom,
 * so the newest message is always in view.
 */
export function TextScene() {
  const { ref, t } = useClock(LENGTH, 13.5);
  const fade = enter(t, 0, 0.4, OUT, 0).opacity;
  const next = THREAD.find((m) => m.at > t);
  const typing = next && isText(next) && next.from === 'cto' && t >= next.at - TYPING;

  return (
    <div ref={ref}>
      <Stage width={380} height={700} label="A text thread with the AI CTO. At 2:14 AM it reports checkout failing and the owner replies YES to apply the fix. In the morning she asks what users are stuck on and gets a ranked list, then asks it to fix the Export button and replies SHIP to put the fix live.">
        <div className="bs-tphone" style={{ opacity: fade }}>
          <div className="bs-tphone-head">
            <span className="bs-avatar">
              <Mark />
            </span>
            <b>AI CTO</b>
            <span className="bs-muted">Acme Portal</span>
          </div>
          <div className="bs-thread-view">
            {THREAD.filter((m) => m.at <= t).map((m, i) => {
              const k = easeOut(span(t, m.at, m.at + 0.35));
              const style = { opacity: k, transform: `translateY(${(1 - k) * 10}px)` };
              if (!isText(m)) {
                return (
                  <span key={`t${i}`} className="bs-text-time" style={style}>
                    {m.time}
                  </span>
                );
              }
              return (
                <span key={`m${i}`} className={`bs-bubble ${m.from}`} style={style}>
                  {m.body}
                </span>
              );
            })}
            {typing && (
              <span className="bs-bubble cto bs-typing">
                <i />
                <i />
                <i />
              </span>
            )}
          </div>
          <div className="bs-tphone-input">
            <span>Text message</span>
          </div>
        </div>
      </Stage>
    </div>
  );
}
