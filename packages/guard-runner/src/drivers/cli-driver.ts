/**
 * The CLI step driver — the sandbox's own surface: the program under test (`run`),
 * `git` beside it, and the file mutations (`write` / `delete` / `patch`) that make a
 * two-state claim expressible.
 *
 * Everything here used to live inline in the run loop. It is a DRIVER now for the
 * same reason the web one is: which steps exist on a surface is that surface's
 * business, and the runner's business is the scenario.
 *
 * The rules this module owns, unchanged by the move:
 *  - a spawn failure, a timeout, or a step `cwd` escaping the sandbox is
 *    INFRASTRUCTURE (`error`), never a verdict about the program;
 *  - an unmet expectation is a `fail`, carrying the RAW streams that produced it;
 *  - a scripted answer whose question was never asked is a `fail` naming the marker;
 *  - a capture resolves only AFTER the step's expectation holds, so a failed step
 *    never publishes a value and a pattern that matches nothing is that step failing.
 */

import fs from 'node:fs'
import path from 'node:path'
import type {
  GuardCliCaptures,
  GuardCliStep,
  GuardExpect,
  GuardGit,
  GuardGitStep,
  GuardJsonValue,
  GuardPatchStep,
  GuardRunArg,
  GuardSandboxStep,
  GuardStep,
  GuardTtyAnswer,
  OutputExcerpts,
} from '@truecourse/shared'
import {
  isDeleteStep,
  isGitStep,
  isOptionalArg,
  isPatchStep,
  isProcessStep,
  isPromptKeyedStdin,
  isRunStep,
  isWebStep,
  isWriteStep,
} from '@truecourse/shared'
import { resolveInSandbox, SandboxError } from '../sandbox.js'
import { overlayStepEnv } from '../child-env.js'
import { gitChildEnv } from '../capabilities/git.js'
import { omitsOptionalPair, type SuppliedOmissions } from '../dependencies.js'
import { executeStep, type StepCapture } from '../executor.js'
import { evaluateExpect, type ExpectMismatch } from '../expect.js'
import { patchJsonText, resolvePatchValue } from '../patch.js'
import { stepExcerpt, type EvidencePatchOp, type EvidenceStep } from '../evidence.js'
import type { StepDriver, StepOutcome, StepRunContext } from './types.js'

/**
 * The `failure.expected` sentinel a step whose declared `cwd` escapes the sandbox
 * carries — the same one a bad `setup.files` path uses, because it is the same
 * defect (a scenario naming a path outside its world) seen one step later.
 */
export const SANDBOX_SETUP_EXPECTED = 'sandbox setup to succeed'

/**
 * The infra reason for a step whose output outlived it (`orphanedStdio`) — the
 * command returned but something it started still holds the pipes, so what the step
 * printed is only what had arrived when the run gave up waiting.
 */
export const ORPHANED_STDIO_INFRA =
  'the step left a background process still holding its output (a spawned daemon?)'

/** The `failure.expected` every other infrastructure failure of a step carries. */
const STEP_TO_RUN = 'the step to run'

/**
 * The empty expectation a `write`/`delete` step that asserts nothing evaluates
 * against — the file steps' `expect` is optional (moving a file is a legitimate
 * silent action), and `evaluateExpect` needs an object either way.
 */
const NO_EXPECTATIONS: GuardExpect = {}

export interface CliStepDriverOptions {
  /** The recipe entrypoint, absolute-resolved; a `run` step's argv is appended to it. */
  resolvedEntry: string[]
  /** The scenario's declared git identity, for `git` steps that name none. */
  gitIdentity?: GuardGit['identity']
}

/**
 * The driver for every step the sandbox itself takes. It holds no per-scenario
 * resources, so its `close` is a no-op — the sandbox is the runner's to clean up.
 */
export function cliStepDriver(opts: CliStepDriverOptions): StepDriver {
  return {
    id: 'cli',
    // Everything that is not another driver's is this one's. Stated that way round
    // on purpose: the sandbox surface is the default world a scenario acts in.
    owns: (step: GuardSandboxStep) => !isWebStep(step),
    close: async () => undefined,
    execute: (step, ctx) => executeCliStep(step as GuardCliStep, ctx, opts),
  }
}

