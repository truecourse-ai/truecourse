/**
 * THE WRITE — the one place a session's work reaches disk.
 *
 * `guard/interfaces.authored.json` is COMMITTED, hand-owned, and the only home
 * of the surfaces no derivation produces. Nothing re-derives it, so this write
 * is held to the rule the derived snapshot is not: it never replaces the file,
 * it lays a validated fragment over it by id, and an entry it was not asked to
 * replace comes through untouched. A run interrupted after three places leaves
 * three places authored and the rest of the file exactly as it was.
 */

import { atomicWriteJson, guardAuthoredInterfacesPath } from '@truecourse/guard-runner'
import { InterfacesFragmentSchema, type InterfacesFile } from '@truecourse/shared'

export interface WriteAuthoredInput {
  repoRoot: string
  /** The file the fragment produced — {@link candidateAuthored}'s output. */
  candidate: InterfacesFile
  /** The derived snapshot, for the envelope's recipe fingerprint. */
  derived: InterfacesFile | null
  now?: () => string
}

/**
 * Stamp the envelope and write. The envelope is the AUTHORING run's: this file
 * is not a mapping, so `generatedAt` dates the authoring and the recipe
 * fingerprint is carried from the derivation the authoring read (the merge
 * prefers the derived envelope anyway — this keeps the file self-describing
 * rather than blank).
 */
export function writeAuthoredCatalog(input: WriteAuthoredInput): { path: string; file: InterfacesFile } {
  const now = input.now ?? (() => new Date().toISOString())
  const file: InterfacesFile = {
    ...input.candidate,
    generatedAt: now(),
    recipeFingerprint: input.derived?.recipeFingerprint || input.candidate.recipeFingerprint || '',
  }
  // Shape, not cross-references: this file is HALF a catalog, and its `at`/`to`
  // ids resolve against the merge (see `InterfacesFragmentSchema`). The
  // references were already checked against the merged catalog by
  // `validateFragment` — checking them again here, against half a catalog,
  // would refuse every task that stands on a derived place.
  const parsed = InterfacesFragmentSchema.safeParse(file)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(
      `refusing to write ${guardAuthoredInterfacesPath(input.repoRoot)}: ${
        issue ? `${issue.path.join('.')} — ${issue.message}` : 'schema validation failed'
      }`,
    )
  }
  const path = guardAuthoredInterfacesPath(input.repoRoot)
  atomicWriteJson(path, parsed.data)
  return { path, file: parsed.data }
}
