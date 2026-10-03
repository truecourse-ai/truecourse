import type { ReactNode } from 'react';
import { SiGithub, SiGoogledocs, SiJira, SiNotion } from 'react-icons/si';
import { cn } from '@/lib/cn';
import { Stage } from '../Stage';
import { useScrollSteps } from '../useScrollSteps';
import { easeInOut, easeOut, enter, lerp, span, typed, useClock, useNarrow } from '../motion';
import { Chat, Check, Mark, Pointer, Spin } from '../icons';

/** How long a step's window takes to play once the scroll reaches it. */
const STEP = 6.5;

const STEPS = [
  {
    title: 'Describe what the app should do',
    body: 'Docs, notes or tickets from Notion, Google Docs or Jira, or a plain description. Every check holds the app to it.',
  },
  { title: 'Connect the code', body: 'One click to connect GitHub, so every change is tested before it goes live.' },
  {
    title: 'We install the script',
    body: 'Two lines of code in the app, approved once, so we can watch it live. Every error, slowdown and place where people get stuck.',
  },
];

/** The window's size: the desktop drawing, or the taller one a phone gets. */
const WINDOW = { wide: { w: 640, h: 430 }, phone: { w: 400, h: 680 } };

/**
 * Setup as three steps beside one app window. Where the section is pinned,
 * scrolling picks the step from how far through the section the reader is,
 * and the window plays that step; nothing moves on by itself, and a click on
 * a step scrolls to it. Where it is not pinned, on narrower screens, each
 * step comes with its own window under it, played as it scrolls into view.
 */
