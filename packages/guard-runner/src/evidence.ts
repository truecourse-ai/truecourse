/**
 * Evidence capture — on every EXECUTED outcome (`pass` / `fail` / `error`), write a
 * self-contained transcript under `.truecourse/guard/evidence/<runId>/<scenarioId>/`.
 * For a fail/error it decides drift-vs-bug by reading, not re-running; for a pass it
 * is the proof of what actually executed (a green guard is otherwise just a
 * checkmark). Contains the invocation, raw + normalized streams, the expectation
 * diff, and a sandbox file listing. A non-executed `stale`/`orphaned` scenario never
 * reaches here — it has no transcript.
 *
 * `invocation.json` is also the store of PER-STEP ACTUALS: every executed step's exit
 * code, duration and output excerpt, which is what the dashboard reads back to render
 * a step's recorded half next to its authored one (`parseGuardStepActuals`). The
 * excerpts are capped at {@link STEP_OUTPUT_LIMIT} so the bundle can never grow
 * unbounded; a step that did not execute simply has no record.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  isPromptKeyedStdin,
  visualJudgeLines,
  type GuardBinds,
  type GuardTtyAnswer,
  type GuardVisualJudgment,
} from '@truecourse/shared'
import { evidenceScenarioDir, evidenceRelPath } from './store.js'
import { listSandboxFiles } from './sandbox.js'
import type { ExpectMismatch } from './expect.js'

/**
 * Per-stream cap on the RAW output either driver RETAINS: the excerpts a mismatch
 * `failure` carries, and every executed step's excerpt in `invocation.json`. Mirrors
 * the probe-transcript convention (`PROBE_OUTPUT_LIMIT` in the guard generator's
 * `ground.ts`) so evidence stays a manageable size. It lives here, at the write
 * boundary, so the two can never be trimmed differently.
 */
export const STEP_OUTPUT_LIMIT = 1200

/** A retained output excerpt: head-truncated, and omitted entirely when empty. */
export function stepExcerpt(text: string): string | undefined {
  return text ? text.slice(0, STEP_OUTPUT_LIMIT) : undefined
}

/**
 * ONE operation a `patch` step applied, as the scenario authored it with its tokens
 * resolved — the record that says what the step MEANT to do, written whether or not
 * it got there (a patch is all-or-nothing, so the reason it stopped is the other
 * half of the story).
 */
export interface EvidencePatchOp {
  /** The file it addresses, as the transcript names it. */
  file: string
  op: 'set' | 'remove'
  /** The key path, in its authored (escaped) form. */
  path: string
  /** The value as JSON, on a `set`. */
  value?: string
}

/** True for the cli steps that only move sandbox files: no exit code, no streams. */
export function isFileStepKind(kind: EvidenceStep['kind']): boolean {
  return kind === 'write' || kind === 'delete' || kind === 'patch'
}

/**
 * ONE member of a web step's expectation beside the page's own answer to it — the
 * pair a reader checks a green step with. See `WebCheck` in the web executor, whose
 * shape this is: the evidence carries it verbatim.
 */
export interface EvidenceWebCheck {
  subject: 'url' | 'text' | 'visible' | 'state' | 'attribute' | 'class'
  expected: string
  actual: string
  ok: boolean
}

/**
 * What ONE web step did, for the transcript — a browser step's evidence is visual,
 * so the record is what it did, where it ended up, what it asserted and what
 * answered each assertion, what the page said, and the name of the screenshot that
 * shows it.
 */
export interface EvidenceWebStep {
  /** What the step did — `navigate /notes`, `click button “Save”`. */
  command: string
  /** What it asserted, one line; empty when it asserted nothing. */
  expectation: string
  /**
   * Each member of that expectation with what the page answered IT. Empty when the
   * step asserted nothing, and when its action failed before anything was asserted
   * — `expectation` then still says what it was going to check.
   */
  checks?: readonly EvidenceWebCheck[]
  /** The address after the step, as `pathname + search`. */
  url: string
  /** The screenshot's filename in this evidence dir, absent when none could be taken. */
  screenshot?: string
  /** What the page showed — the same window the expectation was evaluated against. */
  visibleText: string
  /** Console lines and page errors seen during the step. */
  console?: readonly string[]
}

