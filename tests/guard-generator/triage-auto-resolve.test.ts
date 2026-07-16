/**
 * High-confidence triage recommendations auto-resolve (item 14) — humans see only
 * real questions. A birth/fidelity finding whose Opus triage said `environment` or
 * `generation-defect` at HIGH confidence is handled by the tool itself, never a task:
 *   - environment       → auto-DISMISS the claim into scenarios/decisions.json (marked
 *     `auto`, brief as the reason); generate honors it next run.
 *   - generation-defect → retire the FINDING to the ledger; the claim re-attempts.
 * Drift (doc/code, any confidence) and any verdict below HIGH stay HUMAN findings.
 * Escalation guard: a finding identity that keeps auto-resolving without converging
 * (default 2) surfaces to the human — auto-resolution is never an infinite silent loop.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { generateGuards } from '@truecourse/guard-generator'
import { readGuardDecisions, readGuardAutoResolutions } from '@truecourse/guard-runner'
import type { GuardTriage } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  authorBy,
  triageBy,
  stubAuxRunners,
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
const DOC_CONTENT = ['## version', '`relkit --version` prints the version and exits 0.'].join('\n')

const versionExtract = extractBy({})
/** Author a birth-FAILING scenario (boom, expects exit 0) — round 1 + retry both
 *  fail, so `version` births a finding for triage to judge + auto-resolve. */
const alwaysFails = authorBy({ version: [raw('boom', FAILING_STEPS)] })

function seed(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

const verdict = (v: GuardTriage['verdict'], confidence: GuardTriage['confidence']): GuardTriage => ({
  verdict: v,
  confidence,
  brief: `${v} at ${confidence}: the sandbox never exercises the claimed behavior.`,
  recommendation: `dismiss-or-retry — ${v}.`,
})

async function run(r: string, triage: GuardTriage, escalateAutoResolveAfter?: number) {
  return generateGuards({
    ...stubAuxRunners(),
    repoRoot: r,
    extractRunner: versionExtract,
    generateRunner: alwaysFails,
    triageRunner: triageBy(triage),
    ...(escalateAutoResolveAfter !== undefined ? { escalateAutoResolveAfter } : {}),
  })
}

describe('generateGuards — high-confidence triage auto-resolution (item 14)', () => {
  it('environment + HIGH → auto-dismisses the claim into decisions.json marked auto', async () => {
    const r = seed()
    const res = await run(r, verdict('environment', 'high'))

    // The finding left the task list; it rides the ledger as a triage-dismiss.
    expect(res.birthFindings).toEqual([])
    expect(res.autoResolved).toHaveLength(1)
    expect(res.autoResolved[0]).toMatchObject({
      kind: 'triage-dismiss',
      doc: DOC,
      anchor: 'version',
      title: 'boom',
      verdict: 'environment',
      claim: 'version claim',
    })

    // The claim is dismissed in decisions.json, marked `auto`, with the brief as reason.
    const decisions = readGuardDecisions(r)
    expect(decisions.dismissedClaims).toHaveLength(1)
    expect(decisions.dismissedClaims[0]).toMatchObject({
      doc: DOC,
      anchor: 'version',
      title: 'version claim',
      auto: true,
    })
    expect(decisions.dismissedClaims[0].reason).toContain('environment')
  })

  it('generation-defect + HIGH → retires the FINDING to the ledger, never dismisses the claim', async () => {
    const r = seed()
    const res = await run(r, verdict('generation-defect', 'high'))

    expect(res.birthFindings).toEqual([])
    expect(res.autoResolved).toHaveLength(1)
    expect(res.autoResolved[0]).toMatchObject({
      kind: 'triage-resolve',
      doc: DOC,
      anchor: 'version',
      title: 'boom',
      verdict: 'generation-defect',
    })
    // The claim is NOT dismissed — it re-attempts next generate.
    expect(readGuardDecisions(r).dismissedClaims).toEqual([])
  })

  it.each([
    ['doc-drift', 'high'],
    ['code-drift', 'high'],
    ['generation-defect', 'medium'],
    ['generation-defect', 'low'],
    ['environment', 'medium'],
    ['environment', 'low'],
  ] as const)('%s + %s stays a HUMAN finding — never auto-resolved', async (v, c) => {
    const r = seed()
    const res = await run(r, verdict(v, c))

    expect(res.birthFindings).toHaveLength(1)
    expect(res.birthFindings[0].triage).toMatchObject({ verdict: v, confidence: c })
    expect(res.birthFindings[0].autoResolveEscalation).toBeUndefined()
    expect(res.autoResolved).toEqual([])
    expect(readGuardDecisions(r).dismissedClaims).toEqual([])
  })

  it('a finding without triage (no runner) stays a human finding', async () => {
    const r = seed()
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: alwaysFails,
    })
    expect(res.birthFindings).toHaveLength(1)
    expect(res.birthFindings[0].triage).toBeUndefined()
    expect(res.autoResolved).toEqual([])
  })

  it('generate HONORS an auto-dismissal on the next run — the claim settles as a dismissed gap', async () => {
    const r = seed()
    await run(r, verdict('environment', 'high'))

    // Second generate: the claim was auto-dismissed, so it is skipped before authoring
    // and settles as an explicit `dismissed` coverage gap — no finding this run.
    const res2 = await run(r, verdict('environment', 'high'))
    expect(res2.birthFindings).toEqual([])
    expect(res2.autoResolved).toEqual([])
    const dismissedGap = res2.coverageGaps.find((g) => g.kind === 'dismissed' && g.anchor === 'version')
    expect(dismissedGap).toBeDefined()
  })

  it('escalates to a human finding after N auto-resolutions without converging', async () => {
    const r = seed()
    // Threshold 1: the FIRST run auto-resolves (count → 1); the SECOND re-produces the
    // identical generation-defect finding, which has now auto-resolved 1 ≥ 1 times, so
    // it surfaces to the human with a "re-generation is not fixing this" escalation.
    const res1 = await run(r, verdict('generation-defect', 'high'), 1)
    expect(res1.birthFindings).toEqual([])
    expect(res1.autoResolved).toHaveLength(1)

    // The durable ledger recorded the identity's count.
    const ledger = readGuardAutoResolutions(r)
    expect(Object.keys(ledger.entries)).toHaveLength(1)
    expect(Object.values(ledger.entries)[0]).toMatchObject({ count: 1, verdict: 'generation-defect' })

    const res2 = await run(r, verdict('generation-defect', 'high'), 1)
    expect(res2.autoResolved).toEqual([])
    expect(res2.birthFindings).toHaveLength(1)
    expect(res2.birthFindings[0].autoResolveEscalation).toEqual({ verdict: 'generation-defect', count: 1 })
  })

  it('does NOT escalate before the threshold — the same identity auto-resolves again', async () => {
    const r = seed()
    // Default threshold (2): two runs both auto-resolve, no escalation yet.
    await run(r, verdict('generation-defect', 'high'))
    const res2 = await run(r, verdict('generation-defect', 'high'))
    expect(res2.birthFindings).toEqual([])
    expect(res2.autoResolved).toHaveLength(1)
    expect(readGuardAutoResolutions(r).entries[Object.keys(readGuardAutoResolutions(r).entries)[0]].count).toBe(2)
  })
})
