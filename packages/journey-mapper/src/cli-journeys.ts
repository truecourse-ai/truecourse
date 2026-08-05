/**
 * Journey construction for the cli surface — the one place a command path turns
 * into a {@link Journey}, so the tree derivation and the probe fallback produce
 * BYTE-IDENTICAL journeys for the same surface. That identity is what lets a
 * catalog switch sources without spraying drift across the scenario corpus.
 */

import { journeyFingerprint, type Journey, type JourneyCliOption } from '@truecourse/shared'

/** One command as either derivation found it: its argv path and the flags it takes. */
export interface CliJourneySeed {
  /** Argv path of the command, e.g. `["spec","docs","exclude"]`. */
  path: string[]
  /** Flags the command accepts, canonical long form where one exists. */
  flags: string[]
  /** Per-flag option schema, when the derivation parsed one — never fingerprinted. */
  options?: JourneyCliOption[]
  /** Cosmetic one-liner (the command's description) — never fingerprinted. */
  label?: string
}

/**
 * Build the cli journeys for a set of command paths: one journey per command, a
 * single `invoke` step, ids slugified from the path. Seeds are emitted in the
 * order given, duplicates (same path) collapse onto the first.
 */
export function buildCliJourneys(seeds: readonly CliJourneySeed[]): Journey[] {
  const journeys: Journey[] = []
  const seenPaths = new Set<string>()
  const usedIds = new Set<string>()

  for (const seed of seeds) {
    if (seed.path.length === 0) continue
    const key = seed.path.join(' ')
    if (seenPaths.has(key)) continue
    seenPaths.add(key)

    const id = uniqueId(`cli/${slugify(seed.path)}`, usedIds)
    const entry = { command: [...seed.path] }
    const options = dedupeOptions(seed.options ?? [])
    const steps: Journey['steps'] = [
      {
        kind: 'invoke' as const,
        command: [...seed.path],
        flags: dedupe(seed.flags),
        ...(options.length > 0 ? { options } : {}),
        ...(seed.label ? { label: seed.label } : {}),
      },
    ]
    journeys.push({
      id,
      type: 'cli',
      title: seed.path.join(' '),
      entry,
      steps,
      fingerprint: journeyFingerprint({ type: 'cli', entry, steps }),
    })
  }
  return journeys
}

/**
 * The ROOT journey — the program invoked with no subcommand. It is the last rung
 * of the probe ladder (an entry is always an invocable surface), so a CLI whose
 * help nobody can parse still grounds one journey instead of none.
 */
export function buildRootCliJourney(
  programName: string,
  flags: readonly string[] = [],
  options: readonly JourneyCliOption[] = [],
): Journey {
  const entry = { command: [programName] }
  const deduped = dedupeOptions(options)
  const steps: Journey['steps'] = [
    {
      kind: 'invoke' as const,
      command: [programName],
      flags: dedupe(flags),
      ...(deduped.length > 0 ? { options: deduped } : {}),
    },
  ]
  return {
    id: 'cli/root',
    type: 'cli',
    title: programName,
    entry,
    steps,
    fingerprint: journeyFingerprint({ type: 'cli', entry, steps }),
  }
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/** One option per flag, first declaration wins — mirrors the flag dedupe. */
function dedupeOptions(options: readonly JourneyCliOption[]): JourneyCliOption[] {
  const seen = new Set<string>()
  const out: JourneyCliOption[] = []
  for (const option of options) {
    if (seen.has(option.flag)) continue
    seen.add(option.flag)
    out.push({ ...option })
  }
  return out
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
