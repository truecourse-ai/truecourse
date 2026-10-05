import { Stage } from '../Stage';
import { easeInOut, easeOut, enter, span, typed, useClock, useNarrow } from '../motion';
import { Mark, Moon } from '../icons';

const LENGTH = 16;
const OUT = 15;

/** The incident: when checkout starts failing, when the AI CTO starts testing its fix, and when it lands. */
const BREAKS = 3.2;
const TESTING = 7.4;
const FIXED = 8.4;
/** The chart's span of scene time, and its drawing box. */
const RUN = 11;
const W = 500;
const H = 170;
const MAX_ERR = 50;

const PEOPLE = 20;
const HURT = 14;

/** The share of checkouts failing at scene time `s`, in percent. */
function failing(s: number) {
  const wobble = 1.2 + Math.sin(s * 7.3) * 0.6 + Math.sin(s * 3.1) * 0.5;
  const up = easeInOut(span(s, BREAKS, BREAKS + 0.9));
  const down = easeInOut(span(s, FIXED, FIXED + 0.7));
  return wobble + up * (1 - down) * (36 + Math.sin(s * 5) * 4);
}

function clock(t: number) {
  const minutes = 6 + Math.floor((Math.min(t, RUN) / RUN) * 22);
  return `2:${String(minutes).padStart(2, '0')} AM`;
}

/**
 * The middle of the night: checkout's failures climb, the people trying to
 * pay turn red one by one, and within minutes the AI CTO has named the change
 * that caused it, tests a fix and puts it live on its own, and the failures
 * stop. Nobody is woken up; Dana sees it in the morning. On a phone the message comes in under the chart rather than
 * beside it.
 */
export function WatchScene() {
  const { ref, t } = useClock(LENGTH, 10.2);
  const fade = enter(t, 0, 0.4, OUT, 0).opacity;

  const now = Math.min(t, RUN);
  const points: string[] = [];
  for (let s = 0; s <= now; s += 0.05) {
    points.push(`${((s / RUN) * W).toFixed(1)},${(H - (failing(s) / MAX_ERR) * H).toFixed(1)}`);
  }
  const line = points.length ? `M${points.join(' L')}` : '';
  const head = points[points.length - 1]?.split(',').map(Number);
  const incident = t >= BREAKS + 0.4 && t < FIXED + 0.5;
  const arrive = easeOut(span(t, 5.0, 5.6));
  const narrow = useNarrow();
  const g = narrow
    ? { w: 400, h: 560, chart: { left: 0, top: 0, width: 400 }, alert: { left: 0, top: 290, width: 400 } }
    : { w: 800, h: 460, chart: { left: 0, top: 20, width: 560 }, alert: { left: 440, top: 150, width: 360 } };

  return (
    <div ref={ref}>
      <Stage width={g.w} height={g.h} label="At night checkout starts failing for 14 people. The AI CTO finds the change that caused it, then tests a fix and puts it live on its own within minutes. The owner sees it in the morning.">
        <div className="bs-fill" style={{ opacity: fade }}>
          <div className="bs-card bs-chart" style={g.chart}>
            <div className="bs-chart-head">
              <b>Checkout</b>
              <span className={`bs-chip ${incident ? 'tone-fail' : 'tone-ok'}`}>{incident ? 'Failing' : 'Healthy'}</span>
              <span className="bs-chart-clock">
                <span className="bs-glyph">
                  <Moon />
                </span>
                {clock(t)}
              </span>
            </div>
            <div className="bs-muted bs-chart-say">Payments failing</div>
            <svg className="bs-plot" viewBox={`0 0 ${W} ${H}`}>
              {[0, 1, 2, 3].map((r) => (
                <line key={r} x1={0} x2={W} y1={(H / 3) * r} y2={(H / 3) * r} className="bs-grid" />
              ))}
              {line && <path d={`${line} L${head?.[0] ?? 0},${H} L0,${H} Z`} className="bs-area" />}
              {line && <path d={line} className="bs-line" />}
              {head && <circle cx={head[0]} cy={head[1]} r={4.5} className={incident ? 'bs-head fail' : 'bs-head'} />}
            </svg>
            <div className="bs-muted bs-chart-say">People checking out</div>
            <div className={`bs-people${narrow ? ' tight' : ''}`}>
              {Array.from({ length: PEOPLE }, (_, i) => {
                const hurt = i < HURT && t >= BREAKS + 0.5 + i * 0.22 && t < FIXED + 0.4 + i * 0.04;
                return <span key={i} className={hurt ? 'hurt' : ''} />;
              })}
            </div>
          </div>

          <div className="bs-card bs-alert" style={{ ...g.alert, opacity: arrive, transform: narrow ? `translateY(${(1 - arrive) * 30}px)` : `translateX(${(1 - arrive) * 70}px)` }}>
            <div className="bs-report-head">
              <span className="bs-avatar">
                <Mark />
              </span>
              <b>AI CTO</b>
              <span className="bs-muted">2:14 AM</span>
            </div>
            <p>
              <b>Checkout is failing for Apple Pay users.</b> 14 people affected since 2:10 AM.
            </p>
            <p className="bs-alert-more">{typed("Tuesday's payment change caused it. Fixing it now.", t, 6.4, 34)}</p>
            {t < FIXED + 0.2 ? (
              <div className="bs-alert-foot" style={enter(t, TESTING, 0.4)}>
                <span className="bs-chip tone-info">Testing the fix…</span>
              </div>
            ) : (
              <div className="bs-alert-foot">
                <span className="bs-chip tone-ok bs-pop">Fixed 2:24 AM</span>
                <span className="bs-muted">Tested and put live. Dana saw it in the morning.</span>
              </div>
            )}
          </div>
        </div>
      </Stage>
    </div>
  );
}
