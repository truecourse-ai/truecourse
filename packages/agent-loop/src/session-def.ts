/**
 * The session definition — what a workstream registers per session type:
 * prompt, tools, outcome schema, and the
 * three numbers (turn budget, maxResumes, token ceiling). Consumed by the
 * policy shell (`runAgentLoop`) and realized by a `SessionDriver`.
 */

import type { z } from 'zod';
import type { BudgetSpent, SessionFailure, UserInputQuestion } from './session-events.js';
import type { OutcomeBlock, ToolDisplay } from './session-presentation.js';

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
   * Run a child session as a tool (orchestrator pattern). Depth 1
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
  /** How a call to this tool reads in a transcript. Colocated with the tool
   *  because tools are factory-built per def, so wording can differ per def
   *  for the same tool. Absent ⇒ the reader phrases it from the name. */
  display?: ToolDisplay;
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
  display?: ToolDisplay;
  execute(args: z.infer<TSchema>, ctx: ToolContext): Promise<SessionToolResult>;
}): SessionTool {
  return tool;
}

/**
 * The three numbers each session type sets: the per-grant turn
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
  /** May wait on user input. Non-interactive runs never block. */
  interactive?: boolean;
  /** The session's opening line. A finished string, not a template: the def
   *  factory already has the work item when it builds this. */
  display?: { intro?: string };
  /**
   * How this session's outcome reads. Typed against `outcomeSchema`, so a
   * schema change breaks the presenter at compile time instead of drifting
   * into a digest that silently reads a field nobody writes. Runs once, at
   * emit; a throw is recorded on the event and never fails the session.
   */
  presentOutcome?: (outcome: TOutcome) => OutcomeBlock[];
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
  /**
   * A structural mid-budget draft checkpoint, `outcomePrecondition`'s
   * in-flight sibling. Exists because briefing prose did not carry it either:
   * setup sessions died at the ceiling with 20+ pure-exploration turns and
   * zero drafts (documenso catalog twice, strapi recipe — 2026-08-21 bench),
   * with the one draft, when it came at all, arriving too late to act on.
   *
   * When set and the session's `afterTurn`-th assistant turn completes with no
   * `tool-result` for `tool` yet (a resumed-from prior transcript counts), the
   * shell steers `message` into the session — a user message the driver
   * ingests at its next steering point, consuming no extra budget of its own.
   * Fires at most once per session and never after the shell has decided to
   * stop it. Absent ⇒ behavior identical to before the field existed.
   */
  draftCheckpoint?: { tool: string; afterTurn: number; message: string };
}

/**
 * What `runAgentLoop` resolves to — always, for every session. Failures are
 * data with a resume path, never exceptions.
 */
export type SessionOutcome<TOutcome = unknown> =
  | {
      status: 'completed';
      output: TOutcome;
      /** Questions policy could not settle — reported loudly. */
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
