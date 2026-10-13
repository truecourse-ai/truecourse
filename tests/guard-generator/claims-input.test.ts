/**
 * The claims a generate run reads: the work tree's `specs/claims.json`, each
 * claim checked against its live document — live when the document still holds
 * every sentence it names, unplaced otherwise — and the per-document synthesis
 * inputs the live claims give.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { claimId, parseDocTree, sentenceKey, type Claim } from '@truecourse/shared'
import { specClaimsFilePath } from '@truecourse/shared/work-tree'
import { claimAreaInputs, placeClaims, planGuardWork, readSpecClaims } from '@truecourse/guard-generator'
import { makeTempRepo, rmrf, writeCorpus, writeDoc } from './helpers.js'

const DOC = 'docs/tasks.md'
const CONTENT = [
  'Tasks are kept in a local file.',
  '',
  '# Tasks',
  '',
  '## Creating tasks',
  '',
  '`relkit add <title>` creates a task and prints its id.',
  'An empty title exits 2.',
  '',
  '### Titles',
  '',
  'A title is at most 80 characters.',
  '',
  '## Listing tasks',
  '',
  '`relkit list` prints one line per open task.',
].join('\n')

const key = (text: string): string => sentenceKey(text)
const claim = (text: string, over: Partial<Claim> = {}): Claim => ({
  id: claimId(DOC, [key(text)]),
  doc: DOC,
  sentences: [key(text)],
  subject: 'relkit',
  statement: text,
  areas: ['core/tasks'],
  testable: true,
  ...over,
})

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

describe('placeClaims', () => {
  const tree = parseDocTree(DOC, CONTENT)
  const treeOf = (doc: string) => (doc === DOC ? tree : null)

  it('keeps every claim whose sentences the live document holds', () => {
    const claims = [
      claim('`relkit add <title>` creates a task and prints its id.'),
      claim('An empty title exits 2.', {
        sentences: [key('An empty title exits 2.'), key('A title is at most 80 characters.')],
      }),
      claim('Tasks are kept in a local file.'),
    ]
    const { live, unplaced } = placeClaims(claims, treeOf)
    expect(unplaced).toEqual([])
    expect(live).toEqual(claims)
  })

  it('leaves a claim unplaced when the document no longer holds a sentence it names, or the document is gone', () => {
    const moved = claim('An empty title exits 3.')
    const half = claim('An empty title exits 2.', {
      sentences: [key('An empty title exits 2.'), key('A title is at most 90 characters.')],
    })
    const { live, unplaced } = placeClaims([moved, half, claim('Elsewhere.', { doc: 'docs/gone.md' })], treeOf)
    expect(live).toEqual([])
    expect(unplaced.map((u) => [u.claim.statement, u.missing])).toEqual([
      ['An empty title exits 3.', [key('An empty title exits 3.')]],
      ['An empty title exits 2.', [key('A title is at most 90 characters.')]],
      ['Elsewhere.', [key('Elsewhere.')]],
    ])
  })
})

describe('claimAreaInputs', () => {
  it('gives each document its outline, its area and its testable claims, leaving out dismissed and rejected ones', () => {
    const repo = makeTempRepo()
    repos.push(repo)
    writeCorpus(repo, [{ ref: DOC, areaTags: ['core/tasks'] }])
    writeDoc(repo, DOC, CONTENT)
    const { docs } = planGuardWork(repo)

    const add = claim('`relkit add <title>` creates a task and prints its id.')
    const empty = claim('An empty title exits 2.')
    const list = claim('`relkit list` prints one line per open task.')
    const title = claim('A title is at most 80 characters.')
    const file = claim('Tasks are kept in a local file.', { testable: { reason: 'not-observable' } })
    const { inputs, lines } = claimAreaInputs({
      docs,
      claims: [add, empty, list, title, file],
      dismissals: new Map([[list.id, { claimId: list.id, dismissedAt: '2026-10-07T00:00:00.000Z' }]]),
      suppressed: new Set([`${DOC}\0${key('A title is at most 80 characters.')}`]),
    })

    expect(inputs).toHaveLength(1)
    const [input] = inputs
    expect(input.doc).toBe(DOC)
    expect(input.areaTags).toEqual(['core/tasks'])
    expect(input.outline.map((o) => o.anchor)).toEqual(docs[0]!.sections.map((s) => s.anchor))
    expect(input.claims).toEqual([
      { id: add.id, doc: DOC, title: add.statement, sentences: add.sentences },
      { id: empty.id, doc: DOC, title: empty.statement, sentences: empty.sentences },
    ])
    expect(lines).toEqual([
      `${DOC}: "\`relkit list\` prints one line per open task." left out, dismissed`,
      `${DOC}: "A title is at most 80 characters." left out, a resolved conflict rejected its sentence`,
      `${DOC}: 2 testable claims from the scan`,
    ])
  })
})

describe('readSpecClaims', () => {
  it('reads the tree’s claims file, and answers null when there is none', () => {
    const repo = makeTempRepo()
    repos.push(repo)
    expect(readSpecClaims(repo)).toBeNull()
    const file = specClaimsFilePath(repo)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const claims = { version: 1, generatedAt: '2026-10-07T00:00:00.000Z', claims: [claim('`relkit list` prints one line per open task.')] }
    fs.writeFileSync(file, JSON.stringify(claims))
    expect(readSpecClaims(repo)).toEqual(claims)
  })
})
