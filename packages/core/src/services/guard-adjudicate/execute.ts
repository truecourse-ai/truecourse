/**
 * ONE-SCENARIO EXECUTION for the adjudication tools — `rerun_scoped` (the
 * parent's flake discriminator) and `run_control` (the child's disproof
 * experiment). Both run through the SAME `GuardExecutor` seam every other
 * guard execution crosses, always `persist: false` in a fresh sandbox/server
 * lane: nothing an adjudication tool runs may move the board, the run store,
 * or the corpus. The result comes back CONDENSED — outcome, failing step,
 * expected vs actual, raw excerpts — which is the same window the flow
 * worker's `run_scenario` hands back.
 */

import { isRunRefusalStatus, birthRunTimeoutMs } from '@truecourse/guard-generator';
import { runFailureMessage, type GuardExecutor, type Recipe } from '@truecourse/guard-runner';
import type { GuardScenario, GuardScenarioResult } from '@truecourse/shared';

/** Per-stream cap on the excerpt a condensed result quotes back to a session. */
const CONDENSED_STREAM_CHARS = 1200;

/**
 * The execution seam the adjudication tools share. `recipe` is resolved ONCE by
 * the command adapter (absent when the repo has none — the tools then answer
 * with an error naming the gap instead of pretending to run). `built` memoizes
 * the first build of the command's lifetime: later executions reuse it via
 * `skipBuild`, exactly as birth rounds do. Two sessions racing the first
 * execution both build — harmless, only wasteful — because the flag flips only
 * after a run completed.
 */
export interface AdjudicationExecution {
  executor: GuardExecutor;
  recipe: Recipe | null;
  repoRoot: string;
  branch: string | null;
  commit: string | null;
  built: boolean;
  signal?: AbortSignal;
}

/**
 * Execute ONE scenario, persist-nothing, and condense the report to what a
 * session can act on. A run-level refusal returns as an error naming the world
 * defect — no scenario the session runs can get past it.
 */
export async function executeOneScenario(
  exec: AdjudicationExecution,
  scenario: GuardScenario,
): Promise<{ content: string; isError: boolean }> {
  if (!exec.recipe) {
    return {
      content:
        'no usable `.truecourse/scenarios/recipe.json` — re-executions are unavailable. ' +
        'Adjudicate from the recorded evidence alone.',
      isError: true,
    };
  }
  const report = await exec.executor({
    checkoutDir: exec.repoRoot,
    recipe: exec.recipe,
    scenarios: [scenario],
    persist: false,
    skipBuild: exec.built,
    runTimeoutMs: birthRunTimeoutMs(1),
    branch: exec.branch,
    commit: exec.commit,
    ...(exec.signal ? { signal: exec.signal } : {}),
  });

  if (report.status !== 'ok') {
    const message = runFailureMessage(report);
    if (isRunRefusalStatus(report.status)) {
      return {
        content:
          `the runner REFUSED the run before anything executed: ${message}\n` +
          'This is a configuration/world defect — no re-execution can answer your question until it is fixed.',
        isError: true,
      };
    }
    return { content: `the run did not complete: ${message}`, isError: true };
  }
  exec.built = true;
  const result = report.latest.scenarios.find((r) => r.id === scenario.id);
  if (!result) {
    return { content: 'the scenario was not executed (no result came back)', isError: true };
  }
  return { content: condenseResult(result), isError: false };
}

/** The condensed window a session sees of one executed result. */
export function condenseResult(result: GuardScenarioResult): string {
  const lines: string[] = [`outcome: ${result.outcome}`];
  if (result.outcome === 'pass') {
    lines.push('every step met its expectation');
  } else if (result.failure) {
    lines.push(`failing step: ${result.failure.step}`);
    lines.push(`expected: ${result.failure.expected}`);
    lines.push(`actual:   ${result.failure.actual}`);
    if (result.failure.stdout) lines.push(`stdout (raw, head): ${clip(result.failure.stdout)}`);
    if (result.failure.stderr) lines.push(`stderr (raw, head): ${clip(result.failure.stderr)}`);
  }
  if (result.failedMilestone !== undefined) lines.push(`failed milestone: ${result.failedMilestone}`);
  if (result.blockedPrecondition) lines.push('note: the failing step is a precondition (no milestone on it)');
  if (result.unservedRoute) lines.push('note: the request hit a route no declared server serves');
  return lines.join('\n');
}

function clip(text: string): string {
  return text.length > CONDENSED_STREAM_CHARS ? `${text.slice(0, CONDENSED_STREAM_CHARS)}…` : text;
}
