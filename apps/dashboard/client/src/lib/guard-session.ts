/**
 * The worker-session transcript's client-side vocabulary and merge logic.
 *
 * `GuardSessionEvent` mirrors `AgentLoopEvent` (packages/shared/src/llm/
 * agent-loop.ts), which the shared package does not export to the browser —
 * transcripts arrive as parsed JSONL of unknown provenance anyway, so the pane
 * narrows structurally and renders any line it does not recognize as raw JSON
 * rather than dropping it.
 *
 * Merging: the backfill route and the live `guard:transcript` socket batches
 * both index events by transcript line (`seq` = the batch's first index), so a
 * live batch overlapping the backfill lands on the same slots — idempotent, no
 * duplicate detection, order independent.
 */

export interface GuardSessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number;
}

export type GuardSessionEvent =
  | { kind: 'init'; ts: string; system: string; user: string; tools: string[]; model?: string; resumed?: boolean }
  | { kind: 'reply'; ts: string; turn: number; text: string; toolCall?: { name: string; arguments: unknown }; usage?: GuardSessionUsage }
  | { kind: 'tool'; ts: string; turn: number; name: string; args: unknown; result: string; durationMs: number }
  | { kind: 'reask'; ts: string; turn: number; detail: string }
  | { kind: 'outcome'; ts: string; turn: number; outcome: unknown }
  | { kind: 'end'; ts: string; status: string; turns: number; usage: GuardSessionUsage & { turns: number }; detail?: string };

/** The `guard:transcript` socket payload. */
export interface GuardTranscriptBatch {
  repoId?: string;
  runId: string;
  flowId: string;
  surface: string;
  seq: number;
  events: unknown[];
}

const KINDS = new Set(['init', 'reply', 'tool', 'reask', 'outcome', 'end']);

/** Narrow one parsed JSONL line; unknown shapes render as raw JSON, not gaps. */
export function asSessionEvent(value: unknown): GuardSessionEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === 'string' && KINDS.has(kind) ? (value as GuardSessionEvent) : null;
}

/**
 * Mirror of guard-runner's `sanitizeSegment`: the transcript filename segments
 * the tail parses back are SANITIZED forms, so matching a socket batch against
 * a raw flow id / run id must sanitize the same way.
 */
export function sanitizeTranscriptSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Apply one indexed batch over the accumulated transcript (sparse-safe). */
export function mergeTranscriptBatch(
  prev: readonly (unknown | undefined)[],
  seq: number,
  events: readonly unknown[],
): (unknown | undefined)[] {
  if (events.length === 0) return [...prev];
  const next = [...prev];
  for (let i = 0; i < events.length; i++) next[seq + i] = events[i];
  return next;
}

/** True when a socket batch belongs to the (runId, flowId, surface) pane. */
export function batchMatches(
  batch: Partial<GuardTranscriptBatch>,
  runId: string,
  flowId: string,
  surface: string,
): batch is GuardTranscriptBatch {
  return (
    batch.runId === sanitizeTranscriptSegment(runId) &&
    batch.flowId === sanitizeTranscriptSegment(flowId) &&
    batch.surface === sanitizeTranscriptSegment(surface) &&
    typeof batch.seq === 'number' &&
    Array.isArray(batch.events)
  );
}
