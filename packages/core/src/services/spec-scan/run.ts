/**
 * THE SCAN RUN — the session-based engine of `spec scan` (plan 02 steps 3–5),
 * replacing `@truecourse/spec-consolidator`'s retired `curate()` orchestration.
 * The deterministic spine stayed in the consolidator (discovery, identity,
 * prefilter, grouping, pointer verification, corpus store, decisions io); this
 * module chains it around four session kinds:
 *
 *   discover (det)
 *   → `spec-scan.orchestrate`  ≤1 scope session (step 6; the deterministic
 *     covered-universe pre-pass spends zero sessions on an unchanged universe)
 *   → apply scope verdicts (det — excluded subtrees never reach anything below)
 *   → prefilter/OpenAPI bypass (det, no session)
 *   → `spec-scan.curate-doc`   one session per doc   (pool)
 *   → `spec-scan.settle-areas` ≤1 session per corpus (barrier, concurrency 1)
 *   → groupByArea (det)
 *   → `spec-scan.overlap`      one session per area  (pool)
 *   → verify pointers + cross-area dedup (det) → assemble → write.
 *
 * The orchestrator's standing `instructions` ride EVERY downstream session's
 * briefing AND every downstream cache key (the `extraParts` tails) — editing
 * an instruction re-scans the corpus, which is correct and which the
 * pre-flight estimate states.
 *
 * TWO RULES carried over from the one-shot engine, exactly:
 *
 * - EVERY KIND FAILS OPEN PER ITEM — a failed curation session keeps its doc
 *   untagged, a failed settle session applies no merges, a failed overlap
 *   session flags nothing and lands the whole area in `notReached` — and the
 *   failures are tallied in `stats.llmFailures` (sessions, not calls).
 * - THE ONE-ABORT RULE — a session kind whose EVERY session failed with a
 *   `transport`-class failure produced nothing, and its fail-open defaults
 *   would be written as a healthy corpus. The run aborts with
 *   {@link LlmStageFailureError} BEFORE `writeCorpus`; the previous corpus
 *   stays untouched.
 *
 * CACHING: each kind goes through `cachedSessionOutcome` (author-class — these
 * sessions produce artifacts from their inputs). The cache is probed BEFORE a
 * session is spent; only cache-missing items enter the pool, and only
 * completed outcomes are written back. Tools never write repo/store state —
 * every write happens in the fold here, after the outcomes.
 */

import type {
  SessionDef,
  SessionDriver,
  SessionEvent,
  SessionFailure,
  SessionOutcome,
  SessionPersistence,
  UserInputQuestion,
} from '@truecourse/agent-loop'
import type { z } from 'zod'
import {
  aliasMatcher,
  applySubjectAttribution,
  autoApplyHighConfidenceRecommendations,
  classifyStatusValue,
  discoverDocs,
  docBody,
  groupByArea,
  isStructuralSpecDoc,
  namesOurProduct,
  parseDocStatus,
  prefilterCategory,
  prefilterDocs,
  pruneOrphanedConflictResolutions,
  readCorpusDecisions,
  readRepoIdentityInput,
  readSourcesFile,
  resolveRepoIdentity,
  verifyOverlapSections,
  widenedOverlapDocs,
  writeCorpus,
  writeDecisions,
  type Area,
  type AreaTag,
  type CuratedCorpus,
  type CurateResult,
  type CurateStats,
  type DecisionsFile,
  type DocAreaTags,
  type DocCandidate,
  type Overlap,
  type RepoIdentity,
  type Status,
  type VocabMap,
} from '@truecourse/spec-consolidator'
import { loadSpecScope } from '@truecourse/shared'
import { LlmStageFailureError, type StageTransportTally } from '@truecourse/shared/llm'
import { dedupeCrossAreaOverlaps } from '@truecourse/shared'
import { cachedSessionOutcome } from '../agent/session-cache.js'
import { runSessionPool } from '../agent/session-pool.js'
import {
  CURATE_DOC_CACHE_NAME,
  CURATE_DOC_SESSION_KIND,
  DocVerdictSchema,
  curateDocBriefing,
  curateDocCacheKey,
  curateDocSessionDef,
  curateDocWorkItem,
  type DocVerdict,
} from './curate-doc.js'
import {
  AreaSettlementSchema,
  SETTLE_AREAS_CACHE_NAME,
  SETTLE_AREAS_SESSION_KIND,
  SETTLE_AREAS_WORK_ITEM,
  applySettlement,
  canonicalDocTags,
  collectAreaVocab,
  settleAreasBriefing,
  settleAreasCacheKey,
  settleAreasGate,
  settleAreasSessionDef,
  type AreaSettlement,
  type AreaVocabView,
} from './settle-areas.js'
import {
  OVERLAP_SESSION_CACHE_NAME,
  OVERLAP_SESSION_KIND,
  OverlapOutcomeSchema,
  overlapBriefing,
  overlapSessionCacheKey,
  overlapSessionDef,
  overlapWorkItem,
  type OverlapWorkItem,
} from './overlap.js'
import {
  ORCHESTRATE_WORK_ITEM,
  SPEC_SCAN_ORCHESTRATE_SESSION_KIND,
  applyScopeVerdicts,
  buildScanScopeUniverse,
  mergeScopeOutcome,
  orchestrateBriefing,
  orchestrateSessionDef,
  scopeCoverage,
  type ScanScopeOutcome,
} from './orchestrate.js'
import { buildScanUniverse, instructionsFingerprint } from './tools.js'

