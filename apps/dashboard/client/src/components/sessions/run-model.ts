/**
 * The pure layer under the Activity surface: how a run record READS.
 *
 * Two shapes come out of here — the runs-index row (status word, step dots,
 * progress sentence, counts, duration) and the run-as-a-conversation stream
 * ({@link buildRunStream}), which merges the run's step checklist with its
 * session index so each step becomes one activity card carrying the sessions
 * that did its work.
 *
 * Everything here is derived from what the store actually carries: the run's
 * own `display` blocks — the SAME append-only vocabulary its sessions' outcomes
 * use, in which the step checklist is simply a `checklist` block the run
 * process declares — and the `sessions[]` index. Nothing here holds run-level
 * structure of its own: a run that declares no checklist renders as a flat
 * trace of its session kinds. No narration is invented.
 *
 * Blocks arrive here as bare wire JSON and are parsed tolerantly upstream, so
 * every field is checked before it is read: a kind this client has never heard
 * of, or a known kind whose fields are malformed, states what it carries as a
 * plain line. This is the RUN level of the one fold — everything that is not
 * the checklist degrades to lines here; the transcript level renders the same
 * vocabulary as cards.
 */

import type { ChecklistItem, SessionIndexEntry, SessionStatus } from '@truecourse/agent-loop';
import type { PublicSessionRun } from '@/lib/api';
import { displayBlocks, unknownBlockLine, type ChatRow } from './transcript-model';

export type RunStatus = PublicSessionRun['status'];
export type StepStatus = 'pending' | 'active' | 'done' | 'error';

export const RUN_STATUS_META: Record<RunStatus, { word: string; dot: string }> = {
  running: { word: 'Running', dot: 'bg-sky-500' },
  completed: { word: 'Finished', dot: 'bg-emerald-500' },
  failed: { word: 'Failed', dot: 'bg-red-500' },
  interrupted: { word: 'Interrupted', dot: 'bg-amber-500' },
};

export const SESSION_STATUS_META: Record<SessionStatus, { word: string; dot: string }> = {
  running: { word: 'Active', dot: 'bg-sky-500' },
  waiting: { word: 'Needs you', dot: 'bg-sky-500' },
  parked: { word: 'Parked', dot: 'bg-amber-500' },
  completed: { word: 'Done', dot: 'bg-emerald-500' },
  failed: { word: 'Failed', dot: 'bg-red-500' },
};

/** The step-dot palette — a pending step is an empty ring, never a fill. */
export const STEP_DOT: Record<StepStatus, string> = {
  pending: 'border border-border bg-transparent',
  active: 'bg-sky-500',
  done: 'bg-emerald-500',
  error: 'bg-red-500',
};

/** `spec-scan` → `spec scan` — the store id as a display phrase. */
export const commandLabel = (command: string): string => command.replace(/-/g, ' ');

export const startedLabel = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export const timeLabel = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export const shortRef = (gitRef: string): string =>
  /^[0-9a-f]{40}$/.test(gitRef) ? gitRef.slice(0, 8) : gitRef;

