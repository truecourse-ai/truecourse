/**
 * THE GUARD-GENERATE SESSION SEAMS — the implementations `@truecourse/core`
 * injects into `generateGuards` for plan 04 steps 15 (claim extraction) and 16
 * (flow synthesis). The engine (`@truecourse/guard-generator`) declares the
 * seam TYPES and keeps the deterministic spine; this module owns everything
 * session-shaped: the pool, the cache, the run record, the driver.
 *
 * Discipline (the spec-scan template, `services/spec-scan/run.ts`):
 * - the cache is probed BEFORE a session is spent — only cache-missing items
 *   enter the pool, and only completed outcomes are written back;
 * - a completed outcome the engine's checker REFUSES (flows: unknown
 *   references / uncovered claims) is converted to a `malformed` failure
 *   before fold and cache — a refusal must cost a re-run next time, never
 *   poison the cache into refusing forever;
 * - the driver and the sessions-store run record are built LAZILY, on the
 *   first session that actually runs — a fully-cached generate constructs
 *   neither (and an api-mode config error surfaces as the seam's failure, not
 *   a crashed generate);
 * - tools never write repo/store state; every write stays in `generateGuards`.
 */

import path from 'node:path'
import { createHash } from 'node:crypto'
import type { z } from 'zod'
import type {
  SessionDef,
  SessionDriver,
  SessionEvent,
  SessionOutcome,
  SessionPersistence,
} from '@truecourse/agent-loop'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import { ExtractOutcomeSchema, type ExtractOutcome, type GuardFlowWorkerOutcome } from '@truecourse/shared'
import {
  checkEpicSet,
  checkFlowSet,
  snapExtraction,
  flowSectionKey,
  EpicSynthesisSchema,
  FlowSetSchema,
  type ExtractResult,
  type ExtractSessionSeam,
  type FlowsAreaSessionResult,
  type FlowsAreaSessionSeam,
  type FlowsEpicSessionResult,
  type FlowsEpicSessionSeam,
  type FlowWorkerSessionResult,
  type FlowWorkerSessionSeam,
  type FlowWorkerTask,
  type GuardDoc,
  type GuardSessionSummary,
} from '@truecourse/guard-generator'
import { createSessionRun, type SessionRunStore } from '../../lib/sessions-store.js'
import { resolveCommitSha } from '../../lib/repo-ref.js'
import { createConfiguredSessionDriver } from '../llm/session-driver.js'
import type { LlmTransportFlag } from '../../config/global-config.js'
import { cachedSessionOutcome } from '../agent/session-cache.js'
import { runSessionPool } from '../agent/session-pool.js'
import { describeSessionFailure } from '../guard-setup/session-context.js'
import { buildGuardDocUniverse } from './tools.js'
import {
  EXTRACT_SESSION_CACHE_NAME,
  EXTRACT_SESSION_KIND,
  extractSessionBriefing,
  extractSessionCacheKey,
  extractSessionDef,
  extractSessionWorkItem,
} from './extract.js'
import {
  FLOWS_EPIC_WORK_ITEM,
  FLOWS_SESSION_CACHE_NAME,
  FLOWS_SESSION_KIND,
  flowSetRefusalReason,
  flowsEpicSessionBriefing,
  flowsEpicSessionCacheKey,
  flowsEpicSessionDef,
  flowsSessionBriefing,
  flowsSessionCacheKey,
  flowsSessionDef,
  flowsSessionWorkItem,
  type FlowsCheckerContext,
} from './flows.js'
import {
  CachedWorkerEntrySchema,
  FLOW_WORKER_CACHE_NAME,
  FLOW_WORKER_SESSION_KIND,
  cacheableWorkerOutcome,
  flowWorkerCacheKey,
  flowWorkerSessionDef,
  type CachedWorkerEntry,
} from './flow-worker.js'
import { FIDELITY_SESSION_KIND, emptyFidelityTally, judgeWorkerFidelity } from './fidelity.js'

