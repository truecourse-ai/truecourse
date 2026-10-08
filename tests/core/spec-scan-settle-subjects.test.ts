/**
 * THE SUBJECT SETTLING — `spec-scan.settle-subjects`, the barrier between
 * extracting claims and comparing them.
 *
 * What is under test:
 * - names equal but for case, spacing and markup are one name before any
 *   session runs, briefed once with their claims counted together;
 * - the parts the names are settled in, and that a part of one name runs no
 *   session;
 * - the gate: a name placed twice, a name placed nowhere, an unknown id, a
 *   `same` entry of one name; a wrapping-up outcome is accepted and folded
 *   leniently;
 * - the cache key moves with exactly its named inputs;
 * - through the real `runSpecScanSessions`: the settled subjects reach the
 *   comparison, a failed session merges nothing, and a kind lost whole to the
 *   transport aborts the scan.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installMemoryKvCache, resetKvCacheStore } from '../helpers/memory-kv-cache'
import { LlmStageFailureError } from '@truecourse/shared/llm'
import { runSpecScanSessions } from '../../packages/core/src/services/spec-scan/run'
import { CURATE_DOC_SESSION_KIND } from '../../packages/core/src/services/spec-scan/curate-doc'
import { SETTLE_AREAS_SESSION_KIND } from '../../packages/core/src/services/spec-scan/settle-areas'
import { EXTRACT_CLAIMS_SESSION_KIND, type ExtractedClaim } from '../../packages/core/src/services/spec-scan/extract-claims'
import { COMPARE_CLAIMS_SESSION_KIND } from '../../packages/core/src/services/spec-scan/compare-claims'
import {
  SETTLE_SUBJECTS_NAMES,
  SETTLE_SUBJECTS_SESSION_KIND,
  SUBJECT_SETTLE_STAGE_VERSION,
  checkSubjects,
  collectSubjectNames,
  planSubjectParts,
  settleSubjectsCacheKey,
  settleSubjectsSessionDef,
  settledSubjects,
  subjectKey,
  subjectMerges,
  subjectsRefusal,
  type SubjectName,
  type SubjectPart,
} from '../../packages/core/src/services/spec-scan/settle-subjects'
import { instructionsFingerprint, scanCacheKey } from '../../packages/core/src/services/spec-scan/tools'
import { writeDecisions, type DecisionsFile } from '../../packages/spec-consolidator/src/index.js'
import { splitDocSentences } from '@truecourse/shared'
import { docPathOf, memoryPersistence, outcome, stubDriver, transportFailure, malformedFailure, type StubCall } from './spec-scan-session-stub'
import { compare, compareBriefing, record, settle, subjectNames, type SentenceClaim } from './spec-scan-claims-stub'
import type { DriverResult } from '../../packages/agent-loop/src/index'

// ---------------------------------------------------------------------------
// names
// ---------------------------------------------------------------------------

const UNITS = splitDocSentences('One.\n\nTwo.\n\nThree.\n')
const claim = (doc: string, subject: string, statement = `${subject} works.`): ExtractedClaim => ({
  doc,
  sentences: [UNITS[0]!],
  subject,
  statement,
  areas: ['core/x'],
})

describe('subject names before any session runs', () => {
  it('are one name when equal but for case, spacing and markup', () => {
    expect(subjectKey('  ATS   Checker ')).toBe('ats checker')
    expect(subjectKey('`ATS checker`')).toBe('ats checker')
    expect(subjectKey('**ATS** _checker_')).toBe('ats checker')
    expect(subjectKey('[ATS checker](/docs/ats)')).toBe('ats checker')
    // An identifier keeps its underscore.
    expect(subjectKey('ENCRYPTION_SECRET')).toBe('encryption_secret')
    expect(subjectKey('ENCRYPTION_SECRET')).not.toBe(subjectKey('ENCRYPTION SECRET'))
  })

  it('count their claims and docs together, and take the spelling most claims use', () => {
    const names = collectSubjectNames([
      claim('docs/a.md', 'ATS checker', 'The ATS checker scores a resume.'),
      claim('docs/b.md', 'ats  checker'),
      claim('docs/b.md', '`ATS checker`'),
      claim('docs/c.md', 'ATS checker'),
      claim('docs/a.md', 'Export my data'),
    ])
    expect(names).toEqual([
      { key: 'ats checker', name: 'ATS checker', claims: 4, docs: 3, sample: 'The ATS checker scores a resume.' },
      { key: 'export my data', name: 'Export my data', claims: 1, docs: 1, sample: 'Export my data works.' },
    ])
  })
})

describe('planSubjectParts', () => {
  const names = (n: number): SubjectName[] =>
    collectSubjectNames(Array.from({ length: n }, (_, i) => claim('docs/a.md', `setting ${i} of group${i % 50}`)))

  it('settles every name at once up to the bound, and plans nothing for a single name', () => {
    const all = names(40)
    expect(planSubjectParts(all)).toEqual([{ index: 1, parts: 1, total: 40, names: all }])
    expect(planSubjectParts(names(1))).toEqual([])
    expect(planSubjectParts([])).toEqual([])
  })

  it('divides more names than the bound into parts, none over it', () => {
    const parts = planSubjectParts(names(SETTLE_SUBJECTS_NAMES + 100))
    expect(parts.length).toBeGreaterThanOrEqual(2)
    expect(parts.every((part) => part.names.length <= SETTLE_SUBJECTS_NAMES && part.parts === parts.length)).toBe(true)
    expect(parts.reduce((n, part) => n + part.names.length, 0)).toBe(SETTLE_SUBJECTS_NAMES + 100)
  })
})

// ---------------------------------------------------------------------------
// the gate, the fold, the key
// ---------------------------------------------------------------------------

const PART: SubjectPart = {
  index: 1,
  parts: 1,
  total: 4,
  names: collectSubjectNames([
    claim('docs/a.md', 'ATS check'),
    claim('docs/a.md', 'ATS checker'),
    claim('docs/b.md', 'Export my data'),
    claim('docs/b.md', 'resume checker'),
  ]),
}

describe('the settling gate', () => {
  it('passes a settlement that places every name once', () => {
    const check = checkSubjects({ same: [{ subject: 'ATS checker', names: ['S1', 'S2', 'S4'] }], distinct: ['S3'] }, 4)
    expect(check).toEqual({ problems: [], missing: [] })
    expect(subjectsRefusal(check)).toBeUndefined()
  })

  it('refuses a name placed twice, a name placed nowhere, an unknown id and a group of one', () => {
    const check = checkSubjects(
      { same: [{ subject: 'ATS checker', names: ['S1', 'S2'] }, { subject: 'Export', names: ['S2'] }], distinct: ['S9'] },
      4,
    )
    expect(check.problems).toEqual([
      'same[1] holds fewer than two names; a name that means nothing else goes in "distinct"',
      'S2 is placed twice, in same[0] and in same[1]; place each name once',
      'distinct names "S9", which is not a name of this list (S1 to S4)',
    ])
    expect(check.missing).toEqual(['S3', 'S4'])
    expect(subjectsRefusal(check)).toMatch(/^Settlement refused\.\n\n2 name\(s\) placed nowhere: S3, S4\./)
  })

  it('is the session\'s check, and a wrapping-up outcome is accepted as it stands', async () => {
    const def = settleSubjectsSessionDef(PART)
    expect(def.tools.map((t) => t.name)).toEqual(['check_subjects'])
    expect(def.outcomePrecondition?.tool).toBe('check_subjects')
    const partial = { same: [{ subject: 'ATS checker', names: ['S1', 'S2'] }], distinct: [] }
    expect(def.validateOutcome!(partial, { wrappingUp: false })).toMatch(/S3, S4/)
    expect(def.validateOutcome!(partial, { wrappingUp: true })).toBeUndefined()
  })

  it('folds leniently: a name stays in its first entry, an entry left with one name merges nothing', () => {
    const merges = subjectMerges(PART, {
      same: [
        { subject: 'ATS checker', names: ['S1', 'S2', 'S4'] },
        { subject: 'Exports', names: ['S4', 'S3'] },
      ],
      distinct: [],
    })
    expect([...merges]).toEqual([
      ['ats check', 'ATS checker'],
      ['ats checker', 'ATS checker'],
      ['resume checker', 'ATS checker'],
    ])
  })

  it('maps every claim to its settled subject, and an unmerged one to its name as most spelled', () => {
    const claims = [claim('docs/a.md', 'resume checker'), claim('docs/a.md', 'export my data'), claim('docs/b.md', 'Export my data'), claim('docs/c.md', 'Export my data')]
    const names = collectSubjectNames(claims)
    const settled = settledSubjects(claims, names, new Map([['resume checker', 'ATS checker']]))
    expect(claims.map((c) => settled.get(c))).toEqual(['ATS checker', 'Export my data', 'Export my data', 'Export my data'])
  })
})

describe('settleSubjectsCacheKey', () => {
  const key = (part: SubjectPart, instructions: string[] = []): string => settleSubjectsCacheKey(part, [instructionsFingerprint(instructions)])
  const KEY = key(PART)

  it('is the named inputs, in order, and nothing else', () => {
    expect(KEY).toBe(
      scanCacheKey([
        `settle-subjects-v${SUBJECT_SETTLE_STAGE_VERSION}`,
        'ATS check\t1\nATS checker\t1\nExport my data\t1\nresume checker\t1',
        instructionsFingerprint([]),
      ]),
    )
  })

  it('moves with a name, a claim count and the instructions, never with a sample or a doc count', () => {
    const renamed = { ...PART, names: PART.names.map((n, i) => (i === 0 ? { ...n, name: 'ATS checks' } : n)) }
    const counted = { ...PART, names: PART.names.map((n, i) => (i === 0 ? { ...n, claims: 2 } : n)) }
    const resampled = { ...PART, names: PART.names.map((n) => ({ ...n, sample: 'Another statement.', docs: 7 })) }
    expect(key(renamed)).not.toBe(KEY)
    expect(key(counted)).not.toBe(KEY)
    expect(key(PART, ['be strict'])).not.toBe(KEY)
    expect(key(resampled)).toBe(KEY)
  })
})

// ---------------------------------------------------------------------------
// through the run
// ---------------------------------------------------------------------------

const DOCS: Record<string, string> = {
  'docs/ats.md': '# ATS\n\nThe ATS checker scores a resume against a job post.\n\nThe ATS Checker runs on save.\n\nThe ATS checker is free.\n',
  'docs/review.md': '# Review\n\nThe resume checker flags missing keywords.\n\nThe `ATS checker` needs an AI provider.\n',
}

/** Every sentence a claim, its subject the checker it names as written. */
const checkerClaim: SentenceClaim = ({ line }) => {
  const named = /(ATS checker|ATS Checker|resume checker|`ATS checker`)/.exec(line)?.[1]
  return named ? { subject: named, statement: line } : null
}

