/**
 * Tree-first, probes-verify: the composition that decides which cli derivation a
 * repo gets. The tree is the primary source for every surface; probing is the
 * degradation for CLIs built on a framework no extractor reads yet — and, when
 * BOTH sources exist, the second witness: the catalog becomes their UNION
 * (plan §7.5), with every disagreement reported as a {@link MapperDiagnostic}
 * for the `guard-setup.reconcile-interfaces` session to settle by running the
 * program. The catalog records which composition it got (`tree` / `probes` /
 * `union`) so the gap language downstream stays honest.
 *
 * Union rules (§7.5):
 * - the TREE wins descriptions — help text is terser than the registration's
 *   own description, and the probe seeds carry none anyway;
 * - the PROBES fill what the tree missed: whole commands the help lists that no
 *   registration was read for, and flags the help documents on a command the
 *   tree already has;
 * - EVERY disagreement appends a diagnostic. Diagnostics are run reporting —
 *   they never enter the catalog snapshot or any fingerprint.
 *
 * Honesty bounds on what counts as a disagreement (the probe ladder is a
 * bounded help-text walk, and an absence it never established is not a claim):
 * - a probe seed with NO flags at all established nothing about flags (nested
 *   commands are read out of a parent's help and never probed themselves), so
 *   it neither fills nor disputes;
 * - `probe-missing-command` is reported for DEPTH-1 commands only — those are
 *   the ones the root help enumerates; a deeper tree command is outside the
 *   ladder's one-level reach and its absence from the probes says nothing;
 * - the framework's own implicit flags (`--help`, `--version` and their short
 *   forms) are excluded both ways — every help transcript prints them and no
 *   tree registration does, so they would be one phantom diagnostic per command;
 * - a probe walk that produced only the ROOT interface parsed no command list
 *   at all: it observed nothing, the union is the tree, and the source says so.
 */

import type { FileAnalysis, Interface, InterfaceCatalogSource } from '@truecourse/shared'
import { deriveCliInterfacesFromTree } from './cli-tree.js'
import { deriveCliInterfacesFromProbes, type CliProbeOptions } from './cli-probes.js'
import { buildCliInterfaces, type CliInterfaceSeed } from './cli-interfaces.js'
import type { MapperDiagnostic } from './diagnostics.js'

export interface DeriveCliInterfacesOptions {
  /** The analyzed working tree. Its `cliCommands` artifacts are the primary source. */
  fileAnalyses?: readonly FileAnalysis[]
  /** Probe source; omitted → the tree is the only source (an empty tree stays empty). */
  probe?: CliProbeOptions
}

export interface CliInterfaceCatalog {
  interfaces: Interface[]
  source: InterfaceCatalogSource
  /**
   * What the two derivations disagreed about — run reporting for the caller
   * (`MapInterfacesResult` carries it unsnapshotted, like `externalServices`).
   * NEVER written into `interfaces.json` and never fingerprinted. Empty on a
   * single-source derivation: with one witness there is nothing to disagree.
   */
  diagnostics: MapperDiagnostic[]
}

/**
 * Derive the cli catalog. One source alone is that source's catalog; both
 * sources present is their union (see the module note). The probe ladder runs
 * whenever probe options are given — a tree-backed repo pays the (bounded,
 * sandboxed) probe walk to buy the second witness.
 */
export async function deriveCliInterfaces(
  opts: DeriveCliInterfacesOptions,
): Promise<CliInterfaceCatalog> {
  const fromTree = deriveCliInterfacesFromTree(opts.fileAnalyses ?? [])
  if (!opts.probe) return { interfaces: fromTree, source: 'tree', diagnostics: [] }

  const fromProbes = await deriveCliInterfacesFromProbes(opts.probe)
  if (fromTree.length === 0) return { interfaces: fromProbes, source: 'probes', diagnostics: [] }

  // A root-only probe result means the help yielded no command list — the walk
  // observed nothing to union or dispute (see the module note).
  if (fromProbes.length === 1 && fromProbes[0].id === 'cli/root') {
    return { interfaces: fromTree, source: 'tree', diagnostics: [] }
  }

  return unionCliInterfaces(fromTree, fromProbes, opts.probe.programName)
}

/** Flags every help transcript prints and no tree registration does. */
const IMPLICIT_HELP_FLAGS = new Set(['--help', '-h', '--version', '-V'])

/** One command as either source stated it, read back off its built interface. */
interface SourcedSeed {
  key: string
  seed: CliInterfaceSeed
}

