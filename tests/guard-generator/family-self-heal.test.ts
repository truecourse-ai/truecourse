/**
 * Family-level self-heal (item 4). A burst of same-diagnosis tool-defect residue is
 * clustered by ONE cheap call, and each family (≥ 3 members) gets ONE shared re-author
 * pass carrying the family's correction + exemplars. A member that then passes birth +
 * fidelity commits clean; a family that still won't converge escalates as ONE
 * tool-limitation row (count + description + Dismiss), never a finding. Small clusters
 * (< 3) keep the per-claim path; a failed cluster call leaves the whole residue per-claim.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { generateGuards, clusterDefects, type GenerateRunner, type ClusterRunner } from '@truecourse/guard-generator'
import { loadScenarios, readGuardDecisions, dismissGuardClaim } from '@truecourse/guard-runner'
import { GuardGenerateReportSchema } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  reviewBy,
  stubAuxRunners,
  PASSING_STEPS,
  type FlagSpec,
  authored,
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
// Three sections → three default cli claims (`alpha claim`, `beta claim`, `gamma claim`).
const ANCHORS = ['alpha', 'beta', 'gamma'] as const
const DOC_CONTENT = ANCHORS.map((a) => `## ${a}\n\`relkit ${a}\` does ${a}.`).join('\n\n') + '\n'

function seed(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

const threeExtract = extractBy({})

/** Round 1 authors `w-<anchor>` (a passing scenario); the family re-author (the claim
 *  carries `familyCorrection`) authors `<second>-<anchor>`. `captured` records each
 *  family correction so a test can assert the shared correction + exemplars threaded in. */
function byFamilyRound(second: string, captured?: (fc: { correction: string; exemplars: string[] }) => void): GenerateRunner {
  return async ({ claims }) =>
    authored(
      claims.map((c) => {
        if (c.familyCorrection) {
          captured?.(c.familyCorrection)
          return { ref: c.ref, scenarios: [raw(`${second}-${c.section.anchor}`, PASSING_STEPS)] }
        }
        return { ref: c.ref, scenarios: [raw(`w-${c.section.anchor}`, PASSING_STEPS)] }
      }),
    )
}

/** Flag every listed title at MEDIUM confidence (→ a fidelity finding, never a self-heal). */
function flagMedium(titles: string[]): Record<string, FlagSpec> {
  return Object.fromEntries(titles.map((t) => [t, { mismatch: `weak: ${t}`, confidence: 'medium' as const }]))
}

/** A cluster runner grouping ALL briefs into ONE family with a shared correction + description. */
function clusterAll(correction: string, description: string, onCall?: () => void): ClusterRunner {
  return async ({ briefs }) => {
    onCall?.()
    return { families: [{ members: briefs.map((_, i) => i), correction, description }] }
  }
}

const ROUND1_TITLES = ANCHORS.map((a) => `w-${a}`)

