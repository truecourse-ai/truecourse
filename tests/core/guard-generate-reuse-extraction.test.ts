/**
 * The claim-diff gate's extract-cache seam (`createGuardGenerateSessionSeams().reuseExtraction`):
 * `lookup` finds the outcome cached under a document's PRIOR content hash, and
 * `reuse` copies it under the document's CURRENT key so the extraction pool hits
 * without a session. Proven over a real cache, driverless: the seam's driver
 * thunk is a spy that throws, so a surviving call is a call that acquired none.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import { collectWorkDocs, planGuardWork, type GuardDoc } from '@truecourse/guard-generator'
import type { ExtractOutcome } from '@truecourse/shared'
import {
  EXTRACT_SESSION_CACHE_NAME,
  EXTRACT_SESSION_KIND,
  createGuardGenerateSessionSeams,
  extractDocContentHash,
  extractSessionCacheKey,
  extractSessionCacheKeyForContentHash,
} from '../../packages/core/src/services/guard-generate/index'
import { makeTempRepo, rmrf, writeCorpus, writeDoc, writeRecipe } from '../guard-generator/helpers.js'
import { installMemoryKvCache, resetKvCacheStore } from '../helpers/memory-kv-cache'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

const DOC = 'docs/tasks.md'
const CONTENT = ['# Tasks', '', '## Creating tasks', '', '`relkit add <title>` creates a task and prints its id as `t<N>`.'].join('\n')
const EDITED = CONTENT.replace('creates a task and prints', 'creates a task, then prints')

function docRepo(content: string): string {
  const r = makeTempRepo()
  repos.push(r)
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, content)
  return r
}

function docOf(r: string): GuardDoc {
  return collectWorkDocs(r, planGuardWork(r))[0]!
}

const OUTCOME: ExtractOutcome = {
  claims: [
    {
      claim: '`relkit add <title>` creates a task and prints its id',
      driver: 'cli',
      sectionAnchor: 'tasks/creating-tasks',
      reason: 'stdout carries the new id',
      needs: [],
    },
  ],
  untestable: [],
}

describe('the reuse-extraction seam', () => {
  beforeEach(() => {
    installMemoryKvCache()
  })
  afterEach(() => {
    resetKvCacheStore()
  })

  /** A driver thunk the cache path must never reach. */
  const spyDriver = () =>
    vi.fn(async (): Promise<never> => {
      throw new Error('the reuse path must not acquire a driver')
    })

  it('the content-hash key recipe is the doc key recipe', () => {
    const r = docRepo(CONTENT)
    const doc = docOf(r)
    expect(extractSessionCacheKeyForContentHash(extractDocContentHash(doc.content), doc.suppressedQuotes)).toBe(
      extractSessionCacheKey(doc),
    )
  })

  it('looks up the prior outcome by the prior content hash, and null when none is cached', async () => {
    const r = docRepo(CONTENT)
    const before = docOf(r)
    const priorHash = extractDocContentHash(before.content)
    await setCacheEntry(r, EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey(before), OUTCOME)

    writeDoc(r, DOC, EDITED)
    const after = docOf(r)
    const driver = spyDriver()
    const seams = createGuardGenerateSessionSeams({ repoRoot: r, driver })
    expect(await seams.reuseExtraction.lookup(after, priorHash)).toEqual(OUTCOME)
    expect(await seams.reuseExtraction.lookup(after, extractDocContentHash(after.content))).toBeNull()
    expect(driver).not.toHaveBeenCalled()
  })

  it('reuse copies the prior outcome under the current key, so the pool hits without a session', async () => {
    const r = docRepo(CONTENT)
    const before = docOf(r)
    const priorHash = extractDocContentHash(before.content)
    await setCacheEntry(r, EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey(before), OUTCOME)

    writeDoc(r, DOC, EDITED)
    const after = docOf(r)
    expect(await getCacheEntry(r, EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey(after))).toBeNull()

    const driver = spyDriver()
    const seams = createGuardGenerateSessionSeams({ repoRoot: r, driver })
    await seams.reuseExtraction.reuse(after, priorHash)
    expect(await getCacheEntry(r, EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey(after))).toEqual(OUTCOME)

    const { byDoc, summary } = await seams.extractSession({ docs: [after] })
    expect(summary).toMatchObject({ kind: EXTRACT_SESSION_KIND, ran: 0, fromCache: 1, failed: 0 })
    const result = byDoc.get(after.doc)!
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.claims.map((c) => c.sectionAnchor)).toEqual(['tasks/creating-tasks'])
    expect(driver).not.toHaveBeenCalled()
  })

  it('reuse with no cached prior writes nothing', async () => {
    const r = docRepo(EDITED)
    const doc = docOf(r)
    const seams = createGuardGenerateSessionSeams({ repoRoot: r, driver: spyDriver() })
    await seams.reuseExtraction.reuse(doc, 'deadbeef')
    expect(await getCacheEntry(r, EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey(doc))).toBeNull()
  })
})

it('keeps prior-content reuse in the current declaration context and rejects invalid cached prerequisites', async () => {
  const r = docRepo(CONTENT), before = docOf(r)
  const targets = [{ name: 'vendor', aliases: ['Vendor'], state: 'unprovided' as const, credentialEnv: ['KEY'], registerIn: 'local', providers: [{ service: 'vendor', baseUrlEnvs: ['BASE'] }] }]
  const priorHash = extractDocContentHash(before.content)
  await setCacheEntry(r, EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey(before, targets), OUTCOME)
  writeDoc(r, DOC, EDITED)
  const after = docOf(r), seams = createGuardGenerateSessionSeams({ repoRoot: r, transport: 'api' })
  expect(await seams.reuseExtraction.lookup(after, priorHash, targets)).toEqual(OUTCOME)
  const renamed = [{ ...targets[0], name: 'new-vendor' }]
  expect(await seams.reuseExtraction.lookup(after, priorHash, renamed)).toBeNull()
  await seams.reuseExtraction.reuse(after, priorHash, renamed)
  expect(await getCacheEntry(r, EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey(after, renamed))).toBeNull()
  await seams.reuseExtraction.reuse(after, priorHash, targets)
  expect(await getCacheEntry(r, EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey(after, targets))).toEqual(OUTCOME)
  const invalid = structuredClone(OUTCOME)
  invalid.claims[0].verification = { method: 'behavior', observable: 'supplied data', cases: [{ id: 'value', claim: 'read value', method: 'behavior', requires: ['http'], conditions: [], prerequisites: [{ dependency: 'removed', mode: 'provided' }] }] }
  await setCacheEntry(r, EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey(before, targets), invalid)
  expect(await seams.reuseExtraction.lookup(after, priorHash, targets)).toBeNull()
})
