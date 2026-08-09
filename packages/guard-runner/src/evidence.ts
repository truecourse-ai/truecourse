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
import { isPromptKeyedStdin, type GuardBinds, type GuardTtyAnswer } from '@truecourse/shared'
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

export interface EvidenceStep {
  /** 1-based step index. */
  index: number
  /**
   * The step KIND, for the cli steps that do not spawn the entrypoint: a `git`
   * invocation, or a `write`/`delete` that only moves sandbox files (and so has no
   * exit code and no streams). Absent reads as an ordinary `run`.
   */
  kind?: 'git' | 'write' | 'delete'
  /**
   * The command line, as the transcript shows it: the resolved argv for a spawned
   * step, and the paths a `write`/`delete` acted on for the file steps.
   */
  argv: string[]
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
  spawnError?: string
  rawStdout: string
  rawStderr: string
  normStdout: string
  normStderr: string
  durationMs: number
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
      stdin: s.stdin,
      cwd: s.cwd,
      tty: s.tty,
      env: s.env,
      repeat: s.repeat,
      iterationsRun: s.iterationsRun,
      exitCode: s.exitCode,
      timedOut: s.timedOut,
      spawnError: s.spawnError,
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
    lines.push(`   ${s.kind === 'write' || s.kind === 'delete' ? `${s.kind}:  ` : 'argv:   '} ${JSON.stringify(s.argv)}`)
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
    if (s.kind === 'write' || s.kind === 'delete') {
      lines.push('')
      continue
    }
    lines.push(`   exit:    ${s.exitCode ?? '(killed)'}${s.timedOut ? ' [timed out]' : ''}`)
    if (s.spawnError) lines.push(`   spawn:   ${s.spawnError}`)
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
