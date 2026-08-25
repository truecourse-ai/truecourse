/**
 * THE ADJUDICATION SESSION'S TOOLS (plan 05 step 21) — every one read-only
 * against repo and store state; the one that spawns anything
 * (`rerun_scoped`) runs `persist: false` in a disposable world. All writes
 * happen in the fold, strictly serial, after the outcome.
 *
 *  - `read_evidence`  — one file of THIS failure's evidence bundle,
 *    path-contained to `guard/evidence/<runId>/<scenarioId>/` through the
 *    guard store's confined readers. Binary files (screenshots, video) are
 *    refused with a pointer at `visual_judge`.
 *  - `read_file` / `search_repo` — the repo at arm's length (the interface
 *    authoring tools, reused verbatim): the mechanism hunt that ends in a
 *    `file:line`.
 *  - `rerun_scoped`   — the committed scenario re-executed VERBATIM, fresh
 *    sandbox/server lane, persist-nothing: the flake discriminator. Hard cap
 *    {@link RERUN_MAX} per session.
 *  - `visual_judge`   — the existing cached vision judge over one step's
 *    screenshot; how a session "looks at" a PNG without pulling bytes into
 *    its context.
 *  - `verify_bug`     — dispatches the CONTROL CHILD (step 22) and stashes the
 *    engine's record of its conclusion under an engine-minted reference; a
 *    `bug` outcome at ≥ medium confidence must cite a stashed ref (the fold
 *    refuses one the engine never ran).
 */

import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineSessionTool, type SessionTool } from '@truecourse/agent-loop';
import { evidenceScenarioDir } from '@truecourse/guard-runner';
import { readGuardEvidenceAt } from '../../lib/guard-store.js';
import { readFileTool, searchTool } from '../interface-author/tools.js';
import { resolveModel, resolveFallbackModel } from '../../config/llm-models.js';
import {
  runVisualJudge,
  spawnVisualJudgeRunner,
  resolveVisualJudgeTransport,
} from '../llm/guard-visual-judge.js';
import { describeSessionFailure } from '../guard-setup/session-context.js';
import { readInvocation } from './evidence.js';
import { executeOneScenario, type AdjudicationExecution } from './execute.js';
import { controlBriefing, controlSessionDef, type GuardControlOutcome } from './control.js';
import type { AdjudicationItem } from './pre-pass.js';

/** Hard cap on `rerun_scoped` calls per session — flake discrimination is one
 *  or two runs; anything past that is thrash the evidence should answer. */
export const RERUN_MAX = 2;

/** Cap on what one `read_evidence` call hands back (context is the budget). */
const MAX_EVIDENCE_CHARS = 20_000;

/** Extensions `read_evidence` refuses — the visual artifacts have their own tool. */
const BINARY_EVIDENCE = /\.(png|jpe?g|webm|mp4|gif)$/i;

/**
 * One control the engine actually ran, keyed by the engine-minted reference
 * the tool result named. The fold verifies a fresh `bug` outcome's
 * `control.transcriptRef` (and its conclusion) against THIS — never against
 * the model's restatement.
 */
export interface ControlRecord {
  conclusion: GuardControlOutcome['conclusion'];
  reasoning: string;
}

/** Per-session mutable state the fold reads back after the outcome. */
export interface AdjudicationSessionState {
  reruns: number;
  /** Engine-minted control reference → the engine's record of that control. */
  controls: Map<string, ControlRecord>;
}

export function newSessionState(): AdjudicationSessionState {
  return { reruns: 0, controls: new Map() };
}

export interface AdjudicationToolsInput {
  repoRoot: string;
  item: AdjudicationItem;
  exec: AdjudicationExecution;
  state: AdjudicationSessionState;
}

export function buildAdjudicationTools(input: AdjudicationToolsInput): SessionTool[] {
  return [
    readEvidenceTool(input),
    readFileTool(input.repoRoot),
    searchTool(input.repoRoot),
    rerunScopedTool(input),
    visualJudgeTool(input),
    verifyBugTool(input),
  ];
}

