/**
 * The sessions store record shapes (AGENTIC_PIPELINE_PLAN §3.9):
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

export const SessionCommandSchema = z.enum([
  'spec-scan',
  'guard-setup',
  'guard-generate',
  // Interface authoring (SPEC_GUARD_PLAN item 104) — the web tasks no
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
  /** Driver-owned resume pointer (§3.3) — opaque to everything else. */
  resumeCursor: z.unknown().optional(),
  spent: BudgetSpentSchema,
});
export type SessionIndexEntry = z.infer<typeof SessionIndexEntrySchema>;

export const RunRecordSchema = z.object({
  command: SessionCommandSchema,
  runId: z.string(),
  gitRef: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  status: RunStatusSchema,
  /** The run process's pid — the OSS reconciliation sweep's liveness probe
   *  (§3.9: nothing stays `running` on a dead process's memory). EE's
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
  sessions: z.array(SessionIndexEntrySchema),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

/**
 * What the policy shell needs from a store — file-backed in OSS (core),
 * table-backed in EE. Implementations must boot with the reconciliation
 * sweep of §3.9: a run left `running` by a dead process is marked
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