async function executeCliStep(
  step: GuardCliStep,
  ctx: StepRunContext,
  opts: CliStepDriverOptions,
): Promise<StepOutcome> {
  const { sandbox, tok, stepIndex } = ctx

  // Where the step acts: the sandbox cwd, or the sandbox-relative directory it
  // declares (a second repository, a linked worktree, a fresh clone). A path that
  // escapes the sandbox is a scenario defect, reported like a setup escape — and
  // with NO records, because nothing was attempted.
  let stepCwd: string
  try {
    stepCwd = step.cwd ? resolveInSandbox(sandbox.cwd, tok(step.cwd), 'step cwd') : sandbox.cwd
  } catch (e) {
    return {
      status: 'error',
      records: [],
      expected: SANDBOX_SETUP_EXPECTED,
      message: e instanceof Error ? e.message : String(e),
    }
  }

  return isProcessStep(step)
    ? await runProcessStep(step, ctx, opts, stepCwd)
    : runFileStep(step, ctx, stepCwd)
}

/**
 * A `write` / `delete` / `patch` step: it mutates the sandbox tree between runs and
 * spawns nothing, so it has no exit code and no streams — only its declared file
 * assertions are evaluated.
 */
function runFileStep(step: GuardCliStep, ctx: StepRunContext, stepCwd: string): StepOutcome {
  const { sandbox, tok, stepIndex } = ctx
  const paths = fileStepPaths(step)
  // Resolved BEFORE the step runs, so a failing patch still transcribes what it
  // meant to do — the operations are the other half of the reason it stopped.
  let patchOps: EvidencePatchOp[] | undefined
  try {
    patchOps = isPatchStep(step) ? resolvedPatchOps(step, tok) : undefined
    applyFileStep(step, stepCwd, tok)
  } catch (e) {
    return {
      status: 'error',
      records: [fileStepRecord(stepIndex, step, paths.map(tok), stepCwd, sandbox.cwd, patchOps)],
      expected: STEP_TO_RUN,
      message: e instanceof Error ? e.message : String(e),
    }
  }
  const records = [fileStepRecord(stepIndex, step, paths.map(tok), stepCwd, sandbox.cwd, patchOps)]
  const mismatch = evaluateExpect({
    expect: step.expect ? ctx.resolveExpect(step.expect) : NO_EXPECTATIONS,
    exitCode: null,
    stdout: '',
    stderr: '',
    // `expect.files` is sandbox-relative for EVERY step kind — a step's `cwd` moves
    // where it acts, never where the scenario looks.
    sandboxCwd: sandbox.cwd,
    normalizeText: ctx.normText,
  })
  return mismatch ? { status: 'fail', records, mismatch } : { status: 'ok', records }
}