export interface SpecScanSessionsOptions {
  repoRoot: string
  /**
   * The session driver, LAZILY: resolved only when at least one session must
   * actually run, so a fully-cached re-scan (and an edition whose driver
   * cannot even be constructed offline) never pays for it.
   */
  driver: () => Promise<SessionDriver>
  persistence: SessionPersistence
  /** Inject the decisions instead of reading `decisions.json` (EE). */
  decisions?: DecisionsFile
  /** Inject the doc set instead of walking the filesystem (EE). */
  docSource?: () => DocCandidate[] | Promise<DocCandidate[]>
  /** Who this repository is; explicit `null` = nothing identifies it (EE). */
  repoIdentity?: RepoIdentity | null
  skipGit?: boolean
  /** Skip writing `corpus.json`. The corpus is still assembled + returned. */
  skipCorpusWrite?: boolean
  /** Skip the overlap sessions entirely (workspace sync passes this). */
  disableOverlapDetection?: boolean
  /**
   * Skip the scope-orchestrator session (stored scope verdicts still apply).
   * The workspace corpus sync passes this: its doc tree is a transient scratch
   * materialization whose decisions are deleted with it, so a scope session
   * there would re-spend on every sync and settle nothing durable. Runs with an
   * injected `docSource` skip the session implicitly for the same reason.
   */
  disableScopeOrchestration?: boolean
  /** Ceiling on concurrent sessions per pool (the governor may run fewer). */
  concurrency?: number
  // --- progress hooks -------------------------------------------------------
  onDiscover?: (docs: number, toCurate: number) => void
  /**
   * The scope orchestration's outcome: `covered` = the deterministic pre-pass
   * found every subtree verdicted (zero sessions), `ran`/`failed` = the
   * session's fate, `skipped` = an injected doc set (EE/workspace — scope was
   * settled at repo scope, stored verdicts still apply).
   */
  onScope?: (state: 'covered' | 'ran' | 'failed' | 'skipped') => void
  onCurateProgress?: (done: number, total: number) => void
  onSettle?: (state: 'skipped' | 'cached' | 'ran' | 'failed') => void
  onOverlapProgress?: (done: number, total: number) => void
  /** Every transcript event as it is persisted — the CLI's live line. */
  onSessionEvent?: (workItem: string, event: SessionEvent) => void
  mintSessionId?: () => string
  now?: () => string
}

/** Per-kind rollup of what the run's sessions did. */
export interface ScanSessionKindSummary {
  kind: string
  /** Sessions that actually ran (cache hits never do). */
  ran: number
  fromCache: number
  failed: number
  spent: { turns: number; tokens: number; costUsd: number }
}

export interface SpecScanSessionsResult extends CurateResult {
  /** Zero fresh sessions and zero failures — every input was unchanged. */
  noChanges: boolean
  /** Per-kind session rollups (for the CLI/dashboard detail lines). */
  sessions: ScanSessionKindSummary[]
  /**
   * Questions the interactive orchestrator left unanswered (§3.7). A
   * non-interactive run never blocks on them — every consumer must surface
   * them LOUDLY (the CLI summary does).
   */
  pendingQuestions: UserInputQuestion[]
  /** The orchestrator's `findings` — verbatim observations for human eyes. */
  scanFindings: string[]
}

// ---------------------------------------------------------------------------
// The cached session pool: probe → pool the misses → write back completions.
// ---------------------------------------------------------------------------

