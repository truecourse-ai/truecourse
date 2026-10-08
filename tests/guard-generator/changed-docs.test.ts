/**
 * Which documents changed since the last generate: a completed generate
 * records every document it read with the hash of its text
 * (`manifest.docs`), and the next plan names a document changed when its text
 * differs from that record, or when no generate recorded it.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { planGuardWork } from '@truecourse/guard-generator'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  runGenerate,
  submitWorkerSessions,
  PASSING_STEPS,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

const DOC = 'docs/cli.md'
const OTHER = 'docs/other.md'
const DOC_CONTENT = ['## version', '`relkit --version` prints the version and exits 0.'].join('\n')

describe('planGuardWork — changed documents', () => {
  it('names a document changed until a generate records it, and again once its text moves', async () => {
    const r = makeTempRepo()
    repos.push(r)
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }, { ref: OTHER }])
    writeDoc(r, DOC, DOC_CONTENT)
    writeDoc(r, OTHER, '## notes\nNothing externally observable here.')
    expect([...planGuardWork(r).changedDocs].sort()).toEqual([DOC, OTHER])

    const res = await runGenerate({
      repoRoot: r,
      flowWorkerSession: submitWorkerSessions(() => raw('relkit --version prints the version', PASSING_STEPS)),
    })
    expect(res.status).toBe('ok')
    expect([...planGuardWork(r).changedDocs]).toEqual([])

    writeDoc(r, DOC, DOC_CONTENT.replace('prints the version', 'prints the SEMVER version'))
    expect([...planGuardWork(r).changedDocs]).toEqual([DOC])
  }, 60_000)
})