/**
 * The union of the two cli derivations (both non-trivial). Deterministic and
 * pure; the interfaces are rebuilt through {@link buildCliInterfaces} so union
 * output stays byte-identical with what a single-source derivation of the same
 * surface would produce.
 */
export function unionCliInterfaces(
  fromTree: readonly Interface[],
  fromProbes: readonly Interface[],
  programName?: string,
): CliInterfaceCatalog {
  const tree = seedsOf(fromTree)
  const probes = seedsOf(fromProbes)
  const probeByKey = new Map(probes.map((entry) => [entry.key, entry]))
  const treeKeys = new Set(tree.map((entry) => entry.key))
  const diagnostics: MapperDiagnostic[] = []
  const subjectOf = (path: readonly string[], flag?: string): string =>
    [...(programName ? [programName] : []), ...path, ...(flag ? [flag] : [])].join(' ')

  const seeds: CliInterfaceSeed[] = []

  for (const { key, seed } of tree) {
    const probe = probeByKey.get(key)
    const flags = [...seed.flags]

    if (probe) {
      // A probe seed with no flags established nothing about flags — nested
      // commands are never probed themselves (see the module note).
      if (probe.seed.flags.length > 0) {
        const probeFlags = new Set(probe.seed.flags)
        for (const flag of probe.seed.flags) {
          if (flags.includes(flag) || IMPLICIT_HELP_FLAGS.has(flag)) continue
          flags.push(flag)
          diagnostics.push({
            surface: 'cli',
            kind: 'tree-missing-flag',
            subject: subjectOf(seed.path, flag),
            detail:
              `the program's help documents \`${flag}\` on \`${seed.path.join(' ')}\`; the analyzed tree does not ` +
              `register it. The union carries the flag; drop it if the tree is right.`,
            command: seed.path,
            flag,
          })
        }
        for (const flag of seed.flags) {
          if (probeFlags.has(flag) || IMPLICIT_HELP_FLAGS.has(flag)) continue
          diagnostics.push({
            surface: 'cli',
            kind: 'probe-missing-flag',
            subject: subjectOf(seed.path, flag),
            detail:
              `the tree registers \`${flag}\` on \`${seed.path.join(' ')}\`; the program's help does not list it ` +
              `(a hidden flag, or a registration the program never wires). The union keeps the flag; drop it if the probe is right.`,
            command: seed.path,
            flag,
          })
        }
      }
    } else if (seed.path.length === 1) {
      // Depth 1 is what the root help enumerates; deeper absences say nothing.
      diagnostics.push({
        surface: 'cli',
        kind: 'probe-missing-command',
        subject: subjectOf(seed.path),
        detail:
          `the tree registers the command \`${seed.path.join(' ')}\`; the program's own help does not list it. ` +
          `The union keeps the command; drop it if the probe is right.`,
        command: seed.path,
      })
    }

    // Tree wins the description: `seed.label` is the tree's, and a probe seed
    // never carries one — help parsing reads names and flags, not prose.
    seeds.push({ ...seed, flags })
  }

  for (const { key, seed } of probes) {
    if (treeKeys.has(key)) continue
    seeds.push({ path: seed.path, flags: seed.flags.filter((flag) => !IMPLICIT_HELP_FLAGS.has(flag)) })
    diagnostics.push({
      surface: 'cli',
      kind: 'tree-missing-command',
      subject: subjectOf(seed.path),
      detail:
        `the program's help lists the command \`${seed.path.join(' ')}\`; the analyzed tree does not register it. ` +
        `The union carries the command; drop it if the tree is right.`,
      command: seed.path,
    })
  }

  seeds.sort((a, b) => a.path.join(' ').localeCompare(b.path.join(' ')))
  return { interfaces: buildCliInterfaces(seeds), source: 'union', diagnostics }
}

/**
 * Read each built interface back into its seed. Safe by construction: every
 * cli interface is exactly one `invoke` step (`buildCliInterfaces` is the one
 * place a command path becomes an interface).
 */
function seedsOf(interfaces: readonly Interface[]): SourcedSeed[] {
  const seeds: SourcedSeed[] = []
  for (const iface of interfaces) {
    const step = iface.steps[0]
    if (step?.kind !== 'invoke') continue
    seeds.push({
      key: step.command.join(' '),
      seed: {
        path: [...step.command],
        flags: [...step.flags],
        ...(step.label ? { label: step.label } : {}),
      },
    })
  }
  return seeds
}
