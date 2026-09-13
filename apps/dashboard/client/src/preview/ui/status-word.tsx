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

import type { ContextDocumentStatus, ContextSourceStatus } from '@truecourse/shared';
import { HoverPopover } from '@/preview/ui/hover-popover';
import type { CheckConclusion } from '@/preview/data/types';

export type StatusTone = 'success' | 'failure' | 'blocked' | 'attention' | 'neutral' | 'running';

const DOT: Record<StatusTone, string> = {
  success: 'bg-emerald-500',
  failure: 'bg-red-500',
  blocked: 'bg-amber-500',
  // Amber for the states that want a reader rather than a fix: an interrupted
  // conversation, one holding a question.
  attention: 'bg-amber-500',
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
