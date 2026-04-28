import crypto from 'node:crypto'
import type { Invariant } from '@truecourse/shared'
import {
  appendRejected,
  deleteDraft,
  listActiveInvariantSlugs,
  listDrafts,
  readActiveInvariant,
  readAllActiveInvariants,
  readDraft,
  retireInvariant,
  writeActiveInvariant,
} from '../../lib/invariant-store.js'
import { buildDraftSignature } from './suggest.js'

// ---------------------------------------------------------------------------
// Slug generation — `<type>__<scope-slug>`
// ---------------------------------------------------------------------------

export function buildSlug(type: string, scope: string): string {
  const scopeSlug = scope
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${type}__${scopeSlug}`
}

/**
 * Find the first free `<base>` / `<base>-2` / `<base>-3` … slug. The base
 * `(type, scope)` slug isn't unique on its own — `rest-contract` legitimately
 * emits multiple invariants on the same spec section (one per claim), and
 * `state-machine` could in theory emit two declarations on the same field.
 * Suffix policy keeps filenames human-readable while preventing silent
 * overwrites at accept time.
 */
function nextFreeSlug(repoPath: string, baseSlug: string): string {
  const existing = new Set(listActiveInvariantSlugs(repoPath))
  if (!existing.has(baseSlug)) return baseSlug
  let n = 2
  while (existing.has(`${baseSlug}-${n}`)) n++
  return `${baseSlug}-${n}`
}

// ---------------------------------------------------------------------------
// Lifecycle operations
// ---------------------------------------------------------------------------

export interface AcceptResult {
  invariant: Invariant
  slug: string
}

export function acceptDraft(repoPath: string, draftId: string): AcceptResult {
  const draft = readDraft(repoPath, draftId)
  if (!draft) throw new Error(`Draft ${draftId} not found`)

  const slug = nextFreeSlug(repoPath, buildSlug(draft.type, draft.scope))
  const invariantId = crypto.randomUUID()

  const invariant: Invariant = {
    id: invariantId,
    type: draft.type,
    pluginVersion: draft.pluginVersion,
    scope: draft.scope,
    declaration: draft.declaration,
    provenance: { ...draft.provenance, source: 'discovered' },
  }

  writeActiveInvariant(repoPath, slug, invariant)
  deleteDraft(repoPath, draftId)
  return { invariant, slug }
}

export function rejectDraft(repoPath: string, draftId: string): void {
  const draft = readDraft(repoPath, draftId)
  if (!draft) throw new Error(`Draft ${draftId} not found`)
  appendRejected(repoPath, {
    type: draft.type,
    scope: draft.scope,
    signature: buildDraftSignature(draft),
    rejectedAt: new Date().toISOString(),
  })
  deleteDraft(repoPath, draftId)
}

export function retireBySlug(repoPath: string, slug: string): boolean {
  return retireInvariant(repoPath, slug)
}

export function listActive(repoPath: string): Invariant[] {
  return readAllActiveInvariants(repoPath)
}

export function listPendingDrafts(repoPath: string) {
  return listDrafts(repoPath)
}

export function readActive(repoPath: string, slug: string): Invariant | null {
  return readActiveInvariant(repoPath, slug)
}
