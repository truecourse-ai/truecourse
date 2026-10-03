import { Stage } from '../Stage';
import { backOut, clamp, easeOut, enter, span, useClock, useNarrow } from '../motion';

const LENGTH = 11.6;
const OUT = 10.6;
const DROP = 5.8;

interface Role {
  name: string;
  task: string;
  /** The jobs that slip when one person holds all five. */
  drops?: boolean;
}

const ROLES: Role[] = [
  { name: 'Developer', task: 'Ship the new feature' },
  { name: 'Product', task: "Decide what's next" },
  { name: 'QA', task: 'Test every path', drops: true },
  { name: 'On-call', task: 'Watch production at 2 AM', drops: true },
  { name: 'Support', task: 'Answer 41 emails', drops: true },
];

/**
 * Where each role sits, in role order, around the person in the middle: five
 * around a wide stage on a desktop, and on a phone two columns above and
 * below with Product at the top.
 */
const WIDE = {
  w: 720,
  h: 400,
  roleW: 196,
  center: { x: 360, y: 214 },
  at: [
    { x: 128, y: 92 },
    { x: 360, y: 46 },
    { x: 592, y: 92 },
    { x: 140, y: 330 },
    { x: 580, y: 330 },
  ],
};
const PHONE = {
  w: 400,
  h: 520,
  roleW: 178,
  center: { x: 200, y: 280 },
  at: [
    { x: 103, y: 150 },
    { x: 200, y: 48 },
    { x: 297, y: 150 },
    { x: 103, y: 430 },
    { x: 297, y: 430 },
  ],
};

/**
 * One person and the five jobs that land on them, one after another, until
 * the load shows. Then three of them drop: testing, watching production and
 * hearing users are the jobs a solo builder never gets to.
 */
export function WholeTeam() {
  const { ref, t } = useClock(LENGTH, 8.2);
  const g = useNarrow() ? PHONE : WIDE;
  const load = ROLES.reduce((n, _, i) => n + easeOut(span(t, 0.9 + i * 0.6, 1.4 + i * 0.6)), 0) / ROLES.length;
  const shake = t > 4.4 && t < 5.4 ? Math.sin(t * 60) * 3 * (1 - span(t, 4.4, 5.4)) : 0;
  const all = enter(t, 0, 0.4, OUT, 0);
  const ring = 2 * Math.PI * 58;
  const { center } = g;

  return (
    <div ref={ref}>
      <Stage width={g.w} height={g.h} label="One person holding five jobs. Developer, product, QA, on-call and support. QA, on-call and support are the jobs that get skipped.">
        <div style={{ opacity: all.opacity }} className="bs-fill">
          <svg className="bs-fill" viewBox={`0 0 ${g.w} ${g.h}`}>
            {ROLES.map((role, i) => {
              const a = easeOut(span(t, 0.9 + i * 0.6, 1.5 + i * 0.6));
              const dropped = role.drops && t >= DROP;
              const at = g.at[i]!;
              return (
                <line
                  key={role.name}
                  x1={center.x}
                  y1={center.y}
                  x2={center.x + (at.x - center.x) * a}
                  y2={center.y + (at.y - center.y) * a}
                  className={dropped ? 'bs-tie dropped' : 'bs-tie'}
                />
              );
            })}
            <circle cx={center.x} cy={center.y} r={58} className="bs-load-track" />
            <circle
              cx={center.x}
              cy={center.y}
              r={58}
              className="bs-load"
              strokeDasharray={`${ring * load} ${ring}`}
              transform={`rotate(-90 ${center.x} ${center.y})`}
              style={{ stroke: load > 0.79 ? 'var(--fail)' : load > 0.5 ? 'var(--warn)' : 'var(--accent)' }}
            />
          </svg>
          <div className="bs-you" style={{ left: center.x + shake, top: center.y }}>
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="8.5" r="4" fill="currentColor" />
              <path d="M4 21c.8-4.4 4-7 8-7s7.2 2.6 8 7z" fill="currentColor" />
            </svg>
            <span>You</span>
          </div>
          {ROLES.map((role, i) => {
            const a = clamp(backOut(span(t, 0.9 + i * 0.6, 1.4 + i * 0.6)), 0, 1.2);
            const shown = t >= 0.9 + i * 0.6;
            const dropped = role.drops && t >= DROP;
            const fall = role.drops ? easeOut(span(t, DROP, DROP + 0.5)) : 0;
            const at = g.at[i]!;
            return (
              <div
                key={role.name}
                className={`bs-role${dropped ? ' dropped' : ''}`}
                style={{
                  left: at.x,
                  top: at.y + fall * 8,
                  width: g.roleW,
                  opacity: shown ? 1 : 0,
                  transform: `translate(-50%, -50%) scale(${shown ? a : 0})`,
                }}
              >
                <b>{role.name}</b>
                <span className="bs-role-task">{role.task}</span>
                {role.drops && (
                  <span className="bs-chip tone-fail bs-role-chip" style={{ opacity: fall, transform: `scale(${0.7 + fall * 0.3})` }}>
                    Skipped
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Stage>
    </div>
  );
}
