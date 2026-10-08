/**
 * Binding resolution: a bind holds the keys of the sentences a scenario is read
 * from, and resolves against the document's live tree — every sentence present
 * is a match, any sentence gone is stale, the document gone is orphaned. A
 * scenario folds its binds into one verdict.
 */
import { describe, it, expect } from 'vitest'
import { parseDocTree, sectionSentences, sentenceKey, type DocTree } from '@truecourse/shared'
import { resolveBinding, resolveScenarioBinds } from '@truecourse/guard-runner'

const DOC = 'docs/spec.md'
const SPEC = ['# Spec', '## Top', 'Top body.', '### Rate limiting', 'Limits after 5.', '## Other', 'Other body.'].join('\n')
const tree = parseDocTree(DOC, SPEC)

/** The keys of the sentences of one section of `t`'s own text. */
const keys = (t: DocTree, anchor: string): string[] =>
  sectionSentences(t, t.sections.find((s) => s.anchor === anchor)!).map((s) => sentenceKey(s.text, s.repeat))

describe('resolveBinding', () => {
  it('matches when every bound sentence is still in the document', () => {
    expect(resolveBinding(tree, { sentences: keys(tree, 'spec/top/rate-limiting') })).toEqual({ kind: 'match' })
  })

  it('still matches when the sentences moved under another heading', () => {
    const moved = parseDocTree(DOC, SPEC.replace('### Rate limiting', '### Throttling'))
    expect(resolveBinding(moved, { sentences: keys(tree, 'spec/top/rate-limiting') })).toEqual({ kind: 'match' })
  })

  it('is stale when a sentence is gone, naming the missing keys', () => {
    const bound = keys(tree, 'spec/top/rate-limiting')
    const edited = parseDocTree(DOC, SPEC.replace('Limits after 5.', 'Limits after 10.'))
    expect(resolveBinding(edited, { sentences: [...keys(tree, 'spec/top'), ...bound] })).toEqual({
      kind: 'stale',
      missing: bound,
    })
  })

  it('is orphaned when the document is missing', () => {
    expect(resolveBinding(null, { sentences: keys(tree, 'spec/top') })).toEqual({ kind: 'orphaned' })
  })
})

describe('resolveScenarioBinds', () => {
  const treeFor = (doc: string): DocTree | null => (doc === DOC ? tree : null)
  const at = (anchor: string) => ({ doc: DOC, sentences: keys(tree, anchor) })
  const edited = (anchor: string) => ({ doc: DOC, sentences: [...keys(tree, anchor), 'sentence:older-text'] })
  const gone = { doc: 'docs/missing.md', sentences: ['sentence:any'] }

  it('is executable when every bind matches', () => {
    const verdict = resolveScenarioBinds([at('spec/top'), at('spec/other')], treeFor)
    expect(verdict).toEqual({ kind: 'executable', resolutions: [{ kind: 'match' }, { kind: 'match' }] })
  })

  it('is stale when any bind lost a sentence', () => {
    const verdict = resolveScenarioBinds([at('spec/other'), edited('spec/top')], treeFor)
    expect(verdict).toEqual({
      kind: 'stale',
      resolutions: [{ kind: 'match' }, { kind: 'stale', missing: ['sentence:older-text'] }],
    })
  })

  it('is stale when only some binds are orphaned', () => {
    expect(resolveScenarioBinds([at('spec/other'), gone], treeFor).kind).toBe('stale')
  })

  it('is orphaned only when every bind is orphaned', () => {
    expect(resolveScenarioBinds([gone, { ...gone, doc: 'docs/vanished.md' }], treeFor).kind).toBe('orphaned')
  })
})
