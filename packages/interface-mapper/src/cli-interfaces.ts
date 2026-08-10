/**
 * Interface construction for the cli surface — the one place a command path turns
 * into a {@link Interface}, so the tree derivation and the probe fallback produce
 * BYTE-IDENTICAL interfaces for the same surface. That identity is what lets a
 * catalog switch sources without spraying drift across the scenario corpus.
 *
 * ONE entry per invocable command, never a tree folded into one entry: `rules`,
 * `rules list` and `rules enable` are three interfaces sharing the `rules`
 * {@link Interface.group}.
 */

import { interfaceFingerprint, type Interface } from '@truecourse/shared'

/** One command as either derivation found it: its argv path and the flags it takes. */
export interface CliInterfaceSeed {
  /** Argv path of the command, e.g. `["spec","docs","exclude"]`. */
  path: string[]
  /** Flags the command accepts, canonical long form where one exists. */
  flags: string[]
  /** Cosmetic one-liner (the command's description) — never fingerprinted. */
  label?: string
}

/**
 * Build the cli interfaces for a set of command paths: one interface per command, a
 * single `invoke` step, ids slugified from the path. Seeds are emitted in the
 * order given, duplicates (same path) collapse onto the first.
 */
export function buildCliInterfaces(seeds: readonly CliInterfaceSeed[]): Interface[] {
  const interfaces: Interface[] = []
  const seenPaths = new Set<string>()
  const usedIds = new Set<string>()

  for (const seed of seeds) {
    if (seed.path.length === 0) continue
    const key = seed.path.join(' ')
    if (seenPaths.has(key)) continue
    seenPaths.add(key)

    const id = uniqueId(`cli/${slugify(seed.path)}`, usedIds)
    const entry = { command: [...seed.path] }
    const group = seed.path[0]
    const steps: Interface['steps'] = [
      {
        kind: 'invoke' as const,
        command: [...seed.path],
        flags: dedupe(seed.flags),
        ...(seed.label ? { label: seed.label } : {}),
      },
    ]
    interfaces.push({
      id,
      type: 'cli',
      title: seed.path.join(' '),
      ...(group ? { group } : {}),
      entry,
      steps,
      fingerprint: interfaceFingerprint({ type: 'cli', entry, steps }),
    })
  }
  return interfaces
}

/**
 * The ROOT interface — the program invoked with no subcommand. It is the last rung
 * of the probe ladder (an entry is always an invocable surface), so a CLI whose
 * help nobody can parse still grounds one interface instead of none.
 */
export function buildRootCliInterface(programName: string, flags: readonly string[] = []): Interface {
  const entry = { command: [programName] }
  const steps: Interface['steps'] = [
    { kind: 'invoke' as const, command: [programName], flags: dedupe(flags) },
  ]
  return {
    id: 'cli/root',
    type: 'cli',
    title: programName,
    group: programName,
    entry,
    steps,
    fingerprint: interfaceFingerprint({ type: 'cli', entry, steps }),
  }
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/** `["spec","docs","exclude"]` → `spec-docs-exclude`. */
function slugify(path: readonly string[]): string {
  const slug = path
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'command'
}

/** Two command paths can slugify alike (`a:b` and `a-b`); ids stay unique. */
function uniqueId(base: string, used: Set<string>): string {
  let id = base
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`
  used.add(id)
  return id
}
