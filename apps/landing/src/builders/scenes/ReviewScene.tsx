import { Stage } from '../Stage';
import { easeInOut, easeOut, enter, lerp, span, typed, useClock, useNarrow } from '../motion';
import { Check, Cross, Mail, Pointer, Spin } from '../icons';

const LENGTH = 17;
const OUT = 15.9;

/** When the first test finds the bug, the fix is applied, and the retest passes. */
const FOUND = 6.8;
const APPLY = 9.2;
const PASS = 11.8;

/** Where the pointer is, from one stop to the next. */
const PATH: { at: number; x: number; y: number }[] = [
  { at: 0, x: 430, y: 380 },
  { at: 0.7, x: 430, y: 380 },
  { at: 1.4, x: 262, y: 186 },
  { at: 2.5, x: 262, y: 186 },
  { at: 2.9, x: 262, y: 254 },
  { at: 3.5, x: 262, y: 254 },
  { at: 4.0, x: 262, y: 318 },
  { at: 5.0, x: 262, y: 318 },
  { at: 5.6, x: 420, y: 250 },
];
const CLICKS = [1.45, 2.95, 4.05];

/** Where the pointer is at `t`, moved `dx` across with the form on a phone. */
function pointerAt(t: number, dx = 0) {
  let i = 0;
  while (i < PATH.length - 1 && t >= PATH[i + 1]!.at) i++;
  const a = PATH[i]!;
  const b = PATH[Math.min(i + 1, PATH.length - 1)]!;
  const k = b.at === a.at ? 1 : easeInOut(span(t, a.at, b.at));
  return { x: lerp(a.x, b.x, k) + dx, y: lerp(a.y, b.y, k) };
}

/**
 * The two layouts: the browser with the change's card beside it on a desktop,
 * and on a phone the card under the browser, both at a size that reads.
 */
const WIDE = { w: 800, h: 470, browser: 520, formLeft: 140, dx: 0, card: { left: 470, top: 64, width: 330 } };
const PHONE = { w: 400, h: 820, browser: 400, formLeft: 80, dx: -60, card: { left: 0, top: 440, width: 400 } };

/**
 * A change adds team invites to Acme's client portal, and before it goes live
 * the AI CTO tries it the way a customer would: invites a teammate in a real
 * browser, then waits in the teammate's inbox for an invite that never comes. The change turns red with the problem in plain words,
 * the fix is applied, the retest passes, and the change is safe to go live.
 */
