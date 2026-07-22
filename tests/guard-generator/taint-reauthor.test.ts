/**
 * Item 2 — a claim whose scenario ends a run flagged is TAINTED, so the next generate
 * BYPASSES the author cache (which still holds the rejected scenario) and re-authors
 * fresh, carrying the prior mismatch as correction evidence. A faithful pass clears the
 * taint; unflagged claims still cache-hit; the 2-strike escalation stays as the backstop
 * but now fires only after a FRESH re-author fails the same way.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import { generateGuards, buildAuthorUserPrompt } from '@truecourse/guard-generator'
import type { RawGeneratedScenario, GenerateRunner, AuthorUserContext } from '@truecourse/guard-generator'
import { readGuardAutoResolutions, writeGuardAutoResolutions, guardAutoResolutionsPath } from '@truecourse/guard-runner'
import type { GuardTriage } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  triageBy,
  stubAuxRunners,
  PASSING_STEPS,
  FAILING_STEPS,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

const DOC = 'docs/cli.md'
const DOC_CONTENT = ['## cmd', 'The cmd does things.'].join('\n')

const genDefectHigh: GuardTriage = {
  verdict: 'generation-defect',
  confidence: 'high',
  brief: 'the scenario tests only the matching half and never exercises the excluded inputs',
  recommendation: 'Retry — assert both halves.',
}

/** An author runner that records every context it is handed and authors a scenario per
 *  claim by a caller-supplied picker (so a claim can flip failing→passing across runs). */
function capturingAuthor(pick: (claim: string) => RawGeneratedScenario): {
  runner: GenerateRunner
  calls: AuthorUserContext[]
} {
  const calls: AuthorUserContext[] = []
  const runner: GenerateRunner = async (ctx) => {
    calls.push(ctx)
    return ctx.claims.map((c) => ({ ref: c.ref, scenarios: [pick(c.claim)] }))
  }
  return { runner, calls }
}

function seed(content = DOC_CONTENT): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, content)
  return r
}

