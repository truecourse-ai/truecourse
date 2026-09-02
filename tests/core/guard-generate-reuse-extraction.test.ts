/**
 * The claim-diff gate's extract-cache seam (`createGuardGenerateSessionSeams().reuseExtraction`):
 * `lookup` finds the outcome cached under a document's PRIOR content hash, and
 * `reuse` copies it under the document's CURRENT key so the extraction pool hits
 * without a session. Proven over the real on-disk cache, driverless (`transport:
 * 'api'` under an empty TRUECOURSE_HOME makes driver construction throw, so a
 * surviving call built none).
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
  let home = ''
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-reuse-home-'))
    process.env.TRUECOURSE_HOME = home
  })
  afterEach(() => {
    delete process.env.TRUECOURSE_HOME
    fs.rmSync(home, { recursive: true, force: true })
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
    const seams = createGuardGenerateSessionSeams({ repoRoot: r, transport: 'api' })
    expect(await seams.reuseExtraction.lookup(after, priorHash)).toEqual(OUTCOME)
    expect(await seams.reuseExtraction.lookup(after, extractDocContentHash(after.content))).toBeNull()
    expect(seams.runId()).toBeUndefined()
  })

  it('reuse copies the prior outcome under the current key, so the pool hits without a session', async () => {
    const r = docRepo(CONTENT)
    const before = docOf(r)
    const priorHash = extractDocContentHash(before.content)
    await setCacheEntry(r, EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey(before), OUTCOME)

    writeDoc(r, DOC, EDITED)
    const after = docOf(r)
    expect(await getCacheEntry(r, EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey(after))).toBeNull()

    const seams = createGuardGenerateSessionSeams({ repoRoot: r, transport: 'api' })
    await seams.reuseExtraction.reuse(after, priorHash)
    expect(await getCacheEntry(r, EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey(after))).toEqual(OUTCOME)

    const { byDoc, summary } = await seams.extractSession({ docs: [after] })
    expect(summary).toMatchObject({ kind: EXTRACT_SESSION_KIND, ran: 0, fromCache: 1, failed: 0 })
    const result = byDoc.get(after.doc)!
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.claims.map((c) => c.sectionAnchor)).toEqual(['tasks/creating-tasks'])
  })

  it('reuse with no cached prior writes nothing', async () => {
    const r = docRepo(EDITED)
    const doc = docOf(r)
    const seams = createGuardGenerateSessionSeams({ repoRoot: r, transport: 'api' })
    await seams.reuseExtraction.reuse(doc, 'deadbeef')
    expect(await getCacheEntry(r, EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey(doc))).toBeNull()
  })
})
