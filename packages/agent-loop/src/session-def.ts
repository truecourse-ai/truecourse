/**
 * The session definition — what a workstream registers per session type:
 * prompt, tools, outcome schema, and the
 * three numbers (turn budget, maxResumes, token ceiling). Consumed by the
 * policy shell (`runAgentLoop`) and realized by a `SessionDriver`.
 *
 * Tools and session kinds are declared at module level and register
 * themselves on import (`defineToolSpec`, `defineSessionKind`), so every
 * schema a model can be sent is enumerable without running a session. A def
 * holds only tools bound from a registered spec.
 */

import type { z } from 'zod';
import type { BudgetSpent, SessionFailure, UserInputQuestion, SessionEvent } from './session-events.js';
import type { KnownDisplayBlock, ToolDisplay } from './session-presentation.js';
import type { SessionImage } from './session-driver.js';
import { BOUND_TOOL } from './tool-brand.js';

/** What a tool hands back to the model. An error result is an observation
 *  the session ingests and revises on — never a session failure. */
export interface SessionToolResult {
  content: string;
  isError?: boolean;
  /** Durable tool evidence, recorded for resume but not sent back to the model. */
  artifact?: unknown;
}

/** Per-invocation context the shell provides to a tool's `execute`. */
export interface ToolContext {
  /** Durable events from this session and its explicit resume parent only. */
  readEvents?(): readonly SessionEvent[];
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
    /** Images the child must LOOK at, shown with its first message. */
    images?: readonly SessionImage[],
  ): Promise<SessionOutcome<TOutcome>>;
}

/**
 * What a tool IS, independent of any one session: the fields a module declares
 * once, at load. Identity is DECLARED — `kind` plus the read-only/destructive
 * hints — never inferred from the name downstream. `inputSchema` is always
 * static, so every schema a model can be sent is known without running a
 * session.
 */
export interface ToolSpecFields<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly name: string;
  readonly description: string;
  /** What the tool IS (e.g. `read-doc-section`, `run-scenario`). */
  readonly kind: string;
  readonly readOnly: boolean;
  readonly destructive: boolean;
  readonly inputSchema: TSchema;
  /** How a call to this tool reads in a transcript. Absent ⇒ the reader
   *  phrases it from the name. */
  readonly display?: ToolDisplay;
  /**
   * The input schema is too large for a provider that compiles a schema into
   * a constrained decoder with a size limit. Declared by the tool's owner; the
   * provider decides what it does with a request carrying one.
   */
  readonly largeInputSchema?: true;
}

/**
 * What one session supplies when it binds a spec: the `execute` that closes
 * over the session's own state, and the wording, when it depends on that
 * state, in place of the spec's.
 */
export interface ToolBinding<TSchema extends z.ZodTypeAny> {
  execute(args: z.infer<TSchema>, ctx: ToolContext): Promise<SessionToolResult>;
  description?: string;
  display?: ToolDisplay;
}

/** A registered tool spec; `bind` makes the tool a session runs. */
export interface ToolSpec<TSchema extends z.ZodTypeAny = z.ZodTypeAny> extends ToolSpecFields<TSchema> {
  bind(binding: ToolBinding<TSchema>): SessionTool;
}

/**
 * One tool a session may call: a spec bound to one session. One tool compiles
 * to both the api driver's toolset and the SDK driver's in-process MCP server;
 * the shell validates args against `inputSchema` before `execute` runs in
 * either driver. Only {@link ToolSpec.bind} makes one.
 */
export interface SessionTool extends ToolSpecFields {
  execute(args: unknown, ctx: ToolContext): Promise<SessionToolResult>;
  readonly [BOUND_TOOL]: true;
}

const toolSpecs: ToolSpec[] = [];
const sessionKinds: SessionKindSpec[] = [];

/**
 * Declare a tool at module level and register it. `bind` ties `execute`'s
 * argument type to `inputSchema`, so tool authors get inference without casts
 * (method bivariance makes the erased `SessionTool` sound in practice: args
 * are schema-validated before dispatch).
 */
export function defineToolSpec<TSchema extends z.ZodTypeAny>(fields: ToolSpecFields<TSchema>): ToolSpec<TSchema> {
  const spec: ToolSpec<TSchema> = {
    ...fields,
    bind: (binding) => {
      const display = binding.display ?? fields.display;
      return {
        ...fields,
        description: binding.description ?? fields.description,
        ...(display ? { display } : {}),
        execute: binding.execute,
        [BOUND_TOOL]: true,
      };
    },
  };
  toolSpecs.push(spec);
  return spec;
}

/**
 * A session kind as the model sees it: its name and the schema its outcome is
 * validated against, plus the compact wire shape when the model answers in a
 * different one (`SessionDef.outcomeInputSchema`). Two specs may share a
 * `kind` when one kind answers in two shapes.
 */
