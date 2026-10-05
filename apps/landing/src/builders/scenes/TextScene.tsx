import { Stage } from '../Stage';
import { easeOut, enter, span, useClock } from '../motion';
import { Mark } from '../icons';

interface Text {
  at: number;
  from: 'cto' | 'dana';
  body: string;
}

/** The thread, in the order it plays: a 2 AM alert, a morning question, a command. */
const THREAD: (Text | { at: number; time: string; first?: boolean })[] = [
  { at: 0.4, time: 'Wed 2:14 AM', first: true },
  {
    at: 0.9,
    from: 'cto',
    body: "Checkout is failing for 14 people. Tuesday's payment change caused it. A fix is ready and tested. Reply YES to apply it.",
  },
  { at: 2.6, from: 'dana', body: 'YES' },
  { at: 3.5, from: 'cto', body: 'Applied. Checkout works again.' },
  { at: 5.0, time: 'Wed 9:05 AM' },
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

function StatusBar() {
  return (
    <div className="bs-ios-status">
      <b>9:41</b>
      <span className="bs-ios-island" />
      <span className="bs-ios-icons">
        <svg viewBox="0 0 18 12" aria-hidden="true">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg viewBox="0 0 16 12" aria-hidden="true">
          <path d="M8 11.5l2.4-2.9a3.5 3.5 0 00-4.8 0z" />
          <path d="M3.6 6.8a6.4 6.4 0 018.8 0l-1.3 1.6a4.4 4.4 0 00-6.2 0z" />
          <path d="M1.2 3.9a10 10 0 0113.6 0l-1.3 1.6a8 8 0 00-11 0z" />
        </svg>
        <span className="bs-ios-battery">
          <i />
        </span>
      </span>
    </div>
  );
}

/**
 * The AI CTO by text, on an iPhone in Messages: an alert answered at 2 AM,
 * a question asked over coffee, and a command given and shipped, each reply
 * arriving after a moment of typing. Replies are SMS green, so it reads as a
 * text message thread and not an app. The thread grows from the bottom, so
 * the newest message is always in view.
 */
export function TextScene() {
  const { ref, t } = useClock(LENGTH, 13.5);
  const fade = enter(t, 0, 0.4, OUT, 0).opacity;
  const next = THREAD.find((m) => m.at > t);
  const typing = next && isText(next) && next.from === 'cto' && t >= next.at - TYPING;

  return (
    <div ref={ref}>
      <Stage width={380} height={800} label="A text message thread with the AI CTO on an iPhone. At 2:14 AM it reports checkout failing and the owner replies YES to apply the fix. In the morning she asks what users are stuck on and gets a ranked list, then asks it to fix the Export button and replies SHIP to put the fix live.">
        <div className="bs-iphone">
          <span className="bs-iphone-button left one" />
          <span className="bs-iphone-button left two" />
          <span className="bs-iphone-button right" />
          <div className="bs-iphone-screen">
            <StatusBar />
            <div className="bs-ios-head">
              <span className="bs-ios-back">
                <svg viewBox="0 0 12 20" aria-hidden="true">
                  <path d="M10 2L2 10l8 8" />
                </svg>
              </span>
              <span className="bs-ios-contact">
                <span className="bs-ios-photo">
                  <Mark />
                </span>
                <span className="bs-ios-name">AI CTO ›</span>
              </span>
            </div>
            <div className="bs-ios-thread" style={{ opacity: fade }}>
              {THREAD.filter((m) => m.at <= t).map((m, i) => {
                const k = easeOut(span(t, m.at, m.at + 0.35));
                const style = { opacity: k, transform: `translateY(${(1 - k) * 10}px)` };
                if (!isText(m)) {
                  return (
                    <span key={`t${i}`} className="bs-ios-time" style={style}>
                      {m.first && (
                        <>
                          <b>Text Message</b>
                          <br />
                        </>
                      )}
                      {m.time}
                    </span>
                  );
                }
                return (
                  <span key={`m${i}`} className={`bs-ios-bubble ${m.from}`} style={style}>
                    {m.body}
                  </span>
                );
              })}
              {typing && (
                <span className="bs-ios-bubble cto bs-ios-typing">
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </div>
            <div className="bs-ios-compose">
              <span className="bs-ios-plus">+</span>
              <span className="bs-ios-field">
                Text Message
                <svg viewBox="0 0 14 20" aria-hidden="true">
                  <rect x="4" y="1" width="6" height="11" rx="3" />
                  <path d="M1.5 9a5.5 5.5 0 0011 0M7 14.5V19" />
                </svg>
              </span>
            </div>
            <span className="bs-ios-home" />
          </div>
        </div>
      </Stage>
    </div>
  );
}