/**
 * ONE member of a request step's expectation beside the response's own answer to it
 * — see `ApiCheck` in the api expectation module, whose shape this is: the evidence
 * carries it verbatim, exactly as it carries a web step's checks.
 */
export interface EvidenceApiCheck {
  subject: 'status' | 'headers' | 'body' | 'schema' | 'json'
  expected: string
  actual: string
  ok: boolean
}

/**
 * What ONE request step did, for the transcript — a request spawns nothing, so it
 * has no exit code and no streams: it has a request line, a status, what it asserted
 * next to what the response answered each assertion, and the body it read. Written
 * for a passing step and a failing one alike; the question a reader asks about a
 * request step is always "what came back".
 */
export interface EvidenceApiStep {
  /** What the step did — `GET /api/repos/x/violations?severity=critical`. */
  command: string
  /** What it asserted, one line; empty when it asserted nothing. */
  expectation: string
  /**
   * Each member of that expectation with what the response answered IT. Empty when
   * no response arrived — `expectation` then still says what it was going to check.
   */
  checks?: readonly EvidenceApiCheck[]
  method: string
  /** The interpolated request path, as sent. */
  path: string
  /** The request body as sent (raw or serialized JSON), when it carried one. */
  requestBody?: string
  /** HTTP status, or null when the request never completed. */
  status: number | null
  /**
   * Why no response arrived (connection refused, DNS, abort). A request spawns
   * nothing, so this is never a spawn error — the two read differently and a reader
   * must not be told the runner failed to start something.
   */
  requestError?: string
  /** The response body — the request step's "stdout", head-truncated. */
  body: string
}

export interface EvidenceStep {
  /** 1-based step index. */
  index: number
  /**
   * The step KIND, for the steps that do not spawn the entrypoint: a `git`
   * invocation, a `write`/`delete`/`patch` that only moves sandbox files (and so
   * has no exit code and no streams), a `web` step the browser took, or an `api`
   * request sent to the sandbox's served surface. Absent reads as an ordinary `run`.
   */
  kind?: 'git' | 'write' | 'delete' | 'patch' | 'web' | 'api'
  /** The browser's record, on a `web` step. See {@link EvidenceWebStep}. */
  web?: EvidenceWebStep
  /** The request's record, on an `api` step. See {@link EvidenceApiStep}. */
  api?: EvidenceApiStep
  /**
   * The command line, as the transcript shows it: the resolved argv for a spawned
   * step, and the paths a `write`/`delete`/`patch` acted on for the file steps.
   */
  argv: string[]
  /** For a `patch` step, what it set and removed — see {@link EvidencePatchOp}. */
  patch?: readonly EvidencePatchOp[]
  /**
   * The scripted input as the step declared it (tokens already resolved): the bytes
   * piped in, or the prompt-keyed answers the terminal step typed question by
   * question. Recorded in the form it was written, so a reader sees which
   * discipline delivered it.
   */
  stdin?: string | readonly GuardTtyAnswer[]
  /** Sandbox-relative working directory, when the step declared one. */
  cwd?: string
  /** True when the step ran on a pseudo-terminal (one output channel, echoed input). */
  tty?: boolean
  /**
   * The step's DECLARED env overlay (names + values), absent when it declared none.
   * Declared test data, not host state — the sandbox env itself is never transcribed,
   * so nothing a scenario did not author can appear here.
   */
  env?: Record<string, string>
  repeat: number
  iterationsRun: number
  exitCode: number | null
  timedOut: boolean
  /**
   * The ready line this step was run UNTIL, present when the runner stopped the
   * child at it. Both the transcript and the dashboard's actual line read it, so
   * neither reports our own SIGKILL as the command's outcome.
   */
  endedAtMarker?: string
  spawnError?: string
  rawStdout: string
  rawStderr: string
  normStdout: string
  normStderr: string
  durationMs: number
  /**
   * What this step CAPTURED for the steps after it (name → value). Recorded
   * because a later step's failure is only diagnosable with it: a scenario that
   * fails at step 4 on an argument step 1 produced is unreadable without the value
   * that flowed. Absent when the step captures nothing.
   */
  captured?: Record<string, string>
}

