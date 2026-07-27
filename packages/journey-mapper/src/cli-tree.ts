/**
 * The PRIMARY cli derivation: the command tree the analyzer already read out of
 * the framework's own call signatures (`FileAnalysis.cliCommands`). No subprocess,
 * no build, no help text — the same tree-first rule every other surface follows.
 */

import type { CliCommand, FileAnalysis, Journey } from '@truecourse/shared'
import { buildCliJourneys, type CliJourneySeed } from './cli-journeys.js'

/**
 * One journey per command path across every analyzed file. A command declared in
 * more than one file (a re-registered subcommand) collapses onto one journey whose
 * flags are the union of what those declarations accept — the surface is what a
 * user can reach, not how many places declare it.
 */
export function deriveCliJourneysFromTree(fileAnalyses: readonly FileAnalysis[]): Journey[] {
  const merged = new Map<string, CliJourneySeed>()

  for (const analysis of fileAnalyses) {
    for (const command of analysis.cliCommands ?? []) {
      if (command.path.length === 0) continue
      const key = command.path.join(' ')
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, seedOf(command))
        continue
      }
      for (const flag of command.flags) {
        if (!existing.flags.includes(flag.flag)) existing.flags.push(flag.flag)
      }
      if (!existing.label && command.description) existing.label = command.description
    }
  }

  const seeds = [...merged.values()].sort((a, b) => a.path.join(' ').localeCompare(b.path.join(' ')))
  return buildCliJourneys(seeds)
}

function seedOf(command: CliCommand): CliJourneySeed {
  return {
    path: [...command.path],
    flags: command.flags.map((f) => f.flag),
    ...(command.description ? { label: command.description } : {}),
  }
}
