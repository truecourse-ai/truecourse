/**
 * The WEB step driver — a real browser against the web surface the sandbox serves.
 *
 * It owns exactly one piece of state the cli driver does not have: the BROWSER
 * SESSION, opened at the first web step and closed by `close`. That laziness is the
 * point of the mixed scenario — the surface serves the sandbox, so it must start
 * AFTER the cli steps that populate what the browser is meant to see. The SERVER it
 * drives is the sandbox's shared one (`surface.ts`), which is what lets a `request`
 * step read the very origin this driver is clicking around in.
 *
 * Everything else it reports in the shared step vocabulary: a missed target or an
 * unmet expectation is a `fail` (the page not showing what the claim promises IS the
 * drift), and a surface that will not boot, a browser that will not launch, or a
 * navigation that errors is an `error` (nothing about the app was observed).
 */

import path from 'node:path'
import type { GuardSandboxStep, GuardWebStep } from '@truecourse/shared'
import { describeWebCommand, describeWebExpect, isWebStep, isWebUploadStep } from '@truecourse/shared'
import { stepExcerpt, type EvidenceStep } from '../evidence.js'
import {
  DEFAULT_WEB_STEP_TIMEOUT_MS,
  executeWebStep,
  WEB_TEXT_LIMIT,
  type WebStepResult,
} from '../web/executor.js'
import { openWebSession, type WebSession } from '../web/session.js'
import { resolveWebStep } from '../web/tokens.js'
import { materializeWebFile, type WebFilePayload } from '../web/upload.js'
import type { SandboxSurface } from './surface.js'
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
   * The sandbox's served surface — shared with every other driver that talks to it.
   * Undeclared (`served.declared === false`) when the repo has no `web` block: the
   * driver still exists and still OWNS web steps, and each one settles as the loud
   * error above. Refusing to route them would report "unknown step kind", which is a
   * worse lie.
   */
  served: SandboxSurface
}

/** The driver for every step a browser takes. */
export function webStepDriver(opts: WebStepDriverOptions): StepDriver {
  let session: WebSession | null = null

  return {
    id: 'web',
    owns: (step: GuardSandboxStep) => isWebStep(step),

    async close() {
      // Only the browser: the surface belongs to the sandbox, which takes it down
      // after every driver has let go of it.
      await session?.close()
      session = null
    },

    async execute(step, ctx) {
      const resolved = resolveWebStep(step as GuardWebStep, ctx.tok)
      const failedToTake = (message: string, url = '(the browser never opened)'): StepOutcome => ({
        status: 'error',
        records: [webStepRecord(ctx.stepIndex, resolved, { url, visibleText: '', durationMs: 0, checks: [] })],
        expected: STEP_TO_RUN,
        message,
      })
      const failedToOpen = (message: string): StepOutcome => failedToTake(message)

      if (!opts.served.declared) return failedToOpen(NO_WEB_SURFACE_INFRA)

      // The uploaded file is materialized BEFORE the browser is asked for anything:
      // a declaration that cannot become bytes — a path that escapes the sandbox, a
      // payload past the ceiling — observed nothing about the app, so it is an
      // `error` naming itself, and it never costs a page load.
      let file: WebFilePayload | undefined
      if (isWebUploadStep(resolved)) {
        const materialized = materializeWebFile(resolved.file, ctx.sandbox.cwd)
        if (!materialized.ok) return failedToTake(materialized.reason, '(the file never reached the page)')
        file = materialized.file
      }
      if (!session) {
        const surface = await opts.served.open(ctx)
        if (!surface.ok) return failedToOpen(surface.reason)
        const opened = await openWebSession({
          server: surface.server,
          evidenceDir: ctx.evidenceDir,
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
        ...(file ? { file, armFileChooser: () => session!.armFileChooser() } : {}),
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      })
      if (ctx.signal?.aborted) return { status: 'aborted' }

      const records = [
        webStepRecord(
          ctx.stepIndex,
          resolved,
          { ...result, ...(file ? { file } : {}) },
          session.consoleLines().slice(consoleBefore),
        ),
      ]
      // What the page gave the steps after this one. Published only on a step that
      // held: the executor returns values only when every capture was read, so a
      // failed browser step can never hand a later one a value it never saw.
      if (result.captured) ctx.publishCaptures(result.captured)
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
          // …and its PICTURE, which is the half no amount of text carries. Offered
          // to the runner's visual judge; a screenshot that could not be taken
          // simply offers nothing, and the failure reads exactly as it always did.
          ...(result.screenshot
            ? {
                visual: {
                  screenshotPath: path.join(ctx.evidenceDir, result.screenshot),
                  expectation: describeWebExpect(resolved.expect),
                },
              }
            : {}),
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
  result: Pick<WebStepResult, 'url' | 'visibleText' | 'durationMs' | 'checks'> & {
    screenshot?: string
    file?: WebFilePayload
    captured?: Record<string, string>
  },
  consoleLines: readonly string[] = [],
): EvidenceStep {
  return {
    index,
    kind: 'web',
    argv: [],
    // The same field a cli step's record carries, so the transcript prints what a
    // browser step took off the page in the one place a reader already looks.
    ...(result.captured && Object.keys(result.captured).length > 0 ? { captured: result.captured } : {}),
    web: {
      command: describeWebCommand(step),
      expectation: describeWebExpect(step.expect),
      ...(result.checks.length > 0 ? { checks: result.checks } : {}),
      url: result.url,
      ...(result.screenshot ? { screenshot: result.screenshot } : {}),
      // The file's IDENTITY, never its bytes: a name, a size and a digest are what
      // a reader checks the page's own words against, and the payload is either
      // unreadable noise or the very data the scenario is about.
      ...(result.file
        ? { upload: { name: result.file.name, bytes: result.file.buffer.length, sha256: result.file.sha256 } }
        : {}),
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