let repo: string
let decisions: DecisionsFile
beforeEach(() => {
  installMemoryKvCache()
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-scan-subjects-'))
  decisions = {
    version: 2,
    manualIncludes: [],
    manualExcludes: [],
    manualAreas: [],
    conflictResolutions: [],
    scopeVerdicts: [
      { path: '.', verdict: 'keep', reason: 'root', decidedAt: '2026-01-01T00:00:00Z', resolvedBy: 'user' },
      { path: 'docs', verdict: 'keep', reason: 'docs', decidedAt: '2026-01-01T00:00:00Z', resolvedBy: 'user' },
    ],
    instructions: [],
  }
  writeDecisions(repo, decisions)
  for (const [rel, content] of Object.entries(DOCS)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
    fs.writeFileSync(path.join(repo, rel), content)
  }
})
afterEach(() => {
  resetKvCacheStore()
  fs.rmSync(repo, { recursive: true, force: true })
})

async function scan(settleWith: (call: StubCall) => DriverResult | Promise<DriverResult>) {
  const stub = stubDriver(async (call) => {
    switch (call.kind) {
      case CURATE_DOC_SESSION_KIND:
        return outcome({ keep: true, reason: 'spec', areas: [{ product: 'core', concern: 'checker' }] })
      case SETTLE_AREAS_SESSION_KIND:
        return outcome({ concernMerges: [], productMerges: [], productVerdicts: [], subdivisions: [] })
      case EXTRACT_CLAIMS_SESSION_KIND:
        return record(call, checkerClaim)
      case SETTLE_SUBJECTS_SESSION_KIND:
        return settleWith(call)
      case COMPARE_CLAIMS_SESSION_KIND:
        return compare(call)
      default:
        throw new Error(`unscripted ${call.kind} ${docPathOf(call.briefing)}`)
    }
  })
  const facts: Array<[string, string]> = []
  const result = await runSpecScanSessions({
    repoRoot: repo,
    driver: async () => stub.driver,
    persistence: memoryPersistence().persistence,
    skipGit: true,
    onFact: (step, line) => facts.push([step, line]),
  })
  return { result, stub, facts }
}