export interface SessionKindSpec<TOutcome = unknown> {
  readonly kind: string;
  readonly outcomeSchema: z.ZodType<TOutcome, z.ZodTypeDef, unknown>;
  readonly outcomeInputSchema?: z.ZodTypeAny;
  /** The schema the model answers in is too large for a size-limited
   *  constrained decoder; see `ToolSpecFields.largeInputSchema`. */
  readonly largeOutcomeSchema?: true;
}

/** Declare a session kind at module level and register it. A def spreads it. */
export function defineSessionKind<TOutcome>(spec: SessionKindSpec<TOutcome>): SessionKindSpec<TOutcome> {
  sessionKinds.push(spec);
  return spec;
}

/** Every tool spec registered by the modules loaded so far. */
export function registeredToolSpecs(): readonly ToolSpec[] {
  return toolSpecs;
}

/** Every session kind registered by the modules loaded so far. */
export function registeredSessionKinds(): readonly SessionKindSpec[] {
  return sessionKinds;
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

/** How hard the model should think per turn; each provider maps it to its own setting. */
export type ReasoningLevel = 'low' | 'medium' | 'high';

/**
 * The backend's own shell and file tools a session may be handed. `TaskOutput`
 * and `TaskStop` read and stop a command `Bash` started in the background,
 * which is how a session keeps a server running while it works against it.
 */
export const COMPUTER_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'TaskOutput',
  'TaskStop',
] as const;
export type ComputerTool = (typeof COMPUTER_TOOLS)[number];

/**
 * A COMPUTER for the session: a real shell and the files under `cwd`, through
 * the backend's own tools rather than tools this product defines. The session
 * runs whatever commands it decides to, with this process's privileges, so a
 * def carries one only when its work is to operate a checkout: boot a product,
 * write a test and run it.
 *
 * Only a backend that HAS such tools can run the session; one that does not
 * refuses it before spending anything. Calls to these tools never pass through
 * `SessionTool.execute`, so the clocks that wait on a running tool do not see
 * them: bound such a session by `timeoutMs`, not by the stall or turn clock.
 */
export interface SessionComputer {
  /** Where the shell starts and relative paths resolve. */
  cwd: string;
  tools: readonly ComputerTool[];
  /**
   * The WHOLE environment the shell's commands run in, `PATH` and `HOME`
   * included. Nothing of this process's own environment is inherited beyond
   * it, except what the backend needs to reach its model: the commands are a
   * stranger's install scripts and servers, and this process's secrets are not
   * theirs to read.
   */
  env: Readonly<Record<string, string>>;
}

export interface SessionDef<TOutcome = unknown> {
  /** Session type, `<command>.<task>` (e.g. `spec-scan.curation`). */
  kind: string;
  systemPrompt: string;
  tools: readonly SessionTool[];
  /** The shell and files this session works with; see {@link SessionComputer}.
   *  Absent ⇒ the session has `tools` and nothing else. */
  computer?: SessionComputer;
  /** A session cannot end without an outcome this schema accepts. Typed on
   *  what it PRODUCES, not on what it takes: a schema that coerces or fills
   *  defaults reads a shape of its own, and the shell only ever hands it the
   *  model's raw value. */
  outcomeSchema: z.ZodType<TOutcome, z.ZodTypeDef, unknown>;
  /** Optional compact wire representation; the shell still validates the resolved outcome. */
  outcomeInputSchema?: z.ZodTypeAny;
  /** The schema the model answers in is too large for a size-limited
   *  constrained decoder (declared on the session kind). */
  largeOutcomeSchema?: true;
  resolveOutcome?(value: unknown, events: readonly SessionEvent[]): unknown;
  /** Opt-in bounded repair of malformed terminal objects, under the same budget. */
  outcomeSchemaRepairs?: number;
  /** Validate live task state before accepting a schema-valid terminal outcome.
   * A rejection resumes the same transcript under the existing cumulative budget;
   * `wrappingUp` says the budget is spent and only the wrap-up turns remain. */
  validateOutcome?(outcome: TOutcome, context: { wrappingUp: boolean }): string | undefined | Promise<string | undefined>;
  budget: SessionBudget;
  /** Declared reasoning effort. Absent ⇒ the provider's default. */
  reasoning?: ReasoningLevel;
  /** May wait on user input. Non-interactive runs never block. */
  interactive?: boolean;
  /** The short name of this KIND of work ("Scenario author") and the session's
   *  opening line. Both are finished strings, not templates: the def factory
   *  already has the work item when it builds this. */
  display?: { title?: string; intro?: string };
  /**
   * How this session's outcome reads. Typed against `outcomeSchema`, so a
   * schema change breaks the presenter at compile time instead of drifting
   * into a digest that silently reads a field nobody writes. Runs once, at
   * emit; a throw is recorded on the event and never fails the session.
   */
  presentOutcome?: (outcome: TOutcome) => KnownDisplayBlock[];
  /**
   * A structural demand that `tool` was called before the outcome is accepted
   * Exists because prompting alone did not carry it: across 110
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
