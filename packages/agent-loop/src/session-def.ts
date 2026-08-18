/**
 * The session definition — what a workstream registers per session type
 * (AGENTIC_PIPELINE_PLAN §3.2/§3.3): prompt, tools, outcome schema, and the
 * three numbers (turn budget, maxResumes, token ceiling). Consumed by the
 * policy shell (`runAgentLoop`) and realized by a `SessionDriver`.
 */

import type { z } from 'zod';
import type { BudgetSpent, SessionFailure, UserInputQuestion } from './session-events.js';

/** What a tool hands back to the model. An error result is an observation
 *  the session ingests and revises on — never a session failure. */
export interface SessionToolResult {
  content: string;
  isError?: boolean;
}

/** Per-invocation context the shell provides to a tool's `execute`. */
export interface ToolContext {
  /** The work item this session serves (a doc path, an area, a flow id). */
  workItem: string;
  signal: AbortSignal;
  /**
   * Run a child session as a tool (§3.7's orchestrator pattern). Depth 1
   * only: a child calling this is a structured error the parent sees as a
   * tool result. A child's failure returns as a failed outcome, never a
   * thrown error.
   */
  dispatchChild<TOutcome>(
    def: SessionDef<TOutcome>,
    initialMessages: readonly string[],
  ): Promise<SessionOutcome<TOutcome>>;
}

/**
 * One tool a session may call. Identity is DECLARED — `kind` plus the
 * read-only/destructive hints — never inferred from the name downstream.
 * One definition compiles to both the api driver's toolset and the SDK
 * driver's in-process MCP server; the shell validates args against
 * `inputSchema` before `execute` runs in either driver.
 */
export interface SessionTool {
  name: string;
  description: string;
  /** What the tool IS (e.g. `read-doc-section`, `run-scenario`). */
  kind: string;
  readOnly: boolean;
  destructive: boolean;
  inputSchema: z.ZodTypeAny;
  execute(args: unknown, ctx: ToolContext): Promise<SessionToolResult>;
}

/**
 * Builder that ties `execute`'s argument type to `inputSchema` so tool
 * authors get inference without casts (method bivariance makes the erased
 * `SessionTool` assignment sound in practice: args are schema-validated
 * before dispatch).
 */
export function defineSessionTool<TSchema extends z.ZodTypeAny>(tool: {
  name: string;
  description: string;
  kind: string;
  readOnly: boolean;
  destructive: boolean;
  inputSchema: TSchema;
  execute(args: z.infer<TSchema>, ctx: ToolContext): Promise<SessionToolResult>;
}): SessionTool {
  return tool;
}

/**
 * The three numbers each session type sets (§3.3): the per-grant turn
 * budget, the automatic resume count (effective hard limit =
 * `(maxResumes + 1) × turns`), and the token ceiling the shell enforces
 * between turns.
 */
export interface SessionBudget {
  turns: number;
  maxResumes: number;
  tokenCeiling: number;
}

export interface SessionDef<TOutcome = unknown> {
  /** Session type, `<command>.<task>` (e.g. `spec-scan.curation`). */
  kind: string;
  systemPrompt: string;
  tools: readonly SessionTool[];
  /** A session cannot end without an outcome this schema accepts. */
  outcomeSchema: z.ZodType<TOutcome>;
  budget: SessionBudget;
  /** May wait on user input (§3.7). Non-interactive runs never block. */
  interactive?: boolean;
  /**
   * A structural demand that `tool` was called before the outcome is accepted
   * (01 step 2k). Exists because prompting alone did not carry it: across 110
   * authoring sessions the median first validator call was turn 9 despite the
   * prompt demanding it "EARLY", and 8 sessions never called it at all.
   *
   * When set and an outcome arrives with no `tool-result` for `tool` in this
   * session (a resumed-from prior transcript counts), the shell refuses the
   * outcome and feeds `message` back so the session can comply — a real round
   * trip that consumes a turn under the ordinary budget. The refusal is NOT a
   * malformed turn: a session that skipped a step is told and allowed to
   * continue. It fires at most once per session — a second outcome proceeds
   * through normal schema validation whether or not the tool was called, and a
   * session that burns its budget still refusing ends `budget-exhausted`, the
   * honest result. Absent ⇒ behavior identical to before the field existed.
   */
  outcomePrecondition?: { tool: string; message: string };
}

/**
 * What `runAgentLoop` resolves to — always, for every session. Failures are
 * data with a resume path, never exceptions.
 */
export type SessionOutcome<TOutcome = unknown> =
  | {
      status: 'completed';
      output: TOutcome;
      /** Questions policy could not settle (§3.7) — reported loudly. */
      pendingQuestions: readonly UserInputQuestion[];
      spent: BudgetSpent;
    }
  | {
      status: 'failed';
      failure: SessionFailure;
      /** Whether resume (a fresh grant over the persisted state) can continue it. */
      resumable: boolean;
      spent: BudgetSpent;
    };
