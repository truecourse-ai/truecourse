/**
 * THE RECIPE REPAIR SESSION — `guard-setup.recipe-repair` (plan 03 step 9).
 *
 * Loop ONLY on the failure path: `proposeRecipe` → `verifyProposal` run first,
 * deterministically, and a clean repo spends zero sessions. Only when the
 * deterministic proposal was rejected (or refused to propose) does this session
 * run — briefed on the failed proposal, the engine's own verdict, and the
 * evidence the one-shot fallback used to get — and iterate in ONE
 * {@link WorkingSandbox} where installs and builds accumulate call over call.
 *
 * The session's `verify_recipe` tool is its in-session done-check (the REAL
 * `verifyProposal`, expensive, result returned verbatim), and the def's
 * `outcomePrecondition` refuses an outcome produced before it ever ran. But the
 * GATE OF RECORD is not here: `discoverRecipe` fold-verifies the returned
 * proposal in a fresh verification pass regardless of anything the transcript
 * claims, then writes the recipe and probes the live endpoints exactly as
 * before. A fold-verify failure fails the run with the structured reason — the
 * session is not re-entered this run; resume is the next run's path.
 *
 * CACHE: the settled proposal keeps the legacy `guard/recipe` name AND key
 * (`recipeCacheKey(inputsFingerprint)`), via `cachedSessionOutcome` — a
 * proposal the one-shot era settled stays a hit, and verification always
 * re-runs on hits, today's semantics exactly.
 */

import { z } from 'zod';
import { defineSessionTool, type SessionDef, type SessionEvent, type SessionTool } from '@truecourse/agent-loop';
import {
  RECIPE_CACHE_NAME,
  recipeCacheKey,
  staticProposalComplaints,
  verifyProposal,
  RecipeProposalSchema,
  type RecipeProposal,
  type RecipeRepairContext,
  type RecipeRepairFn,
} from '@truecourse/guard-generator';
import { createWorkingSandbox, maskedRecipeText, type WorkingSandbox } from '@truecourse/guard-runner';
import { cachedSessionOutcome } from '../agent/session-cache.js';
import { runSessionPool } from '../agent/session-pool.js';
import { readFileTool, searchTool } from '../interface-author/tools.js';
import {
  describeSessionFailure,
  type GuardSetupSessionContext,
} from './session-context.js';

export const RECIPE_REPAIR_SESSION_KIND = 'guard-setup.recipe-repair';

/** The three numbers (§3.3): a repair is a handful of sandbox probes and one or
 *  two expensive `verify_recipe` rounds; 15 turns covers that with room for a
 *  wrong first theory about the build. */
export const RECIPE_REPAIR_BUDGET = { turns: 15, maxResumes: 1, tokenCeiling: 200_000 } as const;

/** How much of a command's output one tool result may carry — context is the
 *  budget, and install logs are the worst offenders. The TAIL is kept: that is
 *  where a build states its error. */
const MAX_TOOL_OUTPUT_CHARS = 12_000;

export interface RecipeRepairSessionInput {
  repoRoot: string;
  /** The session's ONE working sandbox — installs/builds accumulate across calls. */
  sandbox: WorkingSandbox;
}

export function recipeRepairSessionDef(input: RecipeRepairSessionInput): SessionDef<RecipeProposal> {
  return {
    kind: RECIPE_REPAIR_SESSION_KIND,
    systemPrompt: SYSTEM_PROMPT,
    tools: buildRepairTools(input),
    outcomeSchema: RecipeProposalSchema,
    budget: RECIPE_REPAIR_BUDGET,
    // The structural half of "prove it before you claim it": an outcome that was
    // never run through the real verification is almost certainly unverified, and
    // the fold will refuse it minutes later — one turn here is cheaper.
    outcomePrecondition: {
      tool: 'verify_recipe',
      message:
        'Outcome refused: you never ran `verify_recipe` in this session. Run it on your complete proposal now — it is the exact install→build→probe→boot verification the engine will re-run on your outcome, so a failure it finds costs one turn to fix here instead of the whole run. Fix anything it reports, then call `outcome` again.',
    },
  };
}

/**
 * The opening message: repair-to-green, never re-derivation. The failed
 * proposal and the engine's own report LEAD — they are the ground truth about
 * this repository — followed by everything the one-shot proposer used to see.
 */