describe('generateGuards — flagged claims re-author fresh, not from cache (item 2)', () => {
  it('taints a flagged claim; next generate bypasses the cache and carries the prior mismatch, while an unflagged sibling cache-hits', async () => {
    const r = seed()
    // Two claims in one section: `bad` births a failing scenario (→ generation-defect,
    // triage-resolve, taint); `good` births a passing scenario (→ committed, no taint).
    const { runner, calls } = capturingAuthor((claim) =>
      claim.includes('bad') ? raw('bad scenario', FAILING_STEPS) : raw('good scenario', PASSING_STEPS),
    )
    const opts = {
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({ cmd: [{ claim: 'bad claim' }, { claim: 'good claim' }] }),
      generateRunner: runner,
      triageRunner: triageBy(genDefectHigh),
    }

    // Run 1 — both claims are cold-cache misses (one batch call), then a retry for `bad`.
    await generateGuards(opts)
    const afterRun1 = calls.length

    // The bad claim is tainted; the good claim is not.
    const ledger1 = readGuardAutoResolutions(r)
    const taints1 = Object.values(ledger1.tainted)
    expect(taints1).toHaveLength(1)
    expect(taints1[0]).toMatchObject({ doc: DOC, anchor: 'cmd', claim: 'bad claim' })

    // Run 2 — the tainted `bad` claim bypasses the cache and re-authors; `good` cache-hits.
    await generateGuards(opts)
    const run2Calls = calls.slice(afterRun1)

    // A run-2 author call re-authored `bad` fresh, carrying the prior flag's mismatch.
    const priorFlagCall = run2Calls.find((ctx) => ctx.claims.some((c) => c.priorFlag))
    expect(priorFlagCall).toBeDefined()
    const badClaim = priorFlagCall!.claims.find((c) => c.priorFlag)!
    expect(badClaim.claim).toBe('bad claim')
    expect(badClaim.priorFlag!.mismatch).toBe(genDefectHigh.brief)
    // The mismatch renders into the actual author PROMPT the model would see.
    const prompt = buildAuthorUserPrompt(priorFlagCall!)
    expect(prompt).toContain('PRIOR FLAG')
    expect(prompt).toContain(genDefectHigh.brief)

    // The unflagged `good` claim never reached the runner on run 2 — it cache-hit.
    for (const ctx of run2Calls) {
      for (const c of ctx.claims) expect(c.claim).not.toBe('good claim')
    }
  })

  it('clears the taint on a faithful pass — the re-author commits and the claim is no longer tainted', async () => {
    const r = seed()
    let healed = false
    const { runner, calls } = capturingAuthor((claim) =>
      !healed && claim.includes('bad') ? raw('bad scenario', FAILING_STEPS) : raw('healed scenario', PASSING_STEPS),
    )
    const opts = {
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({ cmd: [{ claim: 'bad claim' }] }),
      generateRunner: runner,
      triageRunner: triageBy(genDefectHigh),
    }

    // Run 1 — the bad scenario is flagged and the claim is tainted.
    await generateGuards(opts)
    expect(Object.keys(readGuardAutoResolutions(r).tainted)).toHaveLength(1)
    const afterRun1 = calls.length

    // Run 2 — the claim re-authors fresh (cache bypassed) and now PASSES → committed.
    healed = true
    const res2 = await generateGuards(opts)
    expect(calls.length).toBeGreaterThan(afterRun1) // the bad claim was re-authored, not cache-hit
    expect(res2.written).toHaveLength(1)
    expect(res2.birthFindings).toEqual([])

    // A faithful pass clears the taint.
    expect(readGuardAutoResolutions(r).tainted).toEqual({})
  })

  it('escalation still fires when the FRESH re-author fails the same way (backstop intact)', async () => {
    const r = seed()
    // Always authors a failing scenario — the re-author never converges.
    const { runner, calls } = capturingAuthor(() => raw('bad scenario', FAILING_STEPS))
    const opts = {
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({ cmd: [{ claim: 'bad claim' }] }),
      generateRunner: runner,
      triageRunner: triageBy(genDefectHigh),
      escalateAutoResolveAfter: 1,
    }

    // Run 1 — auto-resolves (count → 1) and taints the claim.
    const res1 = await generateGuards(opts)
    expect(res1.birthFindings).toEqual([])
    expect(res1.autoResolved).toHaveLength(1)
    expect(Object.keys(readGuardAutoResolutions(r).tainted)).toHaveLength(1)
    const afterRun1 = calls.length

    // Run 2 — the tainted claim re-authors FRESH (not from cache), fails the same way,
    // and now escalates to a human finding (count 1 ≥ threshold 1).
    const res2 = await generateGuards(opts)
    expect(calls.length).toBeGreaterThan(afterRun1) // the escalation followed a fresh re-author
    expect(res2.birthFindings).toHaveLength(1)
    expect(res2.birthFindings[0].autoResolveEscalation).toEqual({ verdict: 'generation-defect', count: 1 })
    // A run-2 author call carried the prior flag — the re-author was tainted, not cached.
    expect(calls.slice(afterRun1).some((ctx) => ctx.claims.some((c) => c.priorFlag))).toBe(true)
  })

  it('a legacy ledger (no `tainted` field) still parses — the taint set defaults to empty', () => {
    const r = seed()
    // A file written before item 2 existed: escalation counts, no `tainted` key.
    const legacy = { version: 1, entries: { abc123: { count: 1, verdict: 'generation-defect', updatedAt: 'x' } } }
    fs.mkdirSync(guardAutoResolutionsPath(r).replace(/\/[^/]+$/, ''), { recursive: true })
    fs.writeFileSync(guardAutoResolutionsPath(r), JSON.stringify(legacy))

    const parsed = readGuardAutoResolutions(r)
    expect(parsed.entries.abc123).toMatchObject({ count: 1, verdict: 'generation-defect' })
    expect(parsed.tainted).toEqual({})

    // A round-trip write/read carries the (now-materialized) empty taint set forward.
    writeGuardAutoResolutions(r, parsed)
    expect(readGuardAutoResolutions(r).tainted).toEqual({})
  })
})