/** Sessions awaiting an answer — the "needs you" count. */
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
 * What the run says about itself, split the only two ways a reader needs it:
 * the step checklist (every `checklist` block's items, concatenated — the
 * run's own structure) and everything else as plain lines.
 */
function readDisplay(run: PublicSessionRun): { checklist: ChecklistItem[]; notes: string[] } {
  const checklist: ChecklistItem[] = [];
  const notes: string[] = [];
  for (const block of displayBlocks(run.display)) {
    switch (block.kind) {
      case 'checklist':
        if (Array.isArray(block.items)) {
          checklist.push(...block.items);
          break;
        }
        notes.push(unknownBlockLine(block));
        break;
      case 'facts':
        if (Array.isArray(block.lines)) notes.push(...block.lines);
        else notes.push(unknownBlockLine(block));
        break;
      case 'text':
        if (typeof block.text === 'string') notes.push(block.text);
        else notes.push(unknownBlockLine(block));
        break;
      case 'finding':
        if (typeof block.claim === 'string') notes.push(block.claim);
        else notes.push(unknownBlockLine(block));
        break;
      default:
        notes.push(unknownBlockLine(block));
    }
  }
  return { checklist, notes };
}

/**
 * The index row's progress sentence: what the run is doing (the active step's
 * own detail), what broke, or — once every step has landed — how many steps
 * there were. Takes the checklist the caller already folded, so a row that
 * also draws the step dots reads the run's display once.
 */
export function progressSentence(steps: readonly ChecklistItem[], runStatus: RunStatus): string {
  if (steps.length === 0) return '';
  const failed = steps.find((s) => s.status === 'error');
  if (failed) return `${failed.label.toLowerCase()} failed${failed.detail ? ` · ${failed.detail}` : ''}`;
  const active = steps.find((s) => s.status === 'active');
  if (active) {
    const where = `${active.label.toLowerCase()}${active.detail ? ` · ${active.detail}` : ''}`;
    return runStatus === 'running' ? where : `stopped at ${where}`;
  }
  return `${steps.length} step${steps.length === 1 ? '' : 's'}`;
}

/**
 * The row's one line about a run: why it ended badly when the record says so,
 * and how far it got otherwise. A run that died before opening a step has only
 * its error to tell — and when it has both, the error is the part worth the
 * one line the row has.
 */
export function runStory(run: PublicSessionRun, steps: readonly ChecklistItem[]): string {
  return run.error?.message ?? progressSentence(steps, run.status);
}

/**
 * What a run surface needs to offer "run it again". Supplied by whoever mounts
 * the surface — the sessions views know nothing about how a command is started,
 * only whether this one can be.
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

// ---------------------------------------------------------------------------
// step ↔ session mapping
// ---------------------------------------------------------------------------

/** One card in the run's stream: a step, and the sessions that did its work. */
export interface StreamStep {
  key: string;
  label: string;
  status: StepStatus;
  /** The checklist's own live counter ("3/12 docs"), or a derived one. */
  detail?: string;
  sessions: SessionIndexEntry[];
}

export interface RunStream {
  /** In checklist order; pending steps are held back for `next`. */
  steps: StreamStep[];
  /** The label of the step that has not started yet, when one is known. */
  next?: string;
  /** Everything else the run said about itself, one line each. */
  notes: string[];
}

/**
 * The run's stream: its step checklist, each step carrying its sessions.
 *
 * WHICH sessions did which step's work is the run record's own claim: each
 * checklist item names its `sessionKinds`. Nothing here knows a command or a
 * kind — a deterministic step simply claims none.
 *
 * Pending steps don't render as cards — they appear when they start — but the
 * first one names itself in `next` so the stream says what is coming.
 *
 * FALLBACK: any session kind no item claims still gets its own card, appended
 * after the checklist ones (title = the kind, counter = done/total). That is
 * what a run whose items declare nothing renders: checklist cards with no
 * session lines, plus one generic card per kind — and a run declaring no
 * checklist at all renders as one card per kind, a flat agentic trace. Nothing
 * ever disappears.
 */
export function buildRunStream(run: PublicSessionRun): RunStream {
  const { checklist: items, notes } = readDisplay(run);
  const placed = new Set<string>();
  const steps: StreamStep[] = [];

  for (const item of items) {
    const kinds = item.sessionKinds ?? [];
    for (const kind of kinds) placed.add(kind);
    if (item.status === 'pending') continue;
    steps.push({
      key: item.key,
      label: item.label,
      status: item.status,
      ...(item.detail ? { detail: item.detail } : {}),
      sessions: run.sessions.filter((s) => kinds.includes(s.kind)),
    });
  }

  for (const kind of [...new Set(run.sessions.map((s) => s.kind))]) {
    if (placed.has(kind)) continue;
    const sessions = run.sessions.filter((s) => s.kind === kind);
    const done = sessions.filter((s) => s.status === 'completed').length;
    steps.push({
      key: `kind:${kind}`,
      label: kind,
      status: kindStatus(sessions),
      detail: `${done} of ${sessions.length}`,
      sessions,
    });
  }

  const next = items.find((s) => s.status === 'pending')?.label;
  return { steps, notes, ...(next ? { next } : {}) };
}

function kindStatus(sessions: readonly SessionIndexEntry[]): StepStatus {
  if (sessions.some((s) => s.status === 'failed')) return 'error';
  if (sessions.some((s) => s.status === 'running' || s.status === 'waiting' || s.status === 'parked'))
    return 'active';
  return 'done';
}

/**
 * What the agent said last, for the question bubble a `waiting` session posts
 * into the stream. A pending question wins over plain narration — it IS the
 * thing needing an answer; otherwise the last thing the agent typed.
 */
export function lastAgentMessage(rows: readonly ChatRow[]): string | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.kind === 'question') return row.question.question;
    if (row.kind === 'agent-text') return row.text;
  }
  return undefined;
}
