/**
 * BINDING RESOLUTION, LLM-free: a scenario is bound to its documents by the
 * keys of the sentences its milestones are read from, and the runner resolves
 * every bind against the live document before it executes anything. Every
 * sentence still in the document is a match; a sentence gone is `stale` (the
 * flow's text moved, so the test must be re-authored against it); a document
 * gone is `orphaned`. Whatever else changed around the sentences — a heading
 * renamed, a paragraph added, the sentence moved under another heading — leaves
 * the binding standing, because the words the test holds the product to are
 * still there.
 */

import { sentencesByKey, type DocSentence, type DocTree } from '@truecourse/shared'

/** The outcome of checking one bind against a document's live tree. */
export type BindingResolution =
  | { kind: 'match' }
  | { kind: 'stale'; missing: string[] }
  | { kind: 'orphaned' }

/** A document's sentences by key, built once per tree. */
const sentenceIndexes = new WeakMap<DocTree, Map<string, DocSentence>>()
function liveSentences(tree: DocTree): Map<string, DocSentence> {
  let map = sentenceIndexes.get(tree)
  if (!map) {
    map = sentencesByKey(tree)
    sentenceIndexes.set(tree, map)
  }
  return map
}

/**
 * Resolve one bind against a document's live tree. A `null` tree means the
 * document is missing → orphaned; any sentence the document no longer holds →
 * stale, naming the missing keys; every sentence present → match.
 */
export function resolveBinding(tree: DocTree | null, bind: { sentences: readonly string[] }): BindingResolution {
  if (!tree) return { kind: 'orphaned' }
  const live = liveSentences(tree)
  const missing = bind.sentences.filter((key) => !live.has(key))
  return missing.length === 0 ? { kind: 'match' } : { kind: 'stale', missing }
}

/**
 * The scenario-level verdict over ALL of a scenario's binds — one scenario, one
 * outcome, whatever its milestone count.
 *
 * | per-bind resolutions            | scenario     |
 * | ------------------------------- | ------------ |
 * | every bind match                | `executable` |
 * | any bind stale                  | `stale`      |
 * | some (not all) binds orphaned   | `stale`      |
 * | every bind orphaned             | `orphaned`   |
 *
 * `orphaned` is reserved for the total loss — every document the scenario
 * asserts against is gone; a partial loss is spec drift like any edit, so it
 * lands in the same `stale` bucket a regeneration clears.
 */
export type ScenarioBindingVerdict = {
  kind: 'executable' | 'stale' | 'orphaned'
  resolutions: BindingResolution[]
}

/**
 * Resolve every bind of a scenario against the live documents and fold the
 * per-bind resolutions into one verdict — see {@link ScenarioBindingVerdict}.
 * `treeFor` returns a document's tree, or `null` when the document is missing.
 */
export function resolveScenarioBinds(
  binds: readonly { doc: string; sentences: readonly string[] }[],
  treeFor: (doc: string) => DocTree | null,
): ScenarioBindingVerdict {
  const resolutions = binds.map((b) => resolveBinding(treeFor(b.doc), b))
  const orphaned = resolutions.filter((r) => r.kind === 'orphaned').length
  if (orphaned === resolutions.length) return { kind: 'orphaned', resolutions }
  if (orphaned > 0 || resolutions.some((r) => r.kind === 'stale')) return { kind: 'stale', resolutions }
  return { kind: 'executable', resolutions }
}
