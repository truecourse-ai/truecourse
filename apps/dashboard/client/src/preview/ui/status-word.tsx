// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

/**
 * THE status idiom: a colored dot plus a full-contrast word.
 *
 * A status is never a tinted capsule. The DOT carries the colour (emerald for
 * good, red for failed, amber for blocked, muted for nothing-said, blue for
 * still-running) and the WORD carries the meaning at full contrast, so a row
 * reads the same in light and dark and a screen reader gets a word rather than
 * a colour. Capsules ({@link Badge}) are for neutral bounded labels only:
 * `hosted` / `local`, `cli` / `api` / `web`, `derived` / `authored`, a plan name.
 *
 * Every surface maps its own vocabulary onto a TONE here rather than inventing
 * a palette: the maps below are the only place a conclusion, a verdict, a test
 * status or a job state becomes a colour.
 */

import { HoverPopover } from '@/preview/ui/hover-popover';
import type { CheckConclusion, RunOrigin, StepDriver, TestStatus } from '@/preview/data/types';

export type StatusTone = 'success' | 'failure' | 'blocked' | 'neutral' | 'running';

const DOT: Record<StatusTone, string> = {
  success: 'bg-emerald-500',
  failure: 'bg-red-500',
  blocked: 'bg-amber-500',
  neutral: 'bg-muted-foreground',
  running: 'bg-sky-500',
};

export function StatusWord({
  tone,
  word,
  count,
  className = '',
}: {
  tone: StatusTone;
  /** The capitalized word: "Passing", "Blocked", "Neutral". */
  word: string;
  /** A number the word counts, rendered after it: "Failed 3". */
  count?: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-foreground ${className}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} aria-hidden />
      <span className="font-medium">
        {word}
        {count == null ? '' : ` ${count}`}
      </span>
    </span>
  );
}

/** A check's conclusion, in the gate's words. An error is a failure, never neutral. */
export const CONCLUSION_TONE: Record<CheckConclusion, StatusTone> = {
  success: 'success',
  failure: 'failure',
  neutral: 'neutral',
};

export const CONCLUSION_WORD: Record<CheckConclusion, string> = {
  success: 'Passing',
  failure: 'Failing',
  neutral: 'Neutral',
};

export const TEST_TONE: Record<TestStatus, StatusTone> = {
  passing: 'success',
  failing: 'failure',
  blocked: 'blocked',
  'not-testable': 'neutral',
  'never-run': 'neutral',
};

export const TEST_WORD: Record<TestStatus, string> = {
  passing: 'Passing',
  failing: 'Failing',
  blocked: 'Blocked',
  'not-testable': 'Not testable',
  'never-run': 'Never run',
};

export const VERDICT_TONE: Record<'passed' | 'failed' | 'blocked', StatusTone> = {
  passed: 'success',
  failed: 'failure',
  blocked: 'blocked',
};

export const VERDICT_WORD: Record<'passed' | 'failed' | 'blocked', string> = {
  passed: 'Passed',
  failed: 'Failed',
  blocked: 'Blocked',
};

export const JOB_TONE: Record<'queued' | 'running' | 'succeeded' | 'failed', StatusTone> = {
  queued: 'neutral',
  running: 'running',
  succeeded: 'success',
  failed: 'failure',
};

export const JOB_WORD: Record<'queued' | 'running' | 'succeeded' | 'failed', string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
};

/**
 * The neutral bounded labels: a capsule's job. They are facts about a row, not
 * judgements of it, which is exactly why they are allowed to be capsules.
 */
export const ORIGIN_LABEL: Record<RunOrigin, string> = {
  hosted: 'hosted',
  local: 'local',
};

export const DRIVER_LABEL: Record<StepDriver, string> = {
  cli: 'cli',
  api: 'api',
  web: 'web',
};

/**
 * A tally as dots: one colored dot per bucket with its number, no words. For a
 * row's second line under a status word that already says the verdict, where
 * "13 passed · 3 failed · 2 blocked" repeats what the colors say. Hover help on
 * each dot names the bucket.
 */
export function TallyDots({
  items,
  className = '',
}: {
  items: readonly { tone: StatusTone; count: number; label: string }[];
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 tabular-nums ${className}`}>
      {items.map((it) => (
        <HoverPopover key={it.label} content={<span className="text-[11px]">{it.count} {it.label}</span>}>
          <span className="inline-flex items-center gap-1 text-[10px] text-foreground" aria-label={`${it.count} ${it.label}`}>
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[it.tone]}`} />
            {it.count}
          </span>
        </HoverPopover>
      ))}
    </span>
  );
}
