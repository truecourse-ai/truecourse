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

export const SessionCommandSchema = z.enum(['spec-scan', 'guard-setup', 'guard-generate']);
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
  /** The live session API while the process runs — a URL plus auth token,
   *  never a bare port, so the EE runner's service endpoint fits the field. */
  endpoint: z.object({ url: z.string(), token: z.string() }).optional(),
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
