/**
 * THE ADJUDICATION SESSION AT THE COMMAND LEVEL (plan 05, step 21 items 2/5/6
 * and step 22 item 3's fold half) — the verdict cache, the pre-flight plan, the
 * `read_evidence` precondition, and what the fold does with a verdict that
 * breaks a structural invariant.
 *
 * There is no driver seam on `RunGuardAdjudicationOptions` (an open end the
 * implementation named), so the session driver is scripted at the module the
 * BUILT core imports it from — the pattern `tests/cli/guard-adjudication-e2e`
 * established. Everything else is real: the stores, the cache, the pool, the
 * loop, the fold.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import yaml from 'js-yaml'

let sessionScript: StubScript = () => {
  throw new Error('no session script installed for this case')
}
vi.mock('../../packages/core/dist/services/llm/session-driver.js', () => ({
  SESSION_MODEL_CLAUDE_CODE: 'opus',
  assertSessionBackendReady: async () => {},
  createConfiguredSessionDriver: () => {
    const { driver } = stubDriver((call) => sessionScript(call))
    return { driver, mode: 'claude-code', attribution: driver.attribution }
  },
}))

import { runAgentLoop } from '../../packages/agent-loop/src/index'
import { writeGuardLatest, writeManifest } from '@truecourse/guard-runner'
import {
  planGuardAdjudication,
  runGuardAdjudication,
} from '@truecourse/core/commands/guard-adjudicate'
import {
  ADJUDICATE_CACHE_NAME,
  ADJUDICATE_PROMPT_FINGERPRINT,
  adjudicationCacheKey,
  adjudicationSessionDef,
  scenarioBehaviorHash,
} from '../../packages/core/dist/services/guard-adjudicate/session.js'
import { newSessionState } from '../../packages/core/dist/services/guard-adjudicate/tools.js'
import {
  board,
  failRow,
  item,
  makeRepo,
  manifestWith,
  rmrf,
  RUN_ID,
  scenarioDoc,
} from './guard-adjudicate-helpers'
import { memoryPersistence, outcome, stubDriver, type StubCall, type StubScript } from './spec-scan-session-stub'

const repos: string[] = []
beforeEach(() => {
  sessionScript = () => {
    throw new Error('no session script installed for this case')
  }
})
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeRepo()
  repos.push(r)
  return r
}

const EXPECTED_RED = {
  step: 3,
  predictedActual: 'exit 2',
  verdict: 'doc-drift' as const,
  brief: 'the doc promises the flag; the CLI has never accepted it',
}

/** A complete, fold-acceptable verdict. */
const DRIFT = {
  class: 'drift' as const,
  mechanism: 'the doc promises exit 0; the program exits 2',
  evidence: ['exit 2 — unknown flag'],
  confidence: 'high' as const,
  findings: [],
}

const cachePath = (r: string, key: string): string =>
  path.join(r, '.truecourse', '.cache', ADJUDICATE_CACHE_NAME, `${key}.json`)

/** Write a committed scenario yaml so the run joins it to the row. */
function commitScenario(r: string, id: string, steps?: unknown): void {
  const doc = scenarioDoc(id, steps ? ({ steps } as never) : {})
  const target = path.join(r, '.truecourse', 'scenarios', 'area', `${id}.yaml`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, yaml.dump(doc))
}

/** An evidence bundle for `id`, so a session can satisfy its precondition. */
function commitEvidence(r: string, id: string): string {
  const rel = path.join('.truecourse', 'guard', 'evidence', RUN_ID, id)
  fs.mkdirSync(path.join(r, rel), { recursive: true })
  fs.writeFileSync(path.join(r, rel, 'transcript.txt'), 'step 3 failed: exit 2 — unknown flag\n')
  return rel
}

// ---------------------------------------------------------------------------
// The cache key
// ---------------------------------------------------------------------------

