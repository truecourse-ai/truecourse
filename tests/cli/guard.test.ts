import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import { guardGenerateInProcess, GUARD_GENERATE_STEPS } from '@truecourse/core/commands/guard-in-process'
import { StepTracker, type AnalysisProgressPayload } from '@truecourse/core/progress'
import { composeGuardStatus, orderGuardDrifts } from '@truecourse/shared'
import {
  writeGuardLatest,
  writeGuardResult,
  readGuardResult,
  guardResultPath,
  writeManifest,
} from '@truecourse/guard-runner'
import {
  GuardGenerateReportSchema,
  GUARD_FORMAT_VERSION,
  type GuardManifest,
  type GuardManifestFlow,
  type GuardLatest,
  type GuardScenarioResult,
  type GuardOutcome,
  type GuardGenerateReport,
} from '@truecourse/shared'
import {
  runGuardRun,
  runGuardStatus,
  runGuardDrifts,
  printGuardGenerateSummary,
  guardGenerateOutro,
  recipeFailureLines,
  authorFailureLine,
  collapseAuthoringErrors,
} from '../../tools/cli/src/commands/guard'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeApiRecipe,
  writeDoc,
  writeCorpus,
  extractBy,
  workerTurnBy,
  raw,
  faithfulReviewer,
  flowStageRunners,
  stampMilestones,
  PASSING_STEPS,
  FAILING_STEPS,
} from '../guard-generator/helpers.js'
import {
  writeRecipe as writeRunRecipe,
  writeScenario as writeRunScenario,
  scenario as scenarioDef,
  specBinds,
} from '../guard-runner/helpers.js'
import { execSync } from 'node:child_process'
import { recordStageUsage, getLlmCallSink } from '@truecourse/shared/llm'
import path from 'node:path'
import type { GenerateRunner, FidelityRunner } from '@truecourse/guard-generator'

const repos: string[] = []
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

const DOC = 'docs/cli.md'
const DOC_CONTENT = [
  '## version',
  '`relkit --version` prints the version and exits 0.',
  '',
  '## background',
  'The history of relkit; nothing externally observable here.',
].join('\n')

// ---------------------------------------------------------------------------
// Report persisted at the end of a generate (runner-injection, no real LLM).
// ---------------------------------------------------------------------------

