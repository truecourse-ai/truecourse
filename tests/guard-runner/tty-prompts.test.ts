/**
 * PROMPT-KEYED TERMINAL ANSWERS — a scripted answer names the question it replies
 * to, and the runner types it only once that question has been asked.
 *
 * The subject is `relkit ship`: a preflight that holds the terminal and swallows
 * whatever is typed while it works (what every spinner does), then a select, then
 * a confirm. That is the shape the silence heuristic cannot survive, and the first
 * test pins WHY — not "it hung", but where the answers went. Everything after it
 * is the keyed discipline on the same command: an answer waits however long the
 * preflight takes, two questions get their own answers in order, a marker is
 * matched against what the program wrote rather than the decoration around it, and
 * a question that never comes fails the step instead of running out the budget.
 *
 * The unchanged HEURISTIC path — a plain `stdin` string on the prompts that always
 * worked — is covered by `step-kinds.test.ts` (`describe('tty steps')`) and by the
 * last test here, which drives this same two-question command with a plain script
 * once the preflight is out of the way.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeRecipe, writeScenario, scenario } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

/** Run one committed scenario and return its result row. */
async function run(r: string, id: string) {
  const res = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: id })
  if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
  return res.latest.scenarios[0]
}

/** What the failing (or last) step wrote, as the evidence bundle kept it. */
function evidenceStdout(r: string, evidencePath: string): string {
  return fs.readFileSync(path.join(r, evidencePath, 'stdout.txt'), 'utf-8')
}

/** A preflight long enough to have quiet gaps: 4 frames, 200ms apart (> the 150ms window). */
const SLOW_PREFLIGHT = { RELKIT_SHIP_FRAMES: '4', RELKIT_SHIP_FRAME_MS: '200' }

describe('the silence heuristic, on a command that works before it asks', () => {
  it('spends the plain answers on the preflight, and the step then hangs at the question', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'plainhang.yaml',
      scenario({
        id: 'plainhang',
        steps: [
          {
            run: ['ship'],
            tty: true,
            env: SLOW_PREFLIGHT,
            // The old form: bytes, delivered whenever the child pauses. The pauses
            // between spinner frames come first, so both answers are typed into a
            // preflight that swallows them, and nothing is left for the questions.
            stdin: '\ry',
            timeoutMs: 2500,
            expect: { exit: 0 },
          },
        ],
      }),
    )
    const result = await run(r, 'plainhang')
    expect(result.outcome).toBe('error')
    expect(result.failure?.actual).toContain('step timed out after 2500ms')
    // Where the answers went, in the program's own words — and the question that
    // was still waiting when the budget ran out.
    const out = evidenceStdout(r, result.evidencePath!)
    expect(out).toContain('preflight swallowed 2 keystroke(s)')
    expect(out).toContain('Release channel for relkit')
    expect(out).not.toContain('Shipped relkit')
  })
})