describe('adjudicationCacheKey', () => {
  /**
   * The key is the identity, spelled out: the prompt fingerprint FIRST (an
   * edited system prompt must not serve verdicts reached under the old one),
   * then the failure identity, then the scenario's behavior hash. Recomputing
   * it by hand is the only assertion that actually pins the fingerprint is in
   * there — a "changing `actual` changes the key" check would pass without it.
   */
  it('is the sha256 of prompt-fingerprint :: identity :: behavior hash', () => {
    const scenario = scenarioDoc('scn.a')
    const subject = item({ flowId: 'flow.a', scenario })

    const expected = createHash('sha256')
      .update(
        [
          ADJUDICATE_PROMPT_FINGERPRINT,
          'flow.a',
          'cli',
          '3',
          'exit 0',
          'exit 2 — unknown flag',
          scenarioBehaviorHash(scenario),
        ].join('::'),
      )
      .digest('hex')

    expect(adjudicationCacheKey(subject)).toBe(expected)
    expect(ADJUDICATE_PROMPT_FINGERPRINT).toHaveLength(16)
  })

  it('moves with the recorded actual and with the scenario’s behavior, and nothing else', () => {
    const base = item({ flowId: 'flow.a', scenario: scenarioDoc('scn.a') })
    const key = adjudicationCacheKey(base)

    expect(adjudicationCacheKey({ ...base, actual: 'exit 137 — killed' })).not.toBe(key)
    expect(
      adjudicationCacheKey({
        ...base,
        scenario: scenarioDoc('scn.a', { steps: [{ run: ['--help'], expect: { exit: 0 } }] } as never),
      }),
    ).not.toBe(key)
    // The title of the row and the run it came from are not identity.
    expect(adjudicationCacheKey({ ...base, title: 'renamed', runId: 'another-run' })).toBe(key)
  })
})

// ---------------------------------------------------------------------------
// The cache, end to end through the command
// ---------------------------------------------------------------------------

