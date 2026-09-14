import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SessionEvent } from '@truecourse/agent-loop'
import { AuthoredFragmentSchema, type AuthoredFragment } from './draft.js'

export const CheckedDraftReferenceSchema = z.object({ draftId: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict()
const EvidenceSchema = z.object({ kind: z.literal('checked-interface-draft'), draftId: z.string(), fragment: AuthoredFragmentSchema }).strict()

export function checkedDraftEvidence(fragment: AuthoredFragment) {
  const saved = structuredClone(fragment)
  const draftId = `sha256:${createHash('sha256').update(JSON.stringify(saved)).digest('hex')}`
  return { kind: 'checked-interface-draft' as const, draftId, fragment: saved }
}

/** Only successful checks recorded in this session or its explicit resume ancestry qualify. */
export function resolveCheckedDraft(value: unknown, events: readonly SessionEvent[]): AuthoredFragment {
  // Old transcripts and older drivers can still finish with their full outcome.
  const legacy = AuthoredFragmentSchema.safeParse(value)
  if (legacy.success) return legacy.data
  const reference = CheckedDraftReferenceSchema.parse(value)
  for (const event of [...events].reverse()) {
    if (event.type !== 'tool-result' || event.toolName !== 'check_draft' || event.isError) continue
    const evidence = EvidenceSchema.safeParse(event.artifact)
    if (!evidence.success || evidence.data.draftId !== reference.draftId) continue
    if (checkedDraftEvidence(evidence.data.fragment).draftId !== reference.draftId) break
    return structuredClone(evidence.data.fragment)
  }
  throw new Error('Checked draft is unavailable in this session. Run check_draft on the complete draft and return its draftId.')
}
