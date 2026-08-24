/**
 * The tree ∪ probe merge: the cross-check that keeps the cli grammar COMPLETE
 * when either derivation alone would miss surface. The tree stays the identity
 * source: seed `flags` (the fingerprinted set) are never touched, and tree
 * descriptions win. The probe fills what the tree missed: whole flags, choices,
 * and value placeholders land in `options` (grammar metadata, never
 * fingerprinted), and commands only the runtime help lists are added whole.
 * Every disagreement
 * is recorded as a {@link JourneyDiagnostic}: the union keeps scenarios whole
 * today, the diagnostic queues the extractor (or help-parser) fix.
 */

import type { JourneyCliOption, JourneyDiagnostic } from '@truecourse/shared'
import type { CliJourneySeed } from './cli-journeys.js'
import type { CliTreeRoot, CliTreeSurface } from './cli-tree.js'
import type { ProbedCliSurface } from './cli-probes.js'

/** The generated help flag: every commander/argparse command answers it, and
 *  journeys deliberately model it at the root only. Its presence in a probe
 *  transcript is framework boilerplate, never an extractor gap: it merges into
 *  the grammar without a diagnostic. */
const HELP_FLAGS = new Set(['--help', '-h'])

export interface CliUnionResult {
  surface: CliTreeSurface
  diagnostics: JourneyDiagnostic[]
}

/** Merge what the probes observed into the tree surface, recording every
 *  disagreement. Never removes tree truth; commands and flags only the tree
 *  knows always survive. */
export function unionCliSurfaces(tree: CliTreeSurface, probed: ProbedCliSurface): CliUnionResult {
  const diagnostics: JourneyDiagnostic[] = []
  const merged = new Map<string, CliJourneySeed>(tree.seeds.map((s) => [s.path.join(' '), cloneSeed(s)]))

  for (const probeSeed of probed.seeds) {
    const key = probeSeed.path.join(' ')
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, cloneSeed(probeSeed))
      diagnostics.push({
        surface: 'cli',
        path: [...probeSeed.path],
        kind: 'tree-missing-command',
        detail: `the runtime help lists \`${key}\` but the static extraction has no such command`,
      })
      continue
    }
    mergeOptions(existing.path, treeOptionsOf(existing), probeSeed.options ?? [], diagnostics)
    probeMissingFlags(existing.path, existing.flags, probeSeed.options ?? [], diagnostics)
  }

  // Tree commands the probe could have listed but did not. The ladder only ever
  // sees two levels (the root listing, and one nested listing per probed
  // command), so deeper tree paths are outside its universe, never a
  // disagreement. A listing that showed NOTHING is treated as unobserved (a
  // crashed or helpless probe), not as "the runtime hides every command".
  const probePaths = new Set(probed.seeds.map((s) => s.path.join(' ')))
  const nestedListedUnder = new Set(
    probed.seeds.filter((s) => s.path.length === 2).map((s) => s.path[0]),
  )
  for (const seed of tree.seeds) {
    const key = seed.path.join(' ')
    if (probePaths.has(key)) continue
    const observed =
      (seed.path.length === 1 && probed.root.subcommands.length > 0) ||
      (seed.path.length === 2 &&
        probed.probedCommands.has(seed.path[0]) &&
        nestedListedUnder.has(seed.path[0]))
    if (!observed) continue
    diagnostics.push({
      surface: 'cli',
      path: [...seed.path],
      kind: 'probe-missing-command',
      detail: `the static extraction declares \`${key}\` but the runtime help does not list it`,
    })
  }

  // The program level: probe-observed root flags enrich the tree root's grammar
  // the same way. A probe-only root is not invented; the root journey exists
  // only where the tree declared a program level.
  let root: CliTreeRoot | null = tree.root
  if (root) {
    root = {
      ...root,
      options: root.options.map((o) => ({ ...o })),
      programOptions: root.programOptions.map((o) => ({ ...o })),
    }
    mergeOptions([], root.options, probed.root.options, diagnostics)
    probeMissingFlags([], root.flags, probed.root.options, diagnostics)
  }

  const seeds = [...merged.values()].sort((a, b) => a.path.join(' ').localeCompare(b.path.join(' ')))
  return { surface: { seeds, root }, diagnostics }
}

