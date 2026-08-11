/**
 * The WEB step driver — a real browser against the web surface the sandbox serves.
 *
 * It owns exactly one piece of state the cli driver does not have: the SESSION (the
 * served surface plus the browser), opened at the first web step and closed by
 * `close`. That laziness is the point of the mixed scenario — the surface serves the
 * sandbox, so it must start AFTER the cli steps that populate what the browser is
 * meant to see.
 *
 * Everything else it reports in the shared step vocabulary: a missed target or an
 * unmet expectation is a `fail` (the page not showing what the claim promises IS the
 * drift), and a surface that will not boot, a browser that will not launch, or a
 * navigation that errors is an `error` (nothing about the app was observed).
 */

import type { GuardSandboxStep, GuardWebStep } from '@truecourse/shared'
import { describeWebCommand, describeWebExpect, isWebStep } from '@truecourse/shared'
import type { ResolvedWebSurface } from '../recipe.js'
import { stepExcerpt, type EvidenceStep } from '../evidence.js'
import {
  DEFAULT_WEB_STEP_TIMEOUT_MS,
  executeWebStep,
  WEB_TEXT_LIMIT,
  type WebStepResult,
} from '../web/executor.js'
import { openWebSession, type WebSession } from '../web/session.js'
import { resolveWebStep } from '../web/tokens.js'
import type { StepDriver, StepOutcome, StepRunContext } from './types.js'

/** The `failure.expected` an infrastructure failure of a web step carries. */
const STEP_TO_RUN = 'the step to run'

/**
 * The infra message a web step earns when the repo declares no web surface. An
 * `error`, not a `fail`: nothing about the app was observed, so there is no verdict
 * to reach — the RECIPE is incomplete, and the message says exactly that.
 */
export const NO_WEB_SURFACE_INFRA =
  'this scenario has web steps, but recipe.json declares no `web` block — add one ' +
  '(`web.serve` + `web.healthPath`) so the runner knows how to start the web surface'

export interface WebStepDriverOptions {
  /**
   * The recipe's web surface. `null` when the repo declares none — the driver still
   * exists and still OWNS web steps, and each one settles as the loud error above.
   * Refusing to route them would report "unknown step kind", which is a worse lie.
   */
  surface: ResolvedWebSurface | null
}

/** The driver for every step a browser takes. */
export function webStepDriver(opts: WebStepDriverOptions): StepDriver {
  let session: WebSession | null = null

  return {
    id: 'web',
    owns: (step: GuardSandboxStep) => isWebStep(step),

    async close() {
      await session?.close()
      session = null
    },

    async execute(step, ctx) {
      const resolved = resolveWebStep(step as GuardWebStep, ctx.tok)
      const failedToOpen = (message: string): StepOutcome => ({
        status: 'error',
        records: [
          webStepRecord(ctx.stepIndex, resolved, {
            url: '(the browser never opened)',
            visibleText: '',
            durationMs: 0,
            checks: [],
          }),
        ],
        expected: STEP_TO_RUN,
        message,
      })

      if (!opts.surface) return failedToOpen(NO_WEB_SURFACE_INFRA)
      if (!session) {
        const opened = await openWebSession({
          surface: opts.surface,
          repoRoot: ctx.repoRoot,
          sandboxCwd: ctx.sandbox.cwd,
          sandboxEnv: ctx.sandbox.env,
          evidenceDir: ctx.evidenceDir,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        })
        if (!opened.ok) return failedToOpen(opened.reason)
        session = opened.session
      }
      if (ctx.signal?.aborted) return { status: 'aborted' }

      // Only the lines THIS step produced ride in its record; the ones before it
      // already rode in an earlier step's.
      const consoleBefore = session.consoleLines().length
      const result = await executeWebStep({
        page: session.page,
        baseUrl: session.baseUrl,
        step: resolved,
        stepIndex: ctx.stepIndex,
        evidenceDir: ctx.evidenceDir,
        timeoutMs: resolved.timeoutMs ?? DEFAULT_WEB_STEP_TIMEOUT_MS,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      })
      if (ctx.signal?.aborted) return { status: 'aborted' }

      const records = [
        webStepRecord(ctx.stepIndex, resolved, result, session.consoleLines().slice(consoleBefore)),
      ]
      if (result.infra) {
        return { status: 'error', records, expected: STEP_TO_RUN, message: result.infra }
      }
      if (result.mismatch) {
        const excerpt = stepExcerpt(result.visibleText)
        return {
          status: 'fail',
          records,
          mismatch: result.mismatch,
          // The page's own words are this driver's output excerpt — the cli step's
          // `stdout` in the only form a browser has.
          ...(excerpt ? { excerpts: { stdout: excerpt } } : {}),
        }
      }
      return { status: 'ok', records }
    },
  }
}

/**
 * The transcript record of a web step. It spawns nothing, so it has no exit code and
 * no streams; what it has is an action, an address, a screenshot, each assertion
 * beside the page's own answer to it, and what the page showed. Written for a passing
 * step and a failing one alike — the question a reader asks about a browser step is
 * always "what did it look like".
 *
 * The page text is recorded at the width it was ASSERTED against ({@link
 * WEB_TEXT_LIMIT}), not at the stream cap: a record trimmed shorter than the
 * expectation's own window shows a page missing the very words the step asserted,
 * next to a green tick, and cannot be checked by the reader.
 */
function webStepRecord(
  index: number,
  step: GuardWebStep,
  result: Pick<WebStepResult, 'url' | 'visibleText' | 'durationMs' | 'checks'> & { screenshot?: string },
  consoleLines: readonly string[] = [],
): EvidenceStep {
  return {
    index,
    kind: 'web',
    argv: [],
    web: {
      command: describeWebCommand(step),
      expectation: describeWebExpect(step.expect),
      ...(result.checks.length > 0 ? { checks: result.checks } : {}),
      url: result.url,
      ...(result.screenshot ? { screenshot: result.screenshot } : {}),
      visibleText: result.visibleText.slice(0, WEB_TEXT_LIMIT),
      ...(consoleLines.length > 0 ? { console: consoleLines } : {}),
    },
    repeat: 1,
    iterationsRun: 1,
    exitCode: null,
    timedOut: false,
    rawStdout: '',
    rawStderr: '',
    normStdout: '',
    normStderr: '',
    durationMs: result.durationMs,
  }
}