interface CachedPoolResult<TOutcome> {
  outcome: SessionOutcome<TOutcome> & { fromCache?: true }
  /** Absent on a cache hit (there was no session, hence no transcript). */
  sessionId?: string
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
  driver(): Promise<SessionDriver>
  persistence: SessionPersistence
  concurrency?: number
  onProgress?: (done: number, total: number) => void
  onSessionEvent?: (workItem: string, event: SessionEvent) => void
  mintSessionId?: () => string
  now?: () => string
  /**
   * Finalize a fresh COMPLETED outcome's value — with the sessionId in hand —
   * before it is folded and cached. The seam that lets transcript-derived
   * facts (the overlap kind's `sectionsOpened`) ride the cached value, so a
   * later cache hit carries them too. Failures pass through untouched.
   */
  finalizeOutput?: (item: TItem, output: TOutcome, sessionId: string) => TOutcome
  /** Strictly serial across items: hits in item order (before the pool), fresh
   *  outcomes in completion order (inside the pool's serial fold). */
  fold(item: TItem, result: CachedPoolResult<TOutcome>): void
}

/**
 * Run one session per cache-missing item and hand every item's outcome —
 * cached or fresh — to the caller's fold. The cache read/write goes through
 * `cachedSessionOutcome` (schema-gated reads; only completed outputs written;
 * failures never cached); the pool mechanics (permits, throttle governor,
 * transient re-queue, event tee) are `runSessionPool`'s.
 */
async function runCachedSessionPool<TItem, TOutcome>(
  opts: CachedPoolOptions<TItem, TOutcome>,
): Promise<ScanSessionKindSummary & { firstError?: string; allTransport: boolean }> {
  const summary = {
    kind: opts.kind,
    ran: 0,
    fromCache: 0,
    failed: 0,
    spent: { turns: 0, tokens: 0, costUsd: 0 },
    firstError: undefined as string | undefined,
    allTransport: true,
  }
  const toRun: TItem[] = []
  const resolvers = new Map<string, (o: SessionOutcome<TOutcome>) => void>()
  const finals: Promise<void>[] = []
  let done = 0
  const total = opts.items.length
  opts.onProgress?.(0, total)

  // Probe phase, sequential: a hit folds (and reports progress) immediately, a
  // miss registers itself for the pool and parks its outer promise on a
  // deferred the pool's fold resolves. `decided` settles per item as soon as
  // hit-vs-miss is known, so the probes never serialize behind a session.
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
          opts.onProgress?.(++done, total)
          decide()
        }
      }),
    )
    await decided
  }

  if (toRun.length > 0) {
    const driver = await opts.driver()
    await runSessionPool<TItem, TOutcome>({
      items: toRun,
      workItem: opts.workItem,
      session: opts.session,
      briefing: (item) => [opts.briefing(item)],
      driver,
      persistence: opts.persistence,
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
      ...(opts.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      fold: (item, outcome, sessionId) => {
        summary.ran++
        summary.spent.turns += outcome.spent.turns
        summary.spent.tokens += outcome.spent.tokens
        summary.spent.costUsd += outcome.spent.costUsd
        if (outcome.status === 'failed') {
          summary.failed++
          summary.firstError ??= describeSessionFailure(outcome.failure)
          if (outcome.failure.kind !== 'transport') summary.allTransport = false
        }
        const finalized =
          outcome.status === 'completed' && opts.finalizeOutput
            ? { ...outcome, output: opts.finalizeOutput(item, outcome.output, sessionId) }
            : outcome
        opts.fold(item, { outcome: finalized, sessionId })
        opts.onProgress?.(++done, total)
        // Settle the outer cachedSessionOutcome promise (it writes the cache
        // for a completed outcome — the FINALIZED value, so what a later hit
        // returns is exactly what this run folded; a failure passes through
        // uncached).
        resolvers.get(opts.workItem(item))!(finalized)
      },
    })
  }
  await Promise.all(finals)
  return summary
}

/**
 * THE ONE-ABORT RULE: a kind that attempted sessions and lost EVERY one to a
 * transport-class failure produced nothing — its fail-open defaults must not
 * be written as a healthy corpus. Same contract (and same error type) as the
 * old `assertStageHealthy`, with the session kind as the stage id.
 */
function assertKindHealthy(summary: ScanSessionKindSummary & { firstError?: string; allTransport: boolean }): void {
  if (summary.ran > 0 && summary.failed === summary.ran && summary.allTransport) {
    throw new LlmStageFailureError({
      stage: summary.kind,
      attempts: summary.ran,
      failures: summary.failed,
      ...(summary.firstError ? { firstError: summary.firstError } : {}),
    })
  }
}

function describeSessionFailure(failure: SessionFailure): string {
  const text = (() => {
    switch (failure.kind) {
      case 'budget-exhausted':
        return `the session ran out of turns without reaching ${failure.notReached}`
      case 'context-exhausted':
        return 'the session hit its context ceiling'
      case 'malformed':
        return `the session ended malformed: ${failure.detail}`
      case 'transport':
        return `the provider failed (${failure.class}): ${failure.detail}`
      case 'session-lost':
        return `the provider session ${failure.providerSessionId} is gone`
    }
  })()
  return text.slice(0, TALLY_ERROR_CAP)
}