/** A `run` or `git` step: a child process, its streams, and what it captured. */
async function runProcessStep(
  step: GuardStep | GuardGitStep,
  ctx: StepRunContext,
  opts: CliStepDriverOptions,
  stepCwd: string,
): Promise<StepOutcome> {
  const { sandbox, tok, stepIndex } = ctx

  // Substitute the tokens in the scenario-authored argv + stdin + env overlay.
  // Evidence records the RESOLVED overlay — what the child actually saw.
  const argv = isRunStep(step)
    ? [...opts.resolvedEntry, ...resolveRunArgv(step.run, tok, sandbox.suppliedOmissions)]
    : ['git', ...step.git.map(tok)]
  const stdin = resolveStdin(step.stdin, tok)
  const stepEnvOverlay = step.env ? ctx.resolveEnv(step.env) : undefined
  const repeat = isRunStep(step) ? (step.repeat ?? 1) : 1
  // The step's own budget when it declares one, else the run's. Declared per step
  // because patience is a property of the COMMAND (a run that calls a model takes
  // minutes; the version banner beside it still must not) — and it bounds each
  // `repeat` iteration, exactly as the default does.
  const stepTimeoutMs = step.timeoutMs ?? ctx.stepTimeoutMs
  // This step's env: the scenario sandbox env with the step's own overlay on top,
  // scoped to these child spawns only. `resolvedEntry` was pinned to an absolute
  // interpreter at run start, so a step PATH edit reaches CHILD lookups but never
  // the entrypoint. A `git` step gets the pinned identity and the host config
  // switched off on top of that, so a sandbox commit can never be attributed to the
  // developer.
  const baseEnv = overlayStepEnv(sandbox.env, stepEnvOverlay)
  const stepEnv = isGitStep(step) ? gitChildEnv(baseEnv, step.identity ?? opts.gitIdentity) : baseEnv
  const invocation = {
    ...(isGitStep(step) ? { kind: 'git' as const } : {}),
    argv,
    stdin,
    ...(step.cwd ? { cwd: step.cwd } : {}),
    ...(isRunStep(step) && step.tty ? { tty: true } : {}),
    ...(stepEnvOverlay ? { env: stepEnvOverlay } : {}),
    repeat,
  }

  let lastCapture: StepCapture | null = null
  /** What THIS step captured — recorded in evidence beside what it printed. */
  let stepCaptured: Record<string, string> | undefined

  for (let iteration = 1; iteration <= repeat; iteration++) {
    if (ctx.signal?.aborted) return { status: 'aborted' }
    const capture = await executeStep({
      argv,
      cwd: stepCwd,
      env: stepEnv,
      stdin,
      ...(isRunStep(step) && step.tty ? { tty: true } : {}),
      timeoutMs: stepTimeoutMs,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    })
    lastCapture = capture
    // Aggregate every step that actually spawned (a spawn failure never ran).
    if (!capture.spawnError) ctx.onStep?.(observeStep(capture))
    // A capture ended by cancellation is not a verdict — settle without evidence.
    if (ctx.signal?.aborted) return { status: 'aborted' }

    const record = (): EvidenceStep[] => [
      toRecord({ index: stepIndex, ...invocation, iterationsRun: iteration }, capture, ctx.normText),
    ]

    // Infrastructure problem — never a scenario fail.
    if (capture.spawnError || capture.timedOut || capture.orphanedStdio) {
      // `timedOut` and `orphanedStdio` are mutually exclusive by construction (see
      // StepCapture): the command either overran the budget or finished and left
      // its stdio held. One reason each, never both.
      const message = capture.spawnError
        ? `failed to spawn: ${capture.spawnError}`
        : capture.timedOut
          ? // A keyed answer still waiting when the budget ran out names WHAT the run
            // was waiting for, so an overrun that is really a missing question says
            // so instead of leaving a reader to read the transcript for it.
            `step timed out after ${stepTimeoutMs}ms${
              capture.unaskedPrompt !== undefined
                ? ` — still waiting for the prompt “${capture.unaskedPrompt}”, which was never asked`
                : ''
            }`
          : ORPHANED_STDIO_INFRA
      return { status: 'error', records: record(), expected: STEP_TO_RUN, message }
    }

    // The command ran to the end without ever asking a question the scenario
    // scripted an answer to. That is a FINDING about the documented dialogue — the
    // prompt the doc promises is gone, or worded differently — so it settles as a
    // fail on this step, with the marker as the expectation. It is checked before
    // `expect`, because every other mismatch this step could report is downstream of
    // the answer that was never given.
    if (capture.unaskedPrompt !== undefined) {
      return {
        status: 'fail',
        records: record(),
        mismatch: {
          subject: 'prompt',
          expected: `the command to ask “${capture.unaskedPrompt}”`,
          actual: `the question was never asked — the command exited ${
            capture.exitCode === null ? 'without a code' : `with code ${capture.exitCode}`
          }`,
          detail: [
            `the scripted answer for “${capture.unaskedPrompt}” was never typed:`,
            'that text never appeared in what the command wrote.',
          ],
        },
        excerpts: outputExcerpts(capture),
      }
    }

    const mismatch = evaluateExpect({
      expect: ctx.resolveExpect(step.expect),
      exitCode: capture.exitCode,
      stdout: ctx.normText(capture.stdout),
      stderr: ctx.normText(capture.stderr),
      sandboxCwd: sandbox.cwd,
      normalizeText: ctx.normText,
    })
    if (mismatch) {
      return { status: 'fail', records: record(), mismatch, excerpts: outputExcerpts(capture) }
    }

    // This step's CAPTURES, resolved only now — after its expectation held, so a
    // step that failed never publishes a value, and every name a later step reads
    // was produced by a step that passed. A pattern that finds nothing is THIS step
    // failing with its output as evidence, never an empty value flowing on.
    if (step.capture) {
      const read = readStepCaptures(step.capture, capture)
      if ('mismatch' in read) {
        return {
          status: 'fail',
          records: record(),
          mismatch: read.mismatch,
          excerpts: outputExcerpts(capture),
        }
      }
      stepCaptured = read.values
      ctx.publishCaptures(read.values)
    }
  }

  return {
    status: 'ok',
    records: lastCapture
      ? [
          toRecord(
            { index: stepIndex, ...invocation, iterationsRun: repeat },
            lastCapture,
            ctx.normText,
            stepCaptured,
          ),
        ]
      : [],
  }
}

