/**
 * The input-corpus store schema (item 8) — a committed pack of input files under
 * `scenarios/corpus/<pack>/`, plus the small `pack.json` manifest that describes it.
 * Invariant scenarios (`inputs.pack`) run their rule once per file in the pack, so
 * the pack IS the "many inputs" the word "never/always/idempotent" is tested over.
 *
 * The pack directory and its files are committable (the `scenarios/` tree already
 * is), so a clone inherits the corpus and re-running guard is deterministic. The
 * manifest travels with the files as their provenance record.
 */

import { z } from 'zod'

/**
 * One file in a pack. `name` is its sandbox-relative filename inside the pack dir;
 * `note` records where it came from or why it is included (per-file provenance).
 * `source` marks how the file entered the pack: `seed` — written by round-1 pack
 * seeding (doc example blocks / repo fixtures), replaced freely on regenerate;
 * `user` — a real-world repro a user dropped in by hand, which regeneration must
 * NEVER remove (the item-9 ratchet). Absent reads as `seed`.
 */
export const GuardPackFileSchema = z
  .object({
    name: z.string().min(1),
    note: z.string().optional(),
    source: z.enum(['seed', 'user']).optional(),
  })
  .strict()
export type GuardPackFile = z.infer<typeof GuardPackFileSchema>

/**
 * A pack's manifest (`scenarios/corpus/<pack>/pack.json`): the pack id, a
 * provenance one-liner (which section/claim seeded it), and the per-file list. The
 * id MUST equal the directory name so a scenario's `inputs.pack` resolves to it.
 */
export const GuardPackManifestSchema = z
  .object({
    /** The pack id — equals the `scenarios/corpus/<pack>/` directory name. */
    pack: z.string().min(1),
    /** One line on where the pack came from (e.g. the seeding doc + section). */
    provenance: z.string().min(1),
    files: z.array(GuardPackFileSchema),
  })
  .strict()
export type GuardPackManifest = z.infer<typeof GuardPackManifestSchema>
