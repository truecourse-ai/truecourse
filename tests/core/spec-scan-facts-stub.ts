/**
 * Scripted answers for the sessions of a scan that finds conflicts by
 * comparing facts: a recorder, a subject settler and a comparer that read
 * their briefings the way a model would and answer through the real tools, so
 * the shell's outcome preconditions and the gates run as they do live.
 */

import type { DriverResult } from '../../packages/agent-loop/src/index'
import type { FactLedgerWire } from '../../packages/core/src/services/spec-scan/record-facts'
import type { SubjectSettlement } from '../../packages/core/src/services/spec-scan/settle-subjects'
import type { FactComparisonWire } from '../../packages/core/src/services/spec-scan/compare-facts'
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

/** One unit as a record briefing shows it. */
export interface BriefedUnit {
  n: number
  /** The rest of its line: the unit's text as presented. */
  line: string
}

export function recordBriefing(briefing: string): { doc: string; areas: string[]; units: BriefedUnit[] } {
  return {
    doc: /^DOCUMENT: (\S+)/m.exec(briefing)![1]!,
    areas: /^AREA TAGS \(.*?\): (.+)$/m.exec(briefing)![1]!.split(', '),
    units: [...briefing.matchAll(/^\[(\d+)\] (.*)$/gm)].map((m) => ({ n: Number(m[1]), line: m[2]! })),
  }
}

/** What a unit states, or `null` to skip it. */
export type UnitFact = (unit: BriefedUnit, doc: string) => { subject: string; statement: string } | null

/** A recorder that records what `factOf` says each unit states, under every area of the doc, and skips the rest. */
export async function record(call: StubCall, factOf: UnitFact): Promise<DriverResult> {
  const { doc, areas, units } = recordBriefing(call.briefing)
  const ledger: FactLedgerWire = { facts: [], skips: [] }
  for (const unit of units) {
    const fact = factOf(unit, doc)
    if (fact) ledger.facts.push({ units: [unit.n], areas, ...fact })
    else ledger.skips.push({ from: unit.n, to: unit.n, why: 'other', note: 'nothing to record' })
  }
  await useTool(call, 'check_ledger', ledger)
  return outcome(ledger)
}

// ---------------------------------------------------------------------------
// settle subjects
// ---------------------------------------------------------------------------

export function subjectNames(briefing: string): Array<{ id: string; name: string; facts: number }> {
  return [...briefing.matchAll(/^(S\d+) · (.*?) · (\d+) facts? in/gm)].map((m) => ({ id: m[1]!, name: m[2]!, facts: Number(m[3]) }))
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

export interface BriefedFact {
  id: string
  doc: string
  heading: string
  subject: string
  statement: string
}

export function compareBriefing(briefing: string): BriefedFact[] {
  return [...briefing.matchAll(/^(F\d+) · (\S+) · (.*?) · \[(.*?)\] (.*)$/gm)].map((m) => ({
    id: m[1]!,
    doc: m[2]!,
    heading: m[3]!,
    subject: m[4]!,
    statement: m[5]!,
  }))
}

const REVIEW = {
  explanation: 'The two passages give different places for the same control.',
  recommendation: { action: 'fix-doc' as const, rationale: 'Neither document says which is current.', fix: 'Pick one place.', confidence: 'medium' as const },
}

/**
 * A comparer that groups the facts briefed under one subject, and judges a
 * group in conflict when `conflicting` names a pair of its facts (side a
 * first); every other fact is alone.
 */
export async function compare(
  call: StubCall,
  conflicting: (a: BriefedFact, b: BriefedFact) => boolean = () => false,
): Promise<DriverResult> {
  const facts = compareBriefing(call.briefing)
  const bySubject = new Map<string, BriefedFact[]>()
  for (const fact of facts) bySubject.set(fact.subject, [...(bySubject.get(fact.subject) ?? []), fact])
  const comparison: FactComparisonWire = { groups: [], alone: [] }
  for (const [subject, group] of bySubject) {
    if (group.length < 2) {
      comparison.alone.push(group[0]!.id)
      continue
    }
    const conflicts = group.flatMap((a) =>
      group.filter((b) => b !== a && conflicting(a, b)).map((b) => ({ a: a.id, b: b.id, note: `${a.doc} and ${b.doc} disagree on ${subject}`, review: REVIEW })),
    )
    comparison.groups.push({ subject, facts: group.map((f) => f.id), verdict: conflicts.length > 0 ? 'conflict' : 'agree', conflicts })
  }
  await useTool(call, 'check_groups', comparison)
  return outcome(comparison)
}
