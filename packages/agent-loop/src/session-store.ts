/**
 * The sessions store record shapes:
 * `.truecourse/sessions/<command>/<runId>/run.json` plus one transcript
 * jsonl per session. Types live here so the OSS file store (core), the EE
 * table store, and the dashboard client all speak one shape; the store
 * implementations live behind `SessionPersistence`.
 */

import { z } from 'zod';
import {
  BudgetSpentSchema,
  SessionStatusSchema,
  type SessionEvent,
} from './session-events.js';
import { DisplayBlocksSchema } from './session-presentation.js';

export const SessionCommandSchema = z.enum([
  'spec-scan',
  'guard-setup',
  'guard-generate',
  // Interface authoring — the web tasks no
  // derivation produces. Its own command because its runs are its own: they
  // are re-run per place, independently of any generate.
  'guard-interfaces',
  // Run adjudication — the failing-scenario triage/control sessions that read
  // a guard run's evidence. Its own command for the same reason: adjudication
  // runs against a RUN, on its own cadence, independently of any generate.
  'guard-adjudicate',
]);
export type SessionCommand = z.infer<typeof SessionCommandSchema>;

export const RunStatusSchema = z.enum(['running', 'completed', 'failed', 'interrupted']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** One row of the run's session index — the dashboard lists sessions from
 *  here, never by parsing transcripts; resume finds parked sessions here. */
export const SessionIndexEntrySchema = z.object({
  sessionId: z.string(),
  kind: z.string(),
  workItem: z.string(),
  status: SessionStatusSchema,
  providerSessionId: z.string().optional(),
  /** Driver-owned resume pointer — opaque to everything else. */
  resumeCursor: z.unknown().optional(),
  spent: BudgetSpentSchema,
});
export type SessionIndexEntry = z.infer<typeof SessionIndexEntrySchema>;

/** Why a run ended badly. `kind` is an open string so a new failure class
 *  costs no schema change; `llm-config` and `llm-probe` are the ones the
 *  dashboard's start-time checks stamp today. */
export const RunErrorSchema = z.object({
  message: z.string(),
  kind: z.string().optional(),
});
export type RunError = z.infer<typeof RunErrorSchema>;

const RunRecordFieldsSchema = z.object({
  command: SessionCommandSchema,
  runId: z.string(),
  gitRef: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  status: RunStatusSchema,
  /**
   * How the run presents ITSELF, in the same block vocabulary its sessions'
   * outcomes use — the phase checklist is a `checklist` block, nothing more.
   * Not every phase of an agentic command is a session (spec scan's
   * discovery/tagging run before any session exists) and the dashboard can
   * only see what the run record carries, so the run process stamps its own
   * presentation here; every rewrite streams out over the existing run.json
   * tail.
   */
  display: DisplayBlocksSchema.optional(),
  /** The run process's pid — the OSS reconciliation sweep's liveness probe
   *  (nothing stays `running` on a dead process's memory). EE's
   *  table store tracks liveness its own way and may omit it. */
  pid: z.number().int().optional(),
  /** The live session API while the process runs — a URL plus auth token,
   *  never a bare port, so the EE runner's service endpoint fits the field. */
  endpoint: z.object({ url: z.string(), token: z.string() }).optional(),
  /**
   * What the run's sessions ran on: the transport MODE the config selected
   * (`claude-code` | `api` — a string here, since the mode enum is core's)
   * plus the driver's own attribution. Optional because a run recorded
   * before attribution existed reopens unchanged; declared because this
   * schema is non-strict and would otherwise strip it on reopen.
   */
  llm: z
    .object({
      mode: z.string(),
      provider: z.string(),
      model: z.string(),
      fallbackModel: z.string().optional(),
    })
    .optional(),
  /**
   * Why the run ended badly, in the record itself — the only place a surface
   * that never saw the process can read it. Optional: a run that finished
   * cleanly, or one written before the field existed, has none.
   */
  error: RunErrorSchema.optional(),
  sessions: z.array(SessionIndexEntrySchema),
});

/**
 * A run record, read tolerantly.
 *
 * `progress` is a legacy shape, not a live field: runs written before the
 * checklist became a display block carry their phases there. Lifting it into a
 * `checklist` block on the way in is what keeps such a run readable — the boot
 * sweep rewrites every record it touches, so anything dropped at parse is
 * erased from disk on the next boot.
 */
export const RunRecordSchema = z.preprocess((raw) => {
  if (typeof raw !== 'object' || raw === null) return raw;
  const record = raw as Record<string, unknown>;
  if (record.display !== undefined || !Array.isArray(record.progress)) return raw;
  return { ...record, display: { blocks: [{ kind: 'checklist', items: record.progress }] } };
}, RunRecordFieldsSchema);
export type RunRecord = z.infer<typeof RunRecordFieldsSchema>;

/**
 * What the policy shell needs from a store — file-backed in OSS (core),
 * table-backed in EE. Implementations must boot with the reconciliation
 * sweep: a run left `running` by a dead process is marked
 * interrupted, and nothing stays `running` or `waiting` on the strength of
 * a dead process's memory.
 */
export interface SessionPersistence {
  appendEvent(sessionId: string, event: SessionEvent): void;
  updateIndex(entry: SessionIndexEntry): void;
  /** Full transcript read-back; tolerates (drops) a crash-truncated final
   *  line, which the per-session `seq` makes detectable. */
  readEvents(sessionId: string): SessionEvent[];
}
