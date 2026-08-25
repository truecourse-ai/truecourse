/**
 * Api-driver evidence capture — the api analog of the cli `writeEvidence`,
 * writing the same bundle layout under `.truecourse/guard/evidence/<runId>/<scenarioId>/`
 * so every downstream consumer (the dashboard evidence view, the EE blob
 * mirror) reads one shape: `invocation.json`, the focus step's raw/normalized
 * response body, `diff.txt`, `files.txt`, `transcript.txt` — plus the server's
 * own stdout/stderr (`server.stdout.txt` / `server.stderr.txt`), which is where
 * a 500's stack trace actually lives.
 *
 * `invocation.json` carries the PER-STEP ACTUALS the dashboard reads back (status,
 * duration, response-body excerpt), one record per executed step, capped exactly as
 * the cli bundle caps its streams.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { GuardBinds } from '@truecourse/shared'
import { evidenceScenarioDir, evidenceRelPath } from '../store.js'
import { listSandboxFiles } from '../sandbox.js'
import { stepExcerpt } from '../evidence.js'
import type { ApiExpectMismatch } from './expect.js'

export interface ApiEvidenceStep {
  /** 1-based step index. */
  index: number
  /**
   * What kind of step this was. Absent ⇒ `request`, so an older transcript (and
   * every request-only scenario) renders exactly as it did.
   */
  kind?: 'request' | 'boot' | 'signal' | 'logs'
  /** A lifecycle step's action + expectation, one line each — the `request` analog. */
  action?: string
  expectation?: string
  /** The interpolated request line, e.g. `GET /todos/1` (a `request` step only). */
  method?: string
  path?: string
  requestHeaders?: Record<string, string>
  /** The request body as sent (raw or serialized JSON). */
  requestBody?: string
  repeat: number
  iterationsRun: number
  status: number | null
  timedOut: boolean
  requestError?: string
  rawBody: string
  normBody: string
  durationMs: number
  /** Variables captured from this step's response. */
  captured?: Record<string, string>
}

export interface WriteApiEvidenceParams {
  repoRoot: string
  runId: string
  scenarioId: string
  title: string
  /** Every section the scenario binds, in scenario order (the first is the primary). */
  binds: readonly GuardBinds[]
  /** The flow the scenario realizes; absent for a hand-written scenario. */
  flowId?: string
  outcome: 'pass' | 'fail' | 'error'
  steps: ApiEvidenceStep[]
  /** 1-based index of the failing step; omitted on a `pass` (nothing failed). */
  failingStep?: number
  mismatch?: ApiExpectMismatch
  infraMessage?: string
  sandboxCwd: string
  envPins: Record<string, string>
  /** The server process's captured output for this scenario's boot. */
  serverLogs: { stdout: string; stderr: string }
  /**
   * Mask resolved credential values out of every written file. A credential value
   * can surface anywhere in the transcript (an echoed header, a 500 that logs the
   * request), so it is applied at the single write boundary. Defaults to identity.
   */
  redact?: (text: string) => string
}

/** Write the transcript and return the repo-relative evidence directory. */
export function writeApiEvidence(params: WriteApiEvidenceParams): string {
  const dir = evidenceScenarioDir(params.repoRoot, params.runId, params.scenarioId)
  fs.mkdirSync(dir, { recursive: true })
  const redact = params.redact ?? ((t) => t)
  const writeFile = (name: string, content: string): void =>
    fs.writeFileSync(path.join(dir, name), redact(content))

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
      ...(s.kind && s.kind !== 'request' ? { kind: s.kind, action: s.action, expectation: s.expectation } : {}),
      method: s.method,
      path: s.path,
      requestHeaders: s.requestHeaders,
      requestBody: s.requestBody,
      repeat: s.repeat,
      iterationsRun: s.iterationsRun,
      status: s.status,
      timedOut: s.timedOut,
      requestError: s.requestError,
      captured: s.captured,
      // What THIS step got back, not just the focus step's files below — the record
      // a reader gets for every executed step, raw and head-truncated.
      body: stepExcerpt(s.rawBody),
      durationMs: s.durationMs,
    })),
  }
  writeFile('invocation.json', JSON.stringify(invocation, null, 2))

  if (focus) {
    writeFile('response.raw.txt', focus.rawBody)
    writeFile('response.txt', focus.normBody)
  }
  writeFile('server.stdout.txt', params.serverLogs.stdout)
  writeFile('server.stderr.txt', params.serverLogs.stderr)

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
  writeFile('diff.txt', diffLines.join('\n') + '\n')

  writeFile('files.txt', listSandboxFiles(params.sandboxCwd).join('\n') + '\n')

  writeFile('transcript.txt', renderTranscript(params))

  return evidenceRelPath(params.runId, params.scenarioId)
}

function renderTranscript(params: WriteApiEvidenceParams): string {
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
    // A lifecycle step drives the PROCESS, not a request: it has no status, no body
    // and nothing to capture, so it renders as its action and what it asserted.
    if (s.kind && s.kind !== 'request') {
      lines.push(`   ${s.kind}:${' '.repeat(Math.max(1, 8 - s.kind.length))}${s.action ?? ''}`)
      if (s.expectation) lines.push(`   expects: ${s.expectation}`)
      lines.push('')
      continue
    }
    lines.push(`   request: ${s.method} ${s.path}`)
    if (s.requestBody !== undefined) lines.push(`   body:    ${JSON.stringify(s.requestBody)}`)
    if (s.repeat > 1) lines.push(`   repeat:  ${s.iterationsRun}/${s.repeat}`)
    lines.push(`   status:  ${s.status ?? '(no response)'}${s.timedOut ? ' [timed out]' : ''}`)
    if (s.requestError) lines.push(`   error:   ${s.requestError}`)
    if (s.captured && Object.keys(s.captured).length > 0) {
      lines.push(`   capture: ${JSON.stringify(s.captured)}`)
    }
    lines.push(`   response (normalized):`)
    lines.push(indent(s.normBody))
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
