import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  claimContentHash,
  guardClaimKey,
  type GuardClaim,
  type GuardClaimsFile,
  type GuardFlowsFile,
} from '@truecourse/shared'
import {
  crossCheckClaimRefs,
  guardClaimsPath,
  guardFlowsPath,
  loadScenarios,
  readGuardClaimsCorpus,
  readGuardFlowsCorpus,
  walkScenarioRelFiles,
  writeGuardClaims,
  scenariosDir,
} from '@truecourse/guard-runner'
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

const DOC = 'docs/spec.md'
const claim = (over: Partial<GuardClaim> & Pick<GuardClaim, 'id' | 'title'>): GuardClaim => {
  const body = {
    doc: over.doc ?? DOC,
    anchor: over.anchor ?? 'a/b',
    title: over.title,
    claim: over.claim ?? `${over.title} holds.`,
  }
  return { id: over.id, ...body, contentHash: claimContentHash(body), needs: over.needs ?? [] }
}
const claimsFile = (claims: GuardClaim[]): GuardClaimsFile => ({
  version: 1,
  generatedAt: '2026-08-07T00:00:00.000Z',
  claims,
  untestable: [],
})
const flowsFile = (over: Partial<GuardFlowsFile> = {}): GuardFlowsFile => ({
  version: 1,
  generatedAt: '2026-08-07T00:00:00.000Z',
  flows: [],
  noFlowClaims: [],
  ...over,
})
const flow = (milestoneTitles: string[]): GuardFlowsFile['flows'][number] => ({
  id: 'f1',
  title: 'A flow',
  goal: 'A goal',
  fingerprint: 'sha256:f',
  milestones: milestoneTitles.map((claimTitle, i) => ({
    order: i + 1,
    doc: DOC,
    anchor: 'a/b',
    claimTitle,
  })),
  bindings: [{ doc: DOC, anchor: 'a/b', fingerprint: 'sha256:s' }],
  composedOf: [],
  synthesisInputsHash: 'sha256:i',
})

describe('crossCheckClaimRefs', () => {
  const known = claim({ id: 'known-claim', title: 'the thing works' })

  it('is a no-op when the repo has no claims store', () => {
    expect(
      crossCheckClaimRefs({
        claims: null,
        flows: flowsFile({ flows: [flow(['anything at all'])] }),
        scenarios: [],
      }),
    ).toEqual([])
  })

  it('passes silently when every reference resolves', () => {
    const s = scenario({
      id: 'a',
      steps: [{ run: ['--version'], expect: { exit: 0 }, milestone: 'known-claim' }],
    })
    expect(
      crossCheckClaimRefs({
        claims: claimsFile([known]),
        flows: flowsFile({ flows: [flow([known.title])] }),
        scenarios: [{ scenario: s, file: 'a.yaml' }],
      }),
    ).toEqual([])
  })

  it('reports a scenario step naming a claim id the store does not declare', () => {
    const s = scenario({
      id: 'a',
      steps: [
        { run: ['--version'], expect: { exit: 0 } },
        { run: ['list'], expect: { exit: 0 }, milestone: ['known-claim', 'ghost-claim'] },
      ],
    })
    const errors = crossCheckClaimRefs({
      claims: claimsFile([known]),
      flows: null,
      scenarios: [{ scenario: s, file: 'cli/a.yaml' }],
    })
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toBe('cli/a.yaml')
    expect(errors[0].message).toContain('step 2')
    expect(errors[0].message).toContain('ghost-claim')
  })

  it('reports a flow milestone whose claim IDENTITY resolves to nothing', () => {
    const errors = crossCheckClaimRefs({
      claims: claimsFile([known]),
      flows: flowsFile({ flows: [flow([known.title, 'a claim nobody extracted'])] }),
      scenarios: [],
    })
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toContain('flows.json')
    expect(errors[0].message).toContain('milestone 2')
    expect(errors[0].message).toContain('a claim nobody extracted')
  })

  it('reports a noFlowClaims entry the store does not declare', () => {
    const errors = crossCheckClaimRefs({
      claims: claimsFile([known]),
      flows: flowsFile({
        noFlowClaims: [{ doc: DOC, anchor: 'a/b', claimTitle: 'unknown gap', reason: 'unobservable' }],
      }),
      scenarios: [],
    })
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toContain('flows.json')
    expect(errors[0].message).toContain('unknown gap')
  })

  it('reports a duplicated claim id — a milestone tag naming it would be ambiguous', () => {
    const errors = crossCheckClaimRefs({
      claims: claimsFile([known, claim({ id: known.id, title: 'a different claim' })]),
      flows: null,
      scenarios: [],
    })
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toContain('claims.json')
    expect(errors[0].message).toContain('duplicate claim id')
  })

  it('resolves an identity by doc + anchor + title, not by title alone', () => {
    const errors = crossCheckClaimRefs({
      claims: claimsFile([known]),
      flows: flowsFile({
        flows: [
          {
            ...flow([known.title]),
            milestones: [{ order: 1, doc: DOC, anchor: 'other/section', claimTitle: known.title }],
          },
        ],
      }),
      scenarios: [],
    })
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('other/section')
  })
})