/** A seed's grammar as a mutable option list; flags without parsed options
 *  degrade to name-only entries so the merge has one shape to fill. */
function treeOptionsOf(seed: CliJourneySeed): JourneyCliOption[] {
  const options = seed.options ?? seed.flags.map((flag) => ({ flag }))
  seed.options = options
  return options
}

/**
 * Fold probe-observed options into a tree option list. A flag the tree lacks is
 * appended (grammar only, never the fingerprinted `flags`); a flag both know is
 * filled fact-by-fact, tree winning on descriptions. Diagnostics name exactly
 * what the tree lacked.
 */
function mergeOptions(
  path: readonly string[],
  treeOptions: JourneyCliOption[],
  probeOptions: readonly JourneyCliOption[],
  diagnostics: JourneyDiagnostic[],
): void {
  const at = path.length > 0 ? `\`${path.join(' ')}\`` : 'the program level'
  const byFlag = new Map(treeOptions.map((o) => [o.flag, o]))
  for (const probe of probeOptions) {
    const existing = byFlag.get(probe.flag)
    if (!existing) {
      const added: JourneyCliOption = { ...probe }
      treeOptions.push(added)
      byFlag.set(added.flag, added)
      if (!HELP_FLAGS.has(probe.flag)) {
        diagnostics.push({
          surface: 'cli',
          path: [...path],
          flag: probe.flag,
          kind: 'tree-missing-flag',
          detail: `the runtime help documents \`${probe.flag}\` at ${at} but the static extraction lacks the flag`,
        })
      }
      continue
    }
    if (probe.choices?.length && !existing.choices?.length) {
      existing.choices = [...probe.choices]
      diagnostics.push({
        surface: 'cli',
        path: [...path],
        flag: probe.flag,
        kind: 'tree-missing-flag',
        detail: `the runtime help declares choices (${probe.choices.join(', ')}) for \`${probe.flag}\` at ${at} that the static extraction lacks`,
      })
    }
    if (probe.takesValue && !existing.takesValue) {
      existing.takesValue = true
      if (probe.valueHint && !existing.valueHint) existing.valueHint = probe.valueHint
      diagnostics.push({
        surface: 'cli',
        path: [...path],
        flag: probe.flag,
        kind: 'tree-missing-flag',
        detail: `the runtime help shows \`${probe.flag}\` at ${at} taking a value; the static extraction reads it as a switch`,
      })
    }
    if (!existing.description && probe.description) existing.description = probe.description
  }
}

/** Tree flags a PARSED probe transcript does not document. An empty parse means
 *  the transcript was unreadable, and there is nothing to disagree with. */
function probeMissingFlags(
  path: readonly string[],
  treeFlags: readonly string[],
  probeOptions: readonly JourneyCliOption[],
  diagnostics: JourneyDiagnostic[],
): void {
  if (probeOptions.length === 0) return
  const at = path.length > 0 ? `\`${path.join(' ')}\`` : 'the program level'
  const probeFlags = new Set(probeOptions.map((o) => o.flag))
  for (const flag of treeFlags) {
    if (probeFlags.has(flag) || HELP_FLAGS.has(flag)) continue
    diagnostics.push({
      surface: 'cli',
      path: [...path],
      flag,
      kind: 'probe-missing-flag',
      detail: `the static extraction declares \`${flag}\` at ${at} but the runtime help does not document it`,
    })
  }
}

function cloneSeed(seed: CliJourneySeed): CliJourneySeed {
  return {
    path: [...seed.path],
    flags: [...seed.flags],
    ...(seed.options ? { options: seed.options.map((o) => ({ ...o })) } : {}),
    ...(seed.label ? { label: seed.label } : {}),
  }
}