export function SetupScene({ children }: { children?: ReactNode }) {
  const { pin, step, u, jump, pinned } = useScrollSteps(STEPS.length, STEP, 4.6);

  if (!pinned) {
    return (
      <div ref={pin} className="bs-pin bs-pin-setup">
        {children}
        <ol className="bs-setup-stack">
          {STEPS.map((s, i) => (
            <SetupStep key={s.title} index={i} />
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div ref={pin} className="bs-pin bs-pin-setup">
      <div className="bs-pin-sticky">
        {children}
        <div className="bs-setup">
          <ol className="bs-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <button type="button" className={cn('bs-step', i === step && 'on')} onClick={() => jump(i)}>
                  <StepText index={i} />
                </button>
              </li>
            ))}
          </ol>
          <SetupWindow step={step} u={u} />
        </div>
      </div>
    </div>
  );
}

function StepText({ index }: { index: number }) {
  const s = STEPS[index]!;
  return (
    <>
      <span className="bs-step-n">{index + 1}</span>
      <span>
        <b>{s.title}</b>
        <span className="bs-step-body">{s.body}</span>
      </span>
    </>
  );
}

/** One step with its own window under it, played once as it comes into view. */
function SetupStep({ index }: { index: number }) {
  const { ref, t } = useClock(STEP, 4.6, true);
  return (
    <li className="bs-setup-stack-step">
      <div ref={ref}>
        <div className="bs-step on">
          <StepText index={index} />
        </div>
        <SetupWindow step={index} u={t} />
      </div>
    </li>
  );
}

/** The app window playing step `step`, `u` seconds in. */
function SetupWindow({ step, u }: { step: number; u: number }) {
  const narrow = useNarrow();
  const size = narrow ? WINDOW.phone : WINDOW.wide;
  const screen = [
    <Sources key="s" u={u} narrow={narrow} />,
    <Repository key="r" u={u} narrow={narrow} />,
    <Monitoring key="m" u={u} />,
  ][step];
  return (
    <Stage width={size.w} height={size.h} label={`Step ${step + 1}. ${STEPS[step]!.title}.`}>
      <div className="bs-browser bs-app" style={{ inset: 0 }}>
        <div className="bs-browser-bar">
          <i />
          <i />
          <i />
          <span className="bs-url">app.truecourse.dev/{['setup', 'code', 'watching'][step]}</span>
        </div>
        <div className="bs-app-body" key={step} style={enter(u, 0, 0.35, undefined, 8)}>
          {screen}
        </div>
      </div>
    </Stage>
  );
}

/* ---------- step 1: what the app should do ---------- */

const SOURCES: { icon: ReactNode; name: string }[] = [
  { icon: <SiNotion />, name: 'Notion' },
  { icon: <SiGoogledocs />, name: 'Google Docs' },
  { icon: <SiJira />, name: 'Jira' },
  { icon: <Chat />, name: 'Plain description' },
];

/** On a phone the document and the count follow the list down the window, in its flow. */
function Sources({ u, narrow }: { u: number; narrow: boolean }) {
  const found = Math.round(24 * easeOut(span(u, 3.4, 4.6)));
  return (
    <>
      <b className="bs-app-title">What Acme Portal should do</b>
      <ul className="bs-sources">
        {SOURCES.map((s, i) => {
          const done = u >= 0.9 + i * 0.5;
          const busy = u >= 0.4 + i * 0.5 && !done;
          return (
            <li key={s.name}>
              <span className="bs-source-icon">{s.icon}</span>
              <b>{s.name}</b>
              {done ? (
                <span className="bs-chip tone-ok bs-pop">Connected</span>
              ) : busy ? (
                <span className="bs-glyph tone-warn">
                  <Spin angle={u * 400} />
                </span>
              ) : (
                <span className="bs-muted">Connect</span>
              )}
            </li>
          );
        })}
      </ul>
      <div className={cn('bs-doc', narrow && 'flow')} style={enter(u, 2.4, 0.5)}>
        <span className="bs-muted">Notion</span>
        <b>How team invites work</b>
        <span className="bs-skel" style={{ width: '90%' }} />
        <span className="bs-skel" style={{ width: '76%' }} />
        <span className={cn('bs-req', u >= 3.1 && 'lit')}>Every invite sends an email with a link to join.</span>
        <span className="bs-skel" style={{ width: '84%' }} />
        <span className="bs-skel" style={{ width: '60%' }} />
      </div>
      <div className={cn('bs-found', narrow && 'flow')} style={enter(u, 3.4, 0.4)}>
        <b>{found}</b> things to check
      </div>
    </>
  );
}

/* ---------- step 2: the app's code ---------- */

const REPOS = ['acme/client-portal', 'acme/website', 'acme/old-prototype'];

/** The pointer heads for the button, which sits lower on a phone's taller window. */
function Repository({ u, narrow }: { u: number; narrow: boolean }) {
  const toRow = easeInOut(span(u, 0.5, 1.3));
  const toButton = easeInOut(span(u, 1.8, 2.6));
  const button = narrow ? { x: 290, y: 578 } : { x: 470, y: 330 };
  const x = lerp(lerp(button.x, 200, toRow), button.x, toButton);
  const y = lerp(lerp(button.y + 30, 118, toRow), button.y, toButton);
  const picked = u >= 1.45;
  const connected = u >= 2.75;
  return (
    <>
      <b className="bs-app-title">Choose the app</b>
      <ul className="bs-repos">
        {REPOS.map((r, i) => (
          <li key={r} className={cn(i === 0 && picked && 'on')}>
            <span className="bs-gh">
              <SiGithub />
            </span>
            <b>{r}</b>
            {!narrow && <span className="bs-muted">{['Updated today', '2 weeks ago', '8 months ago'][i]}</span>}
          </li>
        ))}
      </ul>
      <div className={cn('bs-connect', connected && 'done')}>
        {connected ? (
          <>
            <span className="bs-glyph">
              <Check />
            </span>
            acme/client-portal connected
          </>
        ) : (
          'Connect'
        )}
      </div>
      {u < 3.4 && (
        <div className="bs-pointer" style={{ left: x, top: y, opacity: 1 - span(u, 3.0, 3.4) }}>
          <Pointer label="Dana" />
        </div>
      )}
    </>
  );
}

/* ---------- step 3: watching ---------- */

function Monitoring({ u }: { u: number }) {
  const done = u >= 2.3;
  const sessions = Math.round(1280 * easeOut(span(u, 3.0, 5.2)));
  return (
    <>
      <div className="bs-mpr">
        <div className="bs-mpr-head">
          <span className="bs-avatar">
            <Mark />
          </span>
          <b>Two lines added to client-portal</b>
          <span key={done ? 'd' : 'w'} className={`bs-chip bs-pop ${done ? 'tone-ok' : 'tone-warn'}`}>
            {done ? 'Ready' : 'Setting up'}
          </span>
        </div>
        <div className="bs-diff">
          <span>+ {typed("import { watch } from 'truecourse'", u, 0.3, 40)}</span>
          <span>+ {typed('watch.start()', u, 1.3, 30)}</span>
        </div>
        <div className="bs-approved" style={enter(u, 1.9, 0.35)}>
          <span className="bs-glyph tone-ok">
            <Check />
          </span>
          Approved by Dana
        </div>
      </div>
      <div className="bs-live-head" style={enter(u, 2.7, 0.4)}>
        <span className="bs-live" />
        <b>Watching</b>
        <span className="bs-muted">client-portal, live</span>
      </div>
      <div className="bs-stats">
        {[
          ['Errors', '0'],
          ['Slowdowns', 'None'],
          ['Visits', sessions.toLocaleString('en-US')],
        ].map(([k, v], i) => (
          <div key={k} className="bs-stat" style={enter(u, 2.9 + i * 0.2, 0.4)}>
            <span className="bs-muted">{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
    </>
  );
}
