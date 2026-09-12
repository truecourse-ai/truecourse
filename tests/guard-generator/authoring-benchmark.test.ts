import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { offlineReport, summarizeAttempts, summarizeUsageEvents } from '../../scripts/benchmark-guard-authoring.js'
import { authoringFixture, missingDialogObservation } from '../fixtures/guard-authoring-benchmark/fixture.js'
import { createAuthorCatalog } from '../../packages/guard-generator/src/author-catalog.js'
import { compareFailureObservations } from '../../packages/guard-generator/src/failure-observation.js'
import { canonicalWebObservationUrl } from '../../packages/guard-runner/src/web/executor.js'
import type { GuardFailureObservation } from '../../packages/shared/src/guard/failure-observation.js'

const target = missingDialogObservation

describe('offline authoring structural benchmark — no model or application execution', () => {
  it('organisation: matching missing-dialog observations reproduce independently of display prose', () => {
    expect(compareFailureObservations(target(), structuredClone(target()))).toBeUndefined()
  })
  it('cross-screen team setup remains discoverable outside the candidate shortlist', () => {
    const f = authoringFixture(); const c = createAuthorCatalog(f.interfaces, f.resources)
    expect(c.candidates([f.own], 'organisation creation dialog').some(x => x.id === f.late.id)).toBe(false)
    const page = JSON.parse(c.search({ query: 'Invite member' }).content)
    expect(page.items.map((x: { id: string }) => x.id)).toContain(f.late.id)
    const fetched = JSON.parse(c.get({ ids: [f.late.id] }).content)
    expect(fetched.complete).toBe(true)
    expect(fetched.items.some((x: { value: unknown }) => x.value === '/teams/members')).toBe(true)
  })
  it('plan-limit: only the runner-owned origin may change during confirmation', () => {
    const a = canonicalWebObservationUrl('http://localhost:31001/plans?limit=5', 'http://localhost:31001', 'web')
    const b = canonicalWebObservationUrl('http://localhost:32002/plans?limit=5', 'http://localhost:32002', 'web')
    const text: GuardFailureObservation = { version: 1, kind: 'web-text', assertion: 'text:0', page: a,
      matcher: { contains: 'Maximum 5 members' }, operator: 'contains', observed: false,
      textDigest: `sha256:${createHash('sha256').update('Plan limit reached').digest('hex')}` }
    expect(compareFailureObservations(text, { ...text, page: b })).toBeUndefined()
    expect(compareFailureObservations(text, { ...text, page: b.replace('limit=5', 'limit=6') })).toBeTruthy()
  })
  it('role permissions: login redirect must not equal an observation from the required authenticated page', () => {
    expect(compareFailureObservations(target(), { ...target(), page: 'guard-server://web/login' })).toBeTruthy()
    // Comparison alone is never counted as accepted/reviewed coverage.
    expect(summarizeAttempts([], 0).costPerAcceptedReviewed).toBeNull()
  })
  it('large catalog: pages retrieve all 1,202 entries within byte/result limits without losing claims', async () => {
    const report = await offlineReport('synthetic-revision')
    expect(report).toMatchObject({ mode: 'offline', catalogActions: 1202, retrievedActions: 1202, lateEntryRetrieved: true, lateEntryOutsideShortlist: true })
    expect(report.initialUtf8Bytes).toBeLessThanOrEqual(120000)
    expect(report.peakToolResultChars).toBeLessThanOrEqual(12000)
    expect(report.lookupPages).toBeGreaterThan(1)
    expect(report.selectedObligations).toEqual(['Creating an organisation displays its dialog'])
    expect(report.modelTurns).toBeNull(); expect(report.acceptedScenarios).toBeNull()
    expect(report.missingMetricReason).toContain('does not execute')
    expect(report.cases).toHaveLength(6)
    expect(report.cases.every(c => c.passed)).toBe(true)
  })
  it('uses live turn events, counts cached inputs once, and keeps reasoning a subset of output', () => {
    const event = { sessionId: 'worker', eventId: 'turn-1', usage: { inputTokens: 10, outputTokens: 20,
      cacheReadTokens: 30, cacheCreateTokens: 40, reasoningTokens: 5, costUsd: 1, costSource: 'model-priced' as const } }
    expect(summarizeUsageEvents([event, event]).usage).toMatchObject({ totalTokens: 100, reasoningTokens: 5, costUsd: 1 })
    expect(summarizeUsageEvents([]).usage).toBeNull()
    expect(summarizeUsageEvents([{ ...event, usage: { ...event.usage, costSource: 'unpriced' } }]).usage?.costUsd).toBeNull()
  })
  it('semantically different failures with similar prose do not reproduce', () => {
    expect(compareFailureObservations(target(), { ...target(), locator: { role: 'dialog', name: 'Delete organisation' } })).toBeTruthy()
    expect(compareFailureObservations(target(), { ...target(), matchCount: 1, reason: 'hidden' })).toBeTruthy()
  })
  it('includes failed attempts in cost and counts children once without summing overlap as wall time', () => {
    const attempts = [
      { sessionId: 'failed', durationMs: 900, costUsd: 3, acceptedReviewed: 0, coveredObligations: 0 },
      { sessionId: 'worker', durationMs: 600, costUsd: 2, acceptedReviewed: 2, coveredObligations: 3 },
      { sessionId: 'review', parentId: 'worker', durationMs: 200, costUsd: 1, acceptedReviewed: 0, coveredObligations: 0 },
    ]
    expect(summarizeAttempts([...attempts, attempts[2]], 1000)).toEqual({ costUsd: 6, acceptedReviewed: 2,
      coveredObligations: 3, wallTimeMs: 1000, summedSessionDurationMs: 1700, costPerAcceptedReviewed: 3,
      wallMsPerAcceptedReviewed: 500, costPerCoveredObligation: 2, wallMsPerCoveredObligation: 1000 / 3 })
    expect(summarizeAttempts([attempts[0]], 900).costPerAcceptedReviewed).toBeNull()
  })
  it('CLI help and output report require no provider and refuse overwriting an existing report', () => {
    const run = (...args: string[]) => execFileSync(process.execPath, ['--conditions=truecourse-source', '--import', 'tsx',
      'scripts/benchmark-guard-authoring.ts', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    expect(run('--help')).toContain('--offline --output')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-benchmark-report-'))
    try {
      const output = path.join(dir, 'report.json'); run('--offline', '--output', output)
      expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({ schemaVersion: 1, mode: 'offline', model: null })
      expect(() => run('--offline', '--output', output)).toThrow()
      expect(() => run('--live', '--output', output)).toThrow()
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