describe('the claims store on disk', () => {
  it('reads back what it wrote, and reads null when absent or corrupt', () => {
    const r = repo()
    expect(readGuardClaimsCorpus(r)).toBeNull()
    const file = claimsFile([claim({ id: 'x', title: 'a claim' })])
    writeGuardClaims(r, file)
    expect(guardClaimsPath(r)).toBe(path.join(scenariosDir(r), 'claims.json'))
    expect(readGuardClaimsCorpus(r)).toEqual(file)
    fs.writeFileSync(guardClaimsPath(r), '{ not json')
    expect(readGuardClaimsCorpus(r)).toBeNull()
  })

  it('reads the flow corpus through the same seam', () => {
    const r = repo()
    expect(readGuardFlowsCorpus(r)).toBeNull()
    fs.mkdirSync(scenariosDir(r), { recursive: true })
    const flows = flowsFile()
    fs.writeFileSync(guardFlowsPath(r), JSON.stringify(flows))
    expect(readGuardFlowsCorpus(r)).toEqual(flows)
  })

  it('joins the scenario-corpus membership walk, so a snapshotting store keeps it', () => {
    const r = repo()
    writeRecipe(r)
    writeGuardClaims(r, claimsFile([]))
    expect(walkScenarioRelFiles(scenariosDir(r))).toContain('claims.json')
  })
})

describe('loadScenarios — claim-reference diagnostics', () => {
  it('reports a dangling milestone id as a load error WITHOUT dropping the scenario', () => {
    const r = repo()
    writeRecipe(r)
    writeGuardClaims(r, claimsFile([claim({ id: 'known-claim', title: 'the thing works' })]))
    writeScenario(
      r,
      'cli/a.yaml',
      scenario({ id: 'a', steps: [{ run: ['--version'], expect: { exit: 0 }, milestone: 'ghost-claim' }] }),
    )

    const { scenarios, errors } = loadScenarios(r)
    expect(scenarios.map((s) => s.id)).toEqual(['a'])
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('ghost-claim')
    expect(errors[0].file).toContain('a.yaml')
  })

  it('stays silent for a repo with scenarios but no claims store', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/a.yaml',
      scenario({ id: 'a', steps: [{ run: ['--version'], expect: { exit: 0 }, milestone: 'anything' }] }),
    )
    expect(loadScenarios(r).errors).toEqual([])
  })

  it('resolves a claim-tagged scenario cleanly when the store declares it', () => {
    const r = repo()
    writeRecipe(r)
    const c = claim({ id: 'known-claim', title: 'the thing works' })
    writeGuardClaims(r, claimsFile([c]))
    fs.mkdirSync(scenariosDir(r), { recursive: true })
    fs.writeFileSync(guardFlowsPath(r), JSON.stringify(flowsFile({ flows: [flow([c.title])] })))
    writeScenario(
      r,
      'cli/a.yaml',
      scenario({ id: 'a', steps: [{ run: ['--version'], expect: { exit: 0 }, milestone: c.id }] }),
    )
    expect(loadScenarios(r).errors).toEqual([])
    expect(guardClaimKey(c)).toBe(guardClaimKey({ doc: DOC, anchor: 'a/b', title: c.title }))
  })
})
