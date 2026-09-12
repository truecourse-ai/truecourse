/** Offline structural regression report; never initializes a model or application. */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { authoringFixture, FIXTURE_VERSION, missingDialogObservation } from '../tests/fixtures/guard-authoring-benchmark/fixture.js'
import type { TurnUsage } from '../packages/agent-loop/src/session-events.js'

export interface AttemptMetric { sessionId: string; parentId?: string; durationMs: number; costUsd: number; acceptedReviewed: number; coveredObligations: number }
/** Input events must already obey TurnUsage's disjoint input/cache buckets. */
export function summarizeUsageEvents(events: { sessionId: string; eventId: string; usage: TurnUsage }[]) {
  const unique = [...new Map(events.map(e => [`${e.sessionId}:${e.eventId}`, e])).values()]
  if (!unique.length) return { usage: null, reason: 'No assistant-turn usage events were supplied.' }
  const sum = (key: keyof Pick<TurnUsage, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheCreateTokens' | 'costUsd'>) => unique.reduce((n, e) => n + e.usage[key], 0)
  const usage = { inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), cacheReadTokens: sum('cacheReadTokens'),
    cacheCreateTokens: sum('cacheCreateTokens'), reasoningTokens: unique.every(e => e.usage.reasoningTokens !== undefined)
      ? unique.reduce((n, e) => n + e.usage.reasoningTokens!, 0) : null,
    costUsd: unique.some(e => e.usage.costSource === 'unpriced') ? null : sum('costUsd'),
    costSources: [...new Set(unique.map(e => e.usage.costSource))].sort() }
  return { usage: { ...usage, totalTokens: usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreateTokens }, reason: null }
}
export function summarizeAttempts(attempts: AttemptMetric[], wallTimeMs: number) {
  const unique = [...new Map(attempts.map(a => [a.sessionId, a])).values()]
  const costUsd = unique.reduce((s, a) => s + a.costUsd, 0)
  const acceptedReviewed = unique.reduce((s, a) => s + a.acceptedReviewed, 0)
  const coveredObligations = unique.reduce((s, a) => s + a.coveredObligations, 0)
  return { costUsd, acceptedReviewed, coveredObligations, wallTimeMs,
    summedSessionDurationMs: unique.reduce((s, a) => s + a.durationMs, 0),
    costPerAcceptedReviewed: acceptedReviewed ? costUsd / acceptedReviewed : null,
    wallMsPerAcceptedReviewed: acceptedReviewed ? wallTimeMs / acceptedReviewed : null,
    costPerCoveredObligation: coveredObligations ? costUsd / coveredObligations : null,
    wallMsPerCoveredObligation: coveredObligations ? wallTimeMs / coveredObligations : null }
}

