/**
 * The session-driver contract — the provider seam of the agentic pipeline.
 * A driver owns the
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
  RawPayload,
  SessionEvent,
  SessionEventBody,
  SessionFailure,
  SessionLlm,
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

/** How a session continues (resume is a fresh budget grant). */
export interface SessionResume {
  /** Opaque, owned and interpreted only by the driver; persisted in the
   *  session index. The SDK driver stores its provider session pointer
   *  here; the api driver may not need one. */
  cursor?: unknown;
  /** The persisted transcript — audit truth. The api driver rebuilds its
   *  message history from it; the SDK driver resumes by cursor instead. */
  events: readonly SessionEvent[];
}

/**
 * A prompt prefix several sessions SHARE: messages
 * that lead the conversation identically for every session of a cluster, and
 * the name that cluster caches under.
 *
 * It is separate from `initialMessages` because WHICH messages are shared is
 * what a driver needs to know: the providers that cache by prefix content take
 * a breakpoint at the end of the shared part (a breakpoint on a per-session
 * message caches nothing twice), and the providers that cache per request take
 * `cacheKey` as the cluster's routing hint. A driver with neither mechanism
 * simply sends the messages first, which is what they are.
 */
export interface SharedPromptPrefix {
  /** Sent ahead of `initialMessages`, byte-identical across the cluster. */
  messages: readonly string[];
  /** Names the cluster for the providers that key their prompt cache per request. */
  cacheKey: string;
}

export interface SessionRunInput {
  def: SessionDef;
  initialMessages: readonly string[];
  /** The cluster prefix this session opens with, when it belongs to one. */
  sharedPrefix?: SharedPromptPrefix;
  resume?: SessionResume;
  /** Drivers emit event BODIES as they happen; the shell stamps seq + ts
   *  and persists. Full content, never summaries. A driver may attach the
   *  raw escape hatch — its native wire payload — which the shell
   *  carries onto the persisted envelope. */
  onEvent(event: SessionEventBody & { raw?: RawPayload }): void;
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
  /**
   * What this driver will call — the same doctrine as `capabilities`:
   * declared DATA the shell reads and stamps onto `session-start`, never an
   * engine `if` on the driver's name. Credentials are not part of it.
   */
  attribution: SessionLlm;
  runSession(input: SessionRunInput): SessionHandle;
}