export function recipeRepairBriefing(ctx: RecipeRepairContext): string {
  const lines: string[] = [
    'Repair ONE recipe proposal to green.',
    '',
  ];
  if (ctx.failed) {
    lines.push(
      `A recipe derived from the repository's own manifests was RUN by the engine and rejected at the \`${ctx.failed.stage}\` stage. Repair it — do not re-derive from scratch; the parts that did not fail are probably right.`,
      '',
      'The proposal the engine ran:',
      // Masked: a derived recipe can carry inline credential values, and a
      // briefing enters a persisted transcript.
      maskedRecipeText(ctx.failed.proposal) ?? ctx.failed.proposal,
      '',
      'The engine reported (ground truth — it names what was actually found):',
      ctx.failed.reason,
    );
  } else {
    lines.push(
      'The deterministic proposer could not derive a recipe from the manifests below, so there is no prior proposal — read the repository and propose one.',
    );
  }
  lines.push(
    '',
    `Files present in the repo root: ${ctx.inputs.presentInputs.join(', ') || '(none of the usual manifests)'}`,
    '',
    'package.json:',
    '"""',
    ctx.inputs.packageJson,
    '"""',
  );
  if (ctx.inputs.apps && ctx.inputs.apps.length > 0) {
    lines.push(
      '',
      'Workspace apps (directory · package · framework · route prefixes it serves).',
      'An app with HTTP route prefixes is a service that needs its own api.servers entry:',
      ...ctx.inputs.apps.map((a) => {
        const prefixes = a.prefixes.length > 0 ? a.prefixes.join(', ') : '(no routes detected)';
        return `  ${a.dir}${a.pkg ? ` · ${a.pkg}` : ''} · ${a.framework} · ${prefixes}`;
      }),
    );
  }
  if (ctx.database) {
    lines.push(
      '',
      `The analyzer detected a database dependency: ${ctx.database.driver}/${ctx.database.type}. A server that needs one and has no \`api.services\` to bring one up will die at boot on a connection nobody could make.`,
    );
  }
  if (ctx.datastoreUrls.length > 0) {
    lines.push(
      'Datastore connection URLs the app declares in its own source:',
      ...ctx.datastoreUrls.slice(0, 6).map((ref) => `  ${JSON.stringify(ref)}`),
    );
  }
  if (ctx.composeGenerated) {
    lines.push(
      '',
      'guard already GENERATED a docker-compose datastore from the app\'s own connection URL, verified the proposal with it, and reverted it when verification still failed — the failure above is with that datastore in place. Do not advise adding a compose file; that was tried.',
    );
  }
  lines.push(
    '',
    'Work in your sandbox (`sandbox_exec` / `sandbox_shell`) to test theories cheaply — check tool versions, run the package manager, try the build. Read the repository (`read_file` / `search_repo`) for what the manifests actually declare. Run `check_recipe` on a draft for the free static refusals, and `verify_recipe` on the complete proposal — that is the real verification the engine will re-run on your outcome, so do not produce an outcome it has not passed.',
  );
  return lines.join('\n');
}

function buildRepairTools(input: RecipeRepairSessionInput): SessionTool[] {
  return [
    readFileTool(input.repoRoot),
    searchTool(input.repoRoot),
    sandboxExecTool(input.sandbox),
    sandboxShellTool(input.sandbox),
    checkRecipeTool(),
    verifyRecipeTool(input.repoRoot),
  ];
}

function sandboxExecTool(sandbox: WorkingSandbox): SessionTool {
  return defineSessionTool({
    name: 'sandbox_exec',
    description:
      'Run one argv in YOUR working sandbox (no shell — a compound command needs `sandbox_shell`). The sandbox persists across your calls: what one call installs or builds, the next call sees. cwd is sandbox-relative.',
    kind: 'sandbox-exec',
    readOnly: false,
    destructive: false,
    inputSchema: z
      .object({
        argv: z.array(z.string()).min(1),
        cwd: z.string().optional(),
        stdin: z.string().optional(),
        timeoutMs: z.number().int().positive().max(120_000).optional(),
      })
      .strict(),
    async execute(args, toolCtx) {
      try {
        const capture = await sandbox.exec(args.argv, {
          ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
          ...(args.stdin !== undefined ? { stdin: args.stdin } : {}),
          ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
          ...(toolCtx.signal ? { signal: toolCtx.signal } : {}),
        });
        return {
          content: renderCapture(capture),
          ...(capture.spawnError || capture.timedOut ? { isError: true } : {}),
        };
      } catch (error) {
        return { content: message(error), isError: true };
      }
    },
  });
}

