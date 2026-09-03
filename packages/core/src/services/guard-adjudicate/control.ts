/**
 * THE VERIFICATION CHILD — `guard-adjudicate.control` (plan 05 step 22), a
 * depth-1 session the parent adjudicator dispatches when it leans `bug` at
 * medium-or-better confidence. Fresh context IS the independence (§3.4 — same
 * model): the child is told the suspected mechanism and asked the one question
 * that matters — what result would DISPROVE the bug — and given exactly one
 * tool to answer it with.
 *
 * PROOF-CLASS, so NEVER CACHED: the whole value of a control is that it ran
 * against the live world just now.
 *
 * `run_control` executes a MODIFIED scenario, parse-gated like the loader
 * (schema + regex-compile check), `persist: false` in a fresh world — the
 * modified scenario NEVER enters the corpus, the board, or any store. Hard cap
 * {@link CONTROL_MAX_EXECUTIONS} executions per child.
 */

import { z } from 'zod';
import yaml from 'js-yaml';
import { defineSessionTool, type SessionBudget, type SessionDef, type SessionTool } from '@truecourse/agent-loop';
import { GuardScenarioSchema, firstInvalidMatchPattern, guardExecutionSteps } from '@truecourse/shared';
import { executeOneScenario, type AdjudicationExecution } from './execute.js';

export const CONTROL_SESSION_KIND = 'guard-adjudicate.control';

/** Hard cap on `run_control` executions per child — a control is one or two
 *  discriminating runs, never a search. */
export const CONTROL_MAX_EXECUTIONS = 3;

export const CONTROL_BUDGET: SessionBudget = {
  turns: 8,
  maxResumes: 0,
  tokenCeiling: 100_000,
};

/**
 * The child's outcome — a plain strict object (never a root union: the
 * drivers' provider surfaces require an OBJECT root). It returns to the parent
 * as the dispatch result; the parent folds a `refutes` into a downgraded class.
 */
export const GuardControlOutcomeSchema = z
  .object({
    conclusion: z.enum(['confirms', 'refutes', 'inconclusive']),
    reasoning: z.string().min(1),
  })
  .strict();
export type GuardControlOutcome = z.infer<typeof GuardControlOutcomeSchema>;

export const CONTROL_SYSTEM_PROMPT = `You are a CONTROL EXPERIMENTER for a suspected code bug.

A colleague adjudicating a failing scenario suspects a bug with a specific
mechanism. Your ONE job is to try to DISPROVE it: design the experiment whose
result would refute the mechanism if the code were actually correct, run it,
and conclude honestly.

Rules:
- You are handed the committed scenario (YAML) and the suspected mechanism.
  Modify the scenario into a DISCRIMINATING experiment: change exactly what
  isolates the mechanism (a different input, a control value, the inverse
  precondition), keep everything incidental identical.
- \`run_control\` executes your modified scenario once in a fresh, disposable
  world. Nothing you run is ever persisted. You get at most ${CONTROL_MAX_EXECUTIONS} executions —
  design before you run.
- Conclude from what RAN, never from what you expected:
  - "confirms"     — the experiment behaved as the bug mechanism predicts.
  - "refutes"      — the experiment behaved as CORRECT code predicts.
  - "inconclusive" — the experiment could not discriminate (infrastructure got
    in the way, or the result is compatible with both readings). An honest
    inconclusive beats a guessed confirm.

End the session with exactly one outcome object:
{ "conclusion": "confirms" | "refutes" | "inconclusive", "reasoning": "<what you ran and what it showed>" }`;

/** The child's opening message: the mechanism, the scenario, the question. */
export function controlBriefing(input: {
  mechanism: string;
  disprove: string;
  scenarioYaml: string;
  scenarioId: string;
}): string {
  return [
    `# Suspected bug — scenario \`${input.scenarioId}\``,
    '',
    '## The suspected mechanism',
    input.mechanism,
    '',
    '## The discriminating question (what result would DISPROVE the bug?)',
    input.disprove,
    '',
    '## The committed scenario (modify this into your experiment)',
    '```yaml',
    input.scenarioYaml.trimEnd(),
    '```',
  ].join('\n');
}

/**
 * `run_control` — parse-gate then one persist-nothing execution. The parse
 * gate is the loader's: the full scenario schema (the child edits the
 * committed yaml, ids and binds included) plus the regex-compile check, so a
 * malformed experiment costs a turn, never a sandbox.
 */
function runControlTool(exec: AdjudicationExecution, state: { executions: number }): SessionTool {
  return defineSessionTool({
    name: 'run_control',
    description:
      `Run a MODIFIED scenario once in a fresh disposable world (never persisted, never entering the corpus). ` +
      `Pass the FULL scenario YAML (edit the committed one you were briefed with). ` +
      `A parse defect returns as an error without an execution. At most ${CONTROL_MAX_EXECUTIONS} executions per session.`,
    kind: 'run-control',
    // Executes the program under test in a disposable sandbox; repo and store
    // state are never written — persist:false is structural, not advisory.
    readOnly: true,
    destructive: false,
    inputSchema: z.object({ yaml: z.string().min(1) }).strict(),
    async execute(args) {
      if (state.executions >= CONTROL_MAX_EXECUTIONS) {
        return {
          content: `execution cap reached (${CONTROL_MAX_EXECUTIONS} per control session) — conclude from what already ran.`,
          isError: true,
        };
      }
      let doc: unknown;
      try {
        doc = yaml.load(args.yaml);
      } catch (e) {
        return { content: `YAML parse error: ${e instanceof Error ? e.message : String(e)}`, isError: true };
      }
      const parsed = GuardScenarioSchema.safeParse(doc);
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ');
        return { content: `the scenario does not parse: ${detail}`, isError: true };
      }
      const badRe = firstInvalidMatchPattern(guardExecutionSteps(parsed.data));
      if (badRe) {
        return {
          content: `step ${badRe.step} ${badRe.where} /${badRe.pattern}/ is not a valid regular expression: ${badRe.error}`,
          isError: true,
        };
      }
      state.executions++;
      return executeOneScenario(exec, parsed.data);
    },
  });
}

export function controlSessionDef(exec: AdjudicationExecution): SessionDef<GuardControlOutcome> {
  const state = { executions: 0 };
  return {
    kind: CONTROL_SESSION_KIND,
    systemPrompt: CONTROL_SYSTEM_PROMPT,
    tools: [runControlTool(exec, state)],
    outcomeSchema: GuardControlOutcomeSchema,
    budget: CONTROL_BUDGET,
    // A conclusion from a control that never ran anything is no control at all.
    outcomePrecondition: {
      tool: 'run_control',
      message:
        'Outcome refused: you never ran `run_control` in this session. A control conclusion must come from an ' +
        'experiment that executed — run your discriminating scenario once, then conclude.',
    },
  };
}