export async function offlineReport(revision: string | null = null) {
  const { createAuthorCatalog, scopedAuthorResources } = await import('../packages/guard-generator/src/author-catalog.js')
  const { buildAuthorUserPrompt } = await import('../packages/guard-generator/src/prompts.js')
  const { flowWorkerSystemPrompt } = await import('../packages/core/src/services/guard-generate/flow-worker.js')
  const { compareFailureObservations } = await import('../packages/guard-generator/src/failure-observation.js')
  const { canonicalWebObservationUrl } = await import('../packages/guard-runner/src/web/executor.js')
  const f = authoringFixture()
  const catalog = createAuthorCatalog(f.interfaces, f.resources)
  const candidates = catalog.candidates([f.own], 'organisation creation dialog')
  const briefing = buildAuthorUserPrompt({ ...f.context, resources: scopedAuthorResources([f.own], f.resources), webSetupCandidates: candidates })
  let peakToolResultChars = 0
  let lookupCalls = 0
  let pages = 0
  let cursor: string | undefined
  const ids: string[] = []
  do {
    const result = catalog.search({ query: '', limit: 20, ...(cursor ? { cursor } : {}) })
    if (result.isError) throw new Error(result.content)
    lookupCalls++; pages++; peakToolResultChars = Math.max(peakToolResultChars, result.content.length)
    const page = JSON.parse(result.content)
    ids.push(...page.items.map((i: { id: string }) => i.id))
    cursor = page.nextCursor
  } while (cursor)
  const fetch = catalog.get({ ids: [f.late.id] })
  if (fetch.isError) throw new Error(fetch.content)
  lookupCalls++; peakToolResultChars = Math.max(peakToolResultChars, fetch.content.length)
  const unavailable = 'Structural offline replay does not execute a model, candidate, fidelity judge, or upstream cache.'
  const observed = missingDialogObservation()
  const initialUtf8Bytes = Buffer.byteLength(flowWorkerSystemPrompt('web') + briefing, 'utf8')
  const sameOrigin = canonicalWebObservationUrl('http://localhost:31001/plans?limit=5', 'http://localhost:31001', 'web') ===
    canonicalWebObservationUrl('http://localhost:32002/plans?limit=5', 'http://localhost:32002', 'web')
  const cases = [
    { id: 'organisation-dialog', assertion: 'same typed missing-dialog result reproduces', passed: compareFailureObservations(observed, structuredClone(observed)) === undefined },
    { id: 'cross-screen-members', assertion: 'member action remains discoverable outside shortlist', passed: ids.includes(f.late.id) && !candidates.some(i => i.id === f.late.id) },
    { id: 'plan-limit-origin', assertion: 'only runner-owned origin changes normalize', passed: sameOrigin },
    { id: 'role-prerequisite', assertion: 'login redirect does not equal authenticated-page evidence', passed: compareFailureObservations(observed, { ...observed, page: 'guard-server://web/login' }) !== undefined },
    { id: 'large-catalog', assertion: 'all catalog actions retrieved within payload bounds', passed: ids.length === f.interfaces.length && initialUtf8Bytes <= 120000 && peakToolResultChars <= 12000 },
    { id: 'different-failure', assertion: 'different dialog remains a different failure', passed: compareFailureObservations(observed, { ...observed, locator: { role: 'dialog', name: 'Delete organisation' } }) !== undefined },
  ]
  return { schemaVersion: 1, fixtureVersion: FIXTURE_VERSION, mode: 'offline' as const, revision,
    execution: 'scripted catalog and briefing replay', model: null,
    initialUtf8Bytes, cases,
    peakToolResultChars, lookupCalls, lookupMisses: 0, lookupPages: pages,
    catalogActions: f.interfaces.length, retrievedActions: ids.length,
    lateEntryRetrieved: ids.includes(f.late.id), lateEntryOutsideShortlist: !candidates.some(i => i.id === f.late.id),
    selectedObligations: f.context.milestones.map(m => m.claim),
    modelTurns: null, workerTasks: null, runAttempts: null, submitAttempts: null, acceptedScenarios: null,
    failed: null, blocked: null, unreviewed: null, reviewedObligationCoverage: null,
    cacheByStage: { extract: null, flows: null, match: null, author: null },
    costPerAcceptedReviewed: null, timePerAcceptedReviewed: null, costPerCoveredObligation: null,
    timePerCoveredObligation: null, missingMetricReason: unavailable }
}

export async function benchmarkMain(args: string[]) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: pnpm exec tsx scripts/benchmark-guard-authoring.ts --offline --output /tmp/report.json\nNo model, app server, or database is contacted.\n')
    return
  }
  if (args.length !== 3 || args[0] !== '--offline' || args[1] !== '--output' || !args[2]) throw new Error('Use --help; only --offline --output <file> is supported.')
  let revision: string | null = null
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { /* source archive */ }
  fs.writeFileSync(path.resolve(args[2]), JSON.stringify(await offlineReport(revision), null, 2) + '\n', { flag: 'wx' })
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // Workspace packages expose their source through this explicit condition.
  // Re-enter using Node's tsx loader, which creates no CLI IPC listener.
  if (!process.execArgv.includes('--conditions=truecourse-source') && process.argv[2] !== '--help') {
    try { execFileSync(process.execPath, ['--conditions=truecourse-source', '--import', 'tsx', process.argv[1], ...process.argv.slice(2)], { stdio: 'inherit' }) }
    catch { process.exitCode = 1 }
  } else benchmarkMain(process.argv.slice(2)).catch(e => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1 })
}