// ---------------------------------------------------------------------------
// The lazy per-run session context. A sibling of guard-setup's
// (`services/guard-setup/session-context.ts`) rather than a reuse: that one
// hardcodes its command + report accounting, and this run's adapter only needs
// acquire/finish. ONE run record covers every session of the generate
// invocation (`sessions/guard-generate/<runId>/`).
// ---------------------------------------------------------------------------

export interface AcquiredContext {
  driver: SessionDriver
  persistence: SessionPersistence
}

export interface GuardGenerateSessionSeams {
  extractSession: ExtractSessionSeam
  flowsAreaSession: FlowsAreaSessionSeam
  flowsEpicSession: FlowsEpicSessionSeam
  /** The flow-worker pool (plan 04 steps 17 + 18) — waves, cache, fidelity children. */
  flowWorkerSession: FlowWorkerSessionSeam
  /** The run id, once a session has run; undefined on a fully-cached run. */
  runId(): string | undefined
  /** Close the run record (when one was created). `failed` only when every
   *  session failed; the command adapter calls this exactly once. */
  finish(aborted: boolean): void
}

export interface CreateGuardGenerateSeamsOptions {
  repoRoot: string
  /** A per-run `--llm-transport` flag; the saved selection answers otherwise. */
  transport?: LlmTransportFlag
  /** Ceiling on concurrent sessions per pool (the governor may run fewer). */
  concurrency?: number
  /** Every transcript event as it is persisted — the CLI's live line. */
  onSessionEvent?: (workItem: string, event: SessionEvent) => void
  /**
   * Test seam: a lazy thunk overriding the internal
   * `createConfiguredSessionDriver` path — the spec-scan analog's shape, plus
   * persistence, because production ties persistence to the run record. When
   * injected, NO sessions-store run record is created (the spec-scan
   * precedent: whoever owns the driver owns the run record — there the
   * command adapter injects both and creates the record itself), so `runId()`
   * stays undefined and `finish()` is a no-op.
   */
  driver?: () => Promise<AcquiredContext>
}

// ---------------------------------------------------------------------------
// The cached session pool (the spec-scan shape plus `rejectOutput`).
// ---------------------------------------------------------------------------

interface CachedPoolResult<TOutcome> {
  outcome: SessionOutcome<TOutcome> & { fromCache?: true }
}

interface CachedPoolOptions<TItem, TOutcome> {
  repoRoot: string
  kind: string
  cacheName: string
  items: readonly TItem[]
  workItem(item: TItem): string
  cacheKey(item: TItem): string
  schema: z.ZodType<TOutcome>
  session(item: TItem): SessionDef<TOutcome>
  briefing(item: TItem): string
  driver(): Promise<AcquiredContext>
  concurrency?: number
  onSessionEvent?: (workItem: string, event: SessionEvent) => void
  /**
   * Engine validation of a fresh COMPLETED outcome, run BEFORE fold and cache.
   * A returned reason converts the outcome to a `malformed` failure — the
   * session had its chances (`check_flows` told it in-session) — so a refused
   * value is never cached and the item lands failed, exactly one re-run away.
   */
  rejectOutput?: (item: TItem, output: TOutcome) => string | null
  /** Strictly serial across items: hits in item order (before the pool), fresh
   *  outcomes in the pool's serial fold. */
  fold(item: TItem, result: CachedPoolResult<TOutcome>): void
}

/**
 * A driver that could not even be constructed (the api-mode config error the
 * module header names) as a transport-class session failure: the pool stamps
 * it on EVERY pending item, so a systemic loss aborts the run as `llm-failed`
 * through the existing channel instead of a crashed generate. The error text
 * rides `detail` verbatim — `firstError` must name the actual config problem.
 */