export interface WriteEvidenceParams {
  repoRoot: string
  runId: string
  scenarioId: string
  title: string
  /** Every section the scenario binds, in scenario order (the first is the primary). */
  binds: readonly GuardBinds[]
  /** The flow the scenario realizes; absent for a hand-written scenario. */
  flowId?: string
  outcome: 'pass' | 'fail' | 'error'
  steps: EvidenceStep[]
  /** 1-based index of the failing step; omitted on a `pass` (nothing failed). */
  failingStep?: number
  mismatch?: ExpectMismatch
  /**
   * The VISUAL JUDGE's verdict on the failing step's screenshot, when one was
   * reached. Carried as its own field rather than folded into the mismatch's
   * `detail` because it is categorically different from everything else there:
   * `detail` is what the runner MEASURED, this is what a model LOOKED AT. Both
   * `diff.txt` and the transcript render it from here, so they can never disagree.
   */
  visual?: GuardVisualJudgment
  infraMessage?: string
  sandboxCwd: string
  envPins: Record<string, string>
}

/** Write the transcript and return the repo-relative evidence directory. */
export function writeEvidence(params: WriteEvidenceParams): string {
  const dir = evidenceScenarioDir(params.repoRoot, params.runId, params.scenarioId)
  fs.mkdirSync(dir, { recursive: true })

  // The step whose raw streams get their own files: the failing step for a
  // fail/error, else the last executed step for a pass (its final output).
  const focus =
    params.failingStep != null
      ? params.steps.find((s) => s.index === params.failingStep)
      : params.steps[params.steps.length - 1]

  const invocation = {
    scenarioId: params.scenarioId,
    title: params.title,
    ...(params.flowId ? { flowId: params.flowId } : {}),
    binds: params.binds,
    outcome: params.outcome,
    envPins: params.envPins,
    steps: params.steps.map((s) => ({
      index: s.index,
      kind: s.kind,
      argv: s.argv,
      // A web step's record: what it did, where it ended up, and the screenshot.
      // `url` is also what the dashboard reads back as this step's ACTUAL line.
      ...(s.web
        ? {
            web: s.web,
            url: s.web.url,
            screenshot: s.web.screenshot,
          }
        : {}),
      // A request step's record: the request line, each assertion beside its
      // answer, and the response. `status` and `body` sit at the top level under
      // the names the api bundle already uses, so one reader serves both bundles.
      ...(s.api
        ? {
            api: s.api,
            status: s.api.status,
            ...(s.api.requestError ? { requestError: s.api.requestError } : {}),
            body: stepExcerpt(s.api.body),
          }
        : {}),
      patch: s.patch,
      stdin: s.stdin,
      cwd: s.cwd,
      tty: s.tty,
      env: s.env,
      repeat: s.repeat,
      iterationsRun: s.iterationsRun,
      exitCode: s.exitCode,
      timedOut: s.timedOut,
      endedAtMarker: s.endedAtMarker,
      spawnError: s.spawnError,
      captured: s.captured,
      // What THIS step printed, not just the focus step's files below — the record
      // a reader gets for every executed step, raw and head-truncated.
      stdout: stepExcerpt(s.rawStdout),
      stderr: stepExcerpt(s.rawStderr),
      durationMs: s.durationMs,
    })),
  }
  writeFile(dir, 'invocation.json', JSON.stringify(invocation, null, 2))

  if (focus) {
    writeFile(dir, 'stdout.raw.txt', focus.rawStdout)
    writeFile(dir, 'stdout.txt', focus.normStdout)
    writeFile(dir, 'stderr.raw.txt', focus.rawStderr)
    writeFile(dir, 'stderr.txt', focus.normStderr)
  }

  const diffLines: string[] = []
  if (params.outcome === 'fail' && params.mismatch) {
    diffLines.push(`step ${params.failingStep} — ${params.mismatch.subject} mismatch`, '')
    diffLines.push(`expected: ${params.mismatch.expected}`)
    diffLines.push(`actual:   ${params.mismatch.actual}`, '')
    diffLines.push(...params.mismatch.detail)
    // After the measured evidence, never instead of it: the annotation is the last
    // word a reader gets, and it is labelled as an annotation on every line.
    if (params.visual) diffLines.push('', ...visualJudgeLines(params.visual))
  } else if (params.outcome === 'error' && params.infraMessage) {
    diffLines.push(`step ${params.failingStep} — infrastructure error`, '', params.infraMessage)
  } else if (params.outcome === 'pass') {
    diffLines.push(`all ${params.steps.length} step${params.steps.length === 1 ? '' : 's'} met their expectations`)
  }
  writeFile(dir, 'diff.txt', diffLines.join('\n') + '\n')

  writeFile(dir, 'files.txt', listSandboxFiles(params.sandboxCwd).join('\n') + '\n')

  writeFile(dir, 'transcript.txt', renderTranscript(params))

  return evidenceRelPath(params.runId, params.scenarioId)
}

