/**
 * The PRIMARY cli derivation: the command tree the analyzer already read out of
 * the framework's own call signatures (`FileAnalysis.cliCommands`). No subprocess,
 * no build, no help text — the same tree-first rule every other surface follows.
 */

import type { CliCommand, CliCommandFlag, FileAnalysis, Journey, JourneyCliOption } from '@truecourse/shared'
import { buildCliJourneys, buildRootCliJourney, type CliJourneySeed } from './cli-journeys.js'

/** The program-level declaration (the analyzer's path-`[]` command), merged. */
export interface CliTreeRoot {
  /** Every program-level flag, the generated `--help`/`--version` included. */
  flags: string[]
  /** The same flags as options: what the root journey's grammar renders. */
  options: JourneyCliOption[]
  /**
   * The DECLARED program options only (never the generated `--help`/`--version`):
   * the flags a user passes before a subcommand to configure the run, marked
   * `scope: 'program'` and carried on every subcommand's options.
   */
  programOptions: JourneyCliOption[]
  /** The program's own description: the root journey's cosmetic label. */
  label?: string
}

/** What the analyzed tree declares for the cli surface, before journey building. */
export interface CliTreeSurface {
  /** One seed per subcommand path, path-sorted. */
  seeds: CliJourneySeed[]
  /** The program level, when the analyzer emitted one; null otherwise. */
  root: CliTreeRoot | null
}

export interface DeriveCliJourneysFromTreeOptions {
  /**
   * The program's user-facing name: what roots the `cli/root` journey (its
   * entry command). Without one a root declaration derives no root journey:
   * a journey cannot be rooted at a name nobody knows.
   */
  programName?: string
}

/**
 * One journey per command path across every analyzed file. A command declared in
 * more than one file (a re-registered subcommand) collapses onto one journey whose
 * flags are the union of what those declarations accept — the surface is what a
 * user can reach, not how many places declare it.
 */
export function deriveCliJourneysFromTree(
  fileAnalyses: readonly FileAnalysis[],
  opts: DeriveCliJourneysFromTreeOptions = {},
): Journey[] {
  return buildJourneysFromSurface(cliTreeSurface(fileAnalyses), opts.programName)
}

/** The tree's cli declarations, merged across files: the union derivation's input. */
export function cliTreeSurface(fileAnalyses: readonly FileAnalysis[]): CliTreeSurface {
  const merged = new Map<string, CliJourneySeed>()
  const rootFlags: CliCommandFlag[] = []
  const rootFlagKeys = new Set<string>()
  let rootSeen = false
  let rootLabel: string | undefined

  for (const analysis of fileAnalyses) {
    for (const command of analysis.cliCommands ?? []) {
      if (command.path.length === 0) {
        rootSeen = true
        for (const flag of command.flags) {
          if (rootFlagKeys.has(flag.flag)) continue
          rootFlagKeys.add(flag.flag)
          rootFlags.push(flag)
        }
        if (!rootLabel && command.description) rootLabel = command.description
        continue
      }
      const key = command.path.join(' ')
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, seedOf(command))
        continue
      }
      for (const flag of command.flags) {
        if (!existing.flags.includes(flag.flag)) {
          existing.flags.push(flag.flag)
          existing.options?.push(optionOf(flag))
        }
      }
      if (!existing.label && command.description) existing.label = command.description
    }
  }

  const seeds = [...merged.values()].sort((a, b) => a.path.join(' ').localeCompare(b.path.join(' ')))
  const root: CliTreeRoot | null = rootSeen
    ? {
        flags: rootFlags.map((f) => f.flag),
        options: rootFlags.map(optionOf),
        programOptions: rootFlags
          .filter((f) => !f.synthesized)
          .map((f) => ({ ...optionOf(f), scope: 'program' as const })),
        ...(rootLabel ? { label: rootLabel } : {}),
      }
    : null
  return { seeds, root }
}

/**
 * A surface's journeys: one per subcommand seed (program-scope options appended
 * to each grammar), plus the `cli/root` journey when the tree declared a program
 * level AND the caller knows the program's name.
 */
export function buildJourneysFromSurface(surface: CliTreeSurface, programName?: string): Journey[] {
  const seeds = surface.seeds.map((seed) => withProgramOptions(seed, surface.root))
  const journeys = buildCliJourneys(seeds)
  if (surface.root && programName) {
    journeys.unshift(
      buildRootCliJourney(programName, surface.root.flags, surface.root.options, surface.root.label),
    )
  }
  return journeys
}

/** Append the program-scope options to a seed's grammar. A seed carrying flags but
 *  no parsed options first degrades them to name-only entries, so its own flags
 *  are never displaced from the grammar by the program's. */
function withProgramOptions(seed: CliJourneySeed, root: CliTreeRoot | null): CliJourneySeed {
  if (!root || root.programOptions.length === 0) return seed
  const own = seed.options ?? seed.flags.map((flag) => ({ flag }))
  return { ...seed, options: [...own, ...root.programOptions.map((o) => ({ ...o }))] }
}

function seedOf(command: CliCommand): CliJourneySeed {
  return {
    path: [...command.path],
    flags: command.flags.map((f) => f.flag),
    options: command.flags.map(optionOf),
    ...(command.description ? { label: command.description } : {}),
  }
}

/** The analyzer's flag artifact as an option, carrying the full parsed spec. */
function optionOf(flag: CliCommandFlag): JourneyCliOption {
  return {
    flag: flag.flag,
    ...(flag.description ? { description: flag.description } : {}),
    ...(flag.required ? { required: true } : {}),
    ...(flag.takesValue ? { takesValue: true } : {}),
    ...(flag.valueHint ? { valueHint: flag.valueHint } : {}),
    ...(flag.choices?.length ? { choices: flag.choices } : {}),
  }
}
