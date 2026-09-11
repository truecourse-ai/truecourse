/**
 * The pure layer under the agent surfaces: how a run record READS.
 *
 * Everything here is derived from what the store actually carries: the run's
 * own `display` blocks (the SAME append-only vocabulary its sessions' outcomes
 * use, in which the step checklist is simply a `checklist` block the run
 * process declares) and its own timestamps. Nothing here holds structure of
 * its own, and no narration is invented. The conversation itself is folded in
 * `conversation-model`, which reads the checklist through here.
 */

import type { ChecklistItem, DisplayBlock } from '@truecourse/agent-loop';
import type { PublicSessionRun } from '@/lib/api';

/**
 * The blocks of a `display`, minus anything that is not a block at all: these
 * arrive as bare wire JSON that nothing on the read path validates. Both
 * readers (the run's checklist, an outcome's findings) take theirs through
 * here.
 */
export function displayBlocks(display: unknown): readonly DisplayBlock[] {
  const blocks: unknown = (display as { blocks?: unknown } | null | undefined)?.blocks;
  if (!Array.isArray(blocks)) return [];
  return blocks.filter(
    (block): block is DisplayBlock =>
      typeof block === 'object' &&
      block !== null &&
      typeof (block as { kind?: unknown }).kind === 'string',
  );
}

export type RunStatus = PublicSessionRun['status'];
export type StepStatus = 'pending' | 'active' | 'done' | 'error';

export const RUN_STATUS_META: Record<RunStatus, { word: string; dot: string }> = {
  running: { word: 'Running', dot: 'bg-sky-500' },
  completed: { word: 'Finished', dot: 'bg-emerald-500' },
  failed: { word: 'Failed', dot: 'bg-red-500' },
  interrupted: { word: 'Interrupted', dot: 'bg-amber-500' },
};

/** The step-dot palette: a pending step is an empty ring, never a fill. */
export const STEP_DOT: Record<StepStatus, string> = {
  pending: 'border border-border bg-transparent',
  active: 'bg-sky-500',
  done: 'bg-emerald-500',
  error: 'bg-red-500',
};

/** What each kind of run is called, in the product's words rather than the store's ids. */
const COMMAND_LABEL: Record<string, string> = {
  'spec-scan': 'Document scan',
  'guard-setup': 'Test setup',
  'guard-generate': 'Test generation',
  'guard-run': 'Test run',
  'guard-interfaces': 'Interface authoring',
  'guard-adjudicate': 'Failure adjudication',
};

/** `spec-scan` → `Document scan`; a command with no name of its own reads as its id, spaced. */
export const commandLabel = (command: string): string => COMMAND_LABEL[command] ?? command.replace(/-/g, ' ');

export const startedLabel = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export const shortRef = (gitRef: string): string =>
  /^[0-9a-f]{40}$/.test(gitRef) ? gitRef.slice(0, 8) : gitRef;

/** Pieces of work awaiting an answer: the "needs you" count. */
export const waitingCount = (run: PublicSessionRun): number =>
  run.sessions.filter((s) => s.status === 'waiting').length;

/** `372000` → `6m 12s`; under a minute stays plain seconds. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  if (minutes < 60) return `${minutes}m ${rest}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * How long the run took, or has been going. A live run's elapsed is computed
 * at RENDER time rather than on a ticker: the socket pushes a fresh run record
 * on every store write, so a running run's number moves on its own without a
 * repaint loop.
 */
export function runDuration(run: PublicSessionRun, now = Date.now()): string {
  const started = Date.parse(run.startedAt);
  if (!Number.isFinite(started)) return '';
  const ended = run.finishedAt ? Date.parse(run.finishedAt) : now;
  if (!Number.isFinite(ended)) return '';
  return formatDuration(ended - started);
}

/** Every checklist item the run declared, in order. A run may present more
 *  than one `checklist` block; they read as ONE list, and nothing is dropped. */
export function runChecklist(run: PublicSessionRun): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  for (const block of displayBlocks(run.display)) {
    if (block.kind === 'checklist' && Array.isArray(block.items)) items.push(...block.items);
  }
  return items;
}

/**
 * What a run surface needs to offer "run it again". Supplied by whoever mounts
 * the surface, which knows nothing about how a command is started, only
 * whether this one can be.
 */
export interface RunStarter {
  /** Whether a run of this command can be started from here. */
  supports: (command: string) => boolean;
  /** Fire it. Refusals are announced by the starter, so there is nothing to catch. */
  start: (command: string) => void;
  /** A start is in flight. */
  pending: boolean;
  /** What a repository with no runs at all is offered, when there is an offer. */
  first: { command: string; label: string } | null;
}
