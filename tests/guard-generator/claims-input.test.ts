/**
 * The claims a generate run reads: the work tree's `specs/claims.json`, each
 * claim placed in its live document by the section whose own text holds its
 * first sentence, and left unplaced when the document no longer holds a
 * sentence it names.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { claimId, parseDocTree, sentenceKey, type Claim } from '@truecourse/shared'
import { specClaimsFilePath } from '@truecourse/shared/work-tree'
import { docTreesOf, placeClaims, readSpecClaims } from '@truecourse/guard-generator'
import { makeTempRepo, rmrf, writeDoc } from './helpers.js'

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

  it('places a claim under the section whose own text holds its first sentence', () => {
    const { placed, unplaced } = placeClaims(
      [
        claim('`relkit add <title>` creates a task and prints its id.'),
        claim('A title is at most 80 characters.'),
        claim('`relkit list` prints one line per open task.'),
        claim('Tasks are kept in a local file.'),
      ],
      treeOf,
    )
    expect(unplaced).toEqual([])
    expect(placed.map((p) => p.anchor)).toEqual(['tasks/creating-tasks', 'tasks/creating-tasks/titles', 'tasks/listing-tasks', 'tasks-2'])
  })

  it('places a claim read from two sentences by the first of them', () => {
    const two = claim('An empty title exits 2.', {
      sentences: [key('An empty title exits 2.'), key('A title is at most 80 characters.')],
    })
    expect(placeClaims([two], treeOf).placed.map((p) => p.anchor)).toEqual(['tasks/creating-tasks'])
  })

  it('leaves a claim unplaced when the document no longer holds a sentence it names, or the document is gone', () => {
    const moved = claim('An empty title exits 3.')
    const { placed, unplaced } = placeClaims([moved, claim('Elsewhere.', { doc: 'docs/gone.md' })], treeOf)
    expect(placed).toEqual([])
    expect(unplaced.map((u) => [u.claim.statement, u.missing])).toEqual([
      ['An empty title exits 3.', [key('An empty title exits 3.')]],
      ['Elsewhere.', [key('Elsewhere.')]],
    ])
  })
})

describe('readSpecClaims / docTreesOf', () => {
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

  it('gives a document’s tree from the tree on disk, once, and null for a missing one', () => {
    const repo = makeTempRepo()
    repos.push(repo)
    writeDoc(repo, DOC, CONTENT)
    const treeOf = docTreesOf(repo, [DOC])
    expect(treeOf(DOC)?.sections.map((s) => s.anchor)).toEqual(parseDocTree(DOC, CONTENT).sections.map((s) => s.anchor))
    expect(treeOf(DOC)).toBe(treeOf(DOC))
    expect(treeOf('docs/none.md')).toBeNull()
  })
})
