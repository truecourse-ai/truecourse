/**
 * Extraction reconciles against the document's LAST extraction: the
 * deterministic half — which sections settle, what a draft must account for,
 * and how the settled sections merge back — lives in the generator and is
 * pinned here. A settled section's claims come back byte for byte without a
 * model in the loop; an extracted section's prior claims are kept, replaced
 * or retired, never silently re-invented.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import {
  carryPriorCaseIdentity,
  collectWorkDocs,
  docContentHash,
  mergeSettledSections,
  planGuardWork,
  priorExtractions,
  reconciliationProblems,
  type ExtractPrior,
  type PriorExtraction,
  type ReuseExtractionSeam,
} from '@truecourse/guard-generator'
import { writeGuardClaims, writeManifest } from '@truecourse/guard-runner'
import type { GuardClaim } from '@truecourse/shared'
import { makeTempRepo, rmrf, writeCorpus, writeDoc, writeRecipe } from './helpers.js'
import { installMemoryKvCache, resetKvCacheStore } from '../helpers/memory-kv-cache.js'

const repos: string[] = []
beforeEach(() => {
  installMemoryKvCache()
})
afterEach(() => {
  resetKvCacheStore()
  while (repos.length) rmrf(repos.pop()!)
})

const DOC = 'docs/tasks.md'
const CREATING = 'tasks/creating-tasks'
const LISTING = 'tasks/listing-tasks'
const CONTENT = [
  '# Tasks',
  '',
  '## Creating tasks',
  '',
  '`relkit add <title>` creates a task and prints its id as `t<N>`.',
  '',
  '## Listing tasks',
  '',
  '`relkit list` prints one line per open task, newest first.',
].join('\n')
/** The listing section reworded; the creating section untouched. */
const EDITED = CONTENT.replace('newest first', 'newest first, one per line')

const ADD = '`relkit add <title>` creates a task and prints its id'
const LIST = '`relkit list` prints one line per open task, newest first'

const addClaim = { claim: ADD, driver: 'cli' as const, sectionAnchor: CREATING, reason: 'stdout carries the id', needs: [] }
const listClaim = { claim: LIST, driver: 'cli' as const, sectionAnchor: LISTING, reason: 'stdout lists tasks', needs: [] }

function docRepo(content: string): string {
  const r = makeTempRepo()
  repos.push(r)
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, content)
  return r
}

/** A seam answering a fixed prior for one content hash, recording what it was asked. */
function seamOf(entries: Record<string, PriorExtraction>): ReuseExtractionSeam & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    async lookup(_doc, priorContentHash) {
      asked.push(priorContentHash)
      return entries[priorContentHash] ?? null
    },
    async reuse() {},
  }
}

/** The manifest a prior generate left: every section's fingerprint (as a gap
 *  record) and the doc's content hash. */
function priorManifest(r: string, content: string) {
  const plan = planGuardWork(r)
  return {
    flows: [],
    gapSections: plan.sections.map((s) => ({ doc: s.doc, anchor: s.anchor, fingerprint: s.fingerprint })),
    docs: [{ doc: DOC, contentHash: docContentHash(content) }],
  }
}

describe('reconciliationProblems', () => {
  const prior: ExtractPrior = { claims: [addClaim, listClaim], untestable: [], settledAnchors: [CREATING] }

  it('accepts a draft that keeps a prior claim verbatim', () => {
    expect(reconciliationProblems({ claims: [listClaim] }, prior)).toEqual([])
  })

  it('accepts a replacement naming the prior sentence, and a retirement with a reason', () => {
    expect(
      reconciliationProblems({ claims: [{ ...listClaim, claim: 'lists open tasks', replaces: LIST }] }, prior),
    ).toEqual([])
    expect(reconciliationProblems({ claims: [], retiredClaims: [{ claim: LIST, reason: 'the list is gone' }] }, prior)).toEqual([])
  })

  it('refuses an unaccounted prior claim of an extracted section', () => {
    expect(reconciliationProblems({ claims: [] }, prior)).toEqual([
      expect.stringContaining(`prior claim "${LIST}" (\`${LISTING}\`) is unaccounted for`),
    ])
  })

  it('refuses a claim on a settled section, and never asks for its prior claims', () => {
    const problems = reconciliationProblems({ claims: [addClaim, listClaim] }, prior)
    expect(problems).toEqual([expect.stringContaining(`is bound to \`${CREATING}\`, a section unchanged`)])
  })

  it('refuses a replacement naming no prior, one prior continued twice, and one both continued and retired', () => {
    expect(reconciliationProblems({ claims: [{ ...listClaim, replaces: 'never said' }] }, prior)).toEqual([
      expect.stringContaining('replaces "never said", which is no prior claim'),
      expect.stringContaining('is unaccounted for'),
    ])
    expect(
      reconciliationProblems(
        { claims: [{ ...listClaim, claim: 'a', replaces: LIST }, { ...listClaim, claim: 'b', replaces: LIST }] },
        prior,
      ),
    ).toEqual([expect.stringContaining('is continued by 2 claims')])
    expect(
      reconciliationProblems({ claims: [listClaim], retiredClaims: [{ claim: LIST, reason: 'gone' }] }, prior),
    ).toEqual([expect.stringContaining('is both continued and retired')])
  })
})