function driverConstructionFailure(error: unknown): Extract<SessionOutcome<never>, { status: 'failed' }> {
  return {
    status: 'failed',
    failure: {
      kind: 'transport',
      detail: `the session driver could not be constructed: ${error instanceof Error ? error.message : String(error)}`,
      class: 'unknown',
      // `none`: retrying an unconstructible driver in-run cannot help — the
      // user fixes the config and the next RUN re-attempts (nothing cached).
      retryability: 'none',
    },
    resumable: false,
    spent: { turns: 0, tokens: 0, costUsd: 0 },
  }
}

/**
 * Run one session per cache-missing item and hand every item's outcome —
 * cached or fresh — to the caller's fold, summarized per kind. The cache
 * read/write goes through `cachedSessionOutcome` (schema-gated reads; only
 * completed outputs written; failures never cached); the pool mechanics
 * (permits, throttle governor, transient re-queue, event tee) are
 * `runSessionPool`'s.
 */
async function runCachedGuardPool<TItem, TOutcome>(
  opts: CachedPoolOptions<TItem, TOutcome>,
): Promise<GuardSessionSummary> {
  const summary: GuardSessionSummary = {
    kind: opts.kind,
    ran: 0,
    fromCache: 0,
    failed: 0,
    allTransport: true,
    spent: { turns: 0, tokens: 0, costUsd: 0 },
  }
  const toRun: TItem[] = []
  const resolvers = new Map<string, (o: SessionOutcome<TOutcome>) => void>()
  const finals: Promise<void>[] = []

  // Probe phase, sequential: a hit folds immediately; a miss registers itself
  // for the pool and parks its outer promise on a deferred the pool's fold
  // resolves. `decided` settles per item as soon as hit-vs-miss is known, so
  // the probes never serialize behind a session.
  for (const item of opts.items) {
    const id = opts.workItem(item)
    let decide!: () => void
    const decided = new Promise<void>((resolve) => (decide = resolve))
    const outcomePromise = cachedSessionOutcome<TOutcome>({
      repoRoot: opts.repoRoot,
      cacheName: opts.cacheName,
      key: opts.cacheKey(item),
      schema: opts.schema,
      run: () => {
        toRun.push(item)
        decide()
        return new Promise<SessionOutcome<TOutcome>>((resolve) => resolvers.set(id, resolve))
      },
    })
    finals.push(
      outcomePromise.then((outcome) => {
        if (outcome.fromCache) {
          summary.fromCache++
          opts.fold(item, { outcome })
          decide()
        }
      }),
    )
    await decided
  }

  if (toRun.length > 0) {
    // The construction guard the module header promises: a driver that cannot
    // be built fails every pending item transport-class (same `firstError`),
    // never escapes the seam as a thrown error.
    let acquired: AcquiredContext
    try {
      acquired = await opts.driver()
    } catch (e) {
      const outcome = driverConstructionFailure(e)
      for (const item of toRun) {
        summary.ran++
        summary.failed++
        summary.firstError ??= describeSessionFailure(outcome.failure)
        opts.fold(item, { outcome })
        resolvers.get(opts.workItem(item))!(outcome)
      }
      await Promise.all(finals)
      return summary
    }
    const { driver, persistence } = acquired
    await runSessionPool<TItem, TOutcome>({
      items: toRun,
      workItem: opts.workItem,
      session: opts.session,
      briefing: (item) => [opts.briefing(item)],
      driver,
      persistence,
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
      fold: (item, outcome) => {
        summary.ran++
        summary.spent.turns += outcome.spent.turns
        summary.spent.tokens += outcome.spent.tokens
        summary.spent.costUsd += outcome.spent.costUsd
        // The engine's refusal: a completed outcome its checker rejects becomes
        // a malformed failure BEFORE fold and cache (see `rejectOutput`).
        let settled = outcome
        if (settled.status === 'completed' && opts.rejectOutput) {
          const reason = opts.rejectOutput(item, settled.output)
          if (reason !== null) {
            settled = {
              status: 'failed',
              // `none`: a refusal is not a retry candidate — the next RUN
              // re-attempts it (the failure was never cached).
              failure: { kind: 'malformed', detail: reason, retryability: 'none' },
              resumable: false,
              spent: settled.spent,
            }
          }
        }
        if (settled.status === 'failed') {
          summary.failed++
          summary.firstError ??= describeSessionFailure(settled.failure)
          if (settled.failure.kind !== 'transport') summary.allTransport = false
        }
        opts.fold(item, { outcome: settled })
        // Settle the outer cachedSessionOutcome promise — it writes the cache
        // for a completed outcome; a failure (including a refusal) passes
        // through uncached.
        resolvers.get(opts.workItem(item))!(settled)
      },
    })
  }
  await Promise.all(finals)
  return summary
}