/** Cap on a recorded failure message — mirrors the shared tally module's
 *  `MAX_TALLY_ERROR_CHARS` (not re-exported through `@truecourse/shared/llm`). */
const TALLY_ERROR_CAP = 500

/** A kind's non-systemic losses as the tally shape every scan surface renders. */
function kindTally(summary: ScanSessionKindSummary & { firstError?: string }): StageTransportTally | null {
  if (summary.failed === 0) return null
  return {
    stage: summary.kind,
    attempts: summary.ran,
    failures: summary.failed,
    ...(summary.firstError ? { firstError: summary.firstError } : {}),
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function runSpecScanSessions(
  opts: SpecScanSessionsOptions,
): Promise<SpecScanSessionsResult> {
  const { repoRoot } = opts
  let decisions = opts.decisions ?? readCorpusDecisions(repoRoot)

  // ---- Discover (det) ------------------------------------------------------
  let allDocs: DocCandidate[]
  let scopeGlobs: string[] = []
  let outOfScopeManualIncludes: string[] = []
  if (opts.docSource) {
    allDocs = await opts.docSource()
  } else {
    const scope = loadSpecScope(repoRoot)
    allDocs = discoverDocs(repoRoot, { skipGit: opts.skipGit, scope })
    scopeGlobs = scope.globs
    if (scope.active) {
      outOfScopeManualIncludes = (decisions.manualIncludes ?? []).filter((p) => !scope.includes(p))
    }
  }

  // ---- Scope orchestration (step 6, ≤1 session) ----------------------------
  // BEFORE identity resolution and the prefilter, so an excluded subtree costs
  // nothing downstream — not an identity read, not a session. The covered-
  // universe pre-pass is deterministic and spends zero sessions; an injected
  // doc set (EE/workspace) skips the session (scope was settled at repo scope)
  // but still honors the stored verdicts.
  const pendingQuestions: UserInputQuestion[] = []
  const scanFindings: string[] = []
  let orchestrateSummary: (ScanSessionKindSummary & { firstError?: string; allTransport: boolean }) | null =
    null
  if (opts.docSource || opts.disableScopeOrchestration) {
    allDocs = applyScopeVerdicts(allDocs, decisions.scopeVerdicts ?? [], [])
    opts.onScope?.('skipped')
  } else {
    const scanScope = buildScanScopeUniverse(buildScanUniverse(allDocs), readSourcesFile(repoRoot).sources)
    const coverage = scopeCoverage(scanScope, decisions.scopeVerdicts ?? [])
    if (coverage.covered) {
      opts.onScope?.('covered')
    } else {
      const summary = {
        kind: SPEC_SCAN_ORCHESTRATE_SESSION_KIND,
        ran: 0,
        fromCache: 0,
        failed: 0,
        spent: { turns: 0, tokens: 0, costUsd: 0 },
        firstError: undefined as string | undefined,
        allTransport: true,
      }
      let settled = false
      await runSessionPool<typeof ORCHESTRATE_WORK_ITEM, ScanScopeOutcome>({
        items: [ORCHESTRATE_WORK_ITEM],
        workItem: () => ORCHESTRATE_WORK_ITEM,
        session: () => orchestrateSessionDef(scanScope),
        briefing: () => [orchestrateBriefing(scanScope, decisions, coverage)],
        driver: await opts.driver(),
        persistence: opts.persistence,
        concurrency: 1,
        ...(opts.onSessionEvent
          ? { onSessionEvent: (workItem, event) => opts.onSessionEvent?.(workItem, event) }
          : {}),
        ...(opts.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
        ...(opts.now ? { now: opts.now } : {}),
        fold: (_item, outcome) => {
          summary.ran++
          summary.spent.turns += outcome.spent.turns
          summary.spent.tokens += outcome.spent.tokens
          summary.spent.costUsd += outcome.spent.costUsd
          if (outcome.status === 'failed') {
            // Fail-open: no verdict changes — the scan proceeds on the stored
            // verdicts (uncovered subtrees stay kept), and the loss is tallied.
            summary.failed++
            summary.firstError ??= describeSessionFailure(outcome.failure)
            if (outcome.failure.kind !== 'transport') summary.allTransport = false
            return
          }
          settled = true
          decisions = mergeScopeOutcome(decisions, outcome.output, opts.now?.() ?? new Date().toISOString())
          pendingQuestions.push(...outcome.pendingQuestions)
          scanFindings.push(...(outcome.output.findings ?? []))
        },
      })
      orchestrateSummary = summary
      assertKindHealthy(summary)
      // Persist the merged verdicts + instructions in decisions.json (atomic,
      // same channel every decisions write uses) — user rows untouched by the
      // merge, so this never loses a human's call.
      if (settled && !opts.skipCorpusWrite) writeDecisions(repoRoot, decisions)
      opts.onScope?.(settled ? 'ran' : 'failed')
    }
    allDocs = applyScopeVerdicts(allDocs, decisions.scopeVerdicts ?? [], scanScope.sources)
  }

  // The standing instructions bind every downstream session: they open each
  // briefing and enter each cache key via the builders' `extraParts` tails.
  const instructions = decisions.instructions ?? []
  const instructionParts = [instructionsFingerprint(instructions)]

  // Resolve identity AFTER discovery + scope application: corpus name-frequency
  // expansion reads the docs that are actually in scope. `!== undefined` so an
  // explicit null is honored (EE).
  const identity =
    opts.repoIdentity !== undefined
      ? opts.repoIdentity
      : resolveRepoIdentity({ ...readRepoIdentityInput(repoRoot), docs: allDocs })

  const manualIncludes = decisions.manualIncludes ?? []
  const manualSet = new Set(manualIncludes)
  const manualExcludes = new Set(decisions.manualExcludes ?? [])
  const universe = buildScanUniverse(allDocs)
  // Our product's aliases as one matcher — the alias backstop's net, used both
  // by the live vocab fold below and the deterministic assembly after it.
  const ours = aliasMatcher(identity?.aliases ?? [])

  // ---- Prefilter + OpenAPI bypass (det — those docs get no session) --------
  const { toClassify, skipped: prefilterSkipped } = prefilterDocs(allDocs, manualIncludes, identity)
  // Structural (OpenAPI) docs are admitted deterministically and bypass every
  // prose session; a force-exclude drops a doc entirely, session unspent.
  const structuralKept = allDocs.filter((d) => isStructuralSpecDoc(d) && !manualExcludes.has(d.path))
  const curateItems = toClassify.filter((d) => !manualExcludes.has(d.path))
  opts.onDiscover?.(allDocs.length, curateItems.length)

  // ---- Curate-doc sessions (one per doc) -----------------------------------
  // Live label view for `corpus_vocab`: the labels of the docs folded so far.
  const liveTags = new Map<string, AreaTag[]>()
  const liveVocab = (): { products: string[]; concerns: string[] } => {
    const products = new Set<string>()
    const concerns = new Set<string>()
    for (const tags of liveTags.values()) {
      for (const tag of canonicalDocTags(tags)) {
        if (tag.product !== 'core' && tag.product !== 'process') products.add(tag.product)
        if (tag.product !== 'process') concerns.add(tag.concern)
      }
    }
    return { products: [...products].sort(), concerns: [...concerns].sort() }
  }

  const verdictByPath = new Map<string, CachedPoolResult<DocVerdict>>()
  const curateSummary = await runCachedSessionPool<DocCandidate, DocVerdict>({
    repoRoot,
    kind: CURATE_DOC_SESSION_KIND,
    cacheName: CURATE_DOC_CACHE_NAME,
    items: curateItems,
    workItem: (doc) => curateDocWorkItem(doc.path),
    cacheKey: (doc) => curateDocCacheKey({ identity, doc }, instructionParts),
    schema: DocVerdictSchema,
    session: (doc) => curateDocSessionDef({ doc, universe, liveVocab }),
    briefing: (doc) => curateDocBriefing(doc, identity, instructions),
    driver: opts.driver,
    persistence: opts.persistence,
    ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
    ...(opts.onCurateProgress ? { onProgress: opts.onCurateProgress } : {}),
    ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
    ...(opts.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    fold: (doc, result) => {
      verdictByPath.set(doc.path, result)
      if (result.outcome.status === 'completed') {
        const v = result.outcome.output
        // Live labels track what the deterministic assembly below will KEEP,
        // by the same rules, so a peer session in flight is never steered by a
        // doc that will not survive: subject attribution first (a keep:true
        // verdict about a DIFFERENT product is a drop), then the
        // manual-include override, then the alias backstop — a doc attributed
        // away as third-party whose prose names our own product is reinstated
        // at assembly, so its labels enter the live view too.
        const attributed = applySubjectAttribution({
          path: doc.path,
          subject: v.subject,
          include: v.keep,
          reason: v.reason,
          category: v.category,
        })
        const willKeep =
          attributed.include ||
          manualSet.has(doc.path) ||
          (attributed.category === 'third-party' && namesOurProduct(doc, ours))
        if (willKeep) liveTags.set(doc.path, v.areas)
      }
    },
  })
  assertKindHealthy(curateSummary)

  // ---- Fold: deterministic backstops + kept/skipped assembly (det) ---------
  // In DISCOVERY order, so the corpus's doc + skip lists are stable across
  // runs whatever order the sessions completed in. The backstops run here —
  // post-cache — exactly as the one-shot engine ran them: a doc a stale cached
  // verdict wrongly dropped is rescued on every run.
  const prefilterReason = new Map(prefilterSkipped.map((s) => [s.path, s.reason]))
  const keptProse: DocCandidate[] = []
  const tagsByPath = new Map<string, DocAreaTags>()
  const skippedDocs: Array<{ path: string; reason: string; category?: string }> = []
  const reinstatedCount = { value: 0 }
  let thirdPartyDropped = 0

  const keepDoc = (doc: DocCandidate, tags: AreaTag[], statusRaw: string | null | undefined): void => {
    keptProse.push(doc)
    const status: Status | undefined =
      (statusRaw ? classifyStatusValue(statusRaw) : undefined) ?? parseDocStatus(docBody(doc))
    tagsByPath.set(doc.path, { tags, ...(status ? { status } : {}) })
  }

  for (const doc of allDocs) {
    if (isStructuralSpecDoc(doc)) continue // appended at assembly, never sessioned
    if (manualExcludes.has(doc.path)) continue // dropped whole — not even skippedDocs
    const pf = prefilterReason.get(doc.path)
    if (pf !== undefined) {
      skippedDocs.push({ path: doc.path, reason: pf, category: prefilterCategory(doc, identity) })
      continue
    }
    const result = verdictByPath.get(doc.path)
    if (!result || result.outcome.status === 'failed') {
      // Fail-open per doc, mirroring the one-shot: {include: true, tags: []},
      // status from the deterministic header parse. Counted in classifyFailed.
      keepDoc(doc, [], undefined)
      continue
    }
    const v = result.outcome.output
    const attributed = applySubjectAttribution({
      path: doc.path,
      subject: v.subject,
      include: v.keep,
      reason: v.reason,
      category: v.category,
    })
    if (attributed.include || manualSet.has(doc.path)) {
      keepDoc(doc, v.areas, v.status)
      continue
    }
    if (attributed.category === 'third-party') {
      thirdPartyDropped++
      if (namesOurProduct(doc, ours)) {
        // The alias backstop: the doc's prose names our own product — reinstate.
        reinstatedCount.value++
        keepDoc(doc, v.areas, v.status)
        continue
      }
    }
    skippedDocs.push({ path: doc.path, reason: attributed.reason, category: attributed.category })
  }

  // ---- Settle-areas session (≤1, true barrier after the curation pool) -----
  const canonicalByPath = new Map<string, AreaTag[]>(
    keptProse.map((doc) => [doc.path, canonicalDocTags(tagsByPath.get(doc.path)?.tags ?? [])]),
  )
  const vocabView: AreaVocabView = collectAreaVocab(canonicalByPath)
  let vocabMap: VocabMap = { products: {}, concerns: {} }
  let settleSummary: (ScanSessionKindSummary & { firstError?: string; allTransport: boolean }) | null = null
  if (keptProse.length > 0 && settleAreasGate(vocabView)) {
    let settlement: AreaSettlement | null = null
    settleSummary = await runCachedSessionPool<typeof SETTLE_AREAS_WORK_ITEM, AreaSettlement>({
      repoRoot,
      kind: SETTLE_AREAS_SESSION_KIND,
      cacheName: SETTLE_AREAS_CACHE_NAME,
      items: [SETTLE_AREAS_WORK_ITEM],
      workItem: () => SETTLE_AREAS_WORK_ITEM,
      cacheKey: () => settleAreasCacheKey(vocabView, instructionParts),
      schema: AreaSettlementSchema,
      session: () => settleAreasSessionDef({ vocab: vocabView, universe }),
      briefing: () => settleAreasBriefing(vocabView, instructions),
      driver: opts.driver,
      persistence: opts.persistence,
      concurrency: 1,
      ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
      ...(opts.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      fold: (_item, result) => {
        if (result.outcome.status === 'completed') settlement = result.outcome.output
      },
    })
    assertKindHealthy(settleSummary)
    if (settlement) {
      const applied = applySettlement(settlement, vocabView)
      vocabMap = applied.vocab
      // Subdivision reassignments rewrite the CANONICAL concern per doc; the
      // merges ride the vocab map through the grouper, exactly as the old
      // normalizer's map did.
      for (const [ref, perDoc] of applied.reassignments) {
        const tags = canonicalByPath.get(ref)
        if (!tags) continue
        canonicalByPath.set(
          ref,
          tags.map((tag) => (perDoc.has(tag.concern) ? { ...tag, concern: perDoc.get(tag.concern)! } : tag)),
        )
      }
      opts.onSettle?.(settleSummary.fromCache > 0 ? 'cached' : 'ran')
    } else {
      opts.onSettle?.('failed')
    }
  } else {
    opts.onSettle?.('skipped')
  }

  // ---- Group docs by area (det) --------------------------------------------
  const groupTags = new Map<string, DocAreaTags>(
    keptProse.map((doc) => {
      const status = tagsByPath.get(doc.path)?.status
      return [doc.path, { tags: canonicalByPath.get(doc.path) ?? [], ...(status ? { status } : {}) }]
    }),
  )
  const grouped = groupByArea(keptProse, groupTags, decisions.manualAreas ?? [], vocabMap)

  // ---- Overlap sessions (one per area) -------------------------------------
  const overlapItems: OverlapWorkItem[] = []
  if (opts.disableOverlapDetection !== true) {
    for (const area of grouped.areas) {
      const byPath = new Map(keptProse.map((d) => [d.path, d]))
      const docs = area.docRefs.map((ref) => byPath.get(ref)).filter((d): d is DocCandidate => d !== undefined)
      const widened = widenedOverlapDocs(area, keptProse, vocabMap)
      // No possible pair, no session: the area needs at least two docs to
      // disagree, its own or one of its own beside a widened outsider.
      if (docs.length + widened.length < 2 || docs.length === 0) continue
      overlapItems.push({ areaId: area.id, concern: area.concern, docs, widened })
    }
  }

  const overlapEntries: Array<{ area: string; overlap: Overlap }> = []
  const notReachedByArea = new Map<string, string[]>()
  const sectionsOpenedByArea = new Map<string, number>()
  const bodyOf = (ref: string): string | undefined => {
    const d = universe.byPath.get(ref)
    return d ? docBody(d) : undefined
  }
  const overlapSummary = await runCachedSessionPool<OverlapWorkItem, z.infer<typeof OverlapOutcomeSchema>>({
    repoRoot,
    kind: OVERLAP_SESSION_KIND,
    cacheName: OVERLAP_SESSION_CACHE_NAME,
    items: overlapItems,
    workItem: (item) => overlapWorkItem(item.areaId),
    cacheKey: (item) => overlapSessionCacheKey(item, instructionParts),
    schema: OverlapOutcomeSchema,
    session: (item) => overlapSessionDef({ item, universe }),
    briefing: (item) => overlapBriefing(item, instructions),
    driver: opts.driver,
    persistence: opts.persistence,
    ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
    ...(opts.onOverlapProgress ? { onProgress: opts.onOverlapProgress } : {}),
    ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
    ...(opts.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    // The skim signal is counted off the TRANSCRIPT, never self-reported: the
    // stamp overwrites anything the session claimed, and it lands in the
    // CACHED value — so a fully-cached re-run keeps the corpus's
    // `sectionsOpened` instead of silently dropping it.
    finalizeOutput: (_item, output, sessionId) => ({
      ...output,
      sectionsOpened: countSectionsOpened(opts.persistence, sessionId),
    }),
    fold: (item, result) => {
      if (result.outcome.status === 'failed') {
        // Fail-open per area: no flags, the failure is tallied, and EVERY doc
        // of the area lands in notReached — a budget-exhausted area reads as
        // "not covered", in the corpus, never as a log line.
        notReachedByArea.set(item.areaId, item.docs.map((d) => d.path))
        return
      }
      const briefed = new Set([...item.docs, ...item.widened].map((d) => d.path))
      for (const flagged of result.outcome.output.overlaps) {
        // The fold's own validation — never trust the transcript: a pointer to
        // a doc the session was not briefed on is dropped; every kept pointer
        // is re-anchored deterministically (quote-first) against the doc text.
        const [a, b] = flagged.docs
        if (a === b || !briefed.has(a) || !briefed.has(b)) continue
        const sections = flagged.sections.filter((s) => s.doc === a || s.doc === b)
        const verified = verifyOverlapSections({ docs: [a, b], note: flagged.note, sections, bodyOf })
        overlapEntries.push({
          area: item.areaId,
          overlap: { docs: [a, b], note: flagged.note, sections: verified, areas: [], review: flagged.review },
        })
      }
      const notReached = result.outcome.output.notReached.filter((ref) => briefed.has(ref))
      if (notReached.length > 0) notReachedByArea.set(item.areaId, notReached)
      // Fresh and cached alike: the run stamped `sectionsOpened` into the
      // value before it entered the cache (finalizeOutput above). Absent only
      // on a legacy entry cached before the stamp existed — no signal, until
      // that area re-runs.
      if (result.outcome.output.sectionsOpened !== undefined) {
        sectionsOpenedByArea.set(item.areaId, result.outcome.output.sectionsOpened)
      }
    },
  })
  assertKindHealthy(overlapSummary)

  // Cross-area dedup (det, unchanged rule from @truecourse/shared): the same
  // disagreement on a doc pair sharing several areas collapses to one record
  // under a representative area, every spanned area listed.
  const overlapsByArea = new Map<string, Overlap[]>()
  for (const merged of dedupeCrossAreaOverlaps(overlapEntries)) {
    const list = overlapsByArea.get(merged.area) ?? []
    list.push({ ...merged.overlap, areas: merged.areas })
    overlapsByArea.set(merged.area, list)
  }
  for (const list of overlapsByArea.values()) {
    list.sort((x, y) => (x.docs.join() < y.docs.join() ? -1 : 1))
  }

  const areas: Area[] = grouped.areas.map((a) => {
    const notReached = notReachedByArea.get(a.id)
    const sectionsOpened = sectionsOpenedByArea.get(a.id)
    return {
      ...a,
      overlaps: overlapsByArea.get(a.id) ?? [],
      ...(notReached && notReached.length > 0 ? { notReached } : {}),
      ...(sectionsOpened !== undefined ? { sectionsOpened } : {}),
    }
  })

  // ---- Assemble + persist (det) --------------------------------------------
  // Structural (OpenAPI) docs join as valid CorpusDoc entries with empty tags.
  const structuralCorpusDocs = structuralKept.map((d) => ({
    ref: d.path,
    kind: d.kind,
    lastTouched: d.lastTouched,
    areaTags: [],
  }))
  const corpus: CuratedCorpus = {
    version: 3,
    generatedAt: new Date().toISOString(),
    docs: [...grouped.docs, ...structuralCorpusDocs],
    areas,
    skippedDocs: skippedDocs.map((s) => ({ ref: s.path, reason: s.reason, category: s.category })),
  }
  let effectiveDecisions = decisions
  let autoResolvedConflicts: CurateStats['autoResolvedConflicts'] = []
  if (!opts.skipCorpusWrite) {
    writeCorpus(repoRoot, {
      docs: corpus.docs,
      areas: corpus.areas,
      skippedDocs: corpus.skippedDocs,
      generatedAt: corpus.generatedAt,
    })
    effectiveDecisions = pruneOrphanedConflictResolutions(repoRoot, corpus, decisions)
    const auto = autoApplyHighConfidenceRecommendations(repoRoot, corpus, effectiveDecisions)
    effectiveDecisions = auto.decisions
    autoResolvedConflicts = auto.applied
  }

  // ---- Stats ----------------------------------------------------------------
  const summaries = [
    ...(orchestrateSummary ? [orchestrateSummary] : []),
    curateSummary,
    ...(settleSummary ? [settleSummary] : []),
    overlapSummary,
  ]
  const llmFailures = summaries
    .map((s) => kindTally(s))
    .filter((t): t is StageTransportTally => t !== null)
  const openOverlaps = areas.flatMap((a) =>
    a.overlaps.map((o) => ({ area: a.id, a: o.docs[0], b: o.docs[1] })),
  )
  const stats: CurateStats = {
    docsScanned: allDocs.length,
    docsKept: keptProse.length + structuralKept.length,
    areaCount: areas.length,
    overlapFlags: openOverlaps.length,
    overlapRefuted: 0, // the session adjudicates inline; nothing to prune behind it
    thirdPartyDropped,
    thirdPartyRestored: reinstatedCount.value,
    classifyFailed: curateSummary.failed,
    autoResolvedConflicts,
    openOverlaps,
    skippedDocs,
    scopeGlobs,
    outOfScopeManualIncludes,
    llmFailures,
  }

  const ran = summaries.reduce((n, s) => n + s.ran, 0)
  return {
    corpus,
    skippedDocs,
    decisions: effectiveDecisions,
    stats,
    noChanges: ran === 0 && llmFailures.length === 0,
    sessions: summaries.map(({ kind, ran, fromCache, failed, spent }) => ({ kind, ran, fromCache, failed, spent })),
    pendingQuestions,
    scanFindings,
  }
}

/**
 * The area's skim signal, counted off the TRANSCRIPT: how many non-error
 * `read_section` results its session actually ingested. Never self-reported —
 * the count is stamped over the outcome value (finalizeOutput) before it is
 * cached, which is how a cache hit still carries it.
 */
function countSectionsOpened(persistence: SessionPersistence, sessionId: string): number {
  return persistence
    .readEvents(sessionId)
    .filter((event) => event.type === 'tool-result' && event.toolName === 'read_section' && event.isError !== true)
    .length
}