describe('runGuardAdjudication — the verdict cache', () => {
  function seedOneFailure(): { r: string; key: string } {
    const r = repo()
    writeGuardLatest(r, board([failRow('scn.a')]))
    writeManifest(r, manifestWith([{ scenarioId: 'scn.a', flowId: 'flow.a' }]))
    commitScenario(r, 'scn.a')
    const key = adjudicationCacheKey(item({ flowId: 'flow.a', scenario: scenarioDoc('scn.a') }))
    return { r, key }
  }

  it('serves an identical failure from the cache, spending no session', async () => {
    const { r, key } = seedOneFailure()
    fs.mkdirSync(path.dirname(cachePath(r, key)), { recursive: true })
    fs.writeFileSync(cachePath(r, key), JSON.stringify(DRIFT))

    const run = await runGuardAdjudication({ repoRoot: r })

    expect(run.scenarios[0]).toMatchObject({ scenarioId: 'scn.a', source: 'cache' })
    expect(run.scenarios[0].verdict?.class).toBe('drift')
    expect(run.sessionRunId).toBeUndefined()
    expect(fs.existsSync(path.join(r, '.truecourse', 'sessions'))).toBe(false)
  })

  it('re-adjudicates once the scenario’s behavior moves', async () => {
    const { r, key } = seedOneFailure()
    fs.mkdirSync(path.dirname(cachePath(r, key)), { recursive: true })
    fs.writeFileSync(cachePath(r, key), JSON.stringify(DRIFT))
    expect((await planGuardAdjudication(r)).cached).toBe(1)

    // The same failure, a different test: the behavior hash is in the key.
    commitScenario(r, 'scn.a', [{ run: ['--help'], expect: { exit: 0 } }])

    expect(await planGuardAdjudication(r)).toMatchObject({ failures: 1, cached: 0, sessions: 1 })
  })

  /**
   * `--scenario <id>` is the documented escape hatch: "An explicitly named row
   * re-adjudicates, its prior verdict briefed" (prepareAdjudication's own
   * comment, and the CLI's help). The row's identity has not changed, so the
   * cached verdict is keyed on exactly what a re-adjudication would look up —
   * an explicit scope must therefore beat the cache, or the hatch is a no-op
   * that rewrites the verdict the user asked to overturn.
   */
  it('re-adjudicates an explicitly scoped row instead of serving its cached verdict', async () => {
    const { r, key } = seedOneFailure()
    fs.mkdirSync(path.dirname(cachePath(r, key)), { recursive: true })
    fs.writeFileSync(cachePath(r, key), JSON.stringify(DRIFT))
    commitEvidence(r, 'scn.a')

    const plan = await planGuardAdjudication(r, { scenarios: ['scn.a'] })

    expect(plan).toMatchObject({ failures: 1, cached: 0, sessions: 1 })
  })

  /**
   * The other half of the same rule: skipping the probe is only worth anything
   * if the session that results is BRIEFED with the verdict being overturned,
   * and if its answer replaces the stale memory. Otherwise the next default run
   * would serve the old verdict straight back out of the cache.
   */
  it('brief the scoped session with the prior verdict, and overwrites the stale cache entry', async () => {
    const r = repo()
    const prior = {
      class: 'authoring-defect' as const,
      mechanism: 'the assertion was mis-authored',
      evidence: ['a line'],
      fix: { layer: 'scenario' as const, description: 'assert the exit code' },
      confidence: 'high' as const,
      findings: [],
    }
    writeGuardLatest(
      r,
      board([failRow('scn.a', { adjudication: { ...prior, adjudicatedAt: '2026-08-19T01:00:00.000Z' } })]),
    )
    writeManifest(r, manifestWith([{ scenarioId: 'scn.a', flowId: 'flow.a' }]))
    commitScenario(r, 'scn.a')
    commitEvidence(r, 'scn.a')
    const key = adjudicationCacheKey(item({ flowId: 'flow.a', scenario: scenarioDoc('scn.a') }))
    fs.mkdirSync(path.dirname(cachePath(r, key)), { recursive: true })
    fs.writeFileSync(cachePath(r, key), JSON.stringify(prior))

    let briefing = ''
    sessionScript = async (call) => {
      briefing = call.briefing
      const tool = call.input.def.tools.find((t) => t.name === 'read_evidence')!
      const read = await tool.execute({ file: 'transcript.txt' }, {
        workItem: 'scn.a',
        signal: call.input.signal,
        dispatchChild: () => {
          throw new Error('no child')
        },
      })
      call.input.onEvent({ type: 'tool-result', toolName: 'read_evidence', content: read.content })
      return outcome(DRIFT)
    }

    const run = await runGuardAdjudication({ repoRoot: r, scenarios: ['scn.a'] })

    expect(run.scenarios[0]).toMatchObject({ scenarioId: 'scn.a', source: 'session' })
    expect(run.scenarios[0].verdict?.class).toBe('drift')
    // The session was told what it is being asked to overturn.
    expect(briefing).toContain('Prior adjudication of this row')
    expect(briefing).toContain('authoring-defect')
    expect(briefing).toContain('the assertion was mis-authored')
    // The stale memory is replaced, so the next DEFAULT run cannot serve it back.
    expect(JSON.parse(fs.readFileSync(cachePath(r, key), 'utf-8'))).toMatchObject({ class: 'drift' })
    const latest = JSON.parse(fs.readFileSync(path.join(r, '.truecourse', 'guard', 'LATEST.json'), 'utf-8'))
    expect(latest.scenarios[0].adjudication.class).toBe('drift')
  }, 30_000)

  /**
   * Skipping the CACHE is not skipping the PRE-PASS: the pre-pass re-derives
   * its answer off the committed corpus and the board row rather than
   * remembering one, so a scoped declared red still costs zero sessions.
   */
  it('still settles a scoped declared red deterministically, with no session', async () => {
    const r = repo()
    writeGuardLatest(r, board([failRow('scn.a')]))
    writeManifest(r, manifestWith([{ scenarioId: 'scn.a', flowId: 'flow.a', expectedRed: EXPECTED_RED }]))
    commitScenario(r, 'scn.a')

    expect(await planGuardAdjudication(r, { scenarios: ['scn.a'] })).toMatchObject({
      failures: 1,
      prePassed: 1,
      cached: 0,
      sessions: 0,
    })

    const run = await runGuardAdjudication({ repoRoot: r, scenarios: ['scn.a'] })

    expect(run.scenarios[0]).toMatchObject({ scenarioId: 'scn.a', source: 'pre-pass' })
    expect(run.scenarios[0].verdict?.class).toBe('expected-red')
    expect(run.sessionRunId).toBeUndefined()
    expect(fs.existsSync(path.join(r, '.truecourse', 'sessions'))).toBe(false)
  })

  /** A cached entry that would be REFUSED at the fold must not be served. */
  it('treats a structurally invalid cached verdict as a miss', async () => {
    const { r, key } = seedOneFailure()
    fs.mkdirSync(path.dirname(cachePath(r, key)), { recursive: true })
    fs.writeFileSync(
      cachePath(r, key),
      JSON.stringify({ ...DRIFT, class: 'bug', confidence: 'low' }), // `bug` with no `code`
    )

    expect(await planGuardAdjudication(r)).toMatchObject({ failures: 1, cached: 0, sessions: 1 })
  })
})

// ---------------------------------------------------------------------------
// The pre-flight plan
// ---------------------------------------------------------------------------

