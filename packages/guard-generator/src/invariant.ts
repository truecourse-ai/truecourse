/**
 * Invariant-claim authoring support (item 8): seed the input-corpus pack a documented
 * always/never/idempotent rule is checked over. Round 1 seeds the pack from inputs
 * ALREADY AT HAND — the section's own example blocks (item 7's payloads), copied
 * byte-faithfully — so no LLM exemplar generation runs here (that is item 9). The
 * seeded pack lands under `scenarios/corpus/<pack>/`, committable with the scenario.
 */

import { createHash } from 'node:crypto'
import { writePack } from '@truecourse/guard-runner'
import type { GuardPackManifest, GuardPackFile } from '@truecourse/shared'
import { anchorLeaf } from './serialize.js'
import type { ExtractedClaim } from './schemas.js'
import type { SectionInput } from './section-plan.js'

/**
 * A deterministic, filesystem-safe pack id for an invariant claim: `inv-<leaf>-<hash>`,
 * keyed on the claim's identity (doc + anchor + claim text) so a re-generate reuses the
 * SAME pack directory (its user-added files then survive, per the item-9 ratchet).
 */
export function invariantPackId(section: SectionInput, claimText: string): string {
  const hash = createHash('sha256')
    .update([section.doc, section.anchor, claimText.replace(/\s+/g, ' ').trim()].join('\0'))
    .digest('hex')
    .slice(0, 8)
  return `inv-${anchorLeaf(section.anchor)}-${hash}`
}

/**
 * Seed an invariant claim's pack from its example blocks and return the pack id, or
 * `null` when the claim carries no seed blocks (nothing at hand to seed with — the
 * claim then authors as an ordinary single-input scenario until item 9 generates a
 * pack). The blocks are written byte-faithfully as `sample-NN` files; `writePack`
 * preserves any user-added file already in the pack.
 */
export function seedInvariantPack(repoRoot: string, section: SectionInput, claim: ExtractedClaim): string | null {
  const blocks = claim.examples ?? []
  if (blocks.length === 0) return null
  const pack = invariantPackId(section, claim.claim)
  const files: Record<string, string> = {}
  const manifestFiles: GuardPackFile[] = []
  blocks.forEach((b, i) => {
    const name = `sample-${String(i + 1).padStart(2, '0')}`
    files[name] = b.block
    manifestFiles.push({ name, source: 'seed', ...(b.outcome ? { note: b.outcome } : {}) })
  })
  const manifest: GuardPackManifest = {
    pack,
    provenance: `seeded from ${section.doc}#${section.anchor} example blocks`,
    files: manifestFiles,
  }
  writePack(repoRoot, manifest, files)
  return pack
}