function sandboxShellTool(sandbox: WorkingSandbox): SessionTool {
  return defineSessionTool({
    name: 'sandbox_shell',
    description:
      'Run one shell command in YOUR working sandbox (install/build class: combined output, 600s default timeout). Same persistent sandbox as `sandbox_exec`.',
    kind: 'sandbox-shell',
    readOnly: false,
    destructive: false,
    inputSchema: z
      .object({
        command: z.string().min(1),
        timeoutMs: z.number().int().positive().max(600_000).optional(),
      })
      .strict(),
    async execute(args, toolCtx) {
      try {
        const result = await sandbox.shell(args.command, {
          ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
          ...(toolCtx.signal ? { signal: toolCtx.signal } : {}),
        });
        const head = result.ok
          ? `exit 0`
          : `exit ${result.exitCode ?? 'none'}${result.timedOut ? ' (timed out)' : ''}`;
        return {
          content: `${head}\n${clipOutput(result.output)}`,
          ...(result.ok ? {} : { isError: true }),
        };
      } catch (error) {
        return { content: message(error), isError: true };
      }
    },
  });
}

function checkRecipeTool(): SessionTool {
  return defineSessionTool({
    name: 'check_recipe',
    description:
      'Statically check a recipe proposal — the schema (enforced on the arguments) plus the engine\'s own refusal rules (shell operators in an argv, dev/watch serve commands). No execution; free. Run `verify_recipe` for the real proof.',
    kind: 'check-recipe',
    readOnly: true,
    destructive: false,
    inputSchema: RecipeProposalSchema,
    async execute(args) {
      const complaints = staticProposalComplaints(args);
      if (complaints.length === 0) {
        return {
          content:
            'Statically clean: the shape validates and no refusal rule fires. Now prove it with `verify_recipe` — the engine re-runs that exact verification on your outcome.',
        };
      }
      return { content: `${complaints.length} problem(s):\n- ${complaints.join('\n- ')}`, isError: true };
    },
  });
}

function verifyRecipeTool(repoRoot: string): SessionTool {
  return defineSessionTool({
    name: 'verify_recipe',
    description:
      'Run the REAL engine verification on a proposal: install → build → entry probe → services → server boot, exactly as the fold will re-run it. EXPENSIVE (minutes) — use it as your done-check on the complete proposal, not as a probe.',
    kind: 'verify-recipe',
    readOnly: false,
    destructive: false,
    inputSchema: RecipeProposalSchema,
    async execute(args) {
      try {
        const verdict = await verifyProposal(repoRoot, args);
        if (verdict.ok) {
          return {
            content:
              'VERIFIED: install, build, the entry probe and the server boot all passed. Produce this proposal as the outcome.',
          };
        }
        return { content: `failed at ${verdict.stage}: ${clipOutput(verdict.reason)}`, isError: true };
      } catch (error) {
        return { content: `verification threw: ${message(error)}`, isError: true };
      }
    },
  });
}

// ---------------------------------------------------------------------------
// the seam implementation `discoverRecipe` calls
// ---------------------------------------------------------------------------

export interface BuildRecipeRepairOptions {
  signal?: AbortSignal;
  onSessionEvent?: (workItem: string, event: SessionEvent) => void;
}

/**
 * The `RecipeRepairFn` the command adapter injects into `runGuardSetup`. One
 * session, concurrency 1; the WorkingSandbox is created before the session and
 * cleaned up in a finally around it. Never throws — a failure comes back as
 * `{ error }` and `discoverRecipe` composes the diagnostic.
 */