describe('planGuardAdjudication', () => {
  it('splits the board three ways: pre-passed, cached, and a session', async () => {
    const r = repo()
    writeGuardLatest(
      r,
      board([failRow('scn.red'), failRow('scn.cached'), failRow('scn.surprise')]),
    )
    writeManifest(
      r,
      manifestWith([
        { scenarioId: 'scn.red', flowId: 'flow.red', expectedRed: EXPECTED_RED },
        { scenarioId: 'scn.cached', flowId: 'flow.cached' },
        { scenarioId: 'scn.surprise', flowId: 'flow.surprise' },
      ]),
    )
    for (const id of ['scn.red', 'scn.cached', 'scn.surprise']) commitScenario(r, id)
    const cachedKey = adjudicationCacheKey(
      item({ row: failRow('scn.cached'), flowId: 'flow.cached', scenario: scenarioDoc('scn.cached') }),
    )
    fs.mkdirSync(path.dirname(cachePath(r, cachedKey)), { recursive: true })
    fs.writeFileSync(cachePath(r, cachedKey), JSON.stringify(DRIFT))

    expect(await planGuardAdjudication(r)).toMatchObject({
      failures: 3,
      alreadyAdjudicated: 0,
      prePassed: 1,
      cached: 1,
      sessions: 1,
    })
  })

  it('skips rows that already carry a verdict for their current identity', async () => {
    const r = repo()
    const adjudication = { ...DRIFT, adjudicatedAt: '2026-08-19T01:00:00.000Z' }
    writeGuardLatest(
      r,
      board(['a', 'b', 'c'].map((id) => failRow(`scn.${id}`, { adjudication }))),
    )

    expect(await planGuardAdjudication(r)).toMatchObject({
      failures: 0,
      alreadyAdjudicated: 3,
      sessions: 0,
    })
  })

  it('refuses a `--scenario` id the board has no failure for, naming it', async () => {
    const r = repo()
    writeGuardLatest(r, board([failRow('scn.a')]))

    await expect(planGuardAdjudication(r, { scenarios: ['scn.ghost'] })).rejects.toThrow(/scn\.ghost/)
  })

  it('refuses a repo with no board at all', async () => {
    await expect(planGuardAdjudication(repo())).rejects.toThrow(/No guard board/)
  })
})

// ---------------------------------------------------------------------------
// The outcome precondition — a verdict from a session that read nothing
// ---------------------------------------------------------------------------

describe('the `read_evidence` precondition', () => {
  it('refuses the first outcome, feeds the message back, and lets the session finish', async () => {
    const r = repo()
    const evidenceDir = commitEvidence(r, 'scn.a')
    const def = adjudicationSessionDef({
      repoRoot: r,
      item: item({ evidenceDir, scenario: scenarioDoc('scn.a') }),
      exec: {
        executor: async () => {
          throw new Error('nothing executes here')
        },
        recipe: null,
        repoRoot: r,
        branch: null,
        commit: null,
        built: false,
      },
      state: newSessionState(),
    })
    const persistence = memoryPersistence()
    const briefings: string[] = []
    const { driver } = stubDriver(async (call: StubCall) => {
      briefings.push(call.briefing)
      // Run 1 hands over a verdict having read nothing at all.
      if (call.briefing === 'the briefing') return outcome(DRIFT)
      // Run 2 was told why, and complies.
      const tool = call.input.def.tools.find((t) => t.name === 'read_evidence')!
      const result = await tool.execute({ file: 'transcript.txt' }, {
        workItem: 'scn.a',
        signal: call.input.signal,
        dispatchChild: () => {
          throw new Error('no child')
        },
      })
      call.input.onEvent({ type: 'tool-result', toolName: 'read_evidence', content: result.content })
      return outcome(DRIFT)
    })

    const result = await runAgentLoop({
      def,
      workItem: 'scn.a',
      initialMessages: ['the briefing'],
      driver,
      persistence: persistence.persistence,
      sessionId: 'sess-1',
    }).outcome

    expect(briefings).toHaveLength(2)
    expect(briefings[1]).toBe(def.outcomePrecondition!.message)
    expect(briefings[1]).toContain('you never read any evidence')
    expect(result.status).toBe('completed')
  })
})

// ---------------------------------------------------------------------------
// The fold's refusal, end to end (step 22 item 3's second half)
// ---------------------------------------------------------------------------

