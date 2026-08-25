/**
 * The pure layer under the Activity surface: how a run record READS.
 *
 * Two shapes come out of here — the runs-index row (status word, phase dots,
 * progress sentence, counts, duration) and the run-as-a-conversation stream
 * ({@link buildRunStream}), which merges the run's phase checklist with its
 * session index so each phase becomes one activity card carrying the sessions
 * that did its work.
 *
 * Everything here is derived from what the store actually carries: the run
 * record's `progress` steps (the run process mirrors its own step tracker
 * there) and the `sessions[]` index. No narration is invented.
 */

import type { SessionIndexEntry, SessionStatus } from '@truecourse/agent-loop';
import type { PublicSessionRun } from '@/lib/api';
import type { ChatRow } from './transcript-model';

export type RunStatus = PublicSessionRun['status'];
export type PhaseStatus = 'pending' | 'active' | 'done' | 'error';

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

/** The phase-dot palette — a pending phase is an empty ring, never a fill. */
export const PHASE_DOT: Record<PhaseStatus, string> = {
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

/**
 * The index row's progress sentence: what the run is doing (the active phase's
 * own detail), what broke, or — once every phase has landed — how many phases
 * there were.
 */
export function progressSentence(run: PublicSessionRun): string {
  const steps = run.progress ?? [];
  if (steps.length === 0) return '';
  const failed = steps.find((s) => s.status === 'error');
  if (failed) return `${failed.label.toLowerCase()} failed${failed.detail ? ` · ${failed.detail}` : ''}`;
  const active = steps.find((s) => s.status === 'active');
  if (active) {
    const where = `${active.label.toLowerCase()}${active.detail ? ` · ${active.detail}` : ''}`;
    return run.status === 'running' ? where : `stopped at ${where}`;
  }
  return `${steps.length} phase${steps.length === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// phase ↔ session mapping
// ---------------------------------------------------------------------------

/**
 * WHICH sessions did which phase's work, per command — the one table.
 *
 * The keys are the run record's real checklist keys (the run process mirrors
 * its own step tracker into `progress`; spec scan's are `CURATE_STEPS` in
 * `packages/core/src/commands/spec-in-process.ts`). The values are the real
 * `*_SESSION_KIND` constants the scan services mint. A deterministic phase
 * maps to no session kinds at all — its card is the header row alone.
 */
const PHASE_SESSION_KINDS: Record<string, Record<string, readonly string[]>> = {
  'spec-scan': {
    // Discovery is deterministic, but the interactive scope orchestrator runs
    // while it is the open step.
    discover: ['spec-scan.orchestrate'],
    // One curate-doc session per doc, then at most one settle-areas session
    // to merge the labels they minted.
    tag: ['spec-scan.curate-doc', 'spec-scan.settle-areas'],
    overlap: ['spec-scan.overlap'],
    // The deterministic fold (re-anchoring, dedup, auto-apply) — no sessions.
    verify: [],
  },
};

/** One card in the run's stream: a phase, and the sessions that did its work. */
export interface StreamPhase {
  key: string;
  label: string;
  status: PhaseStatus;
  /** The checklist's own live counter ("3/12 docs"), or a derived one. */
  detail?: string;
  sessions: SessionIndexEntry[];
}

export interface RunStream {
  /** In checklist order; pending phases are held back for `next`. */
  phases: StreamPhase[];
  /** The label of the phase that has not started yet, when one is known. */
  next?: string;
}

/**
 * The run's stream: its phase checklist, each phase carrying its sessions.
 *
 * Pending phases don't render as cards — they appear when they start — but the
 * first one names itself in `next` so the stream says what is coming.
 *
 * FALLBACK: any session kind the table above doesn't place still gets its own
 * card, appended after the checklist ones (title = the kind, counter =
 * done/total). That is what a command with no mapping entry — every future
 * guard command — renders: checklist cards with no session lines, plus one
 * generic card per kind. Nothing ever disappears because the table is behind.
 */
export function buildRunStream(run: PublicSessionRun): RunStream {
  const steps = run.progress ?? [];
  const table = PHASE_SESSION_KINDS[run.command];
  const placed = new Set<string>();
  const phases: StreamPhase[] = [];

  for (const step of steps) {
    const kinds = table?.[step.key] ?? [];
    for (const kind of kinds) placed.add(kind);
    if (step.status === 'pending') continue;
    phases.push({
      key: step.key,
      label: step.label,
      status: step.status,
      ...(step.detail ? { detail: step.detail } : {}),
      sessions: run.sessions.filter((s) => kinds.includes(s.kind)),
    });
  }

  for (const kind of [...new Set(run.sessions.map((s) => s.kind))]) {
    if (placed.has(kind)) continue;
    const sessions = run.sessions.filter((s) => s.kind === kind);
    const done = sessions.filter((s) => s.status === 'completed').length;
    phases.push({
      key: `kind:${kind}`,
      label: kind,
      status: kindStatus(sessions),
      detail: `${done} of ${sessions.length}`,
      sessions,
    });
  }

  const next = steps.find((s) => s.status === 'pending')?.label;
  return { phases, ...(next ? { next } : {}) };
}

function kindStatus(sessions: readonly SessionIndexEntry[]): PhaseStatus {
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