export function buildRecipeRepair(
  context: GuardSetupSessionContext,
  opts: BuildRecipeRepairOptions = {},
): RecipeRepairFn {
  return async (ctx) => {
    try {
      const outcome = await cachedSessionOutcome<RecipeProposal>({
        repoRoot: ctx.repoRoot,
        cacheName: RECIPE_CACHE_NAME,
        key: recipeCacheKey(ctx.inputsFingerprint),
        schema: RecipeProposalSchema,
        run: async () => {
          const { driver, persistence } = await context.acquire();
          const sandbox = createWorkingSandbox();
          try {
            const results = await runSessionPool<RecipeRepairContext, RecipeProposal>({
              items: [ctx],
              workItem: () => 'recipe-repair',
              session: () => recipeRepairSessionDef({ repoRoot: ctx.repoRoot, sandbox }),
              briefing: () => [recipeRepairBriefing(ctx)],
              driver,
              persistence,
              concurrency: 1,
              ...(opts.signal ? { signal: opts.signal } : {}),
              ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
              fold: () => {
                /* single item; the caller folds (verify + write) */
              },
            });
            const result = results[0]?.outcome;
            if (!result) {
              // Only an already-aborted signal can skip the single item.
              return {
                status: 'failed',
                failure: { kind: 'transport', detail: 'aborted before the session started', class: 'unknown', retryability: 'none' },
                resumable: false,
                spent: { turns: 0, tokens: 0, costUsd: 0 },
              };
            }
            context.note(result.status);
            context.addSpend(1, result.spent);
            return result;
          } finally {
            sandbox.cleanup();
          }
        },
      });
      const sessionRunId = context.runId();
      if (outcome.status === 'completed') {
        return { proposal: outcome.output, ...(sessionRunId ? { sessionRunId } : {}) };
      }
      return {
        error: describeSessionFailure(outcome.failure),
        ...(sessionRunId ? { sessionRunId } : {}),
      };
    } catch (error) {
      return { error: message(error), ...(context.runId() ? { sessionRunId: context.runId() } : {}) };
    }
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function renderCapture(capture: {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}): string {
  if (capture.spawnError) return `spawn failed: ${capture.spawnError}`;
  const head = `exit ${capture.exitCode ?? `signal ${capture.signal ?? 'none'}`}${capture.timedOut ? ' (timed out)' : ''}`;
  const parts = [head];
  if (capture.stdout.trim().length > 0) parts.push(`stdout:\n${clipOutput(capture.stdout)}`);
  if (capture.stderr.trim().length > 0) parts.push(`stderr:\n${clipOutput(capture.stderr)}`);
  if (parts.length === 1) parts.push('(no output)');
  return parts.join('\n');
}

/** Keep the TAIL of a long output — that is where a build states its error. */
function clipOutput(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  return `… (${text.length - MAX_TOOL_OUTPUT_CHARS} chars clipped)\n${text.slice(-MAX_TOOL_OUTPUT_CHARS)}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const SYSTEM_PROMPT = `You repair RECIPE PROPOSALS for TrueCourse guard: the small JSON declaration that turns a repository's working tree into something scenarios can drive — an install command, a build command, a CLI entry argv and/or an HTTP \`api\` block.

# The job

A deterministic proposal derived from the repository's own manifests FAILED the engine's verification (or none could be derived). Your briefing quotes the failed proposal and the engine's own report verbatim. Repair it to green: change what the report proves wrong, keep what it does not. This is repair, never re-derivation — the engine's report is ground truth about this repository.

# The shape you produce

One JSON object: optional \`install\` (shell), \`build\` (shell), optional \`entry\` (argv array — a CLI entrypoint), optional \`api\` (\`serve\` argv + optional \`healthPath\`/\`env\`, or a \`servers\` map + \`defaultServer\` for a multi-service workspace). At least one of \`entry\`/\`api\`. \`\${PORT}\` in serve argv/env is substituted at boot. An argv is spawned WITHOUT a shell — no \`&&\`, no pipes; shell composition belongs in \`install\`/\`build\`. Never a dev/watch command as a server.

# How to work

- The engine's report first. It lists what was actually found (the files next to a missing entry, the build's own error tail). Answer IT.
- \`read_file\` / \`search_repo\` read the repository. \`sandbox_exec\` / \`sandbox_shell\` run commands in YOUR OWN persistent sandbox — a scratch world with an isolated HOME, not the repository checkout; use it to test tool availability and theories cheaply. The verification itself installs and builds the real tree — you never need to reproduce that by hand.
- \`check_recipe\` is free and static: run it on a draft early.
- \`verify_recipe\` is the REAL verification — install → build → entry probe → services → server boot, minutes of work. Run it on your complete proposal before you produce the outcome; the engine re-runs exactly it on whatever you return, so an outcome it has not passed is an outcome that will be refused.
- A dependency-free CLI may need NO install at all; an install demanding a lockfile the repo does not commit needs the non-frozen form. Omitting a wrong step is a valid repair — verification still proves the entry answers.

# The outcome

The proposal itself, as the outcome — nothing else. Do not write files, do not edit the repository (you cannot), do not restate the report.`;