function renderTranscript(params: WriteEvidenceParams): string {
  const lines: string[] = []
  lines.push(`scenario: ${params.scenarioId}`)
  lines.push(`title:    ${params.title}`)
  if (params.flowId) lines.push(`flow:     ${params.flowId}`)
  for (const [i, b] of params.binds.entries()) {
    lines.push(`${i === 0 ? 'binds:   ' : '         '} ${b.doc} #${b.section}`)
  }
  lines.push(`outcome:  ${params.outcome}`)
  lines.push('')
  for (const s of params.steps) {
    lines.push(`── step ${s.index} ${s.index === params.failingStep ? '(failing)' : ''}`.trimEnd())
    // A web step has no argv and no streams: it has an action, an address, a
    // screenshot, what it asserted next to what answered each assertion, and what
    // the page showed. That is its whole record.
    if (s.web) {
      lines.push(`   web:      ${s.web.command}`)
      lines.push(`   at:       ${s.web.url}`)
      if (s.web.screenshot) lines.push(`   screen:   ${s.web.screenshot}`)
      for (const line of s.web.console ?? []) lines.push(`   console:  ${line}`)
      const checks = s.web.checks ?? []
      for (const check of checks) {
        // EVERY assertion beside ITS OWN answer. One `at:` line standing in as the
        // actual of a text assertion is what made a green step read as a red one.
        lines.push(`   ${check.ok ? '✓' : '✗'} expected: ${check.expected}`)
        lines.push(`     actual:   ${check.actual}`)
      }
      // An expectation the step never reached (its action failed first) has no
      // answers — say what it was going to check, and that nothing checked it.
      if (checks.length === 0 && s.web.expectation) {
        lines.push(`   · expected: ${s.web.expectation}`)
        lines.push(`     actual:   not evaluated — the step did not get past its action`)
      }
      lines.push(`   page text:`)
      lines.push(indent(s.web.visibleText))
      lines.push('')
      continue
    }
    // A request step has no argv and no streams either: it has a request line, a
    // status, every assertion beside ITS OWN answer, and the body it read. The
    // pairing rule is the web step's, for the same reason — one answer standing in
    // for several assertions reads as a failure on a step that passed.
    if (s.api) {
      lines.push(`   api:      ${s.api.command}`)
      if (s.api.requestBody !== undefined) lines.push(`   body:     ${JSON.stringify(s.api.requestBody)}`)
      lines.push(`   status:   ${s.api.status ?? '(no response)'}${s.timedOut ? ' [timed out]' : ''}`)
      if (s.api.requestError) lines.push(`   error:    ${s.api.requestError}`)
      const checks = s.api.checks ?? []
      for (const check of checks) {
        lines.push(`   ${check.ok ? '✓' : '✗'} expected: ${check.expected}`)
        lines.push(`     actual:   ${check.actual}`)
      }
      if (checks.length === 0 && s.api.expectation) {
        lines.push(`   · expected: ${s.api.expectation}`)
        lines.push(`     actual:   not evaluated — no response arrived`)
      }
      if (s.captured && Object.keys(s.captured).length > 0) {
        lines.push(`   capture:  ${JSON.stringify(s.captured)}`)
      }
      lines.push(`   response:`)
      lines.push(indent(s.api.body))
      lines.push('')
      continue
    }
    lines.push(`   ${isFileStepKind(s.kind) ? `${s.kind}:  ` : 'argv:   '} ${JSON.stringify(s.argv)}`)
    // A patch's operations, as authored with their tokens resolved: the file's
    // paths alone would not say what changed in it.
    for (const op of s.patch ?? []) {
      lines.push(
        op.op === 'set'
          ? `   set:     ${op.file} ${op.path} = ${op.value}`
          : `   remove:  ${op.file} ${op.path}`,
      )
    }
    if (s.cwd !== undefined) lines.push(`   cwd:     ${s.cwd}`)
    if (isPromptKeyedStdin(s.stdin)) {
      // One line per question, in the order the dialogue was scripted — the
      // transcript's answer to "what was typed, and what was it typed at".
      for (const a of s.stdin) {
        lines.push(`   answer:  ${JSON.stringify(a.answer)} at ${JSON.stringify(a.marker)}`)
      }
    } else if (s.stdin !== undefined) lines.push(`   stdin:   ${JSON.stringify(s.stdin)}`)
    if (s.tty) lines.push(`   tty:     yes (one output channel; input is echoed)`)
    if (s.env) {
      // The step's own overlay — what made THIS invocation's world differ from its siblings'.
      for (const [name, value] of Object.entries(s.env)) lines.push(`   env:     ${name}=${value}`)
    }
    if (s.repeat > 1) lines.push(`   repeat:  ${s.iterationsRun}/${s.repeat}`)
    // A file step spawns nothing: an exit code or a stream would be an invention.
    if (isFileStepKind(s.kind)) {
      lines.push('')
      continue
    }
    // A held command ends because the runner stopped it at its ready line. Saying
    // "(killed)" for that would read as an infrastructure failure on a green step.
    if (s.endedAtMarker !== undefined) lines.push(`   until:   stopped at ${JSON.stringify(s.endedAtMarker)}`)
    lines.push(
      `   exit:    ${
        s.endedAtMarker !== undefined ? '(stopped at its marker)' : (s.exitCode ?? '(killed)')
      }${s.timedOut ? ' [timed out]' : ''}`,
    )
    if (s.spawnError) lines.push(`   spawn:   ${s.spawnError}`)
    // The values this step handed forward — the api transcript's `capture:` line.
    if (s.captured && Object.keys(s.captured).length > 0) {
      lines.push(`   capture: ${JSON.stringify(s.captured)}`)
    }
    lines.push(`   stdout (normalized):`)
    lines.push(indent(s.normStdout))
    lines.push(`   stderr (normalized):`)
    lines.push(indent(s.normStderr))
    lines.push('')
  }
  if (params.outcome === 'fail' && params.mismatch) {
    lines.push(`── mismatch (step ${params.failingStep})`)
    lines.push(`   expected: ${params.mismatch.expected}`)
    lines.push(`   actual:   ${params.mismatch.actual}`)
    for (const line of params.visual ? visualJudgeLines(params.visual) : []) {
      lines.push(`   ${line}`)
    }
  } else if (params.infraMessage) {
    lines.push(`── error (step ${params.failingStep})`)
    lines.push(indent(params.infraMessage))
  }
  return lines.join('\n') + '\n'
}

function indent(text: string): string {
  const body = text.length === 0 ? '(empty)' : text
  return body
    .split('\n')
    .map((l) => `     ${l}`)
    .join('\n')
}

function writeFile(dir: string, name: string, content: string): void {
  fs.writeFileSync(path.join(dir, name), content)
}
