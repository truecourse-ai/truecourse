/**
 * Evidence capture — on every EXECUTED outcome (`pass` / `fail` / `error`), write a
 * self-contained transcript under `.truecourse/guard/evidence/<runId>/<scenarioId>/`.
 * For a fail/error it decides drift-vs-bug by reading, not re-running; for a pass it
 * is the proof of what actually executed (a green guard is otherwise just a
 * checkmark). Contains the invocation, raw + normalized streams, the expectation
 * diff, and a sandbox file listing. A non-executed `stale`/`orphaned` scenario never
 * reaches here — it has no transcript.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { GuardBinds } from '@truecourse/shared'
import { evidenceScenarioDir, evidenceRelPath } from './store.js'
import { listSandboxFiles } from './sandbox.js'
import type { ExpectMismatch } from './expect.js'

export interface EvidenceStep {
  /** 1-based step index. */
  index: number
  argv: string[]
  stdin?: string
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
  binds: GuardBinds
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
    binds: params.binds,
    outcome: params.outcome,
    envPins: params.envPins,
    steps: params.steps.map((s) => ({
      index: s.index,
      argv: s.argv,
      stdin: s.stdin,
      repeat: s.repeat,
      iterationsRun: s.iterationsRun,
      exitCode: s.exitCode,
      timedOut: s.timedOut,
      spawnError: s.spawnError,
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
  lines.push(`binds:    ${params.binds.doc} #${params.binds.section}`)
  lines.push(`outcome:  ${params.outcome}`)
  lines.push('')
  for (const s of params.steps) {
    lines.push(`── step ${s.index} ${s.index === params.failingStep ? '(failing)' : ''}`.trimEnd())
    lines.push(`   argv:    ${JSON.stringify(s.argv)}`)
    if (s.stdin !== undefined) lines.push(`   stdin:   ${JSON.stringify(s.stdin)}`)
    if (s.repeat > 1) lines.push(`   repeat:  ${s.iterationsRun}/${s.repeat}`)
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