describe('guardGenerateInProcess — persisted report', () => {
  it('writes a schema-valid guard/result.json after a completed generate', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const { guard } = await guardGenerateInProcess(r, {
      ...flowStageRunners(r),
      extractRunner: extractBy({ background: { untestable: 'design history' } }),
      turnFn: workerTurnBy({ version: raw('relkit --version exits 0', PASSING_STEPS) }),
      fidelityRunner: faithfulReviewer(),
    })

    expect(guard.status).toBe('ok')
    expect(fs.existsSync(guardResultPath(r))).toBe(true)

    const report = readGuardResult(r)
    expect(report).not.toBeNull()
    expect(() => GuardGenerateReportSchema.parse(report)).not.toThrow()
    expect(report!.status).toBe('ok')
    expect(report!.written.map((w) => w.flowId)).toEqual(['version'])
    expect(report!.birthPassed).toBe(1)
    expect(report!.coverageGaps.map((g) => g.kind)).toContain('untestable')
    expect(report!.generatedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    // Injected runners bypass the transport, so no usage is recorded.
    expect(report!.usage).toBeUndefined()
  })

  it('writes the report even on a noChanges no-op', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const runners = {
      ...flowStageRunners(r),
      extractRunner: extractBy({ background: { untestable: 'history' } }),
      turnFn: workerTurnBy({ version: raw('v', PASSING_STEPS) }),
      fidelityRunner: faithfulReviewer(),
    }
    await guardGenerateInProcess(r, runners)
    fs.rmSync(guardResultPath(r)) // prove the second run rewrites it

    const { guard } = await guardGenerateInProcess(r, runners)
    expect(guard.noChanges).toBe(true)
    expect(fs.existsSync(guardResultPath(r))).toBe(true)
    expect(readGuardResult(r)!.noChanges).toBe(true)
  })

  it('does NOT write the report when the estimate gate declines', async () => {
    const r = repo()
    // No recipe.json → the estimate carries a recipe-discovery stage → the gate fires.
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    await expect(
      guardGenerateInProcess(r, { onLlmEstimate: async () => false }),
    ).rejects.toThrow(/declined/)

    expect(fs.existsSync(guardResultPath(r))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Per-call LLM logging is installed at the in-process driver — the seam BOTH
// the CLI and the dashboard route through, so neither can run untraced.
// ---------------------------------------------------------------------------

describe('guardGenerateInProcess — per-call LLM log', () => {
  const llmLogFiles = (r: string): string[] => {
    const d = path.join(r, '.truecourse', 'logs')
    return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.startsWith('llm-guard-generate-')) : []
  }

  it('writes a per-run call log and clears the global sink when the run ends', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    await guardGenerateInProcess(r, {
      ...flowStageRunners(r),
      extractRunner: extractBy({ background: { untestable: 'design history' } }),
      turnFn: workerTurnBy({ version: raw('relkit --version exits 0', PASSING_STEPS) }),
      fidelityRunner: faithfulReviewer(),
    })

    const files = llmLogFiles(r)
    expect(files.some((f) => f.endsWith('.jsonl'))).toBe(true)
    expect(files.some((f) => f.endsWith('.summary.json'))).toBe(true)
    // Teardown: the process-global slot must not outlive the run that filled it
    // (it is a single slot — a leaked sink would capture the NEXT run's calls).
    expect(getLlmCallSink()).toBeUndefined()
  })

  it('clears the sink even when the generate throws', async () => {
    const r = repo()
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    await expect(guardGenerateInProcess(r, { onLlmEstimate: async () => false })).rejects.toThrow()
    expect(getLlmCallSink()).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Grounding progress reaches the tracker (CLI + dashboard consume the same one).
// ---------------------------------------------------------------------------

describe('guardGenerateInProcess — the author step counter', () => {
  /** Collect every distinct detail the author step showed across the run. */
  function trackAuthorDetails(): { tracker: StepTracker; details: string[] } {
    const details: string[] = []
    const tracker = new StepTracker((payload: AnalysisProgressPayload) => {
      const author = payload.steps?.find((s) => s.key === 'author')
      if (author?.detail && details[details.length - 1] !== author.detail) details.push(author.detail)
    }, GUARD_GENERATE_STEPS.map((s) => ({ ...s })))
    return { tracker, details }
  }

  it('shows the plain flow-scenario counter (authoring probes are gone with the worker path)', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const { tracker, details } = trackAuthorDetails()
    await guardGenerateInProcess(r, {
      tracker,
      ...flowStageRunners(r),
      extractRunner: extractBy({
        version: [{ claim: '`--version` prints the version and exits 0' }],
        background: { untestable: 'design history' },
      }),
      turnFn: workerTurnBy({ version: raw('v', PASSING_STEPS) }),
      fidelityRunner: faithfulReviewer(),
    })

    expect(details.some((d) => /\d+\/\d+ flow scenario/.test(d))).toBe(true)
    expect(details.some((d) => d.includes('grounding'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Authoring failures surface LIVE — the hook fires per failed attempt, the CLI
// renders a warn line, and the flow counter gains a "· N failed" reading.
// ---------------------------------------------------------------------------

describe('guardGenerateInProcess — live authoring failures', () => {
  /** Collect every distinct validate detail — where the flow counter lives. */
  function trackValidateDetails(): { tracker: StepTracker; details: string[] } {
    const details: string[] = []
    const tracker = new StepTracker((payload: AnalysisProgressPayload) => {
      const step = payload.steps?.find((s) => s.key === 'validate')
      if (step?.detail && details[details.length - 1] !== step.detail) details.push(step.detail)
    }, GUARD_GENERATE_STEPS.map((s) => ({ ...s })))
    return { tracker, details }
  }

  // Two testable sections: `version` authors fine (so birth runs and the validate
  // line is LIVE), `help` times out — the failure the counter must show.
  const TWO_DOC = 'docs/two.md'
  const TWO_CONTENT = [
    '## version',
    '`relkit --version` prints the version and exits 0.',
    '',
    '## help',
    '`relkit --version` also answers here and exits 0.',
  ].join('\n')

  const oneFlowExplodes = () =>
    workerTurnBy({
      help: { throws: 'claude timed out after 600000ms' },
      version: raw('version exits 0', PASSING_STEPS),
    })

  function seedRepo(): string {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: TWO_DOC }])
    writeDoc(r, TWO_DOC, TWO_CONTENT)
    return r
  }

  it('forwards each failed attempt and counts the given-up flows on the live counter', async () => {
    const r = seedRepo()
    const { tracker, details } = trackValidateDetails()
    const seen: string[] = []

    await guardGenerateInProcess(r, {
      tracker,
      ...flowStageRunners(r),
      extractRunner: extractBy({}),
      turnFn: oneFlowExplodes(),
      fidelityRunner: faithfulReviewer(),
      onAuthorFailure: (f) => seen.push(`${f.flowId} ${f.reason} ${f.willRetry}`),
    })

    expect(seen).toEqual(['help worker session ended: turn-error — timed out after 10m false'])
    expect(details.some((d) => d.includes('1 failed'))).toBe(true)
  })

  it('leaves the counter alone for a caller that wires no failure sink (the dashboard popup)', async () => {
    const r = seedRepo()
    const { tracker, details } = trackValidateDetails()

    await guardGenerateInProcess(r, {
      tracker,
      ...flowStageRunners(r),
      extractRunner: extractBy({}),
      turnFn: oneFlowExplodes(),
      fidelityRunner: faithfulReviewer(),
    })

    expect(details.some((d) => d.includes('failed'))).toBe(false)
    expect(details.some((d) => /flows \d+\/\d+/.test(d))).toBe(true)
  })
})

describe('authorFailureLine', () => {
  const failure = {
    flowId: 'create-a-task',
    flowTitle: 'Create a task',
    surface: 'cli' as const,
    doc: 'docs/cli.md',
    anchor: 'tasks/add',
    reason: 'timed out after 10m',
  }

  it('says a re-ask is coming when one is', () => {
    expect(authorFailureLine({ ...failure, reason: 'invalid output', attempt: 1, willRetry: true })).toBe(
      '✗ create-a-task · cli — invalid output, retrying (2/2)',
    )
  })

  it('says the flow was given up on when it was', () => {
    expect(authorFailureLine({ ...failure, attempt: 1, willRetry: false })).toBe(
      '✗ create-a-task · cli — timed out after 10m; flow failed, will retry next generate',
    )
  })
})

describe('collapseAuthoringErrors', () => {
  it('keys on the FLOW when the error names one, else the section leaf', () => {
    expect(
      collapseAuthoringErrors([
        { doc: 'd.md', anchor: 'a/b', flowId: 'flow-1', message: 'authoring (cli) call failed: timed out after 600000ms' },
        { doc: 'd.md', anchor: 'a/c', message: 'boom' },
      ]).map((u) => u.subject),
    ).toEqual(['flow-1', 'c'])
  })

  it('leads with the first message when the reasons disagree, and counts the rest', () => {
    expect(
      collapseAuthoringErrors([
        { doc: 'd.md', anchor: 'a/b', flowId: 'f', message: 'authoring (cli) call failed: timed out after 600000ms' },
        { doc: 'd.md', anchor: 'a/b', flowId: 'f', message: 'something else entirely' },
      ])[0].reason,
    ).toMatch(/\(\+1 more\)$/)
  })
})

// ---------------------------------------------------------------------------
// Extract step units: live "views X/Y" (planned denominator from the first
// tick), completed "N doc(s) · M view(s)" — the same units end to end.
// ---------------------------------------------------------------------------

describe('guardGenerateInProcess — extract step units', () => {
  /** Collect every distinct extract detail, split by live vs completed. */
  function trackExtractDetails(): { tracker: StepTracker; live: string[]; done: string[] } {
    const live: string[] = []
    const done: string[] = []
    const tracker = new StepTracker((payload: AnalysisProgressPayload) => {
      const step = payload.steps?.find((s) => s.key === 'extract')
      if (!step?.detail) return
      const bucket = step.status === 'done' ? done : live
      if (bucket[bucket.length - 1] !== step.detail) bucket.push(step.detail)
    }, GUARD_GENERATE_STEPS.map((s) => ({ ...s })))
    return { tracker, live, done }
  }

  it('live counter shows "views X/Y" with the planned denominator from the start; completion reports docs AND views', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const { tracker, live, done } = trackExtractDetails()
    await guardGenerateInProcess(r, {
      tracker,
      ...flowStageRunners(r),
      extractRunner: extractBy({ background: { untestable: 'history' } }),
      turnFn: workerTurnBy({ version: raw('v', PASSING_STEPS) }),
      fidelityRunner: faithfulReviewer(),
    })

    // Every live tick carries the denominator — never a bare count.
    expect(live.length).toBeGreaterThan(0)
    for (const d of live) expect(d).toMatch(/^views \d+\/\d+/)
    // The planned total is visible before the first view resolves (0/N).
    expect(live[0]).toMatch(/^views 0\/\d+/)
    // Completed line keeps both units: one doc read, one extraction view called.
    expect(done).toHaveLength(1)
    expect(done[0]).toMatch(/^1 doc · 1 view\b/)
  })
})

// ---------------------------------------------------------------------------
// Early aborts (no corpus, an unusable recipe) must tick NO phase that never
// ran — "Authoring — 0 tests written" / "Birth-validating — 0/0 flows settled"
// for work that never happened is a lie the CLI and the dashboard popup would
// both tell (they render the same steps payload).
// ---------------------------------------------------------------------------

describe('guardGenerateInProcess — an early abort ticks no phase that never ran', () => {
  /** The LAST checklist the tracker emitted — what the terminal is left showing. */
  function trackSteps(): { tracker: StepTracker; last: () => AnalysisProgressPayload['steps'] } {
    let steps: AnalysisProgressPayload['steps']
    const tracker = new StepTracker((payload: AnalysisProgressPayload) => {
      if (payload.steps) steps = payload.steps
    }, GUARD_GENERATE_STEPS.map((s) => ({ ...s })))
    return { tracker, last: () => steps }
  }

  it('no-docs: the step it died in errors, every later step stays pending and detail-free', async () => {
    const r = repo() // no corpus at all
    const { tracker, last } = trackSteps()

    const { guard } = await guardGenerateInProcess(r, { tracker })

    expect(guard.status).toBe('no-docs')
    const steps = last()!
    expect(steps.find((s) => s.key === 'index')!.status).toBe('error')
    for (const key of ['extract', 'journeys', 'flows', 'match', 'author', 'validate']) {
      const step = steps.find((s) => s.key === key)!
      expect(step.status).toBe('pending')
      expect(step.detail).toBeUndefined()
    }
    // No phantom counters anywhere in what the user was left looking at.
    expect(steps.map((s) => s.detail ?? '').join(' ')).not.toMatch(/tests? written|flows? settled/)
  })

  it('recipe-failed: same — no "0 tests written", no "0/0 flows settled"', async () => {
    const r = repo()
    // The no-LLM route to `recipe-failed`: a credential whose `satisfies` names no
    // scheme in any corpus doc, rejected before the first paid call.
    writeApiRecipe(r, {
      entry: null,
      credentials: { 'api-key': { header: 'X-API-Key', valueFromEnv: 'API_KEY', satisfies: 'noSuchScheme' } },
    })
    writeCorpus(r, [{ ref: 'api/openapi.yaml' }])
    writeDoc(
      r,
      'api/openapi.yaml',
      [
        'openapi: 3.0.0',
        "info: { title: t, version: '1' }",
        'components:',
        '  securitySchemes:',
        '    apiKeyAuth: { type: apiKey, in: header, name: X-API-Key }',
        'paths:',
        '  /me:',
        '    get:',
        '      operationId: getMe',
        '      security: [{ apiKeyAuth: [] }]',
        "      responses: { '200': { description: ok } }",
      ].join('\n'),
    )
    const { tracker, last } = trackSteps()

    const { guard } = await guardGenerateInProcess(r, {
      tracker,
      journeys: async () => ({ journeys: [] }),
      extractRunner: async () => {
        throw new Error('extraction must not run — the recipe was rejected')
      },
    })

    expect(guard.status).toBe('recipe-failed')
    const steps = last()!
    // It died in the step it was in — errored, with the reason's first line.
    const errored = steps.filter((s) => s.status === 'error')
    expect(errored).toHaveLength(1)
    expect(errored[0].detail).toContain('noSuchScheme')
    expect(steps.filter((s) => s.status === 'done').map((s) => s.key)).not.toContain('author')
    for (const key of ['author', 'validate']) {
      expect(steps.find((s) => s.key === key)!.status).toBe('pending')
      expect(steps.find((s) => s.key === key)!.detail).toBeUndefined()
    }
    // The abort still persists its report — only the phantom ticks went away.
    expect((await readGuardResult(r))?.status).toBe('recipe-failed')
  })
})

// ---------------------------------------------------------------------------
// The `recipe-failed` printer: a guided (multi-line) reason renders readably.
// ---------------------------------------------------------------------------

describe('recipeFailureLines', () => {
  it('keeps a multi-line reason multi-line, indenting the detail under the headline', () => {
    const reason = [
      'the app depends on a database (drizzle-orm/postgres detected) and no datastore was reachable at boot',
      '  • start your database, or',
      '',
      'api server `node dist/index.js` did not start: Database error: Failed query',
    ].join('\n')

    const { headline, detail } = recipeFailureLines(reason)

    expect(headline).toBe(
      'Recipe unusable: the app depends on a database (drizzle-orm/postgres detected) and no datastore was reachable at boot',
    )
    // Every later line survives on its own line — blanks preserved as blanks.
    expect(detail).toEqual(['    • start your database, or', '', '  api server `node dist/index.js` did not start: Database error: Failed query'])
  })

  it('a single-line reason has no detail, and an absent one still says something', () => {
    expect(recipeFailureLines('nope')).toEqual({ headline: 'Recipe unusable: nope', detail: [] })
    expect(recipeFailureLines(undefined).headline).toBe('Recipe unusable: recipe discovery failed')
  })
})

// ---------------------------------------------------------------------------
// `guard run` output: passes stay in the live counter, non-pass results stream
// inline as they settle, the close is a counts summary (+ drift pointers on
// non-green runs); `--verbose` restores the full per-scenario listing.
// ---------------------------------------------------------------------------

describe('runGuardRun — output shape', () => {
  function gitInit(r: string): void {
    execSync('git init -q -b main', { cwd: r })
  }

  /** Run `guard run` capturing stdout (clack) + stderr (renderer) and the exit code. */
  async function captureRun(
    r: string,
    opts: { verbose?: boolean } = {},
  ): Promise<{ out: string; err: string; exitCode: number | null }> {
    let exitCode: number | null = null
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code ?? 0
      throw new Error(`process.exit(${code})`)
    }) as never)
    const capture = (chunks: string[]) =>
      ((chunk: unknown, ...rest: unknown[]) => {
        chunks.push(typeof chunk === 'string' ? chunk : String(chunk))
        const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined
        cb?.()
        return true
      }) as never
    const outChunks: string[] = []
    const errChunks: string[] = []
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(capture(outChunks))
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(capture(errChunks))
    try {
      await runGuardRun({ cwd: r, verbose: opts.verbose })
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith('process.exit(')) throw e
    } finally {
      outSpy.mockRestore()
      errSpy.mockRestore()
      exitSpy.mockRestore()
    }
    return { out: outChunks.join(''), err: errChunks.join(''), exitCode }
  }

  it('default: no per-pass lines; non-pass results stream inline; drift close = counts + pointers', async () => {
    const r = repo()
    gitInit(r)
    writeRunRecipe(r)
    writeRunScenario(
      r,
      'cli/ver.yaml',
      scenarioDef({ id: 'ver', title: 'prints the version', binds: specBinds('cli/version'), steps: [{ run: ['--version'], expect: { exit: 0 } }] }),
    )
    writeRunScenario(
      r,
      'cli/boom.yaml',
      scenarioDef({ id: 'boom.fail', title: 'boom exits clean', binds: specBinds('cli/boom'), steps: [{ run: ['boom'], expect: { exit: 0 } }] }),
    )
    writeRunScenario(
      r,
      'cli/stale.yaml',
      scenarioDef({
        id: 'stale1',
        title: 'edited section',
        binds: specBinds('cli/whoami').map((b) => ({ ...b, fingerprint: 'sha256:bogus' })),
        steps: [{ run: ['whoami'], expect: { exit: 0 } }],
      }),
    )

    const { out, err, exitCode } = await captureRun(r)

    // Passing scenarios never print a ✓ line — they live in the counter + counts.
    expect(out).not.toContain('✓ ver')
    expect(err).not.toContain('✓ ver')
    // Non-pass results streamed inline (renderer log), a full line each with icon.
    expect(err).toMatch(/✗ boom\.fail — boom exits clean {2}\(\d+ms\)/)
    expect(err).toContain('~ stale1 — edited section  — section edited since binding')
    // The close: counts per outcome + pointers; the expected/actual dump is gone.
    expect(out).toContain('1 passed · 1 failed · 1 stale')
    expect(out).toContain('truecourse guard drifts')
    expect(out).not.toContain('expected:')
    expect(exitCode).toBe(1)
  })

  it('green run: terse close — counts + outro, no scenario listing, no drift pointers', async () => {
    const r = repo()
    gitInit(r)
    writeRunRecipe(r)
    writeRunScenario(
      r,
      'cli/ver.yaml',
      scenarioDef({ id: 'ver', title: 'prints the version', binds: specBinds('cli/version'), steps: [{ run: ['--version'], expect: { exit: 0 } }] }),
    )
    writeRunScenario(
      r,
      'cli/who.yaml',
      scenarioDef({ id: 'who', title: 'whoami works', binds: specBinds('cli/whoami'), steps: [{ run: ['whoami'], expect: { exit: 0 } }] }),
    )

    const { out, err, exitCode } = await captureRun(r)

    expect(out).toContain('2 passed')
    expect(out).toContain('All sections guarded.')
    expect(out).not.toMatch(/✓ (ver|who) —/)
    expect(err).not.toMatch(/✓ (ver|who) —/)
    expect(out).not.toContain('truecourse guard drifts')
    expect(exitCode).toBeNull()
  })

  it('--verbose restores the per-scenario ✓ listing', async () => {
    const r = repo()
    gitInit(r)
    writeRunRecipe(r)
    writeRunScenario(
      r,
      'cli/ver.yaml',
      scenarioDef({ id: 'ver', title: 'prints the version', binds: specBinds('cli/version'), steps: [{ run: ['--version'], expect: { exit: 0 } }] }),
    )

    const { out } = await captureRun(r, { verbose: true })
    expect(out).toMatch(/✓ ver — prints the version {2}\(\d+ms\)/)
  })
})

// ---------------------------------------------------------------------------
// Sections-led birth line + retry spend attribution (stage guard.retry).
// ---------------------------------------------------------------------------

describe('guardGenerateInProcess — flow-led birth line + retry usage', () => {
  /** Collect every distinct detail the validate (birth) step showed across the run. */
  function trackValidateDetails(): { tracker: StepTracker; details: string[] } {
    const details: string[] = []
    const tracker = new StepTracker((payload: AnalysisProgressPayload) => {
      const step = payload.steps?.find((s) => s.key === 'validate')
      if (step?.detail && details[details.length - 1] !== step.detail) details.push(step.detail)
    }, GUARD_GENERATE_STEPS.map((s) => ({ ...s })))
    return { tracker, details }
  }

  it('leads the birth line with the fixed flow denominator and a plain birth count', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const { tracker, details } = trackValidateDetails()
    await guardGenerateInProcess(r, {
      tracker,
      ...flowStageRunners(r),
      extractRunner: extractBy({ background: { untestable: 'history' } }),
      turnFn: workerTurnBy({ version: raw('v', PASSING_STEPS) }),
      fidelityRunner: faithfulReviewer(),
    })

    // Every live line leads with the run's flow denominator (one flow for DOC).
    const live = details.filter((d) => /^flows /.test(d))
    expect(live.length).toBeGreaterThan(0)
    expect(live.every((d) => /^flows \d+\/1 · (building…|birth \d+)/.test(d))).toBe(true)
    // The birth count carries NO denominator — its total grows across rounds.
    expect(live.some((d) => /birth \d+\//.test(d))).toBe(false)
  })

  it('shows retrying R/T for a session RESUME (the in-loop heal) and totals worker spend under guard.generate', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    // A HIGH-confidence flag on the first review resumes the still-open session
    // once (the heal); the revised settle reviews faithful. The turn fn records
    // usage the way the transport would: every worker turn under guard.generate.
    let reviews = 0
    const reviewer: FidelityRunner = async () => {
      recordStageUsage('guard.fidelity', { model: 'fidelity-model', inputTokens: 80, outputTokens: 10, costUsd: 0.1 })
      return reviews++ === 0
        ? { verdict: 'flagged', mismatch: 'asserts less than the claim', confidence: 'high' }
        : { verdict: 'faithful' }
    }
    // The resumed session REVISES the scenario (the retry half), as a real heal
    // does — an identical re-settle would re-read the cached flagged review.
    const inner = workerTurnBy({
      version: { first: raw('v', PASSING_STEPS), retry: raw('v revised', PASSING_STEPS) },
    })
    const turnFn: typeof inner = async (req) => {
      recordStageUsage('guard.generate', { model: 'gen-model', inputTokens: 100, outputTokens: 50, costUsd: 0.25 })
      return inner(req)
    }

    const { tracker, details } = trackValidateDetails()
    const { guard } = await guardGenerateInProcess(r, {
      tracker,
      ...flowStageRunners(r),
      extractRunner: extractBy({ background: { untestable: 'history' } }),
      turnFn,
      fidelityRunner: reviewer,
    })
    expect(guard.written.map((w) => w.flowId)).toEqual(['version'])

    // The resume counter rides the SAME validate line the old retry counter did.
    expect(details.some((d) => /retrying \d+\/1/.test(d))).toBe(true)

    // result.json totals include every worker turn under guard.generate plus the
    // two reviews under guard.fidelity.
    const report = readGuardResult(r)!
    expect(report.usage).toEqual({
      calls: 4 + 2, // 2 session turns + 2 resume turns, and 2 reviews
      inputTokens: 4 * 100 + 2 * 80,
      outputTokens: 4 * 50 + 2 * 10,
      costUsd: 4 * 0.25 + 2 * 0.1,
    })
  })

  it('shows the fidelity counter on the birth line and totals fidelity spend under guard.fidelity', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    // The reviewer records usage the way the transport would — under guard.fidelity.
    const reviewer: FidelityRunner = async () => {
      recordStageUsage('guard.fidelity', { model: 'fidelity-model', inputTokens: 80, outputTokens: 10, costUsd: 0.1 })
      return { verdict: 'faithful' }
    }

    const { tracker, details } = trackValidateDetails()
    const { guard } = await guardGenerateInProcess(r, {
      tracker,
      ...flowStageRunners(r),
      extractRunner: extractBy({ background: { untestable: 'history' } }),
      turnFn: workerTurnBy({ version: raw('v', PASSING_STEPS) }),
      fidelityRunner: reviewer,
    })
    expect(guard.written.map((w) => w.flowId)).toEqual(['version'])

    // The fidelity counter rides the SAME validate (birth) line.
    expect(details.some((d) => /^flows \d+\/1 · .*fidelity 1/.test(d))).toBe(true)

    // result.json totals include the fidelity-review spend under the new stage.
    const report = readGuardResult(r)!
    expect(report.usage).toEqual({ calls: 1, inputTokens: 80, outputTokens: 10, costUsd: 0.1 })
  })
})

// ---------------------------------------------------------------------------
// The flow-led progress steps the CLI renders (`Mapping journeys` /
// `Synthesizing flows` / `Matching flows`): every long stage ticks a live
// counter, and the LLM-backed ones carry their model/spend tag.
// ---------------------------------------------------------------------------

describe('guardGenerateInProcess — flow-led progress steps', () => {
  it('renders the three flow steps with live counters, and a usage tag on the LLM ones', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    // Every step's every distinct (label, detail) as the CLI's renderer would paint it.
    const painted = new Map<string, { label: string; details: string[] }>()
    const tracker = new StepTracker((payload: AnalysisProgressPayload) => {
      for (const step of payload.steps ?? []) {
        const seen = painted.get(step.key) ?? { label: step.label, details: [] }
        if (step.detail && step.status !== 'pending' && !seen.details.includes(step.detail)) {
          seen.details.push(step.detail)
        }
        painted.set(step.key, seen)
      }
    }, GUARD_GENERATE_STEPS.map((s) => ({ ...s })))

    await guardGenerateInProcess(r, {
      tracker,
      ...flowStageRunners(r),
      flowsRunner: async (ctx) => {
        recordStageUsage('guard.flows', { model: 'flows-model', inputTokens: 40, outputTokens: 10, costUsd: 0.3 })
        return {
          flows: ctx.claims.map((c) => ({
            title: c.anchor,
            goal: `verify ${c.claim}`,
            milestones: [{ order: 1, doc: c.doc, anchor: c.anchor, claimTitle: c.claim }],
          })),
          noFlowClaims: [],
        }
      },
      matchRunner: async (ctx) => {
        recordStageUsage('guard.match', { model: 'match-model', inputTokens: 20, outputTokens: 5, costUsd: 0.2 })
        return { plan: ctx.milestones.map((m) => ({ journeyId: ctx.journeys[0].id, milestone: m.order })) }
      },
      extractRunner: extractBy({ background: { untestable: 'history' } }),
      turnFn: workerTurnBy({ version: raw('v', PASSING_STEPS) }),
      fidelityRunner: faithfulReviewer(),
    })

    expect(painted.get('journeys')?.label).toBe('Mapping journeys')
    expect(painted.get('flows')?.label).toBe('Synthesizing flows')
    expect(painted.get('match')?.label).toBe('Matching flows')

    // Journey mapping is deterministic — a result, never a model tag.
    const journeys = painted.get('journeys')!.details.join('\n')
    expect(journeys).toMatch(/\d+ journeys? · \d+ surfaces?/)
    expect(journeys).not.toContain('model')

    // Synthesis + matching tick a counter and carry their live spend.
    expect(painted.get('flows')!.details.some((d) => /areas? .*flows-model/.test(d) || /\d+ area/.test(d))).toBe(true)
    expect(painted.get('flows')!.details.some((d) => d.includes('flows-model'))).toBe(true)
    expect(painted.get('match')!.details.some((d) => /flow×surface/.test(d))).toBe(true)
    expect(painted.get('match')!.details.some((d) => d.includes('match-model'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Pure composition — composeGuardStatus.
// ---------------------------------------------------------------------------

/** One atomic flow per section — the shape a section-authored generate writes. */
function sectionFlow(anchor: string, scenarioIds: string[]): GuardManifestFlow {
  return {
    flowId: `docs/x.md#${anchor}`,
    flowFingerprint: 'sha256:x',
    bindings: [{ doc: 'docs/x.md', anchor, fingerprint: 'sha256:x' }],
    scenarios: scenarioIds.map((id) => ({ id, surface: 'cli' as const })),
    generationInputsHash: null,
    gaps: [],
  }
}

function report(over: Partial<GuardGenerateReport> = {}): GuardGenerateReport {
  return {
    generatedAt: '2026-01-02T03:04:05.000Z',
    status: 'ok',
    sectionsTotal: 0,
    sectionsChanged: 0,
    skippedUnchanged: 0,
    noChanges: false,
    written: [],
    coverageGaps: [],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
    ...over,
  }
}

describe('composeGuardStatus', () => {
  it('returns all-null when every store file is absent', () => {
    const s = composeGuardStatus(null, null, null)
    expect(s).toEqual({ coverage: null, lastRun: null, lastGenerate: null })
  })

  it('summarizes coverage: bound sections + the ones owning scenarios', () => {
    const manifest: GuardManifest = {
      version: GUARD_FORMAT_VERSION,
      flows: [
        sectionFlow('a', ['a.1']),
        sectionFlow('b', []),
        sectionFlow('c', []),
        sectionFlow('d', ['d.1']),
      ],
    }
    const s = composeGuardStatus(manifest, null, null)
    expect(s.coverage).toMatchObject({ totalSections: 4, withScenarios: 2 })
    // A section is classified by the surface its flows' scenarios run on; the two
    // whose flows recorded neither a scenario nor a gap stay unclassified.
    expect(s.coverage?.classification.cli).toBe(2)
    expect(s.coverage?.classification.unclassified).toBe(2)
    expect(s.lastRun).toBeNull()
    expect(s.lastGenerate).toBeNull()
  })

  it('classifies a section by the driver its flows await when no scenario exists', () => {
    const awaiting: GuardManifestFlow = {
      ...sectionFlow('w', []),
      gaps: [{ surface: 'web', kind: 'awaiting-driver', driver: 'web', reason: 'no web driver yet' }],
    }
    const untestable: GuardManifestFlow = {
      ...sectionFlow('u', []),
      gaps: [{ surface: 'cli', kind: 'untestable', reason: 'design history' }],
    }
    const s = composeGuardStatus({ version: GUARD_FORMAT_VERSION, flows: [awaiting, untestable] }, null, null)
    expect(s.coverage?.classification.web).toBe(1)
    expect(s.coverage?.classification.untestable).toBe(1)
    expect(s.coverage?.classification.unclassified).toBe(0)
  })

  it('carries the flow×surface settle breakdown in the composed coverage (the dashboard data)', () => {
    const partial: GuardManifestFlow = {
      ...sectionFlow('b', ['b.1']),
      generationInputsHash: 'sha256:h',
      gaps: [{ surface: 'web', kind: 'awaiting-driver', driver: 'web', reason: 'no web driver yet' }],
    }
    const retired: GuardManifestFlow = {
      ...sectionFlow('c', []),
      generationInputsHash: 'sha256:h',
      gaps: [
        { surface: 'cli', kind: 'retired', reason: 'no scenario — authoring retired after 2 defective attempts' },
      ],
    }
    const s = composeGuardStatus(
      { version: GUARD_FORMAT_VERSION, flows: [sectionFlow('a', ['a.1']), partial, retired] },
      null,
      null,
    )
    expect(s.coverage?.settle).toEqual({
      total: 4,
      settled: 2,
      unsettled: [
        { label: 'awaiting web driver', count: 1 },
        { label: 'retired', count: 1 },
      ],
    })
  })

  it('rolls the flows up as guarded / partial / blocked with the gap labels behind them', () => {
    const guarded = sectionFlow('a', ['a.1'])
    const partial: GuardManifestFlow = {
      ...sectionFlow('b', ['b.1']),
      gaps: [{ surface: 'web', kind: 'awaiting-driver', driver: 'web', reason: 'no web driver yet' }],
    }
    const blocked: GuardManifestFlow = {
      ...sectionFlow('c', []),
      gaps: [{ surface: 'cli', kind: 'no-journey', reason: 'nothing was mapped for cli' }],
    }
    const s = composeGuardStatus({ version: GUARD_FORMAT_VERSION, flows: [guarded, partial, blocked] }, null, null)
    expect(s.coverage?.flows).toEqual({
      total: 3,
      guarded: 1,
      partial: 1,
      blocked: 1,
      gapLabels: ['awaiting web driver', 'no journey'],
    })
  })

  it('summarizes the last generate: written, birthPassed, gaps-by-kind, findings, errors', () => {
    const rep = report({
      written: [{ id: 'v.1', title: 't', doc: DOC, anchor: 'version', file: 'x.yaml' }],
      birthPassed: 3,
      coverageGaps: [
        { doc: DOC, anchor: 'a', kind: 'untestable', reason: 'r' },
        { doc: DOC, anchor: 'b', kind: 'awaiting-driver', driver: 'web', reason: 'r' },
        { doc: DOC, anchor: 'c', kind: 'untestable', reason: 'r' },
      ],
      birthFindings: [{ doc: DOC, anchor: 'a', title: 't', step: 1, expected: 'e', actual: 'a' }],
      errors: [{ doc: DOC, anchor: 'a', message: 'boom' }],
      usage: { calls: 5, inputTokens: 100, outputTokens: 40, costUsd: 0.42 },
    })
    const s = composeGuardStatus(null, null, rep)
    expect(s.lastGenerate).toMatchObject({
      written: 1,
      birthPassed: 3,
      coverageGapsByKind: { web: 1, tui: 0, library: 0, untestable: 2, 'no-claim': 0 },
      birthFindings: 1,
      errors: 1,
      usage: { calls: 5, costUsd: 0.42 },
    })
  })

  it('splits the written tests by the status they were committed with', () => {
    const rep = report({
      written: [
        { id: 'a.1', title: 't', doc: DOC, anchor: 'a', file: 'a.yaml', status: 'passing' },
        { id: 'b.1', title: 't', doc: DOC, anchor: 'b', file: 'b.yaml', status: 'failing' },
        // A report written before failing tests were committed records no status.
        { id: 'c.1', title: 't', doc: DOC, anchor: 'c', file: 'c.yaml' },
      ],
      birthFindings: [
        { doc: DOC, anchor: 'b', scenarioId: 'b.1', committed: true, title: 't', step: 1, expected: 'e', actual: 'a' },
        { doc: DOC, anchor: 'd', kind: 'fidelity', title: 'weak', step: 1, expected: '', actual: 'vacuous' },
      ],
    })
    const s = composeGuardStatus(null, null, rep)
    expect(s.lastGenerate).toMatchObject({
      written: 3,
      testsPassing: 2,
      testsFailing: 1,
      birthFindings: 2,
      // Only the fidelity rejection was withheld; the other is a committed test.
      fidelityRejections: 1,
    })
    expect(() => GuardGenerateReportSchema.parse(rep)).not.toThrow()
  })

  it('counts blocked-on gaps and aggregates their capability nouns', () => {
    const rep = report({
      coverageGaps: [
        { doc: DOC, anchor: 'a', kind: 'blocked-on', reason: 'blocked on git: needs a repo' },
        { doc: DOC, anchor: 'b', kind: 'blocked-on', reason: 'blocked on git, db: needs both' },
        { doc: DOC, anchor: 'c', kind: 'no-claim', reason: 'nothing assertable' },
      ],
    })
    const s = composeGuardStatus(null, null, rep)
    expect(s.lastGenerate).toMatchObject({
      coverageGapsByKind: { 'blocked-on': 2, 'no-claim': 1 },
      blockedOnCapabilities: { git: 2, db: 1 },
    })
  })

  it('round-trips a blocked-on coverage gap through the report schema', () => {
    const rep = report({
      coverageGaps: [{ doc: DOC, anchor: 'a', kind: 'blocked-on', reason: 'blocked on git, db: c' }],
    })
    expect(() => GuardGenerateReportSchema.parse(rep)).not.toThrow()
  })

  it('composes a partial view (only the last run present)', () => {
    const s = composeGuardStatus(null, sampleLatest([scn('a', 'pass'), scn('b', 'fail')]), null)
    expect(s.coverage).toBeNull()
    expect(s.lastGenerate).toBeNull()
    expect(s.lastRun?.summary).toMatchObject({ total: 2, pass: 1, fail: 1 })
  })
})

// ---------------------------------------------------------------------------
// Pure ordering — orderGuardDrifts.
// ---------------------------------------------------------------------------

function scn(id: string, outcome: GuardOutcome, over: Partial<GuardScenarioResult> = {}): GuardScenarioResult {
  return {
    id,
    title: `${id} title`,
    binds: { doc: 'docs/x.md', section: `${id}/sec`, fingerprint: 'sha256:x' },
    outcome,
    durationMs: 1,
    ...over,
  }
}

function sampleLatest(scenarios: GuardScenarioResult[]): GuardLatest {
  const summary = { total: scenarios.length, pass: 0, fail: 0, stale: 0, orphaned: 0, error: 0 }
  for (const s of scenarios) summary[s.outcome]++
  return {
    run: {
      runId: '2026-01-01_abc',
      ranAt: '2026-01-01T00:00:00.000Z',
      branch: 'main',
      commit: 'deadbeefcafef00d',
      recipeFingerprint: 'sha256:r',
      scenarioFormat: GUARD_FORMAT_VERSION,
    },
    summary,
    scenarios,
    sections: [],
  }
}

describe('orderGuardDrifts', () => {
  it('returns [] when there is no run', () => {
    expect(orderGuardDrifts(null)).toEqual([])
  })

  it('excludes passes and orders fail → error → stale → orphaned', () => {
    const latest = sampleLatest([
      scn('p', 'pass'),
      scn('o', 'orphaned'),
      scn('s', 'stale'),
      scn('f', 'fail'),
      scn('e', 'error'),
    ])
    expect(orderGuardDrifts(latest.scenarios).map((d) => d.id)).toEqual(['f', 'e', 's', 'o'])
  })

  it('preserves original order within the same outcome tier', () => {
    const latest = sampleLatest([scn('f2', 'fail'), scn('f1', 'fail'), scn('f3', 'fail')])
    expect(orderGuardDrifts(latest.scenarios).map((d) => d.id)).toEqual(['f2', 'f1', 'f3'])
  })
})

// ---------------------------------------------------------------------------
// CLI printers — runGuardStatus / runGuardDrifts.
// ---------------------------------------------------------------------------

describe('runGuardStatus (printer)', () => {
  let out: string
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    out = ''
    spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk)
      return true
    })
  })
  afterEach(() => spy.mockRestore())

  it('prints a helpful pointer on a fresh repo (all three files absent)', async () => {
    const r = repo()
    await runGuardStatus({ cwd: r })
    expect(out).toContain('No guard data yet')
    expect(out).toContain('guard generate')
    expect(out).toContain('guard run')
  })

  it('renders coverage + last-run blocks when present', async () => {
    const r = repo()
    writeGuardLatest(r, sampleLatest([scn('a', 'pass'), scn('b', 'fail')]))
    await runGuardStatus({ cwd: r })
    expect(out).toContain('last run')
    expect(out).toContain('1 pass')
    expect(out).toContain('1 fail')
    // coverage file (manifest) still absent → its block reads (none)
    expect(out).toContain('coverage    (none)')
  })

  it('renders the blocked-on gap count with its capability breakdown', async () => {
    const r = repo()
    writeGuardResult(
      r,
      report({
        sectionsChanged: 2,
        coverageGaps: [
          { doc: DOC, anchor: 'a', kind: 'blocked-on', reason: 'blocked on git: c1' },
          { doc: DOC, anchor: 'b', kind: 'blocked-on', reason: 'blocked on git, db: c2' },
        ],
      }),
    )
    await runGuardStatus({ cwd: r })
    expect(out).toContain('2 blocked-on (git 2, db 1)')
  })

  it('surfaces the ready-but-held count in the last-generate block', async () => {
    const r = repo()
    writeGuardResult(
      r,
      report({
        sectionsChanged: 2,
        written: [{ id: 'v.1', title: 't', doc: DOC, anchor: 'version', file: 'x.yaml' }],
        birthPassed: 2,
        errors: [{ doc: DOC, anchor: 'auth/login', message: 'boom' }],
        heldSections: [{ doc: DOC, anchor: 'auth/login', readyScenarios: [{ id: 'login.1', title: 'g', yaml: 'y' }] }],
      }),
    )
    await runGuardStatus({ cwd: r })
    expect(out).toContain('1 ready but held')
  })

  it('mentions the dismissed count as a gaps segment', async () => {
    const r = repo()
    writeGuardResult(
      r,
      report({
        sectionsChanged: 1,
        coverageGaps: [{ doc: DOC, anchor: 'version', kind: 'dismissed', reason: 'dismissed: the --version claim' }],
      }),
    )
    await runGuardStatus({ cwd: r })
    expect(out).toContain('1 dismissed')
  })

  it('splits the flows waiting on a PROVIDABLE third party out of the blocked count', async () => {
    const r = repo()
    // The repo declares open-meteo but configures nothing, so it is unprovided —
    // the one blocked-on noun a user can clear without writing a test.
    const recipe = path.join(r, '.truecourse', 'scenarios', 'recipe.json')
    fs.mkdirSync(path.dirname(recipe), { recursive: true })
    fs.writeFileSync(
      recipe,
      JSON.stringify(
        {
          build: 'true',
          entry: ['node', 'bin.mjs'],
          api: { serve: ['node', 'server.mjs'], healthPath: '/health', externals: { 'open-meteo': { baseUrlEnv: 'FORECAST_BASE_URL' } } },
        },
        null,
        2,
      ) + '\n',
    )
    writeGuardResult(
      r,
      report({
        sectionsChanged: 2,
        coverageGaps: [
          { doc: DOC, anchor: 'a', kind: 'blocked-on', reason: 'blocked on open-meteo: forecast', flowId: 'f1' },
          { doc: DOC, anchor: 'b', kind: 'blocked-on', reason: 'blocked on open-meteo: history', flowId: 'f2' },
          // A generic noun names nothing providable — it stays in the raw count only.
          { doc: DOC, anchor: 'c', kind: 'blocked-on', reason: 'blocked on network: fetch', flowId: 'f3' },
        ],
      }),
    )
    await runGuardStatus({ cwd: r })
    expect(out).toContain('3 blocked-on')
    expect(out).toContain('2 flows need setup (open-meteo — run: truecourse guard externals)')
  })

  it('stays silent about needs-setup when no blocked flow names a known service', async () => {
    const r = repo()
    writeGuardResult(
      r,
      report({
        sectionsChanged: 1,
        coverageGaps: [{ doc: DOC, anchor: 'a', kind: 'blocked-on', reason: 'blocked on network: fetch' }],
      }),
    )
    await runGuardStatus({ cwd: r })
    expect(out).toContain('1 blocked-on')
    expect(out).not.toContain('need setup')
  })

  it('says how many flows the guarded sections went through, and renders the settle breakdown on its own line', async () => {
    const r = repo()
    const partial: GuardManifestFlow = {
      ...sectionFlow('b', ['b.1']),
      gaps: [{ surface: 'web', kind: 'awaiting-driver', driver: 'web', reason: 'no web driver yet' }],
    }
    writeManifest(r, {
      version: GUARD_FORMAT_VERSION,
      flows: [sectionFlow('a', ['a.1']), partial, sectionFlow('c', [])],
    })

    await runGuardStatus({ cwd: r })

    expect(out).toContain('coverage    2/3 sections guarded (via 3 flows)')
    // The flow×surface settle breakdown: a + b tested, b's web surface awaits its
    // driver, c (hash unrecorded, nothing at all) is pending work — never silent.
    expect(out).toContain(
      'flows       2/4 settled · 2 unsettled: 1 awaiting web driver, 1 pending next generate',
    )
  })

  it('renders the retired reason in the settle breakdown, and stays terse when all settled', async () => {
    const r = repo()
    const settled = { ...sectionFlow('a', ['a.1']), generationInputsHash: 'sha256:h' }
    writeManifest(r, { version: GUARD_FORMAT_VERSION, flows: [settled] })
    await runGuardStatus({ cwd: r })
    expect(out).toContain('flows       1/1 settled')
    expect(out).not.toContain('unsettled')

    out = ''
    const retired: GuardManifestFlow = {
      ...sectionFlow('b', []),
      generationInputsHash: 'sha256:h',
      gaps: [
        { surface: 'cli', kind: 'retired', reason: 'no scenario — authoring retired after 3 defective attempts' },
      ],
    }
    const blocked: GuardManifestFlow = {
      ...sectionFlow('c', []),
      generationInputsHash: 'sha256:h',
      gaps: [{ surface: 'api', kind: 'blocked-on', reason: 'blocked on anthropic: call the model' }],
    }
    writeManifest(r, { version: GUARD_FORMAT_VERSION, flows: [settled, retired, blocked] })
    await runGuardStatus({ cwd: r })
    expect(out).toContain('flows       1/3 settled · 2 unsettled: 1 blocked on anthropic, 1 retired')
  })
})

describe('printGuardGenerateSummary (printer)', () => {
  let out: string
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    out = ''
    spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk)
      return true
    })
  })
  afterEach(() => spy.mockRestore())

  it('surfaces orphaned dismissals (stale decisions) as a line', () => {
    printGuardGenerateSummary(
      report({
        sectionsChanged: 1,
        orphanedDismissals: [{ doc: DOC, anchor: 'version', title: 'a claim that no longer exists' }],
      }),
      '.truecourse/guard/result.json',
    )
    expect(out).toContain('1 orphaned')
    expect(out).toContain('decisions.json')
  })
})

