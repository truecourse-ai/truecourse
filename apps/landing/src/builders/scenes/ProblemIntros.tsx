import { easeOut, span, useClock } from '../motion';
import { Check, Cross } from '../icons';

/**
 * Two ways to open the problem section, offered side by side for choosing:
 * where a builder's week goes, and the one job hired against the four the
 * app needs. Each plays once as it comes into view.
 */

const HOURS = [
  { label: 'Building', hours: 9, tone: 'build' },
  { label: 'Fixing what broke', hours: 11, tone: 'fix' },
  { label: 'Checking it is still up', hours: 7, tone: 'watch' },
  { label: 'Answering users', hours: 8, tone: 'users' },
] as const;
const TOTAL = HOURS.reduce((n, h) => n + h.hours, 0);

/** A builder's week as one bar: building is a small part, the rest is keeping the app alive. */
export function HoursBar() {
  const { ref, t } = useClock(4, 4, true);
  return (
    <div ref={ref} className="bs-hours" role="img" aria-label="A builder's week of 35 hours. 9 hours building, 11 fixing what broke, 7 checking it is still up, 8 answering users.">
      <div className="bs-hours-bar" aria-hidden="true">
        {HOURS.map((h, i) => {
          const k = easeOut(span(t, 0.2 + i * 0.5, 0.9 + i * 0.5));
          return (
            <span key={h.label} className={`bs-hours-seg ${h.tone}`} style={{ flexGrow: h.hours * k, flexBasis: 0 }}>
              {k > 0.8 && <b>{h.hours}h</b>}
            </span>
          );
        })}
      </div>
      <ul className="bs-hours-legend" aria-hidden="true">
        {HOURS.map((h, i) => (
          <li key={h.label} style={{ opacity: easeOut(span(t, 0.2 + i * 0.5, 0.7 + i * 0.5)) }}>
            <i className={h.tone} />
            {h.label}
          </li>
        ))}
      </ul>
      <p className="bs-hours-total" aria-hidden="true">
        {TOTAL} hours a week. Only 9 of them building.
      </p>
    </div>
  );
}

const JOBS = [
  { job: 'Builder', note: 'You, every day', done: true },
  { job: 'Tester', note: 'Nobody checks a change before it goes live', done: false },
  { job: 'On call at night', note: 'Nobody sees it break at 2 AM', done: false },
  { job: 'Hearing from users', note: 'Nobody notices where people give up', done: false },
];

/** The one job a solo builder fills, against the four the app needs. */
export function JobsChecklist() {
  const { ref, t } = useClock(3.4, 3.4, true);
  return (
    <div ref={ref}>
      <ul className="bs-jobs-check" aria-label="The app needs four jobs. Builder is covered. Tester, on call at night, and hearing from users are not.">
        {JOBS.map((j, i) => {
          const k = easeOut(span(t, 0.2 + i * 0.6, 0.7 + i * 0.6));
          return (
            <li key={j.job} className={j.done ? 'done' : 'open'} style={{ opacity: k, transform: `translateY(${(1 - k) * 10}px)` }}>
              <span className="bs-glyph">{j.done ? <Check /> : <Cross />}</span>
              <b>{j.job}</b>
              <span>{j.note}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
