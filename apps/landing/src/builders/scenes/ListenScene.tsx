import type { ReactNode } from 'react';
import { Stage } from '../Stage';
import { easeInOut, easeOut, enter, lerp, span, useClock, useNarrow } from '../motion';
import { Bug, Exit, Tap } from '../icons';

const LENGTH = 16;
const OUT = 15;
const FLY = 0.75;
/** How long a signal sits where it landed before it is sorted. */
const SIT = 1.5;

interface Issue {
  title: string;
  people: number;
}

const ISSUES: Issue[] = [
  { title: "Can't find Export on their phone", people: 23 },
  { title: 'Password reset email arrives late', people: 9 },
  { title: 'Yearly price reads as monthly', people: 6 },
];

interface Signal {
  icon: ReactNode;
  text: string;
  issue: number;
  x: number;
  y: number;
}

const SIGNALS: Signal[] = [
  { icon: <Tap />, text: 'Tapped Menu 6 times on iPhone', issue: 0, x: 8, y: 40 },
  { icon: <Exit />, text: '18 sessions ended on Reports', issue: 0, x: 70, y: 118 },
  { icon: <Bug />, text: 'Password reset failed 12 times', issue: 1, x: 20, y: 196 },
  { icon: <Tap />, text: 'Rage taps on Reports, Android', issue: 0, x: 80, y: 274 },
  { icon: <Exit />, text: '31 people left at billing', issue: 2, x: 4, y: 352 },
  { icon: <Bug />, text: 'Reset email timed out, 9 times', issue: 1, x: 90, y: 30 },
  { icon: <Tap />, text: 'Switched Yearly and Monthly 5 times', issue: 2, x: 30, y: 128 },
  { icon: <Exit />, text: 'Gave up on mobile export', issue: 0, x: 64, y: 214 },
  { icon: <Tap />, text: 'Scrolled past Export 3 times', issue: 0, x: 14, y: 300 },
  { icon: <Bug />, text: 'Reset link already expired', issue: 1, x: 84, y: 380 },
];

/**
 * The two layouts: signals to the left of the card on a desktop; on a phone
 * the signals gather above the card, drawn closer together.
 */
const WIDE = { w: 800, h: 470, cardX: 372, cardTop: 40, sx: 1, sy: 1, read: { left: 40, top: 120 } };
const PHONE = { w: 400, h: 640, cardX: 0, cardTop: 260, sx: 0.45, sy: 0.58, read: { left: 24, top: 40 } };
type Layout = typeof WIDE;

/** The centre of issue row `i`, in stage pixels: the card's top, its head, then 76px a row. */
const rowY = (g: Layout, i: number) => g.cardTop + 60 + 38 + i * 76;

/** What was read to find them, shown once every signal is sorted. */
const READ: { icon: ReactNode; count: string; what: string }[] = [
  { icon: <Tap />, count: '1,280', what: 'sessions' },
  { icon: <Bug />, count: '312', what: 'errors' },
  { icon: <Exit />, count: '96', what: 'gave up partway' },
];
const appears = (i: number) => 0.5 + i * 0.42;
const lands = (i: number) => appears(i) + SIT + FLY;

/**
 * What users leave behind in their sessions, scattered: repeated taps,
 * errors, flows they give up on. Each one flies to the issue it belongs
 * to, the issues rank themselves by how many people they hurt, and the top
 * one comes with its cause and a fix ready.
 */
export function ListenScene() {
  const { ref, t } = useClock(LENGTH, 10.4);
  const fade = enter(t, 0, 0.4, OUT, 0).opacity;
  const g = useNarrow() ? PHONE : WIDE;

  const share = ISSUES.map((issue, k) => {
    const mine = SIGNALS.map((s, i) => ({ s, i })).filter(({ s }) => s.issue === k);
    const got = mine.reduce((n, { i }) => n + easeOut(span(t, lands(i) - 0.1, lands(i) + 0.5)), 0);
    return Math.round((got / mine.length) * issue.people);
  });
  const sorted = t >= lands(SIGNALS.length - 1) + 0.6;
  const why = enter(t, lands(SIGNALS.length - 1) + 1.0, 0.6);

  return (
    <div ref={ref}>
      <Stage width={g.w} height={g.h} label="Repeated taps, errors and abandoned sessions are grouped into three problems ranked by how many people they affect. The top one, 23 people who can't find Export on their phone, comes with a fix ready.">
        <div className="bs-fill" style={{ opacity: fade }}>
          <div className="bs-card bs-issues" style={{ left: g.cardX, top: g.cardTop, width: g.w - g.cardX }}>
            <div className="bs-issues-head">
              <b>What users struggle with</b>
              <span className="bs-muted">This week</span>
            </div>
            {ISSUES.map((issue, k) => (
              <div key={issue.title} className="bs-issue">
                <span className="bs-issue-rank">{k + 1}</span>
                <span className="bs-issue-text">
                  <b>{issue.title}</b>
                  <span className="bs-bar">
                    <span style={{ width: `${(share[k]! / ISSUES[0]!.people) * 100}%` }} />
                  </span>
                </span>
                <span className="bs-issue-count">
                  <b>{share[k]}</b> people
                </span>
              </div>
            ))}
            <div className="bs-why-wrap" style={{ ...why, maxHeight: sorted ? 120 : 0 }}>
              <div className="bs-why">
                <b>Why it happens.</b> On small screens Export hides under the menu. A fix is ready.
              </div>
            </div>
          </div>

          <div className="bs-read" style={{ ...g.read, ...enter(t, lands(SIGNALS.length - 1) + 0.2, 0.6) }}>
            <span className="bs-muted">Read this week</span>
            {READ.map((r) => (
              <div key={r.what} className="bs-read-row">
                <span className="bs-glyph">{r.icon}</span>
                <b>{r.count}</b>
                <span className="bs-muted">{r.what}</span>
              </div>
            ))}
          </div>

          {SIGNALS.map((s, i) => {
            const a = appears(i);
            const show = easeOut(span(t, a, a + 0.45));
            const fly = easeInOut(span(t, a + SIT, a + SIT + FLY));
            if (show <= 0 || fly >= 1) return null;
            const x = lerp(s.x * g.sx + (g === PHONE ? 16 : 0), g.cardX + 16, fly);
            const y = lerp(s.y * g.sy, rowY(g, s.issue) - 18, fly);
            return (
              <div
                key={s.text}
                className="bs-signal"
                style={{
                  left: x,
                  top: y,
                  opacity: show * (1 - span(fly, 0.6, 1)),
                  transform: `scale(${lerp(0.85, 1, show) * lerp(1, 0.55, fly)})`,
                }}
              >
                <span className="bs-glyph">{s.icon}</span>
                {s.text}
              </div>
            );
          })}
        </div>
      </Stage>
    </div>
  );
}