describe('runGuardDrifts (printer)', () => {
  let out: string
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    out = ''
    spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk)
      return true
    })
  })
  afterEach(() => spy.mockRestore())

  it('points at `guard run` when there is no run', async () => {
    const r = repo()
    await runGuardDrifts({ cwd: r })
    expect(out).toContain('No guard run yet')
    expect(out).toContain('guard run')
  })

  it('reports no drift when every scenario passed', async () => {
    const r = repo()
    writeGuardLatest(r, sampleLatest([scn('a', 'pass'), scn('b', 'pass')]))
    await runGuardDrifts({ cwd: r })
    expect(out).toContain('No drift')
  })

  it('lists non-pass scenarios most-severe-first with the section anchor', async () => {
    const r = repo()
    writeGuardLatest(
      r,
      sampleLatest([
        scn('p', 'pass'),
        scn('o', 'orphaned'),
        scn('f', 'fail', {
          failure: { step: 2, expected: 'exit 0', actual: 'exit 7' },
          evidencePath: '.truecourse/guard/evidence/run/f',
        }),
      ]),
    )
    await runGuardDrifts({ cwd: r })
    expect(out).toContain('[fail] f')
    expect(out).toContain('f/sec')
    expect(out).toContain('step 2')
    expect(out).toContain('evidence:')
    // fail is listed before orphaned; pass is excluded.
    expect(out.indexOf('[fail] f')).toBeLessThan(out.indexOf('[orphaned] o'))
    expect(out).not.toContain('[pass]')
    expect(out).toContain('Showing 1–2 of 2')
  })

  it('--json emits { total, drifts[] } in severity order, passes excluded', async () => {
    const r = repo()
    writeGuardLatest(
      r,
      sampleLatest([
        scn('p', 'pass'),
        scn('s', 'stale'),
        scn('f', 'fail', { failure: { step: 1, expected: 'e', actual: 'a' }, evidencePath: 'ev/f' }),
      ]),
    )
    // JSON goes to console.log (vitest intercepts it, so capture it directly).
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runGuardDrifts({ cwd: r, json: true })
    const printed = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    logSpy.mockRestore()

    const parsed = JSON.parse(printed)
    expect(parsed.total).toBe(2)
    expect(parsed.drifts.map((d: { outcome: string }) => d.outcome)).toEqual(['fail', 'stale'])
    expect(parsed.drifts[0]).toMatchObject({
      id: 'f',
      outcome: 'fail',
      doc: 'docs/x.md',
      section: 'f/sec',
      failure: { step: 1 },
      evidencePath: 'ev/f',
    })
    // No clack intro/outro decoration reaches stdout in JSON mode.
    expect(out).toBe('')
  })

  it('paginates with --offset / --all like `drifts list`', async () => {
    const r = repo()
    const many = Array.from({ length: 25 }, (_, i) => scn(`f${i}`, 'fail'))
    writeGuardLatest(r, sampleLatest(many))
    await runGuardDrifts({ cwd: r, limit: 20, offset: 0 })
    expect(out).toContain('5 more')
    expect(out).toContain('guard drifts --offset 20')
    expect(out).toContain('Showing 1–20 of 25')
  })
})