/** The observation the runner aggregates — raw emptiness + timing, no output kept. */
function observeStep(capture: StepCapture): {
  exitCode: number | null
  stdoutEmpty: boolean
  stderrEmpty: boolean
  durationMs: number
} {
  return {
    exitCode: capture.exitCode,
    stdoutEmpty: capture.stdout.length === 0,
    stderrEmpty: capture.stderr.length === 0,
    durationMs: capture.durationMs,
  }
}

/**
 * The RAW (un-normalized) stdout/stderr excerpts to ride next to a mismatch — each
 * head-truncated, each stream omitted when it was empty (no empty-string noise), so
 * the birth-retry and the finding see the usage error the program actually printed.
 */
function outputExcerpts(capture: StepCapture): OutputExcerpts {
  const out: OutputExcerpts = {}
  const stdout = stepExcerpt(capture.stdout)
  const stderr = stepExcerpt(capture.stderr)
  if (stdout) out.stdout = stdout
  if (stderr) out.stderr = stderr
  return out
}

/**
 * Take this step's declared captures out of what it just printed, or report the
 * miss. Reads the RAW streams: `normalize` exists to REPLACE the volatile parts of
 * output, and a run-generated id, version or cost is exactly what a scenario
 * captures — carrying a normalizer's placeholder forward would defeat the point.
 */
function readStepCaptures(
  captures: GuardCliCaptures,
  capture: StepCapture,
): { values: Record<string, string> } | { mismatch: ExpectMismatch } {
  const values: Record<string, string> = {}
  for (const [name, spec] of Object.entries(captures)) {
    const from = spec.from ?? 'stdout'
    const text =
      from === 'stderr' ? capture.stderr : from === 'output' ? capture.stdout + capture.stderr : capture.stdout
    let found: RegExpExecArray | null = null
    let reError = ''
    try {
      found = new RegExp(spec.pattern).exec(text)
    } catch (e) {
      // Both the loader and birth validation reject a source `new RegExp` refuses,
      // so this is unreachable for anything that got here — and a mid-run throw
      // would report an authoring defect as a crashed run. Same treatment the
      // stream matchers give it: a named mismatch, never an exception.
      reError = e instanceof Error ? e.message : String(e)
    }
    if (!found || found[1] === undefined) {
      return {
        mismatch: {
          subject: 'capture',
          expected: `capture "${name}" to match /${spec.pattern}/ in ${from}${reError ? ` (invalid regex: ${reError})` : ''}`,
          actual: `${from} carries no match for it`,
          detail: [
            `expected to capture "${name}" from ${from} with /${spec.pattern}/, but it did not match`,
            `--- actual ${from} ---`,
            text,
          ],
        },
      }
    }
    values[name] = found[1]
  }
  return { values }
}

/**
 * The argv a `run` step actually spawns with: every element token-resolved, and
 * every OPTIONAL PAIR whose field this machine left blank dropped whole — flag and
 * value together, so the program falls back to its own default instead of being
 * handed an empty one.
 */
function resolveRunArgv(
  run: readonly GuardRunArg[],
  tok: (text: string) => string,
  omissions: SuppliedOmissions,
): string[] {
  const argv: string[] = []
  for (const arg of run) {
    if (!isOptionalArg(arg)) {
      argv.push(tok(arg))
      continue
    }
    const [flag, value] = arg.optional
    if (omitsOptionalPair(value, omissions)) continue
    argv.push(tok(flag), tok(value))
  }
  return argv
}

/**
 * A step's scripted input with its tokens substituted — in whichever form the
 * scenario wrote it. A prompt-keyed answer resolves BOTH halves: the marker can name
 * a value the run generated (a `${unique}` id echoed back in the question) exactly
 * as the answer can.
 */
function resolveStdin(
  stdin: GuardStep['stdin'],
  tok: (text: string) => string,
): string | GuardTtyAnswer[] | undefined {
  if (stdin === undefined) return undefined
  if (!isPromptKeyedStdin(stdin)) return tok(stdin)
  return stdin.map((a) => ({ marker: tok(a.marker), answer: tok(a.answer) }))
}

/** The sandbox paths a file step acts on, as authored (tokens not yet resolved). */
function fileStepPaths(step: GuardCliStep): string[] {
  if (isWriteStep(step)) return Object.keys(step.write)
  if (isPatchStep(step)) return Object.keys(step.patch)
  if (isDeleteStep(step)) return step.delete
  return []
}

/**
 * A patch step's operations with their tokens resolved — the transcript's record of
 * what the step meant to do, and the values {@link applyFileStep} writes.
 */