describe('carryPriorCaseIdentity', () => {
  const withCases = (claim: string, ids: [string, string][], needs: { kind: 'fixture'; name: string }[] = []) => ({
    claim,
    driver: 'cli' as const,
    sectionAnchor: LISTING,
    reason: 'r',
    verification: { scope: 'configuration' as const, method: 'behavior' as const, observable: 'o', cases: ids.map(([id, text]) => ({ id, claim: text, method: 'behavior' as const, requires: ['process' as const], conditions: [], prerequisites: [] })) },
    needs,
  })
  const priorList = withCases(LIST, [['newest-first', 'Newest task first'], ['one-per-line', 'One line per task']], [{ kind: 'fixture', name: 'sample-tasks' }])
  const prior: ExtractPrior = { claims: [addClaim, priorList], untestable: [], settledAnchors: [CREATING] }

  it('a kept claim takes its prior driver, alternatives, cases and needs verbatim, whatever the session re-minted', () => {
    const draft = { claims: [{ ...withCases(LIST, [['first', 'Newest task first']], [{ kind: 'fixture' as const, name: 'tasks' }]), driver: 'web' as const, alternativeDrivers: ['api' as const] }] }
    expect(carryPriorCaseIdentity(draft, prior)).toEqual([priorList])
    // A prior without a driver (a store row from before drivers were recorded) leaves the session's choice.
    const { driver: _d, ...driverless } = priorList
    const out = carryPriorCaseIdentity(draft, { ...prior, claims: [addClaim, driverless] })
    expect(out[0]!.driver).toBe('web')
    expect(out[0]!.verification).toEqual(priorList.verification)
  })

  it('a replaced claim keeps the id of every prior case it re-states, and the prior need name for the same need', () => {
    const draft = {
      claims: [{ ...withCases('lists open tasks', [['first', 'Newest task first'], ['count', 'Shows the count']], [{ kind: 'fixture' as const, name: 'tasks' }]), replaces: LIST }],
    }
    const [out] = carryPriorCaseIdentity(draft, prior)
    expect(out!.verification?.cases?.map((c) => c.id)).toEqual(['newest-first', 'count'])
    expect(out!.needs).toEqual([{ kind: 'fixture', name: 'sample-tasks' }])
  })

  it('leaves a settled section and a genuinely new claim alone', () => {
    const fresh = withCases('a brand new claim', [['x', 'x']])
    expect(carryPriorCaseIdentity({ claims: [addClaim, fresh] }, prior)).toEqual([addClaim, fresh])
  })
})

describe('mergeSettledSections', () => {
  it('takes the settled sections from the prior byte for byte and the rest from the draft, dropping retiredClaims', () => {
    const prior: ExtractPrior = {
      claims: [addClaim, listClaim],
      untestable: [{ sectionAnchor: CREATING, reason: 'note kept' }],
      settledAnchors: [CREATING],
    }
    const draft = {
      claims: [{ ...listClaim, claim: 'lists open tasks', replaces: LIST }],
      untestable: [{ sectionAnchor: LISTING, reason: 'fresh note' }],
      retiredClaims: [],
    }
    expect(mergeSettledSections(draft, prior)).toEqual({
      claims: [addClaim, { ...listClaim, claim: 'lists open tasks', replaces: LIST }],
      untestable: [{ sectionAnchor: CREATING, reason: 'note kept' }, { sectionAnchor: LISTING, reason: 'fresh note' }],
    })
  })

  it('never merges a prior claim that has no driver', () => {
    const { driver: _d, ...driverless } = addClaim
    const prior: ExtractPrior = { claims: [driverless], untestable: [], settledAnchors: [CREATING] }
    expect(mergeSettledSections({ claims: [], untestable: [] }, prior).claims).toEqual([])
  })
})