// ---------------------------------------------------------------------------
// Generate closing summary — printGuardGenerateSummary (counts + top-3 + pointers).
// ---------------------------------------------------------------------------

/**
 * The closing line. A run that wrote nothing must never claim there are tests to
 * commit — the regression was a $35 generate that wrote ZERO files, recorded 50
 * errors, and signed off with "Review + commit the tests".
 */
describe('guardGenerateOutro', () => {
  it('never claims tests to review when none were written', () => {
    expect(guardGenerateOutro({ written: 0, problems: 50 })).toBe('No scenarios written — see the errors above.')
    expect(guardGenerateOutro({ written: 0, problems: 0 })).toBe('No scenarios written.')
    expect(guardGenerateOutro({ written: 0, problems: 50 })).not.toContain('commit')
  })

  it('points at the written tests only when some were written', () => {
    expect(guardGenerateOutro({ written: 3, problems: 0 })).toBe(
      'Review + commit the scenarios, then `truecourse guard run`.',
    )
  })

  it('says a refused run was aborted, whatever else the report carries', () => {
    expect(guardGenerateOutro({ written: 0, problems: 0, refused: true })).toBe(
      'Aborted — the run was refused; no scenarios were written.',
    )
  })
})

describe('printGuardGenerateSummary', () => {
  let out: string
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    out = ''
    spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk)
      return true
    })
  })
  afterEach(() => spy.mockRestore())

  it('renders a compact counts block reusing the status summary', () => {
    const rep = report({
      sectionsChanged: 5,
      skippedUnchanged: 40,
      written: [{ id: 'v.1', title: 't', doc: DOC, anchor: 'version', file: 'x.yaml' }],
      birthPassed: 3,
      coverageGaps: [
        { doc: DOC, anchor: 'a', kind: 'untestable', reason: 'r' },
        { doc: DOC, anchor: 'b', kind: 'blocked-on', reason: 'blocked on git: needs a repo' },
      ],
      birthFindings: [{ doc: DOC, anchor: 'cli/version', title: 'prints semver', step: 1, expected: 'e', actual: 'a' }],
      errors: [{ doc: DOC, anchor: 'cli/build', message: 'authoring returned no output' }],
      usage: { calls: 5, inputTokens: 100, outputTokens: 40, costUsd: 0.42 },
    })
    printGuardGenerateSummary(rep, '.truecourse/guard/result.json')

    // Two distinct unsettled sections (version + build) out of 5 changed → 3 settled.
    // No `flows` block on this (pre-flow) report — the section split stands in.
    expect(out).toContain('5 changed · 3 settled · 2 unsettled · 40 unchanged')
    expect(out).toContain('scenarios   1 written · 1 passing')
    expect(out).toContain('gaps        2 (')
    expect(out).toContain('blocked-on (git 1)')
    expect(out).toContain('failing     1 — committed red')
    expect(out).toContain('1 authoring error')
    expect(out).toContain('$0.42')
    // Pointers to the detail surfaces.
    expect(out).toContain('truecourse guard drifts')
    expect(out).toContain('truecourse guard flows')
    expect(out).toContain('.truecourse/guard/result.json')
  })

  it('shows at most the top 3 birth findings, then a truncation pointer', () => {
    const birthFindings = Array.from({ length: 10 }, (_, i) => ({
      doc: DOC,
      anchor: `sec/f${i}`,
      title: `finding ${i}`,
      step: 1,
      expected: 'e',
      actual: 'a',
    }))
    printGuardGenerateSummary(report({ sectionsChanged: 10, birthFindings }), 'p')

    expect(out).toContain('✗ f0 · birth: finding 0')
    expect(out).toContain('✗ f2 · birth: finding 2')
    expect(out).not.toContain('finding 3')
    expect(out).toContain('… and 7 more — see `truecourse guard drifts`')
  })

  it('lists EVERY failed authoring unit (deduped), never a top-3 truncation', () => {
    const errors = Array.from({ length: 5 }, (_, i) => ({ doc: DOC, anchor: `sec/e${i}`, message: `boom ${i}` }))
    printGuardGenerateSummary(report({ sectionsChanged: 5, errors }), 'p')

    for (let i = 0; i < 5; i++) expect(out).toContain(`✗ e${i} — boom ${i}`)
    expect(out).not.toContain('… and')
    expect(out).toContain('re-run generate to retry')
  })

  it("groups a flow's repeated errors into one line with an attempt count", () => {
    printGuardGenerateSummary(
      report({
        sectionsChanged: 2,
        errors: [
          // One flow, two surfaces, both timed out → one line, two attempts.
          { doc: DOC, anchor: 'cli/slow', flowId: 'slow-flow', message: 'authoring (cli) call failed: claude timed out after 600000ms' },
          { doc: DOC, anchor: 'cli/slow', flowId: 'slow-flow', message: 'authoring (api) call failed: claude timed out after 600000ms' },
          { doc: DOC, anchor: 'cli/bad', flowId: 'bad-flow', message: 'authoring (cli) output invalid after re-ask: bad shape' },
        ],
      }),
      'p',
    )

    expect(out).toContain('✗ slow-flow — timed out (2 attempts)')
    expect(out).toContain('✗ bad-flow — invalid output twice')
    // Two unit lines, not four raw entries.
    expect(out).not.toContain('600000ms')
    expect(out).toContain('these 2 units')
  })

  it('prints only the counts block and pointers when there are no findings or errors', () => {
    printGuardGenerateSummary(
      report({
        sectionsChanged: 2,
        written: [{ id: 'a.1', title: 't', doc: DOC, anchor: 'a', file: 'a.yaml' }],
        birthPassed: 1,
      }),
      'REPORT_PATH',
    )
    expect(out).toContain('2 changed · 2 settled · 0 unsettled')
    expect(out).not.toContain('Top birth finding')
    expect(out).not.toContain('Top authoring error')
    expect(out).not.toContain('ready but held')
    expect(out).toContain('REPORT_PATH')
  })

  it('renders the ready-but-held line, blamed on its sections\' findings + errors', () => {
    const rep = report({
      sectionsChanged: 3,
      written: [{ id: 'v.1', title: 't', doc: DOC, anchor: 'version', file: 'x.yaml' }],
      birthPassed: 4,
      birthFindings: [{ doc: DOC, anchor: 'auth/login', title: 'f', step: 1, expected: 'e', actual: 'a' }],
      errors: [{ doc: DOC, anchor: 'auth/logout', message: 'boom' }],
      heldSections: [
        {
          doc: DOC,
          anchor: 'auth/login',
          readyScenarios: [
            { id: 'login.1', title: 'g1', yaml: 'y' },
            { id: 'login.2', title: 'g2', yaml: 'y' },
          ],
        },
        { doc: DOC, anchor: 'auth/logout', readyScenarios: [{ id: 'logout.1', title: 'g3', yaml: 'y' }] },
      ],
    })
    printGuardGenerateSummary(rep, 'p')
    // 3 held (2 + 1); blocked by 1 finding (auth/login) and 1 error (auth/logout).
    expect(out).toContain('3 ready but held (1 finding · 1 error)')
  })
})

