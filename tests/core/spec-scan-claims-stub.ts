/**
 * Scripted answers for the sessions of a scan that finds conflicts by
 * comparing claims: an extractor, a subject settler and a comparer that read
 * their briefings the way a model would and answer through the real tools, so
 * the shell's outcome preconditions and the gates run as they do live.
 */

import type { DriverResult } from '../../packages/agent-loop/src/index'
import type { ClaimLedgerWire } from '../../packages/core/src/services/spec-scan/extract-claims'
import type { SubjectSettlement } from '../../packages/core/src/services/spec-scan/settle-subjects'
import type { ClaimComparisonWire } from '../../packages/core/src/services/spec-scan/compare-claims'
import { outcome, type StubCall } from './spec-scan-session-stub'

/** Run one of the session's own tools and put its result on the transcript, as a driver does. */
export async function useTool(call: StubCall, name: string, args: unknown): Promise<string> {
  const tool = call.def.tools.find((t) => t.name === name)
  if (!tool) throw new Error(`the session has no tool ${name}`)
  const result = await tool.execute(args, {
    workItem: '',
    signal: call.input.signal,
    dispatchChild: () => Promise.reject(new Error('not used')),
  })
  await call.emit({ type: 'tool-result', toolName: name, content: result.content, ...(result.isError ? { isError: true } : {}) })
  return result.content
}

// ---------------------------------------------------------------------------
// record
// ---------------------------------------------------------------------------

/** One sentence as an extraction briefing shows it. */
export interface BriefedSentence {
  n: number
  /** The rest of its line: the sentence's text as presented. */
  line: string
}

export function recordBriefing(briefing: string): { doc: string; areas: string[]; sentences: BriefedSentence[] } {
  return {
    doc: /^DOCUMENT: (\S+)/m.exec(briefing)![1]!,
    areas: /^AREA TAGS \(.*?\): (.+)$/m.exec(briefing)![1]!.split(', '),
    sentences: [...briefing.matchAll(/^\[(\d+)\] (.*)$/gm)].map((m) => ({ n: Number(m[1]), line: m[2]! })),
  }
}

interface StatedClaim {
  subject: string
  statement: string
  testable?: boolean
  reason?: ClaimLedgerWire['facts'][number]['reason']
}

/** What a sentence states (one claim, or several), or `null` to skip it. */
export type SentenceClaim = (sentence: BriefedSentence, doc: string) => StatedClaim | readonly StatedClaim[] | null

/** An extractor that writes the claims `claimOf` says each sentence states, under every area of the doc, and skips the rest. */
export async function record(call: StubCall, claimOf: SentenceClaim): Promise<DriverResult> {
  const { doc, areas, sentences } = recordBriefing(call.briefing)
  const ledger: ClaimLedgerWire = { facts: [], skips: [] }
  for (const sentence of sentences) {
    const stated = claimOf(sentence, doc)
    if (stated === null) ledger.skips.push({ from: sentence.n, to: sentence.n, why: 'other', note: 'nothing to record' })
    else for (const claim of [stated].flat()) ledger.facts.push({ sentences: [sentence.n], areas, testable: true, reason: null, ...claim })
  }
  await useTool(call, 'check_ledger', ledger)
  return outcome(ledger)
}

// ---------------------------------------------------------------------------
// settle subjects
// ---------------------------------------------------------------------------

export function subjectNames(briefing: string): Array<{ id: string; name: string; claims: number }> {
  return [...briefing.matchAll(/^(S\d+) · (.*?) · (\d+) facts? in/gm)].map((m) => ({ id: m[1]!, name: m[2]!, claims: Number(m[3]) }))
}

/** A settler that merges the names `sameAs` maps to one subject, and keeps every other name distinct. */
export async function settle(call: StubCall, sameAs: (name: string) => string | null = () => null): Promise<DriverResult> {
  const groups = new Map<string, string[]>()
  const distinct: string[] = []
  for (const { id, name } of subjectNames(call.briefing)) {
    const subject = sameAs(name)
    if (subject === null) distinct.push(id)
    else groups.set(subject, [...(groups.get(subject) ?? []), id])
  }
  const settlement: SubjectSettlement = { same: [], distinct }
  for (const [subject, names] of groups) {
    if (names.length >= 2) settlement.same.push({ subject, names })
    else distinct.push(...names)
  }
  await useTool(call, 'check_subjects', settlement)
  return outcome(settlement)
}

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------

export interface BriefedClaim {
  id: string
  doc: string
  heading: string
  subject: string
  statement: string
}

export function compareBriefing(briefing: string): BriefedClaim[] {
  return [...briefing.matchAll(/^(F\d+) · (\S+) · (.*?) · \[(.*?)\] (.*)$/gm)].map((m) => ({
    id: m[1]!,
    doc: m[2]!,
    heading: m[3]!,
    subject: m[4]!,
    statement: m[5]!,
  }))
}

/** A conflict's adjudication, as the comparer writes it. */
export interface StubReview {
  explanation: string
  recommendation: {
    action: 'pick-a' | 'pick-b' | 'fix-doc' | 'dismiss'
    rationale: string
    fix?: string
    confidence?: 'low' | 'medium' | 'high'
  }
}

export const REVIEW: StubReview = {
  explanation: 'The two sentences give different places for the same control.',
  recommendation: { action: 'fix-doc', rationale: 'Neither document says which is current.', fix: 'Pick one place.', confidence: 'medium' },
}

/**
 * A comparer that groups the claims briefed under one subject, and judges a
 * group in conflict when `conflicting` names a pair of its claims (side a
 * first), each conflict carrying `review`; every other claim is alone.
 */
export async function compare(
  call: StubCall,
  conflicting: (a: BriefedClaim, b: BriefedClaim) => boolean = () => false,
  review: StubReview = REVIEW,
): Promise<DriverResult> {
  const claims = compareBriefing(call.briefing)
  const bySubject = new Map<string, BriefedClaim[]>()
  for (const claim of claims) bySubject.set(claim.subject, [...(bySubject.get(claim.subject) ?? []), claim])
  const comparison: ClaimComparisonWire = { groups: [], alone: [] }
  for (const [subject, group] of bySubject) {
    if (group.length < 2) {
      comparison.alone.push(group[0]!.id)
      continue
    }
    const conflicts = group.flatMap((a) =>
      group.filter((b) => b !== a && conflicting(a, b)).map((b) => ({ a: a.id, b: b.id, note: `${a.doc} and ${b.doc} disagree on ${subject}`, review })),
    )
    const paired = new Set(conflicts.flatMap((c) => [c.a, c.b]))
    comparison.groups.push({
      subject,
      facts: group.map((f) => f.id),
      verdict: conflicts.length > 0 ? 'conflict' : 'agree',
      conflicts,
      ...(conflicts.length > 0 ? { consistent: group.map((f) => f.id).filter((id) => !paired.has(id)) } : {}),
    })
  }
  await useTool(call, 'check_groups', comparison)
  return outcome(comparison)
}