describe('generateGuards — family-level self-heal (item 4)', () => {
  it('clusters same-diagnosis residue and a CONVERGING family commits its survivors — no findings, no escalation', async () => {
    const r = seed()
    const corrections: { correction: string; exemplars: string[] }[] = []
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: threeExtract,
      // Round 1 all flagged medium → 3 fidelity residue findings; the family re-author
      // (`fixed-*`) is judged faithful → converges.
      generateRunner: byFamilyRound('fixed', (fc) => corrections.push(fc)),
      fidelityRunner: reviewBy(flagMedium(ROUND1_TITLES)),
      clusterRunner: clusterAll('Assert the exact output the claim quotes.', 'Scenarios assert a weaker proxy than the claim.'),
    })

    // Every member re-authored fresh and committed; nothing stays a finding, nothing escalates.
    expect(res.written.map((w) => w.title).sort()).toEqual(['fixed-alpha', 'fixed-beta', 'fixed-gamma'])
    expect(res.written.every((w) => w.diagnosis === undefined)).toBe(true)
    expect(res.birthFindings).toEqual([])
    expect(res.familyEscalations).toEqual([])
    expect(loadScenarios(r).scenarios.map((s) => s.title).sort()).toEqual(['fixed-alpha', 'fixed-beta', 'fixed-gamma'])

    // The shared correction + exemplar mismatches were threaded into EACH member's re-author.
    expect(corrections).toHaveLength(3)
    for (const fc of corrections) {
      expect(fc.correction).toBe('Assert the exact output the claim quotes.')
      expect(fc.exemplars.length).toBeGreaterThan(0)
      expect(fc.exemplars.length).toBeLessThanOrEqual(2)
    }
    // birthPassed counts both the round-1 passes and the family survivors' passes.
    expect(res.birthPassed).toBe(6)
  })

  it('a NON-CONVERGING family escalates as ONE tool-limitation row — count + description, not a finding', async () => {
    const r = seed()
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: threeExtract,
      generateRunner: byFamilyRound('still'),
      // Round-1 AND the family re-author (`still-*`) are both flagged → never converges.
      fidelityRunner: reviewBy(flagMedium([...ROUND1_TITLES, ...ANCHORS.map((a) => `still-${a}`)])),
      clusterRunner: clusterAll('Assert both halves of the claim.', 'Scenarios only test the positive half.'),
    })

    // The whole family left the findings list and rides ONE escalation row.
    expect(res.written).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.familyEscalations).toHaveLength(1)
    expect(res.familyEscalations[0]).toMatchObject({
      description: 'Scenarios only test the positive half.',
      count: 3,
    })
    expect(res.familyEscalations[0].members).toHaveLength(3)
    // The member identities are the dismissable claim identities (doc + anchor + claim text).
    expect(res.familyEscalations[0].members.map((m) => m.title).sort()).toEqual(['alpha claim', 'beta claim', 'gamma claim'])
  })

  it('dismissing a family (its member claim identities) makes the next generate skip them', async () => {
    const r = seed()
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: threeExtract,
      generateRunner: byFamilyRound('still'),
      fidelityRunner: reviewBy(flagMedium([...ROUND1_TITLES, ...ANCHORS.map((a) => `still-${a}`)])),
      clusterRunner: clusterAll('Assert both halves.', 'Only the positive half is tested.'),
    })
    const family = res.familyEscalations[0]

    // The family Dismiss writes each member's claim dismissal (the batched core helper is
    // exercised in tests/core; here the same per-member dismissals drive generate).
    for (const m of family.members) {
      dismissGuardClaim(r, { doc: m.doc, anchor: m.anchor, title: m.title, dismissedAt: new Date().toISOString() })
    }
    const decisions = readGuardDecisions(r)
    expect(new Set(decisions.dismissedClaims.map((d) => d.title))).toEqual(new Set(['alpha claim', 'beta claim', 'gamma claim']))

    // Second generate: every family member is dismissed → skipped before authoring; each
    // settles as a `dismissed` gap and produces no finding or escalation this run.
    const res2 = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: threeExtract,
      generateRunner: byFamilyRound('still'),
      fidelityRunner: reviewBy(flagMedium([...ROUND1_TITLES, ...ANCHORS.map((a) => `still-${a}`)])),
      clusterRunner: clusterAll('Assert both halves.', 'Only the positive half is tested.'),
    })
    expect(res2.birthFindings).toEqual([])
    expect(res2.familyEscalations).toEqual([])
    expect(res2.coverageGaps.filter((g) => g.kind === 'dismissed')).toHaveLength(3)
  })

  it('a small cluster (< 3 residue) keeps the per-claim path — no cluster call, findings stay', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    // Only TWO sections → two residue findings, below the family threshold.
    writeDoc(r, DOC, ['## alpha', '`relkit a` does A.', '', '## beta', '`relkit b` does B.'].join('\n') + '\n')
    let clusterCalls = 0
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: byFamilyRound('fixed'),
      fidelityRunner: reviewBy(flagMedium(['w-alpha', 'w-beta'])),
      clusterRunner: clusterAll('never called', 'never called', () => clusterCalls++),
    })

    expect(clusterCalls).toBe(0)
    expect(res.familyEscalations).toEqual([])
    expect(res.birthFindings.map((f) => f.title).sort()).toEqual(['w-alpha', 'w-beta'])
  })

  it('a failed cluster call leaves the whole residue on the per-claim path (fail-soft)', async () => {
    const r = seed()
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: threeExtract,
      generateRunner: byFamilyRound('fixed'),
      fidelityRunner: reviewBy(flagMedium(ROUND1_TITLES)),
      clusterRunner: async () => {
        throw new Error('cluster call failed')
      },
    })

    expect(res.familyEscalations).toEqual([])
    expect(res.written).toEqual([])
    expect(res.birthFindings.map((f) => f.title).sort()).toEqual(ROUND1_TITLES)
  })

  it('the family escalation round-trips through the report schema; an older report omitting it still parses', () => {
    const rep = {
      generatedAt: '2026-07-21T00:00:00.000Z',
      status: 'ok' as const,
      sectionsTotal: 3,
      sectionsChanged: 3,
      skippedUnchanged: 0,
      noChanges: false,
      written: [],
      coverageGaps: [],
      birthFindings: [],
      errors: [],
      extractionFailures: [],
      orphaned: [],
      familyEscalations: [
        {
          id: 'abc123',
          description: 'Scenarios only test the positive half.',
          count: 2,
          members: [
            { doc: DOC, anchor: 'alpha', title: 'alpha claim' },
            { doc: DOC, anchor: 'beta', title: 'beta claim' },
          ],
        },
      ],
    }
    expect(() => GuardGenerateReportSchema.parse(rep)).not.toThrow()
    const { familyEscalations: _drop, ...older } = rep
    expect(() => GuardGenerateReportSchema.parse(older)).not.toThrow()
  })
})

describe('clusterDefects — index handling + fail-soft', () => {
  it('drops out-of-range and duplicate member indexes, keeps in-range families', async () => {
    const runner: ClusterRunner = async () => ({
      families: [
        { members: [0, 1, 1, 9], correction: 'c', description: 'd' },
        { members: [7, 8], correction: 'c2', description: 'd2' },
      ],
    })
    const families = await clusterDefects(['a', 'b', 'c'], runner)
    expect(families).toEqual([{ members: [0, 1], correction: 'c', description: 'd' }])
  })

  it('returns null (fail-soft) when the runner throws or stays invalid', async () => {
    const thrown = await clusterDefects(['a'], async () => {
      throw new Error('boom')
    })
    expect(thrown).toBeNull()
    const invalid = await clusterDefects(['a'], async () => ({ nope: true }))
    expect(invalid).toBeNull()
  })
})