// ---------------------------------------------------------------------------
// The flow-led generate summary — flows are the generation unit, so the close
// leads with them, names composition findings, and prices the run against the
// ceiling the estimate quoted.
// ---------------------------------------------------------------------------

describe('printGuardGenerateSummary — flow-led', () => {
  let out: string
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    out = ''
    spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk)
      return true
    })
  })
  afterEach(() => spy.mockRestore())

  const flows = (over: Partial<GuardGenerateReport['flows']> = {}) => ({
    total: 6,
    settled: 5,
    unsettled: 1,
    skipped: 0,
    dismissed: 0,
    orphaned: 0,
    subsumed: 0,
    noFlowClaims: 0,
    unsettledAreas: [],
    ...over,
  })

  it('leads with flows, then scenarios, gaps, findings and spend against the estimate', () => {
    const rep = report({
      sectionsChanged: 9,
      skippedUnchanged: 33,
      flows: flows({ skipped: 12 }),
      written: Array.from({ length: 7 }, (_, i) => ({
        id: `f.api.${i}`,
        title: 't',
        doc: DOC,
        anchor: 'version',
        file: `x${i}.yaml`,
        flowId: 'task-lifecycle',
        surface: 'api' as const,
      })),
      birthPassed: 7,
      coverageGaps: [
        { doc: DOC, anchor: 'a', kind: 'no-journey', reason: 'nothing mapped for web', flowId: 'onboarding', surface: 'web' },
        { doc: DOC, anchor: 'b', kind: 'awaiting-driver', driver: 'web', reason: 'the web driver is not runnable yet', flowId: 'task-lifecycle', surface: 'web' },
      ],
      usage: { calls: 21, inputTokens: 900_000, outputTokens: 40_000, costUsd: 8.01 },
    })

    printGuardGenerateSummary(rep, '.truecourse/guard/result.json', { estimatedCostUsd: 10.29 })

    expect(out).toContain('flows       5 settled · 1 unsettled · 12 unchanged')
    expect(out).toContain('scenarios   7 written · 7 passing')
    expect(out).toContain('gaps        2 (1 awaiting web driver · 1 no journey)')
    expect(out).toContain('usage       21 calls · $8.01 (≤ $10.29 estimated)')
    expect(out).toContain('next  `truecourse guard run`')
    // Nothing failed, so no failing/rejected/errors blocks at all — and the tests
    // line drops the failing half rather than printing a zero.
    expect(out).not.toContain('failing')
    expect(out).not.toContain('rejected')
    expect(out).not.toContain('sections    ')
  })

  it('labels a composition finding and points `guard flows --show` at its flow', () => {
    const rep = report({
      sectionsChanged: 4,
      flows: flows({ total: 2, settled: 1, unsettled: 1 }),
      birthFindings: [
        {
          doc: DOC,
          anchor: 'tasks/completing-tasks',
          title: 'Tasks are created, listed, completed',
          step: 3,
          expected: 'exit 0',
          actual: 'doc says idempotent, got 409',
          flowId: 'task-lifecycle',
          surface: 'api',
          failedMilestone: 3,
          priorMilestonesPassed: true,
        },
        {
          doc: DOC,
          anchor: 'version',
          kind: 'fidelity' as const,
          title: 'asserts nothing observable',
          step: 1,
          expected: '',
          actual: 'the scenario only checks exit 0',
          flowId: 'version-check',
          surface: 'cli',
        },
      ],
    })

    printGuardGenerateSummary(rep, 'p')

    // The committed red test and the withheld fidelity rejection are DIFFERENT
    // species now, so they get their own lines rather than one "findings" count.
    expect(out).toContain('failing     1 — committed red')
    expect(out).toContain('▲ task-lifecycle · api · milestone 3: doc says idempotent, got 409')
    expect(out).toContain('rejected    1 by fidelity review')
    expect(out).toContain('✗ version-check · cli · fidelity: asserts nothing observable')
    expect(out).toContain('`truecourse guard flows --show task-lifecycle`')
  })

  it('surfaces dismissed and orphaned flows on the flows line', () => {
    printGuardGenerateSummary(
      report({
        flows: flows({ total: 4, settled: 4, unsettled: 0, dismissed: 2, orphaned: 1 }),
        orphanedFlowDismissals: [{ flowId: 'gone', title: 'a flow that no longer exists' }],
      }),
      'p',
    )
    expect(out).toContain('flows       4 settled · 0 unsettled · 2 dismissed · 1 orphaned')
    expect(out).toContain('1 orphaned — the dismissed claim/flow no longer exists')
  })

  it('with the manifest, the flows line is the settle breakdown — untested units say why', () => {
    const manifest: GuardManifest = {
      version: GUARD_FORMAT_VERSION,
      flows: [
        // Tested on cli; the milestone-scoped sibling gap is settled-with-gap and
        // never double-counts the unit.
        {
          ...sectionFlow('a', ['a.cli.1']),
          generationInputsHash: 'sha256:h',
          gaps: [
            {
              surface: 'cli',
              kind: 'blocked-on',
              reason: 'blocked on stripe: 1 of 3 claims of pay — the other 2 are covered',
              blockedMilestones: [{ milestone: 3, blockedOn: ['stripe'] }],
            },
          ],
        },
        {
          ...sectionFlow('b', []),
          generationInputsHash: 'sha256:h',
          gaps: [{ surface: 'cli', kind: 'blocked-on', reason: 'blocked on anthropic: call the model' }],
        },
        {
          ...sectionFlow('c', []),
          generationInputsHash: 'sha256:h',
          gaps: [{ surface: 'cli', kind: 'blocked-on', reason: 'blocked on anthropic: stream tokens' }],
        },
        {
          ...sectionFlow('d', []),
          generationInputsHash: 'sha256:h',
          gaps: [
            { surface: 'cli', kind: 'retired', reason: 'no scenario — authoring retired after 3 defective attempts' },
          ],
        },
      ],
    }
    printGuardGenerateSummary(report({ flows: flows({ skipped: 12 }) }), 'p', { manifest })
    expect(out).toContain(
      'flows       1/4 settled · 12 unchanged · 3 unsettled: 2 blocked on anthropic, 1 retired',
    )
  })

  it('with the manifest, an all-settled corpus stays terse — no unsettled segment', () => {
    const manifest: GuardManifest = {
      version: GUARD_FORMAT_VERSION,
      flows: [
        { ...sectionFlow('a', ['a.cli.1']), generationInputsHash: 'sha256:h' },
        { ...sectionFlow('b', ['b.cli.1']), generationInputsHash: 'sha256:h' },
      ],
    }
    printGuardGenerateSummary(
      report({ flows: flows({ total: 2, settled: 2, unsettled: 0 }) }),
      'p',
      { manifest },
    )
    expect(out).toContain('flows       2/2 settled')
    expect(out).not.toContain('unsettled')
  })
})