// ---------------------------------------------------------------------------
// read_evidence — the bundle, one contained file at a time
// ---------------------------------------------------------------------------

function readEvidenceTool(input: AdjudicationToolsInput): SessionTool {
  const { repoRoot, item } = input;
  return defineSessionTool({
    name: 'read_evidence',
    description:
      'Read one file of THIS failure\'s evidence bundle (the briefing lists the file names). ' +
      'Text files only — screenshots and video are answered through `visual_judge`, never as bytes.',
    kind: 'read-evidence',
    readOnly: true,
    destructive: false,
    inputSchema: z.object({ file: z.string().min(1) }).strict(),
    async execute(args) {
      if (!item.evidenceDir) {
        return { content: 'this failure carries no evidence bundle on this machine.', isError: true };
      }
      if (BINARY_EVIDENCE.test(args.file)) {
        return {
          content: `\`${args.file}\` is a visual artifact — ask \`visual_judge\` about the step instead of reading bytes.`,
          isError: true,
        };
      }
      // The confined reader: a `../`-laced name (or one outside this failure's
      // dir) resolves to null, never to a file.
      const content = await readGuardEvidenceAt(repoRoot, item.evidenceDir, args.file);
      if (content === null) {
        return {
          content: `\`${args.file}\` is not a file of this failure's evidence bundle.`,
          isError: true,
        };
      }
      return {
        content:
          content.length > MAX_EVIDENCE_CHARS
            ? `${content.slice(0, MAX_EVIDENCE_CHARS)}\n… (truncated at ${MAX_EVIDENCE_CHARS} chars)`
            : content,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// rerun_scoped — the flake discriminator
// ---------------------------------------------------------------------------

function rerunScopedTool(input: AdjudicationToolsInput): SessionTool {
  const { item, exec, state } = input;
  return defineSessionTool({
    name: 'rerun_scoped',
    description:
      `Re-execute THIS scenario verbatim, once, in a fresh disposable world (nothing persisted). ` +
      `The flake discriminator: does the recorded failure reproduce right now? At most ${RERUN_MAX} calls per session.`,
    kind: 'rerun-scoped',
    readOnly: true,
    destructive: false,
    inputSchema: z.object({}).strict(),
    async execute() {
      if (state.reruns >= RERUN_MAX) {
        return {
          content: `rerun cap reached (${RERUN_MAX} per session) — conclude from what already ran.`,
          isError: true,
        };
      }
      if (!item.scenario) {
        return { content: 'the committed scenario is not in the corpus — nothing to re-execute.', isError: true };
      }
      state.reruns++;
      return executeOneScenario(exec, item.scenario);
    },
  });
}

// ---------------------------------------------------------------------------
// visual_judge — the cached vision verdict over one step's screenshot
// ---------------------------------------------------------------------------

function visualJudgeTool(input: AdjudicationToolsInput): SessionTool {
  const { repoRoot, item } = input;
  return defineSessionTool({
    name: 'visual_judge',
    description:
      'Ask the vision judge what one web step\'s screenshot shows against its expectation. ' +
      'Cached per failure identity, so repeating a question is free. Only steps that left a screenshot answer.',
    kind: 'visual-judge',
    readOnly: true,
    destructive: false,
    inputSchema: z.object({ step: z.number().int().positive() }).strict(),
    async execute(args) {
      if (!item.evidenceDir) {
        return { content: 'this failure carries no evidence bundle on this machine.', isError: true };
      }
      const invocation = await readInvocation(repoRoot, item.evidenceDir);
      const step = invocation?.steps.find((s) => s.index === args.step);
      if (!step?.web?.screenshot) {
        return { content: `step ${args.step} left no screenshot (not a web step, or it never rendered).`, isError: true };
      }
      // The screenshot lives beside invocation.json in this failure's own dir;
      // the filename came from the bundle itself, never from the model.
      const screenshotPath = path.join(
        evidenceScenarioDir(repoRoot, item.runId, item.scenarioId),
        step.web.screenshot,
      );
      let runner;
      try {
        runner = spawnVisualJudgeRunner({
          transport: resolveVisualJudgeTransport(),
          model: resolveModel('guard.visualJudge', undefined, repoRoot),
          fallbackModel: resolveFallbackModel(repoRoot) ?? undefined,
        });
      } catch (e) {
        return { content: `no usable vision transport: ${e instanceof Error ? e.message : String(e)}`, isError: true };
      }
      const failing = args.step === item.step;
      const outcome = await runVisualJudge(
        repoRoot,
        {
          screenshotPath,
          expectation: step.web.expectation ?? '',
          expected: failing ? item.expected : (step.web.expectation ?? ''),
          actual: failing ? item.actual : '(the step passed — describe what is on screen)',
          stepIndex: args.step,
          scenarioId: item.scenarioId,
        },
        runner,
      );
      if (outcome.status === 'skipped') return { content: `no verdict: ${outcome.reason}`, isError: true };
      if (outcome.status === 'failed') return { content: `no verdict: ${outcome.reason}`, isError: true };
      const j = outcome.judgment;
      return {
        content: [
          `expected visible on screen: ${j.expectedVisible}`,
          `screen: ${j.screenSummary}`,
          `rationale: ${j.rationale}`,
        ].join('\n'),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// verify_bug — dispatch the control child (step 22)
// ---------------------------------------------------------------------------

function verifyBugTool(input: AdjudicationToolsInput): SessionTool {
  const { item, exec, state } = input;
  return defineSessionTool({
    name: 'verify_bug',
    description:
      'Run the INDEPENDENT CONTROL EXPERIMENT for a suspected code bug (required before any `bug` verdict at ' +
      'medium-or-better confidence). State the mechanism and the discriminating question — what result would ' +
      'DISPROVE the bug. A fresh control session designs and runs the experiment; its conclusion comes back with ' +
      'the reference your outcome\'s `control.transcriptRef` must cite. A `refutes` conclusion means your verdict ' +
      'must NOT be `bug` — downgrade it.',
    kind: 'verify-bug',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({
        mechanism: z.string().min(1).describe('The suspected mechanism, precisely (file:line when you have it).'),
        disprove: z.string().min(1).describe('The discriminating question: what result would disprove the bug?'),
      })
      .strict(),
    async execute(args, ctx) {
      if (!item.scenarioYaml) {
        return { content: 'the committed scenario yaml is unavailable — no control can run.', isError: true };
      }
      const outcome = await ctx.dispatchChild(
        controlSessionDef(exec),
        [
          controlBriefing({
            mechanism: args.mechanism,
            disprove: args.disprove,
            scenarioYaml: item.scenarioYaml,
            scenarioId: item.scenarioId,
          }),
        ],
      );
      if (outcome.status !== 'completed') {
        return {
          content:
            `the control session failed (${describeSessionFailure(outcome.failure)}) — ` +
            'no control ran. You may retry once, or hold the bug verdict at LOW confidence (which needs no control).',
          isError: true,
        };
      }
      // The ENGINE mints the reference and keeps the record: the fold trusts
      // this stash, never the outcome text's restatement. (`dispatchChild`
      // returns only the outcome — the child's session id is in the parent
      // transcript's `child-session` event for a reader following the ref.)
      const ref = `control-${randomUUID().slice(0, 8)}`;
      state.controls.set(ref, { conclusion: outcome.output.conclusion, reasoning: outcome.output.reasoning });
      return {
        content: [
          `control concluded: ${outcome.output.conclusion}`,
          `reasoning: ${outcome.output.reasoning}`,
          '',
          `Cite it in your outcome as control: { "conclusion": "${outcome.output.conclusion}", "reasoning": "<its reasoning>", "transcriptRef": "${ref}" }.`,
          ...(outcome.output.conclusion === 'refutes'
            ? ['The control REFUTED the mechanism — your class must not be `bug`.']
            : []),
        ].join('\n'),
      };
    },
  });
}