function resolvedPatchOps(step: GuardPatchStep, tok: (text: string) => string): EvidencePatchOp[] {
  const ops: EvidencePatchOp[] = []
  for (const [rel, operations] of Object.entries(step.patch)) {
    const file = tok(rel)
    for (const [keyPath, value] of Object.entries(operations.set ?? {})) {
      ops.push({ file, op: 'set', path: keyPath, value: JSON.stringify(resolvePatchValue(value, tok)) })
    }
    for (const keyPath of operations.remove ?? []) ops.push({ file, op: 'remove', path: keyPath })
  }
  return ops
}

/**
 * Perform a `write` / `delete` / `patch` step: materialize, remove or edit sandbox
 * files, in declaration order, resolved against the step's `cwd`. Every path goes
 * through {@link resolveInSandbox}, so a step can only ever touch its own sandbox.
 *
 * A `delete` of a path that is not there THROWS rather than succeeding quietly: the
 * step exists to create a two-state world, and a mistyped path that silently
 * "worked" would let the next assertion pass for the wrong reason. A `patch` holds
 * the same line harder — see {@link patchJsonText} — and is ALL-OR-NOTHING across
 * the whole step: every file's new text is computed before any of it is written, so
 * a scenario can never be left standing on half an edit.
 */
function applyFileStep(step: GuardCliStep, cwd: string, tok: (text: string) => string): void {
  if (isWriteStep(step)) {
    for (const [rel, content] of Object.entries(step.write)) {
      const target = resolveInSandbox(cwd, tok(rel), 'write')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, tok(content))
    }
    return
  }
  if (isPatchStep(step)) {
    const planned: Array<{ target: string; text: string }> = []
    for (const [rel, operations] of Object.entries(step.patch)) {
      const file = tok(rel)
      const target = resolveInSandbox(cwd, file, 'patch')
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        throw new SandboxError(`patch: ${file} does not exist in the sandbox`)
      }
      const set: Record<string, GuardJsonValue> = {}
      for (const [keyPath, value] of Object.entries(operations.set ?? {})) {
        set[keyPath] = resolvePatchValue(value, tok)
      }
      planned.push({
        target,
        text: patchJsonText({ file, text: fs.readFileSync(target, 'utf-8'), set, remove: operations.remove }),
      })
    }
    for (const { target, text } of planned) fs.writeFileSync(target, text)
    return
  }
  if (!('delete' in step)) return
  for (const rel of step.delete) {
    const target = resolveInSandbox(cwd, tok(rel), 'delete')
    if (!fs.existsSync(target)) {
      throw new SandboxError(`delete: ${rel} does not exist in the sandbox`)
    }
    fs.rmSync(target, { recursive: true, force: true })
  }
}

/**
 * The transcript record of a file step. It spawned nothing, so there is no exit code
 * and no output: the fields exist because every evidence step shares one shape, and
 * they are left empty rather than filled with an invented success.
 */
function fileStepRecord(
  index: number,
  step: GuardCliStep,
  paths: string[],
  stepCwd: string,
  sandboxCwd: string,
  patchOps?: EvidencePatchOp[],
): EvidenceStep {
  return {
    index,
    kind: isWriteStep(step) ? 'write' : isPatchStep(step) ? 'patch' : 'delete',
    argv: paths,
    ...(patchOps ? { patch: patchOps } : {}),
    ...(stepCwd === sandboxCwd ? {} : { cwd: path.relative(sandboxCwd, stepCwd) }),
    repeat: 1,
    iterationsRun: 1,
    exitCode: null,
    timedOut: false,
    rawStdout: '',
    rawStderr: '',
    normStdout: '',
    normStderr: '',
    durationMs: 0,
  }
}

function toRecord(
  invocation: Pick<
    EvidenceStep,
    'index' | 'kind' | 'argv' | 'stdin' | 'cwd' | 'tty' | 'env' | 'repeat' | 'iterationsRun'
  >,
  capture: StepCapture,
  normText: (t: string) => string,
  captured?: Record<string, string>,
): EvidenceStep {
  return {
    ...invocation,
    ...(captured && Object.keys(captured).length > 0 ? { captured } : {}),
    exitCode: capture.exitCode,
    timedOut: capture.timedOut,
    spawnError: capture.spawnError,
    rawStdout: capture.stdout,
    rawStderr: capture.stderr,
    normStdout: normText(capture.stdout),
    normStderr: normText(capture.stderr),
    durationMs: capture.durationMs,
  }
}