describe('priorExtractions', () => {
  it('settles the unchanged sections of an edited document from the cached prior, and leaves the edited one to extract', async () => {
    const r = docRepo(EDITED)
    const docs = collectWorkDocs(r, planGuardWork(r))
    const before = docRepo(CONTENT)
    const manifest = priorManifest(before, CONTENT)
    const seam = seamOf({ [docContentHash(CONTENT)]: { claims: [addClaim, listClaim], untestable: [] } })

    const priors = await priorExtractions({ repoRoot: r, docs, priorManifest: manifest, seam })

    expect(seam.asked).toEqual([docContentHash(CONTENT)])
    expect(priors.get(DOC)).toEqual({ claims: [addClaim, listClaim], untestable: [], settledAnchors: [CREATING] })
  })

  it('falls back to the committed claims store when the cache holds no prior, settling only rows that carry a driver', async () => {
    const r = docRepo(EDITED)
    const docs = collectWorkDocs(r, planGuardWork(r))
    const before = docRepo(CONTENT)
    const row = (over: Partial<GuardClaim>): GuardClaim => ({
      id: 'add', doc: DOC, anchor: CREATING, title: ADD, claim: ADD, contentHash: 'sha256:x', verifyVia: 'stdout carries the id', ...over,
    })
    writeGuardClaims(r, {
      version: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      claims: [row({ driver: 'cli' }), row({ id: 'list', anchor: LISTING, title: LIST, claim: LIST })],
      untestable: [],
    })

    const withDriver = await priorExtractions({ repoRoot: r, docs, priorManifest: priorManifest(before, CONTENT), seam: seamOf({}) })
    expect(withDriver.get(DOC)).toMatchObject({
      claims: [expect.objectContaining({ claim: ADD, driver: 'cli', sectionAnchor: CREATING }), expect.objectContaining({ claim: LIST, sectionAnchor: LISTING })],
      settledAnchors: [CREATING],
    })

    // The same rows without a driver: briefed, never settled.
    writeGuardClaims(r, { version: 1, generatedAt: '2026-01-01T00:00:00.000Z', claims: [row({}), row({ id: 'list', anchor: LISTING, title: LIST, claim: LIST })], untestable: [] })
    const driverless = await priorExtractions({ repoRoot: r, docs, priorManifest: priorManifest(before, CONTENT), seam: seamOf({}) })
    expect(driverless.get(DOC)?.settledAnchors).toEqual([])
    expect(driverless.get(DOC)?.claims).toHaveLength(2)
  })

  it('has no prior for a document neither the cache nor the store knows', async () => {
    const r = docRepo(CONTENT)
    const docs = collectWorkDocs(r, planGuardWork(r))
    const priors = await priorExtractions({ repoRoot: r, docs, priorManifest: null, seam: seamOf({}) })
    expect(priors.size).toBe(0)
  })

  it('settles nothing when the manifest carries no fingerprints, even with a prior in hand', async () => {
    const r = docRepo(EDITED)
    const docs = collectWorkDocs(r, planGuardWork(r))
    const seam = seamOf({ [docContentHash(CONTENT)]: { claims: [addClaim, listClaim], untestable: [] } })
    const priors = await priorExtractions({ repoRoot: r, docs, priorManifest: { flows: [], docs: [{ doc: DOC, contentHash: docContentHash(CONTENT) }] }, seam })
    expect(priors.get(DOC)).toEqual({ claims: [addClaim, listClaim], untestable: [], settledAnchors: [] })
  })

  it('takes a prior the claim-diff gate already fetched instead of asking the cache again, and never asks for an unchanged document', async () => {
    const r = docRepo(EDITED)
    const docs = collectWorkDocs(r, planGuardWork(r))
    const before = docRepo(CONTENT)
    const seam = seamOf({ [docContentHash(CONTENT)]: { claims: [addClaim, listClaim], untestable: [] } })
    const cachedPriors = new Map([[DOC, { claims: [addClaim, listClaim], untestable: [] }]])
    const priors = await priorExtractions({ repoRoot: r, docs, priorManifest: priorManifest(before, CONTENT), seam, cachedPriors })
    expect(seam.asked).toEqual([])
    expect(priors.get(DOC)?.settledAnchors).toEqual([CREATING])

    const unchanged = collectWorkDocs(before, planGuardWork(before))
    const none = await priorExtractions({ repoRoot: before, docs: unchanged, priorManifest: priorManifest(before, CONTENT), seam })
    expect(seam.asked).toEqual([])
    expect(none.size).toBe(0)
    void writeManifest
  })
})
