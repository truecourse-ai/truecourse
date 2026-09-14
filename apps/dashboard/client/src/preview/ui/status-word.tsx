/**
 * THE status idiom: a colored dot plus a full-contrast word.
 *
 * A status is never a tinted capsule. The DOT carries the colour (emerald for
 * good, red for failed, amber for blocked, muted for nothing-said, blue for
 * still-running and for guard's unproven) and the WORD carries the meaning at
 * full contrast, so a row reads the same in light and dark and a screen reader
 * gets a word rather than a colour. The same dot carries a LIST'S TALLY
 * ({@link StatusTally}), the one place a list says how many rows wear each
 * word. Capsules ({@link Badge}) are for neutral bounded labels only:
 * `hosted` / `local`, `cli` / `api` / `web`, `derived` / `authored`, a plan name.
 *
 * Every surface maps its own vocabulary onto a TONE here rather than inventing
 * a palette: the maps below are the only place a conclusion, a verdict, a test
 * status or a job state becomes a colour.
 */

import type { ContextDocumentStatus, ContextSourceStatus } from '@truecourse/shared';
import type { GuardCoveragePlainStatus } from '@/preview/vendor/shared';
import type { WorkStatus } from '@/components/sessions/run-model';
import { HoverPopover } from '@/preview/ui/hover-popover';
import type { CheckConclusion } from '@/preview/data/types';

export type StatusTone =
  | 'success'
  | 'failure'
  | 'blocked'
  | 'attention'
  | 'unproven'
  | 'neutral'
  | 'running';

const DOT: Record<StatusTone, string> = {
  success: 'bg-emerald-500',
  failure: 'bg-red-500',
  blocked: 'bg-amber-500',
  // Amber for the states that want a reader rather than a fix: an interrupted
  // conversation, one holding a question.
  attention: 'bg-amber-500',
  // Guard's one blue: nothing has ruled here yet and someone can move it. Guard
  // bans amber, so its Blocked and its Never run wear this rather than the
  // amber Context's Blocked wears.
  unproven: 'bg-sky-500',
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

/**
 * A document of Context, in the product owner's six words. Not linked is grey
 * with Not testable: neither is anybody's to-do. The WORDS live in
 * `@truecourse/shared` (the server folds by them); only the colour is here.
 */
export const CONTEXT_DOC_TONE: Record<ContextDocumentStatus, StatusTone> = {
  proved: 'success',
  failed: 'failure',
  blocked: 'blocked',
  'not-run': 'neutral',
  'not-testable': 'neutral',
  'not-linked': 'neutral',
};

/** A source's sync state as a status word, everywhere a source appears. */
export const CONTEXT_SYNC_WORD: Record<ContextSourceStatus, string> = {
  synced: 'Synced',
  syncing: 'Syncing',
  failed: 'Failed',
  paused: 'Paused',
  never: 'Never synced',
};

export const CONTEXT_SYNC_TONE: Record<ContextSourceStatus, StatusTone> = {
  synced: 'success',
  syncing: 'running',
  failed: 'failure',
  paused: 'neutral',
  never: 'neutral',
};

/** A piece of work's status. The words are the run model's; only the colour is
 *  here. Waiting its turn is nobody's to-do, so it is the muted tone. */
export const RUN_STATUS_TONE: Record<WorkStatus, StatusTone> = {
  queued: 'neutral',
  running: 'running',
  completed: 'success',
  failed: 'failure',
  interrupted: 'attention',
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

/**
 * The five coverage words as tones. The words and the order are guard's
 * (`GUARD_COVERAGE_PLAIN_ORDER`); the paint is guard's four colours, so a
 * tally under a guard list and the chips in it carry the same dot.
 */
export const GUARD_COVERAGE_TONE: Record<GuardCoveragePlainStatus, StatusTone> = {
  failed: 'failure',
  blocked: 'unproven',
  'never-run': 'unproven',
  succeeded: 'success',
  'not-testable': 'neutral',
};

/** One word of a list's tally: how many of the shown rows wear it. */
export interface TallyItem {
  key: string;
  /** The status word: "Failed", "Blocked". */
  word: string;
  count: number;
  tone: StatusTone;
}

/**
 * The rows a list SHOWS, counted by status, in the order the list's own filter
 * offers them. Every word of the order comes back, zero included;
 * {@link StatusTally} is what leaves the empty ones out.
 */
export function tallyOf<T, K extends string>(
  rows: readonly T[],
  order: readonly K[],
  statusOf: (row: T) => K,
  describe: (key: K) => { word: string; tone: StatusTone },
): TallyItem[] {
  const counts = new Map<K, number>();
  for (const row of rows) {
    const key = statusOf(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return order.map((key) => ({ key, count: counts.get(key) ?? 0, ...describe(key) }));
}

/**
 * THE tally of a list, its last line: one dot per status word with how many of
 * the shown rows wear it, worst first, a word no row wears left out. The dots
 * read as Home's area rows read; the word is spelled out because a list has no
 * legend above it. It counts what is SHOWN, so the search and the filters move
 * it, and it is the ONE place a list says how many of anything it holds.
 *
 * The bar ends in one muted size: "N total" when the list shows everything it
 * holds, "K of N" when the search or a filter narrowed it to K rows, so the
 * cut is stated rather than left to be summed from the words.
 */
export function StatusTally({
  label,
  items,
  total,
}: {
  label: string;
  items: readonly TallyItem[];
  /** The full row count, before any search or filter. */
  total?: number;
}) {
  const shown = items.filter((item) => item.count > 0);
  if (shown.length === 0) return null;
  const counted = items.reduce((sum, item) => sum + item.count, 0);
  return (
    <div
      role="group"
      aria-label={`${label} tally`}
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-6 py-2"
    >
      {shown.map((item) => (
        <span
          key={item.key}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground"
        >
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[item.tone]}`} />
          <span className="tabular-nums">{`${item.count} ${item.word}`}</span>
        </span>
      ))}
      {total != null && (
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {counted < total ? `${counted} of ${total}` : `${total} total`}
        </span>
      )}
    </div>
  );
}

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