const briefingsOf = (calls: readonly StubCall[], kind: string): string[] => calls.filter((c) => c.kind === kind).map((c) => c.briefing)

describe('settling subjects through the run', () => {
  it('briefs names equal but for markup once, then compares the claims under their settled subjects', async () => {
    const { result, stub, facts } = await scan((call) => settle(call, (name) => (/checker/i.test(name) ? 'ATS checker' : null)))
    const [settleBriefing] = briefingsOf(stub.calls, SETTLE_SUBJECTS_SESSION_KIND)
    // "ATS checker", "ATS Checker" and "`ATS checker`" are one name before the
    // session runs, spelled as most of its claims spell it.
    expect(subjectNames(settleBriefing!)).toEqual([
      { id: 'S1', name: 'ATS checker', claims: 4 },
      { id: 'S2', name: 'resume checker', claims: 1 },
    ])
    const compared = briefingsOf(stub.calls, COMPARE_CLAIMS_SESSION_KIND).flatMap(compareBriefing)
    expect(compared.map((f) => f.subject)).toEqual(Array(5).fill('ATS checker'))
    expect(result.corpus.comparison).toEqual({
      subjectNames: 2,
      settledSubjects: 1,
      subjectFamilies: 0,
      subjectBatchFamilies: 0,
      subjectBatchClaims: 0,
      unplacedClaims: 0,
    })
    expect(facts).toContainEqual(['subjects', 'subject names: 2 names, 2 of them merged into 1 subject'])
    expect(facts).toContainEqual(['subjects', '5 claims: 2 subject names, 1 settled subject'])
  })

  it('merges nothing when its session fails: the claims keep their names as written', async () => {
    const { result, facts } = await scan(() => malformedFailure())
    expect(result.corpus.comparison).toMatchObject({ subjectNames: 2, settledSubjects: 2 })
    expect(facts).toContainEqual(['subjects', 'subject names: the session failed, its 2 names stay as written'])
    expect(result.stats.llmFailures).toEqual([expect.objectContaining({ stage: SETTLE_SUBJECTS_SESSION_KIND, failures: 1 })])
  })

  it('aborts on the one-abort rule when every settling session dies of transport', async () => {
    const error = await scan(() => transportFailure()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmStageFailureError)
    expect((error as LlmStageFailureError).tally.stage).toBe(SETTLE_SUBJECTS_SESSION_KIND)
  })

  it('serves the settlement from the cache on an unchanged re-run', async () => {
    await scan((call) => settle(call))
    const { stub, result } = await scan(() => {
      throw new Error('no settling session may run')
    })
    expect(stub.kinds).not.toContain(SETTLE_SUBJECTS_SESSION_KIND)
    expect(result.noChanges).toBe(true)
  })
})