// ---------------------------------------------------------------------------
// The seams
// ---------------------------------------------------------------------------

export function createGuardGenerateSessionSeams(
  opts: CreateGuardGenerateSeamsOptions,
): GuardGenerateSessionSeams {
  let acquired: Promise<{ run: SessionRunStore; driver: SessionDriver }> | null = null
  let run: SessionRunStore | null = null
  let completed = 0
  let failed = 0

  const build = async (): Promise<{ run: SessionRunStore; driver: SessionDriver }> => {
    const gitRef = await resolveCommitSha(opts.repoRoot)
    const store = createSessionRun(opts.repoRoot, { command: 'guard-generate', gitRef })
    const { driver, mode, attribution } = createConfiguredSessionDriver({
      ...(opts.transport ? { transport: opts.transport } : {}),
      cwd: opts.repoRoot,
      providerStateDir: path.join(store.dir, 'provider'),
    })
    store.setLlm({
      mode,
      provider: attribution.provider,
      model: attribution.model,
      ...(attribution.fallbackModel ? { fallbackModel: attribution.fallbackModel } : {}),
    })
    run = store
    return { run: store, driver }
  }
  // An injected driver (`opts.driver`, the test seam) brings its own
  // persistence and creates NO run record — `run` stays null, so `runId()`
  // returns undefined and `finish` no-ops. The internal path builds both.
  const acquire = opts.driver ?? (async (): Promise<AcquiredContext> => {
    // A failed build is retried on the next acquire rather than memoized: an
    // earlier seam's config error must not poison a later one after a fix.
    if (!acquired) acquired = build().catch((e) => ((acquired = null), Promise.reject(e)))
    const { run: store, driver } = await acquired
    return { driver, persistence: store.persistence }
  })
  const note = (summary: GuardSessionSummary): void => {
    completed += summary.ran - summary.failed
    failed += summary.failed
  }

  const extractSession: ExtractSessionSeam = async (input) => {
    const universe = buildGuardDocUniverse(input.docs)
    const byDoc = new Map<string, ExtractResult>()
    let done = 0
    const total = input.docs.length
    input.onDoc?.(0, total)
    const summary = await runCachedGuardPool<GuardDoc, ExtractOutcome>({
      repoRoot: opts.repoRoot,
      kind: EXTRACT_SESSION_KIND,
      cacheName: EXTRACT_SESSION_CACHE_NAME,
      items: input.docs,
      workItem: (doc) => extractSessionWorkItem(doc.doc),
      cacheKey: (doc) => extractSessionCacheKey(doc),
      schema: ExtractOutcomeSchema,
      session: (doc) => extractSessionDef({ doc, universe }),
      briefing: (doc) => extractSessionBriefing(doc),
      driver: acquire,
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
      fold: (doc, result) => {
        if (result.outcome.status === 'completed') {
          // THE FOLD RE-SNAP: the cache holds the raw outcome (model anchors),
          // and the snap runs here on hit and fresh alike — so a section
          // renamed since the entry was written still binds correctly today.
          byDoc.set(doc.doc, {
            ok: true,
            data: snapExtraction(result.outcome.output, doc.sections),
            complete: true,
            failedViews: 0,
          })
        } else {
          byDoc.set(doc.doc, {
            ok: false,
            reason: `extraction session failed: ${describeSessionFailure(result.outcome.failure)}`,
          })
        }
        input.onDoc?.(++done, total)
      },
    })
    note(summary)
    return { byDoc, summary }
  }

  const flowsAreaSession: FlowsAreaSessionSeam = async (input) => {
    const universe = buildGuardDocUniverse(input.docs ?? [])
    const checker: FlowsCheckerContext = {
      sectionKeys: new Set(
        (input.docs ?? []).flatMap((d) => d.sections.map((s) => flowSectionKey(s.doc, s.anchor))),
      ),
      catalogNames: new Set((input.grounding?.dependencies ?? []).map((d) => d.name)),
    }
    const byArea = new Map<string, FlowsAreaSessionResult>()
    const summary = await runCachedGuardPool({
      repoRoot: opts.repoRoot,
      kind: FLOWS_SESSION_KIND,
      cacheName: FLOWS_SESSION_CACHE_NAME,
      items: input.areas,
      workItem: (area) => flowsSessionWorkItem(area.areaId),
      cacheKey: (area) => flowsSessionCacheKey(area),
      schema: FlowSetSchema,
      session: (area) => flowsSessionDef({ area, universe, checker }),
      briefing: (area) => flowsSessionBriefing(area, input.grounding),
      driver: acquire,
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
      // The fold-side refusal (never trust the transcript): the SAME checker
      // `check_flows` ran in-session, so a draft that checked clean lands clean.
      rejectOutput: (area, output) =>
        flowSetRefusalReason(checkFlowSet(output, { area, sectionKeys: checker.sectionKeys, catalogNames: checker.catalogNames })),
      fold: (area, result) => {
        if (result.outcome.status === 'completed') {
          byArea.set(area.areaId, {
            ok: true,
            value: result.outcome.output,
            ...(result.outcome.fromCache ? { fromCache: true } : {}),
            inputsKey: flowsSessionCacheKey(area),
          })
        } else {
          byArea.set(area.areaId, {
            ok: false,
            reason: `flows session failed: ${describeSessionFailure(result.outcome.failure)}`,
          })
        }
        input.onArea?.(area.areaId)
      },
    })
    note(summary)
    return { byArea, summary }
  }

  const flowsEpicSession: FlowsEpicSessionSeam = async (input) => {
    let result: FlowsEpicSessionResult = {
      ok: false,
      reason: 'the epic session produced no result',
    }
    const summary = await runCachedGuardPool({
      repoRoot: opts.repoRoot,
      kind: FLOWS_SESSION_KIND,
      cacheName: FLOWS_SESSION_CACHE_NAME,
      items: [FLOWS_EPIC_WORK_ITEM],
      workItem: () => FLOWS_EPIC_WORK_ITEM,
      cacheKey: () => flowsEpicSessionCacheKey(input.digests),
      schema: EpicSynthesisSchema,
      session: () => flowsEpicSessionDef({ digests: input.digests, claims: input.claims }),
      briefing: () => flowsEpicSessionBriefing(input.digests),
      driver: acquire,
      concurrency: 1,
      ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
      rejectOutput: (_item, output) => {
        const { unknownReferences } = checkEpicSet(output, input.digests, input.claims)
        return unknownReferences.length > 0 ? `epic pass refused: ${unknownReferences[0]}` : null
      },
      fold: (_item, poolResult) => {
        if (poolResult.outcome.status === 'completed') {
          result = {
            ok: true,
            value: poolResult.outcome.output,
            ...(poolResult.outcome.fromCache ? { fromCache: true } : {}),
            inputsKey: flowsEpicSessionCacheKey(input.digests),
          }
        } else {
          result = {
            ok: false,
            reason: `epic session failed: ${describeSessionFailure(poolResult.outcome.failure)}`,
          }
        }
      },
    })
    note(summary)
    return { result, summary }
  }

  // The flow-worker pool (plan 04 steps 17 + 18). Not `runCachedGuardPool`:
  // the worker cache holds MORE than the outcome (the settled yaml), a cached
  // `settled` must survive a fresh confirmation run before it counts as a hit,
  // and the two WAVES (non-epic, then epic — a true barrier, so an epic's
  // briefing sees its members' settled scenarios) don't fit the generic shape.
  const flowWorkerSession: FlowWorkerSessionSeam = async (input) => {
    const universe = buildGuardDocUniverse(input.docs)
    const summary: GuardSessionSummary = {
      kind: FLOW_WORKER_SESSION_KIND,
      ran: 0,
      fromCache: 0,
      failed: 0,
      allTransport: true,
      spent: { turns: 0, tokens: 0, costUsd: 0 },
    }
    const fidelityTally = emptyFidelityTally()
    const byTask = new Map<string, FlowWorkerSessionResult>()
    const total = input.tasks.length + input.epicTasks.length
    let done = 0
    input.onTask?.(0, total)
    // Each tick carries the task's outcome kind so the engine can render a live
    // `settled n · blocked m` tally beside the counter.
    const tick = (kind?: GuardFlowWorkerOutcome['kind'] | 'failed'): void => input.onTask?.(++done, total, kind)
    const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex')

    const runWave = async (wave: readonly FlowWorkerTask[]): Promise<void> => {
      if (wave.length === 0) return
      const misses: FlowWorkerTask[] = []
      for (const task of wave) {
        // A tainted flow SKIPS the cache read — the entry still holds the
        // rejected scenario, and re-serving it would re-flag and treadmill.
        const hit = task.taint
          ? null
          : await getCacheEntry(opts.repoRoot, FLOW_WORKER_CACHE_NAME, flowWorkerCacheKey(task)).catch(() => null)
        if (hit !== null) {
          const parsed = CachedWorkerEntrySchema.safeParse(hit)
          if (parsed.success) {
            const { outcome, scenarioYaml } = parsed.data
            if (outcome.kind === 'blocked') {
              summary.fromCache++
              byTask.set(task.workItem, { kind: 'outcome', outcome, fromCache: true })
              tick('blocked')
              continue
            }
            if (
              outcome.kind === 'settled' &&
              scenarioYaml !== undefined &&
              sha256Hex(scenarioYaml) === outcome.scenarioYamlSha
            ) {
              // The cached-settled VERIFICATION (mirror of recipe-cache-
              // verifies): one fresh, deterministic confirmation run before
              // the hit stands — it catches world drift the key cannot see.
              // Drift means the entry is a MISS and the session runs. The `!`
              // stands on the flattened outcome schema's superRefine: a parsed
              // `settled` always carries `expectedReds`.
              if (await task.confirmCached(scenarioYaml, outcome.expectedReds!)) {
                summary.fromCache++
                byTask.set(task.workItem, { kind: 'outcome', outcome, fromCache: true })
                tick('settled')
                continue
              }
            }
          }
        }
        misses.push(task)
      }
      if (misses.length === 0) return
      // Briefings BEFORE the pool: they capture ground probes (async work the
      // pool's synchronous `briefing` callback cannot do). Sequential on
      // purpose — cli briefings spawn probe sandboxes, and a stampede of them
      // is exactly what the probe cache exists to avoid paying twice.
      const briefings = new Map<string, string>()
      for (const task of misses) briefings.set(task.workItem, await task.prepare())
      // The same construction guard `runCachedGuardPool` applies: an
      // unconstructible driver fails every miss of the wave transport-class
      // instead of crashing the generate.
      let acquiredCtx: AcquiredContext
      try {
        acquiredCtx = await acquire()
      } catch (e) {
        const outcome = driverConstructionFailure(e)
        const reason = describeSessionFailure(outcome.failure)
        for (const task of misses) {
          summary.ran++
          summary.failed++
          summary.firstError ??= reason
          byTask.set(task.workItem, { kind: 'failed', reason })
          tick('failed')
        }
        return
      }
      const { driver, persistence } = acquiredCtx
      await runSessionPool<FlowWorkerTask, GuardFlowWorkerOutcome>({
        items: misses,
        workItem: (t) => t.workItem,
        session: (t) =>
          flowWorkerSessionDef({
            task: t,
            judgeWith: (ctx) => (fidelityInput) =>
              judgeWorkerFidelity({
                repoRoot: opts.repoRoot,
                universe,
                ctx,
                input: fidelityInput,
                tally: fidelityTally,
              }),
          }),
        briefing: (t) => [briefings.get(t.workItem)!],
        driver,
        persistence,
        ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
        ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
        fold: async (task, outcome) => {
          summary.ran++
          summary.spent.turns += outcome.spent.turns
          summary.spent.tokens += outcome.spent.tokens
          summary.spent.costUsd += outcome.spent.costUsd
          // The engine's refusal: a `settled` outcome referencing a sha the
          // engine never accepted becomes `malformed` BEFORE fold and cache.
          // (The `!`s here and below stand on the flattened outcome schema's
          // superRefine: a parsed `settled` always carries its sha.)
          let settled = outcome
          if (
            settled.status === 'completed' &&
            settled.output.kind === 'settled' &&
            !task.hasStash(settled.output.scenarioYamlSha!)
          ) {
            settled = {
              status: 'failed',
              failure: {
                kind: 'malformed',
                detail: 'the settled outcome references a sha the engine never accepted',
                retryability: 'none',
              },
              resumable: false,
              spent: settled.spent,
            }
          }
          if (settled.status === 'failed') {
            summary.failed++
            summary.firstError ??= describeSessionFailure(settled.failure)
            if (settled.failure.kind !== 'transport') summary.allTransport = false
            byTask.set(task.workItem, { kind: 'failed', reason: describeSessionFailure(settled.failure) })
            tick('failed')
          } else {
            byTask.set(task.workItem, { kind: 'outcome', outcome: settled.output })
            // Only settled + blocked enter the cache; a settled entry carries
            // the STASHED yaml (the sha references run state that dies with
            // the run). Failures are never cached.
            if (cacheableWorkerOutcome(settled.output)) {
              const scenarioYaml =
                settled.output.kind === 'settled' ? task.stashedYaml(settled.output.scenarioYamlSha!) : undefined
              if (settled.output.kind !== 'settled' || scenarioYaml !== undefined) {
                const entry: CachedWorkerEntry = {
                  outcome: settled.output,
                  ...(scenarioYaml !== undefined ? { scenarioYaml } : {}),
                }
                await setCacheEntry(opts.repoRoot, FLOW_WORKER_CACHE_NAME, flowWorkerCacheKey(task), entry).catch(
                  () => undefined,
                )
              }
            }
            tick(settled.output.kind)
          }
        },
      })
    }

    await runWave(input.tasks)
    // The epic wave starts only after the first has fully folded — the barrier
    // that lets epic briefings carry members' settled scenarios read-only.
    await runWave(input.epicTasks)

    note(summary)
    const fidelitySummary: GuardSessionSummary | undefined =
      fidelityTally.ran > 0
        ? {
            kind: FIDELITY_SESSION_KIND,
            ran: fidelityTally.ran,
            fromCache: 0,
            failed: fidelityTally.failed,
            allTransport: fidelityTally.allTransport,
            ...(fidelityTally.firstError ? { firstError: fidelityTally.firstError } : {}),
            spent: fidelityTally.spent,
          }
        : undefined
    if (fidelitySummary) note(fidelitySummary)
    return { byTask, summary, ...(fidelitySummary ? { fidelitySummary } : {}) }
  }

  return {
    extractSession,
    flowsAreaSession,
    flowsEpicSession,
    flowWorkerSession,
    runId: () => run?.runId,
    finish(aborted) {
      if (!run) return
      run.finish(aborted ? 'interrupted' : failed > 0 && completed === 0 ? 'failed' : 'completed')
      run = null
    },
  }
}
