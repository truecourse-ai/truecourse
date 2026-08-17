/**
 * The session-driver contract — the provider seam of the agentic pipeline
 * (AGENTIC_PIPELINE_PLAN §3.3, decisions 2026-08-17). A driver owns the
 * MECHANICS of running one session against one backend; the policy shell
 * (`runAgentLoop`) owns the SEMANTICS: budgets, ceilings, resume grants,
 * the malformed policy, sequence stamping, and sub-session depth.
 *
 * Two implementations, kept semantically one by the conformance suite:
 * the api driver (per-turn loop, `packages/llm-api`) and the Agent SDK
 * driver (`packages/llm-claude-agent`).
 */

import type { SessionDef } from './session-def.js';
import type {
  SessionEvent,
  SessionEventBody,
  SessionFailure,
  SessionStatus,
} from './session-events.js';

/**
 * What a driver can and cannot do — declared facts the shell reads, never
 * an engine `if` on the driver's name.
 */
export interface DriverCapabilities {
  /** `live`: a steer joins the running turn; `turn-boundary`: it waits. */
  steering: 'live' | 'turn-boundary';
  /** How the structured outcome is obtained: the backend's native output
   *  format, or an outcome tool the model must call. */
  structuredOutcome: 'native' | 'tool';
  /** Whether resume can target a point inside the conversation. */
  resumeAtMessage: boolean;
}

/** How a session continues (§3.3: resume is a fresh budget grant). */
export interface SessionResume {
  /** Opaque, owned and interpreted only by the driver; persisted in the
   *  session index. The SDK driver stores its provider session pointer
   *  here; the api driver may not need one. */
  cursor?: unknown;
  /** The persisted transcript — audit truth. The api driver rebuilds its
   *  message history from it; the SDK driver resumes by cursor instead. */
  events: readonly SessionEvent[];
}

export interface SessionRunInput {
  def: SessionDef;
  initialMessages: readonly string[];
  resume?: SessionResume;
  /** Drivers emit event BODIES as they happen; the shell stamps seq + ts
   *  and persists. Full content, never summaries. */
  onEvent(event: SessionEventBody): void;
  signal: AbortSignal;
}

/**
 * A driver's terminal result. Semantic failures resolve (as `failure`),
 * they never reject — `done` rejecting is reserved for defects in the
 * driver itself.
 */
export type DriverResult =
  | { kind: 'outcome'; value: unknown; resumeCursor?: unknown }
  | { kind: 'failure'; failure: SessionFailure; resumeCursor?: unknown };

export interface SessionHandle {
  done: Promise<DriverResult>;
  /** Observable state; turn end is derived from its transitions, never
   *  trusted from a provider turn event alone. */
  status(): SessionStatus;
  /** Deliver a user message; timing per `capabilities.steering`. The
   *  transcript records it at the moment the session ingests it. */
  steer(message: string): void;
  /** Stop after the in-flight turn settles — the shell's enforcement lever
   *  for budgets and ceilings. */
  interrupt(): Promise<void>;
}

export interface SessionDriver {
  capabilities: DriverCapabilities;
  runSession(input: SessionRunInput): SessionHandle;
}