export function ReviewScene() {
  const { ref, t } = useClock(LENGTH, 8.4);
  const g = useNarrow() ? PHONE : WIDE;
  const pointer = pointerAt(t, g.dx);
  const onForm = t < 4.3;
  const retest = t >= APPLY + 0.4;
  const found = t >= FOUND && !retest;
  const passed = t >= PASS;
  const waiting = (t < FOUND) || (retest && t < PASS - 0.6);
  const emailIn = t >= PASS - 0.6;
  const fade = enter(t, 0, 0.4, OUT, 0).opacity;

  const status = passed
    ? { tone: 'ok', text: 'Passed. Every step works.' }
    : retest
      ? { tone: 'run', text: 'Testing the fix by inviting a teammate' }
      : found
        ? { tone: 'fail', text: 'Problem found. No invite email.' }
        : { tone: 'run', text: 'Testing this change by inviting a teammate' };

  return (
    <div ref={ref}>
      <Stage width={g.w} height={g.h} label="The AI CTO tests a new team invites feature by inviting a teammate in a browser, finds that no invite email arrives, applies a fix, and the retest passes.">
        <div className="bs-fill" style={{ opacity: fade }}>
          <div className="bs-browser" style={{ left: 0, top: 0, width: g.browser, height: 420 }}>
            <div className="bs-browser-bar">
              <i />
              <i />
              <i />
              <span className="bs-url">preview.acmeportal.com/{onForm ? 'team/invite' : 'team'}</span>
            </div>
            <div className={`bs-driving tone-${status.tone}`}>
              <span className="bs-driving-dot" />
              <span>{status.text}</span>
            </div>
            <div className="bs-page">
              {onForm ? (
                <div className="bs-form" style={{ left: g.formLeft }}>
                  <b className="bs-page-title">Invite a teammate</b>
                  <label>Email</label>
                  <div className="bs-input">{typed('sam@northwind.com', t, 1.6, 24)}</div>
                  <label>Role</label>
                  <div className="bs-input">{t >= 3.0 ? 'Can view documents' : ''}</div>
                  <div className={`bs-button${t > 4.05 ? ' pressed' : ''}`}>Send invite</div>
                </div>
              ) : (
                <div className="bs-form" style={{ left: g.formLeft }}>
                  <b className="bs-page-title">Your team</b>
                  <div className="bs-invited">Invite sent to sam@northwind.com</div>
                  <div className="bs-skel" style={{ width: '74%' }} />
                  <div className="bs-skel" style={{ width: '83%' }} />
                </div>
              )}
              <div className="bs-inbox" style={enter(t, 5.0, 0.5)}>
                <div className="bs-inbox-head">
                  <span className="bs-glyph">
                    <Mail />
                  </span>
                  <b>Inbox</b>
                  <span className="bs-muted">sam@northwind.com</span>
                </div>
                {emailIn ? (
                  <div className="bs-inbox-row tone-ok bs-pop">
                    <span className="bs-glyph">
                      <Check />
                    </span>
                    Maria invited you to Acme Portal
                  </div>
                ) : waiting ? (
                  <div className="bs-inbox-row bs-muted">
                    <span className="bs-glyph">
                      <Spin angle={t * 400} />
                    </span>
                    Waiting for the invite email…
                  </div>
                ) : (
                  <div className="bs-inbox-row tone-fail bs-pop">
                    <span className="bs-glyph">
                      <Cross />
                    </span>
                    No invite email arrived
                  </div>
                )}
              </div>
            </div>
            {t < 5.9 && (
              <div className="bs-pointer" style={{ left: pointer.x, top: pointer.y, opacity: 1 - span(t, 5.4, 5.9) }}>
                <Pointer />
              </div>
            )}
            {CLICKS.map((c) => {
              const k = span(t, c, c + 0.5);
              if (k <= 0 || k >= 1) return null;
              const at = pointerAt(c, g.dx);
              return (
                <span
                  key={c}
                  className="bs-ripple"
                  style={{ left: at.x, top: at.y, opacity: 1 - k, transform: `translate(-50%, -50%) scale(${0.3 + k})` }}
                />
              );
            })}
          </div>

          <div className="bs-card bs-pr" style={g.card}>
            <div className="bs-pr-title">Team invites</div>
            <div className="bs-muted bs-pr-sub">New change, not live yet</div>
            <ul className="bs-checks">
              <li>
                <span className="bs-glyph tone-ok">
                  <Check />
                </span>
                Saved
              </li>
              <li>
                <span className="bs-glyph tone-ok">
                  <Check />
                </span>
                App starts <span className="bs-muted">No errors</span>
              </li>
              <li>
                <span className={`bs-glyph tone-${passed ? 'ok' : found ? 'fail' : 'warn'}`}>
                  {passed ? <Check /> : found ? <Cross /> : <Spin angle={t * 400} />}
                </span>
                <b>AI CTO tried it</b>
                <span className="bs-muted">{passed ? 'Works' : found ? '1 problem' : 'Testing…'}</span>
              </li>
            </ul>
            <div className="bs-finding" style={{ maxHeight: found ? 160 * easeOut(span(t, FOUND, FOUND + 0.5)) : 0 }}>
              <p>
                <b>Invited teammates get no email.</b> Acme's notes say every invite sends one.
              </p>
              <div className={`bs-button small${t >= APPLY ? ' pressed' : ''}`}>{t >= APPLY ? 'Applying fix…' : 'Apply the fix'}</div>
            </div>
            <div className={`bs-merge${passed ? ' ready' : ''}`}>{passed ? 'Safe to go live' : 'Go live'}</div>
          </div>
        </div>
      </Stage>
    </div>
  );
}
