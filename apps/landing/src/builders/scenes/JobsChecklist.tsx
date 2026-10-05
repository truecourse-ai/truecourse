import { easeOut, span, useClock } from '../motion';
import { Check, Cross } from '../icons';

/**
 * The problem in one look: the one job a solo builder fills, against the
 * four the app needs. The rows come in one after another as it comes into
 * view; the three open ones are the jobs the AI CTO takes.
 */

const JOBS = [
  { job: 'Builder', note: 'You, every day', done: true },
  { job: 'Tester', note: 'Nobody checks a change before it goes live', done: false },
  { job: 'On call at night', note: 'Nobody sees it break at 2 AM', done: false },
  { job: 'Watching how people use it', note: 'Nobody sees where people get stuck or give up', done: false },
];

/** The one job a solo builder fills, against the four the app needs. */
export function JobsChecklist() {
  const { ref, t } = useClock(3.4, 3.4, true);
  return (
    <div ref={ref}>
      <ul className="bs-jobs-check" aria-label="The app needs four jobs. Builder is covered. Tester, on call at night, and watching how people use it are not.">
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