describe('runGuardAdjudication — a refused verdict costs a re-run, never a cache entry', () => {
  it('fails the row when a `bug` stands on a control that refuted it', async () => {
    const r = repo()
    writeGuardLatest(r, board([failRow('scn.a')]))
    writeManifest(r, manifestWith([{ scenarioId: 'scn.a', flowId: 'flow.a' }]))
    commitScenario(r, 'scn.a')
    commitEvidence(r, 'scn.a')
    const key = adjudicationCacheKey(item({ flowId: 'flow.a', scenario: scenarioDoc('scn.a') }))

    let controlRef = ''
    sessionScript = async (call) => {
      const tool = (name: string) => call.input.def.tools.find((t) => t.name === name)!
      const ctx = {
        workItem: 'scn.a',
        signal: call.input.signal,
        dispatchChild: () => {
          throw new Error('the shell owns dispatch')
        },
      }
      if (call.kind === 'guard-adjudicate.control') {
        const ran = await tool('run_control').execute({ yaml: yaml.dump(scenarioDoc('ctl.1')) }, ctx)
        call.input.onEvent({
          type: 'tool-result',
          toolName: 'run_control',
          content: ran.content,
          isError: ran.isError,
        })
        return outcome({ conclusion: 'refutes', reasoning: 'correct code produces exactly this' })
      }
      const read = await tool('read_evidence').execute({ file: 'transcript.txt' }, ctx)
      call.input.onEvent({ type: 'tool-result', toolName: 'read_evidence', content: read.content })
      const verify = await tool('verify_bug').execute(
        { mechanism: 'src/x.ts:1 drops the flag', disprove: 'the flag is honored without it' },
        ctx,
      )
      call.input.onEvent({ type: 'tool-result', toolName: 'verify_bug', content: verify.content })
      controlRef = /control-[0-9a-f]{8}/.exec(verify.content)?.[0] ?? ''
      // The refutation, cited honestly — and a `bug` class it cannot support.
      return outcome({
        class: 'bug',
        mechanism: 'the flag is dropped',
        code: { file: 'src/x.ts', line: 1 },
        evidence: ['exit 2 — unknown flag'],
        control: { conclusion: 'refutes', reasoning: 'correct code produces exactly this', transcriptRef: controlRef },
        confidence: 'high',
        findings: [],
      })
    }

    const run = await runGuardAdjudication({ repoRoot: r })

    expect(controlRef).toMatch(/^control-[0-9a-f]{8}$/)
    expect(run.scenarios[0].source).toBe('session')
    expect(run.scenarios[0].verdict).toBeUndefined()
    expect(run.scenarios[0].failed).toContain('verdict refused')
    expect(run.scenarios[0].failed).toContain('downgrade the class')
    // Nothing refused may be cached, and nothing refused may reach the board.
    expect(fs.existsSync(cachePath(r, key))).toBe(false)
    const latest = JSON.parse(fs.readFileSync(path.join(r, '.truecourse', 'guard', 'LATEST.json'), 'utf-8'))
    expect(latest.scenarios[0].adjudication).toBeUndefined()
    expect(run.usage.sessions.count).toBe(1)
  }, 30_000)

  it('caches and persists an ACCEPTED verdict, with the session that reached it', async () => {
    const r = repo()
    writeGuardLatest(r, board([failRow('scn.a')]))
    writeManifest(r, manifestWith([{ scenarioId: 'scn.a', flowId: 'flow.a' }]))
    commitScenario(r, 'scn.a')
    commitEvidence(r, 'scn.a')
    const key = adjudicationCacheKey(item({ flowId: 'flow.a', scenario: scenarioDoc('scn.a') }))

    sessionScript = async (call) => {
      const tool = call.input.def.tools.find((t) => t.name === 'read_evidence')!
      const read = await tool.execute({ file: 'transcript.txt' }, {
        workItem: 'scn.a',
        signal: call.input.signal,
        dispatchChild: () => {
          throw new Error('no child')
        },
      })
      call.input.onEvent({ type: 'tool-result', toolName: 'read_evidence', content: read.content })
      return outcome({ ...DRIFT, findings: ['docs/spec.md says exit 0; the CLI has always exited 2'] })
    }

    const run = await runGuardAdjudication({ repoRoot: r })

    expect(run.scenarios[0]).toMatchObject({ scenarioId: 'scn.a', source: 'session' })
    expect(run.scenarios[0].verdict?.class).toBe('drift')
    expect(run.scenarios[0].verdict?.sessionId).toBeTruthy()
    expect(JSON.parse(fs.readFileSync(cachePath(r, key), 'utf-8'))).toMatchObject({ class: 'drift' })
    // The findings ledger is the doc-bug feed, appended per run.
    expect(run.findingsLedger?.appended).toBe(1)
    expect(fs.readFileSync(path.join(r, '.truecourse', 'guard', 'adjudicate.findings.md'), 'utf-8')).toContain(
      'docs/spec.md says exit 0',
    )
  }, 30_000)
})