describe('prompt-keyed answers', () => {
  it('waits for the question, however long the command works before asking it', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'keyedwait.yaml',
      scenario({
        id: 'keyedwait',
        steps: [
          {
            run: ['ship'],
            tty: true,
            env: SLOW_PREFLIGHT,
            stdin: [
              { marker: 'Release channel for relkit', answer: '\r' },
              { marker: 'Publish relkit v2.4.1?', answer: 'y' },
            ],
            timeoutMs: 10_000,
            expect: {
              exit: 0,
              output: { contains: 'Shipped relkit v2.4.1 to stable' },
              files: { 'shipped.txt': { contains: 'stable' } },
            },
          },
        ],
      }),
    )
    const result = await run(r, 'keyedwait')
    expect(result.outcome).toBe('pass')
    // Nothing was typed at the preflight: the answers waited for their questions.
    expect(evidenceStdout(r, result.evidencePath!)).toContain('preflight swallowed 0 keystroke(s)')
  })

  it('answers two questions in sequence, each with its own keys', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'keyedseq.yaml',
      scenario({
        id: 'keyedseq',
        steps: [
          {
            run: ['ship'],
            tty: true,
            env: SLOW_PREFLIGHT,
            stdin: [
              // Arrow then Enter at the menu — keys, in one answer…
              { marker: 'Release channel for relkit', answer: '\u001b[B\r' },
              // …then the decline at the confirm, which the exit code carries.
              { marker: 'Publish relkit v2.4.1?', answer: 'n' },
            ],
            timeoutMs: 10_000,
            expect: {
              exit: 1,
              output: { contains: 'Publish cancelled' },
              files: { 'shipped.txt': { absent: true } },
            },
          },
        ],
      }),
    )
    expect((await run(r, 'keyedseq')).outcome).toBe('pass')
  })

  it('matches the marker against what the program WROTE, not the terminal decoration', async () => {
    // `ship` writes the confirm as `Publish <bold>relkit v2.4.1</bold>? [y/N] `, so
    // this marker only spans the question once the escapes are out of the way — and
    // the preflight redraws its line with cursor/erase codes throughout.
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'keyedansi.yaml',
      scenario({
        id: 'keyedansi',
        steps: [
          {
            run: ['ship'],
            tty: true,
            env: { RELKIT_SHIP_FRAMES: '2', RELKIT_SHIP_FRAME_MS: '200' },
            stdin: [
              { marker: 'Release channel for relkit v2.4.1:', answer: '\r' },
              { marker: 'Publish relkit v2.4.1? [y/N]', answer: 'y' },
            ],
            timeoutMs: 10_000,
            expect: { exit: 0, files: { 'shipped.txt': { contains: 'stable' } } },
          },
        ],
      }),
    )
    expect((await run(r, 'keyedansi')).outcome).toBe('pass')
  })

  it('fails the step — naming the question — when it is never asked', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'keyedmissing.yaml',
      scenario({
        id: 'keyedmissing',
        steps: [
          {
            // A command that asks nothing at all: the answer's question never comes,
            // and the step must say so rather than wait out its budget.
            run: ['whoami'],
            tty: true,
            stdin: [{ marker: 'Publish relkit v2.4.1?', answer: 'y' }],
            timeoutMs: 10_000,
            expect: { exit: 0 },
          },
        ],
      }),
    )
    const result = await run(r, 'keyedmissing')
    expect(result.outcome).toBe('fail')
    expect(result.failure?.expected).toBe('the command to ask “Publish relkit v2.4.1?”')
    expect(result.failure?.actual).toContain('the question was never asked')
    expect(result.failure?.actual).toContain('exited with code 0')
    // Fast, not timed out: the step settled the moment the command was gone.
    expect(result.durationMs).toBeLessThan(10_000)
    const diff = fs.readFileSync(path.join(r, result.evidencePath!, 'diff.txt'), 'utf-8')
    expect(diff).toContain('prompt mismatch')
    expect(diff).toContain('Publish relkit v2.4.1?')
  })

  it('records each answer beside the question it was typed at', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'keyedev.yaml',
      scenario({
        id: 'keyedev',
        steps: [
          {
            run: ['ship'],
            tty: true,
            env: { RELKIT_SHIP_FRAMES: '1', RELKIT_SHIP_FRAME_MS: '50' },
            stdin: [
              { marker: 'Release channel for relkit', answer: '\r' },
              { marker: 'Publish relkit v2.4.1?', answer: 'y' },
            ],
            timeoutMs: 10_000,
            expect: { exit: 0 },
          },
        ],
      }),
    )
    const result = await run(r, 'keyedev')
    expect(result.outcome).toBe('pass')
    const invocation = JSON.parse(
      fs.readFileSync(path.join(r, result.evidencePath!, 'invocation.json'), 'utf-8'),
    )
    expect(invocation.steps[0].stdin).toEqual([
      { marker: 'Release channel for relkit', answer: '\r' },
      { marker: 'Publish relkit v2.4.1?', answer: 'y' },
    ])
    const transcript = fs.readFileSync(path.join(r, result.evidencePath!, 'transcript.txt'), 'utf-8')
    expect(transcript).toContain('answer:  "\\r" at "Release channel for relkit"')
    expect(transcript).toContain('answer:  "y" at "Publish relkit v2.4.1?"')
  })
})

describe('the plain script still drives the prompts it always did', () => {
  it('answers the same two questions when nothing works in front of them', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'plainseq.yaml',
      scenario({
        id: 'plainseq',
        steps: [
          {
            run: ['ship'],
            tty: true,
            // No preflight: the only pauses are the prompts themselves, which is the
            // world the silence heuristic was written for. Same bytes as the hanging
            // case above — what changed is only what happens before the question.
            env: { RELKIT_SHIP_FRAMES: '0' },
            stdin: '\ry',
            timeoutMs: 10_000,
            expect: { exit: 0, files: { 'shipped.txt': { contains: 'stable' } } },
          },
        ],
      }),
    )
    expect((await run(r, 'plainseq')).outcome).toBe('pass')
  })
})
