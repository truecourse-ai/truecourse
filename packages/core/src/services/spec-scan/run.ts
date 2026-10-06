/**
 * THE SCAN RUN — the session-based engine of `spec scan`,
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
 *   → `spec-scan.corpus-review` computer path only: one session per shard of
 *     the kept docs, dropping what does not belong (part of the curate step)
 *   → `spec-scan.settle-areas` ≤1 session per corpus (barrier, concurrency 1)
 *   → groupByArea (det)
 *   → the overlap step, in the shape `conflictMethod` names:
 *       `pairing`: deriveOverlapWorkItems (det — claim-token/heading pairing)
 *       → `spec-scan.overlap` one session per collision cluster (pool);
 *       `facts`: `spec-scan.record-facts` one session per window of a kept
 *       doc's units (pool), each doc's ledger collected
 *       → `spec-scan.settle-subjects` one session per part of the facts'
 *       subject names (barrier)
 *       → planCompareBatches (det — area batches, then subject batches)
 *       → `spec-scan.compare-facts` one session per batch (pool), each
 *       conflict it finds handed to the fold as a finding
 *   → verify pointers + cross-area dedup (det; findings that name the same
 *     two passages folded into one) → assemble → write.
 *
 * THE COMPUTER PATH is the caller's call (`computer`): it runs when the driver
 * can hand a session a computer, and adds a corpus review after curation that
 * reads the kept docs off a scratch directory (`corpus-dir.ts`). Without it the
 * scan is unchanged.
 *
 * The orchestrator's standing `instructions` ride EVERY downstream session's
 * briefing AND every downstream cache key (the `extraParts` tails) — editing
 * an instruction re-scans the corpus, which is correct and which the
 * pre-flight estimate states.
 *
 * TWO RULES carried over from the one-shot engine, exactly:
 *
 * - EVERY KIND FAILS OPEN PER ITEM — a failed curation session keeps its doc
 *   untagged, a failed settle session applies no merges, a failed overlap or
 *   compare session flags nothing and lands its docs in `notReached` — and the
 *   failures are tallied in `stats.llmFailures` (sessions, not calls).
 * - THE ONE-ABORT RULE — a session kind whose EVERY session failed with a
 *   `transport`-class failure produced nothing, and its fail-open defaults
 *   would be written as a healthy corpus. The run aborts with
 *   {@link LlmStageFailureError} BEFORE `writeCorpus`; the previous corpus
 *   stays untouched.
 *
 * CANCELLATION follows the same shape: a caller's `signal` reaches every
 * session, and the run throws {@link ScanAbortedError} before any write rather
 * than folding a half-run corpus out of the fail-open defaults. What completed
 * before the cancel keeps its cache entry; what died does not (failures are
 * never cached), so resuming costs only the unfinished docs.
 *
 * CACHING: each kind goes through `cachedSessionOutcome` (author-class — these
 * sessions produce artifacts from their inputs). The cache is probed BEFORE a
 * session is spent; only cache-missing items enter the pool, and only
 * completed outcomes are written back. Tools never write repo/store state —
 * every write happens in the fold here, after the outcomes.
 *
 * SINGLE-STEP MODE (`only`): run one step's
 * sessions in isolation — prior steps replay from their durable artifacts
 * (stored scope verdicts, outcome caches; a miss fails loud), later steps
 * never start, and corpus.json is written only by the final step. See
 * {@link SpecScanSessionsOptions.only}.
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
  assignDocPairArea,
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
  readCorpus,
  readCorpusDecisions,
  readRepoIdentityInput,
  resolveRepoIdentity,
  verifyOverlapSections,
  writeCorpus,
  writeDecisions,
  type Area,
  type AreaComparison,
  type AreaTag,
  type CandidatePair,
  type CorpusComparison,
  type CuratedCorpus,
  type CurateResult,
  type CurateStats,
  type DecisionsFile,
  type DocAreaTags,
  type DocCandidate,
  type Overlap,
  type RepoIdentity,
  splitArea,
  type Status,
  type VocabMap,
} from '@truecourse/spec-consolidator'
import { LlmStageFailureError, type StageTransportTally } from '@truecourse/shared/llm'
import { dedupeCrossAreaOverlaps, namesPassages, type OverlapLike } from '@truecourse/shared'
import { cachedSessionOutcome } from '../agent/session-cache.js'
import { runSessionPool } from '../agent/session-pool.js'
import {
  CURATE_DOC_CACHE_NAME,
  CURATE_DOC_SESSION_KIND,
  DocVerdictSchema,
  curateDocBriefing,
  curateDocCacheKey,
  curateDocLegacyCacheKeys,
  curateDocSessionDef,
  curateDocWorkItem,
  docOriginCachePart,
  type DocOrigin,
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
  settleAreasLegacyCacheKey,
  settleAreasGate,
  settleAreasSessionDef,
  type AreaSettlement,
  type AreaVocabView,
} from './settle-areas.js'
import { reconcileDocTagsWithPrior } from './settle-areas.js'
import {
  OVERLAP_SESSION_CACHE_NAME,
  OVERLAP_SESSION_KIND,
  OverlapOutcomeSchema,
  deriveOverlapWorkItems,
  overlapBriefing,
  overlapSessionCacheKey,
  overlapSessionLegacyCacheKey,
  overlapSessionDef,
  overlapWorkItem,
  openedSectionKey,
  pairRecord,
  uncheckedBriefedPairs,
  type OverlapFinding,
  type OverlapWorkItem,
} from './overlap.js'
import {
  ORCHESTRATE_WORK_ITEM,
  SPEC_SCAN_ORCHESTRATE_SESSION_KIND,
  applyScopeVerdicts,
  buildScanScopeUniverse,
  buildWorkspaceScopeUniverse,
  mergeScopeOutcome,
  orchestrateBriefing,
  orchestrateSessionDef,
  scopeCoverage,
  type ScanScopeOutcome,
  type ScopeGrammar,
  type ScopeSourceView,
} from './orchestrate.js'
import { buildScanUniverse, instructionsFingerprint } from './tools.js'
import { corpusDir, corpusFingerprint } from './corpus-dir.js'
import {
  CORPUS_REVIEW_CACHE_NAME,
  CORPUS_REVIEW_SESSION_KIND,
  CORPUS_REVIEW_TIMEOUT_MS,
  CorpusReviewOutcomeSchema,
  applyCorpusReview,
  corpusReviewBriefing,
  corpusReviewCacheKey,
  corpusReviewSessionDef,
  corpusReviewWorkItem,
  planCorpusReviewShards,
  type CorpusReviewOutcome,
  type CorpusReviewShard,
} from './corpus-review.js'
import {
  FactLedgerSchema,
  RECORD_FACTS_CACHE_NAME,
  RECORD_FACTS_SESSION_KIND,
  describeDocLedger,
  docFactLedger,
  docLedgerCounts,
  factAreaIds,
  recordFactsBriefing,
  recordFactsCacheKey,
  recordFactsItems,
  recordFactsSessionDef,
  recordFactsWorkItem,
  type DocFactLedger,
  type FactAreaContext,
  type FactLedger,
  type RecordFactsItem,
  type RecordedFact,
} from './record-facts.js'
import {
  SETTLE_SUBJECTS_CACHE_NAME,
  SETTLE_SUBJECTS_SESSION_KIND,
  SubjectSettlementSchema,
  collectSubjectNames,
  planSubjectParts,
  settleSubjectsBriefing,
  settleSubjectsCacheKey,
  settleSubjectsSessionDef,
  settleSubjectsWorkItem,
  settledSubjects,
  subjectKey,
  subjectMerges,
  type SubjectPart,
  type SubjectSettlement,
} from './settle-subjects.js'
import {
  COMPARE_BATCH_FACTS,
  COMPARE_FACTS_CACHE_NAME,
  COMPARE_FACTS_SESSION_KIND,
  FactComparisonSchema,
  checkGroups,
  compareFactsBriefing,
  compareFactsCacheKey,
  compareFactsSessionDef,
  compareFactsWorkItem,
  describeBatch,
  foldSamePassages,
  planCompareBatches,
  type CompareItem,
  type FactComparison,
} from './compare-facts.js'

// ---------------------------------------------------------------------------
// Single-step mode (`only`)
// ---------------------------------------------------------------------------

/** The scan's four session steps, in pipeline order. */
export const SCAN_STEPS = ['orchestrate', 'curate', 'settle', 'overlap'] as const
export type ScanStep = (typeof SCAN_STEPS)[number]

/**
 * The phase a fact is filed under. These are the scan CHECKLIST's step keys
 * (`spec-in-process`'s `CURATE_STEPS`), which group the session steps above:
 * discovery and the prefilter under `discover`, curation and settling under
 * `tag`, the cluster reviews and the conflicts found under `overlap`, and the
 * deterministic fold (re-anchoring, dedup, auto-apply) under `verify`. A scan
 * that finds conflicts by comparing facts files recording each doc's facts
 * under `record`, settling their subjects under `subjects` and comparing them
 * under `compare`, steps the checklist carries only on such a scan.
 */
export type ScanFactStep = 'discover' | 'tag' | 'record' | 'subjects' | 'compare' | 'overlap' | 'verify'

/**
 * How the overlap step finds conflicts: `pairing` reviews the docs that share
 * claim tokens or headings, cluster by cluster; `facts` records each kept
 * doc's facts window by window, settles their subjects and compares them batch
 * by batch.
 */
export type ConflictMethod = 'pairing' | 'facts'

/** The method a scan runs: the one it was given, else pairing. */
export function resolveConflictMethod(opts: { conflictMethod?: ConflictMethod }): ConflictMethod {
  return opts.conflictMethod ?? 'pairing'
}

/**
 * The caller cancelled the run through its `signal` (the dashboard does this
 * when a repository is disconnected under its own onboarding scan). Thrown
 * BEFORE anything is written: an aborted session fails, and a kind's fail-open
 * defaults over sessions that never ran would assemble a degenerate corpus —
 * every unfinished doc kept untagged — indistinguishable from a healthy one.
 * Same discipline as the one-abort rule, on a different trigger.
 */
export class ScanAbortedError extends Error {
  constructor() {
    super('the spec scan was cancelled')
    this.name = 'ScanAbortedError'
  }
}

/**
 * A single-step run (`only`) found a PRIOR step's artifact missing: the prior
 * step's outcome cache has no entry for `missing`, so replaying it would spend
 * sessions that belong to that step's own run. Deliberately loud — a silent
 * re-run here would mask exactly the cache-key drift a stepwise run exists to
 * expose. The fix is always a scan with `only` set to that step.
 */
export class ScanStepNotReadyError extends Error {
  constructor(
    readonly step: ScanStep,
    readonly missing: string[],
  ) {
    super(
      `the ${step} step has ${missing.length} uncached item${missing.length === 1 ? '' : 's'} — run it without \`only\` first`,
    )
    this.name = 'ScanStepNotReadyError'
  }
}

export interface SpecScanSessionsOptions {
  repoRoot: string
  /**
   * The session driver, LAZILY: resolved only when at least one session must
   * actually run, so a fully-cached re-scan (and an edition whose driver
   * cannot even be constructed offline) never pays for it.
   */
  driver: () => Promise<SessionDriver>
  persistence: SessionPersistence
  /** Inject the decisions instead of reading `decisions.json` (the workspace scan). */
  decisions?: DecisionsFile
  /** Inject the doc set instead of walking the filesystem (the workspace scan). */
  docSource?: () => DocCandidate[] | Promise<DocCandidate[]>
  /** Who this repository is; explicit `null` = nothing identifies it (the workspace scan). */
  repoIdentity?: RepoIdentity | null
  skipGit?: boolean
  /** Skip writing `corpus.json`. The corpus is still assembled + returned. */
  skipCorpusWrite?: boolean
  /** Skip the overlap sessions entirely (workspace sync passes this). */
  disableOverlapDetection?: boolean
  /**
   * The driver can hand a session a computer (Claude Code). The caller that
   * chose the driver says so; nothing below infers it. Then a corpus review
   * (`spec-scan.corpus-review`) over the kept docs on disk follows curation.
   */
  computer?: boolean
  /**
   * How the overlap step finds conflicts (see {@link ConflictMethod}). The
   * caller decides; absent, the scan pairs.
   */
  conflictMethod?: ConflictMethod
  /**
   * The corpus the last scan wrote, for the areas to reconcile against: its
   * area ids ride the settle session's briefing and are kept by its fold, and
   * each document's prior tags ride its curation briefing. The workspace scan
   * injects the stored version (its scratch tree holds none); a repository
   * scan reads `corpus.json` from the tree when this is absent. Explicit
   * `null` means there is no prior.
   */
  previousCorpus?: CuratedCorpus | null
  /**
   * The overlaps the corpus this scan replaces had flagged. Each overlap
   * session is briefed with the ones between its docs, so a dispute keeps its
   * identity across scans (see `priorDisputesFor`). Never part of a cache key.
   */
  priorOverlaps?: readonly OverlapLike[]
  /**
   * Leave the judge's high-confidence recommendations as recommendations: a
   * scan whose decisions are not this workspace's to write (a pull request's)
   * applies none of them.
   */
  skipAutoApply?: boolean
  /**
   * Skip the scope-orchestrator session (stored scope verdicts still apply).
   * The workspace corpus sync passes this: its doc tree is a transient scratch
   * materialization whose decisions are deleted with it, so a scope session
   * there would re-spend on every sync and settle nothing durable. Runs with an
   * injected `docSource` skip the session implicitly for the same reason —
   * unless {@link SpecScanSessionsOptions.scopeSources} names the universe's
   * sources, which is the workspace scan saying its scope IS durable.
   */
  disableScopeOrchestration?: boolean
  /**
   * UNIVERSE MODE. The sources whose documents make up the universe, with their
   * document counts — what the scope session verdicts by id. Present ⇒ the scan
   * runs the scope session over the CONTEXT grammar (`context/<sourceId>/…`
   * refs; a source id or a `context/<sourceId>/<dir>` subtree is a verdict
   * subject) instead of reading the tree's own `sources.json`. The workspace
   * scan passes it; a per-repository scan never does.
   */
  scopeSources?: readonly ScopeSourceView[]
  /**
   * Universe mode: where each document came from, for the curation briefing
   * (and its cache key, so a document that changes source is re-judged). Keyed
   * by doc ref.
   */
  docOrigins?: ReadonlyMap<string, DocOrigin>
  /** Ceiling on concurrent sessions per pool (the governor may run fewer). */
  concurrency?: number
  /**
   * Single-step mode: run ONLY this step's sessions. Prior steps replay from
   * their durable artifacts — orchestrate from the stored scope verdicts (its
   * session is skipped even on an uncovered universe), curate/settle from their
   * outcome caches (a cache miss throws {@link ScanStepNotReadyError} instead
   * of silently spending the prior step's sessions). Later steps never start,
   * and `corpus.json` is written only when the FINAL step (`overlap`) runs —
   * every earlier stop returns `stoppedAfter` and touches no corpus.
   */
  only?: ScanStep
  /**
   * Cancel the run. In-flight sessions get the signal (they end as failures),
   * queued ones never start, and the run throws {@link ScanAbortedError}
   * instead of folding what it has — nothing is written.
   */
  signal?: AbortSignal
  // --- progress hooks -------------------------------------------------------
  /**
   * One thing a phase DID, in the scan's own words: which doc, which subtree,
   * which cluster, and whether a cache answered instead of a session. Appended
   * in the order it happened; the counters stay on the hooks below.
   */
  onFact?: (step: ScanFactStep, line: string) => void
  onDiscover?: (docs: number, toCurate: number) => void
  /**
   * The scope orchestration's outcome: `covered` = the deterministic pre-pass
   * found every subtree verdicted (zero sessions), `ran`/`failed` = the
   * session's fate, `skipped` = an injected doc set (the workspace scan — scope
   * was settled at repo scope, stored verdicts still apply).
   */
  onScope?: (state: 'covered' | 'ran' | 'failed' | 'skipped') => void
  onCurateProgress?: (done: number, total: number) => void
  onSettle?: (state: 'skipped' | 'cached' | 'ran' | 'failed') => void
  /** The record step's sessions, one per doc window, when conflicts are found by comparing facts. */
  onRecordProgress?: (done: number, total: number) => void
  /** The subject settling's sessions, one per part of the subject names, when conflicts are found by comparing facts. */
  onSubjectsProgress?: (done: number, total: number) => void
  /** The compare step's sessions, one per batch of facts, when conflicts are found by comparing facts. */
  onCompareProgress?: (done: number, total: number) => void
  /** The overlap step's sessions: the collision clusters. */
  onOverlapProgress?: (done: number, total: number) => void
  /** Every transcript event as it is persisted — the caller's live view. */
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
  /** Per-kind session rollups (for the dashboard's detail lines). */
  sessions: ScanSessionKindSummary[]
  /**
   * Questions the interactive orchestrator left unanswered. A
   * non-interactive run never blocks on them — every consumer must surface
   * them LOUDLY.
   */
  pendingQuestions: UserInputQuestion[]
  /** The orchestrator's `findings` — verbatim observations for human eyes. */
  scanFindings: string[]
  /**
   * Set in single-step mode when the run stopped BEFORE assembly: the named
   * step ran, later steps never started, and `corpus.json` is untouched (the
   * returned `corpus` is an empty skeleton). Absent on a completed scan —
   * including `only: 'overlap'`, which runs through the corpus write.
   */
  stoppedAfter?: ScanStep
  /**
   * The ledger the record step collected for each doc it recorded, in corpus
   * order. Present only when conflicts are found by comparing facts.
   */
  factLedgers?: DocFactLedger[]
}

// ---------------------------------------------------------------------------
// The cached session pool: probe → pool the misses → write back completions.
// ---------------------------------------------------------------------------

/** A kind's rollup as the run tallies it, before the result drops the tally fields. */
type KindRun = ScanSessionKindSummary & { firstError?: string; allTransport: boolean }

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
  /** The keys this kind computed before its formula changed, newest first; a
   *  miss under `cacheKey` reads them in turn. Delete with the legacy hash. */
  legacyCacheKeys?(item: TItem): readonly string[]
  schema: z.ZodType<TOutcome>
  session(item: TItem): SessionDef<TOutcome>
  briefing(item: TItem): string
  driver(): Promise<SessionDriver>
  persistence: SessionPersistence
  concurrency?: number
  signal?: AbortSignal
  /** Each session's wall clock; the only clock a session with a computer has. */
  timeoutMs?: number
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
  /**
   * Single-step mode, replaying a PRIOR step: serve every item from cache and
   * throw {@link ScanStepNotReadyError} (naming this step) on any miss instead
   * of running a session — the misses belong to this step's own `only` run.
   */
  cacheOnly?: ScanStep
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
      ...(opts.legacyCacheKeys ? { legacyKeys: opts.legacyCacheKeys(item) } : {}),
      schema: opts.schema,
      run: () => {
        toRun.push(item)
        decide()
        return new Promise<SessionOutcome<TOutcome>>((resolve) => resolvers.set(id, resolve))
      },
    })
    finals.push(
      outcomePromise
        .then((outcome) => {
          if (outcome.fromCache) {
            summary.fromCache++
            opts.fold(item, { outcome })
            opts.onProgress?.(++done, total)
          }
        })
        // `decide` unconditionally, whatever the chain above did: a fold or
        // progress callback that THROWS on a cache hit (or a cache read that
        // rejects) must fail the scan at the `Promise.all(finals)` below — not
        // park the probe loop's `await decided` forever. Idempotent on a miss,
        // where run() already decided at registration.
        .finally(decide),
    )
    await decided
  }

  // A cache-only replay refuses to spend: the misses' parked promises are
  // simply abandoned (nothing awaits them past this throw).
  if (opts.cacheOnly !== undefined && toRun.length > 0) {
    throw new ScanStepNotReadyError(
      opts.cacheOnly,
      toRun.map((item) => opts.workItem(item)),
    )
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
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
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
    // A cancelled pool leaves the items it skipped un-folded, so their parked
    // promises never settle — abandoned exactly as a cache-only replay
    // abandons its misses. Nothing below may await them.
    if (opts.signal?.aborted) throw new ScanAbortedError()
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

/** Canonical tags with one doc's concern rewrites from the area settlement applied. */
function reassignConcerns(tags: readonly AreaTag[], perDoc: ReadonlyMap<string, string> | undefined): AreaTag[] {
  return tags.map((tag) => {
    const to = perDoc?.get(tag.concern)
    return to === undefined ? tag : { ...tag, concern: to }
  })
}

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
  const only = opts.only
  const conflictMethod = resolveConflictMethod(opts)
  /** Stop the run where it stands — the pools own the gaps between the steps. */
  const throwIfAborted = (): void => {
    if (opts.signal?.aborted) throw new ScanAbortedError()
  }
  throwIfAborted()
  /** Single-step mode: is `step` PRIOR to the chosen one (replay, never spend)? */
  const replayOnly = (step: ScanStep): boolean =>
    only !== undefined && SCAN_STEPS.indexOf(step) < SCAN_STEPS.indexOf(only)
  /** One line of what a phase did, for the run record's checklist. */
  const fact = (step: ScanFactStep, line: string): void => opts.onFact?.(step, line)
  let decisions = opts.decisions ?? readCorpusDecisions(repoRoot)
  // What the last scan settled, for identity: the area ids, and each doc's tags.
  const previousCorpus = opts.previousCorpus === undefined ? readCorpus(repoRoot) : opts.previousCorpus
  const priorAreaIds: string[] = previousCorpus?.areas.map((a) => a.id) ?? []
  const priorTagsByRef = new Map<string, string[]>(previousCorpus?.docs.map((d) => [d.ref, d.areaTags]) ?? [])

  // ---- Discover (det) ------------------------------------------------------
  let allDocs: DocCandidate[]
  if (opts.docSource) {
    allDocs = await opts.docSource()
    fact('discover', 'docs supplied by the caller, no repository walk')
  } else {
    allDocs = discoverDocs(repoRoot, { skipGit: opts.skipGit })
    fact('discover', 'walked the repository for documentation files')
  }

  // ---- Scope orchestration (step 6, ≤1 session) ----------------------------
  // BEFORE identity resolution and the prefilter, so an excluded subtree costs
  // nothing downstream — not an identity read, not a session. The covered-
  // universe pre-pass is deterministic and spends zero sessions; an injected
  // doc set (the workspace scan) skips the session (scope was settled at repo scope)
  // but still honors the stored verdicts.
  const pendingQuestions: UserInputQuestion[] = []
  const scanFindings: string[] = []
  // The docs a scope verdict excluded, recorded for `skippedDocs`: the
  // dashboard's "not included" surface must be able to show them (and
  // force-include them) — a doc that just vanishes cannot be undone. User
  // pins (`manualIncludes`) never land here: applyScopeVerdicts keeps them.
  const scopeExcluded: Array<{ path: string; reason: string; category?: string }> = []
  // Universe mode: the workspace's own sources, under the context ref grammar.
  const scopeGrammar: ScopeGrammar = opts.scopeSources ? 'context' : 'repo'
  const applyScope = (docs: DocCandidate[], sources: readonly ScopeSourceView[]): DocCandidate[] => {
    for (const verdict of decisions.scopeVerdicts ?? []) {
      const who = verdict.resolvedBy === 'auto' ? 'the scope session' : 'a decision'
      fact('discover', `${verdict.path}: ${verdict.verdict === 'exclude' ? 'excluded' : 'kept'} by ${who}, ${verdict.reason}`)
    }
    const kept = applyScopeVerdicts(
      docs,
      decisions.scopeVerdicts ?? [],
      sources,
      decisions.manualIncludes ?? [],
      scopeGrammar,
    )
    if (kept.length !== docs.length) {
      const keptSet = new Set(kept.map((d) => d.path))
      // Force-excluded docs stay out of the skip list here too — a manual
      // exclude drops a doc whole, same as the fold below.
      const excluded = new Set(decisions.manualExcludes ?? [])
      for (const d of docs) {
        if (!keptSet.has(d.path) && !excluded.has(d.path)) {
          scopeExcluded.push({ path: d.path, reason: 'excluded by a scan-scope verdict', category: 'out-of-scope' })
        }
      }
    }
    return kept
  }
  let orchestrateSummary: (ScanSessionKindSummary & { firstError?: string; allTransport: boolean }) | null =
    null
  if ((opts.docSource && !opts.scopeSources) || opts.disableScopeOrchestration) {
    fact('discover', 'scope session skipped, the stored verdicts still apply')
    allDocs = applyScope(allDocs, opts.scopeSources ?? [])
    opts.onScope?.('skipped')
  } else {
    const scanScope = opts.scopeSources
      ? buildWorkspaceScopeUniverse(buildScanUniverse(allDocs), opts.scopeSources)
      : buildScanScopeUniverse(buildScanUniverse(allDocs))
    const coverage = scopeCoverage(scanScope, decisions.scopeVerdicts ?? [])
    if (coverage.covered) {
      fact('discover', 'every subtree already carries a scope verdict, no scope session')
      opts.onScope?.('covered')
    } else if (replayOnly('orchestrate')) {
      // Single-step mode, a later step: the scope session belongs to
      // `only: 'orchestrate'`. Proceed on the stored verdicts — uncovered
      // subtrees stay kept, the same fail-open a lost session leaves.
      fact('discover', 'scope session belongs to another step, the stored verdicts still apply')
      opts.onScope?.('skipped')
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
        ...(opts.signal ? { signal: opts.signal } : {}),
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
      throwIfAborted() // before the verdicts are persisted below
      assertKindHealthy(summary)
      // Persist the merged verdicts + instructions in decisions.json (atomic,
      // same channel every decisions write uses) — user rows untouched by the
      // merge, so this never loses a human's call.
      if (settled && !opts.skipCorpusWrite) writeDecisions(repoRoot, decisions)
      fact(
        'discover',
        settled
          ? 'a scope session decided which subtrees the scan covers'
          : 'the scope session failed, the stored verdicts were kept',
      )
      opts.onScope?.(settled ? 'ran' : 'failed')
    }
    allDocs = applyScope(allDocs, scanScope.sources)
  }

  // Single-step early return: what ran so far, an empty corpus skeleton (the
  // real corpus.json is untouched), and `stoppedAfter`. `noChanges` keeps its
  // meaning per step — a warm re-run of one step spends and reports nothing.
  const stoppedResult = (
    stoppedAfter: ScanStep,
    summaries: (ScanSessionKindSummary & { firstError?: string })[],
    over: { skippedDocs?: CurateStats['skippedDocs']; stats?: Partial<CurateStats> } = {},
  ): SpecScanSessionsResult => {
    const llmFailures = summaries
      .map((s) => kindTally(s))
      .filter((t): t is StageTransportTally => t !== null)
    const ran = summaries.reduce((n, s) => n + s.ran, 0)
    return {
      corpus: { version: 3, generatedAt: new Date().toISOString(), docs: [], areas: [], skippedDocs: [] },
      skippedDocs: over.skippedDocs ?? [],
      decisions,
      stats: {
        docsScanned: allDocs.length,
        docsKept: 0,
        areaCount: 0,
        overlapFlags: 0,
        overlapRefuted: 0,
        thirdPartyDropped: 0,
        thirdPartyRestored: 0,
        classifyFailed: 0,
        autoResolvedConflicts: [],
        openOverlaps: [],
        skippedDocs: over.skippedDocs ?? [],
        llmFailures,
        ...over.stats,
      },
      noChanges: ran === 0 && llmFailures.length === 0,
      sessions: summaries.map(({ kind, ran, fromCache, failed, spent }) => ({
        kind,
        ran,
        fromCache,
        failed,
        spent,
      })),
      pendingQuestions,
      scanFindings,
      stoppedAfter,
    }
  }
  if (only === 'orchestrate') {
    return stoppedResult('orchestrate', orchestrateSummary ? [orchestrateSummary] : [], {
      skippedDocs: scopeExcluded,
    })
  }

  // The standing instructions bind every downstream session: they open each
  // briefing and enter each cache key via the builders' `extraParts` tails.
  const instructions = decisions.instructions ?? []
  const instructionParts = [instructionsFingerprint(instructions)]
  // Universe mode: each doc's source rides its briefing AND its cache key, so a
  // document that changes source is judged again rather than read off a hit.
  const originOf = (doc: DocCandidate): DocOrigin | undefined => opts.docOrigins?.get(doc.path)
  const originParts = (doc: DocCandidate): string[] => {
    const part = docOriginCachePart(originOf(doc))
    return part ? [part] : []
  }

  // Resolve identity AFTER discovery + scope application: corpus name-frequency
  // expansion reads the docs that are actually in scope. `!== undefined` so an
  // explicit null is honored (the workspace scan).
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
  for (const skip of prefilterSkipped) {
    fact('discover', `${skip.path}: dropped before curation, ${skip.reason}`)
  }
  for (const doc of structuralKept) {
    fact('discover', `${doc.path}: structural spec, kept without a session`)
  }
  for (const doc of allDocs) {
    if (manualExcludes.has(doc.path)) fact('discover', `${doc.path}: force-excluded by a decision`)
    else if (manualSet.has(doc.path)) fact('discover', `${doc.path}: force-included by a decision`)
  }
  opts.onDiscover?.(allDocs.length, curateItems.length)

  // ---- Curate-doc sessions (one per doc) -----------------------------------
  // Live label view for `corpus_vocab`: the labels of the docs folded so far.
  const liveTags = new Map<string, AreaTag[]>()
  const liveVocab = (): { products: string[]; concerns: string[] } => {
    const products = new Set<string>()
    const concerns = new Set<string>()
    // The last scan's labels are in the vocabulary from the first doc on, so
    // a session never mints a new spelling for an area that already exists.
    for (const id of priorAreaIds) {
      const tag = splitArea(id)
      if (tag.product === 'process') continue
      if (tag.product !== 'core') products.add(tag.product)
      concerns.add(tag.concern)
    }
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
    cacheKey: (doc) => curateDocCacheKey({ identity, doc }, [...instructionParts, ...originParts(doc)]),
    legacyCacheKeys: (doc) => curateDocLegacyCacheKeys({ identity, doc }, [...instructionParts, ...originParts(doc)]),
    schema: DocVerdictSchema,
    session: (doc) => curateDocSessionDef({ doc, universe, liveVocab }),
    briefing: (doc) => curateDocBriefing(doc, identity, instructions, originOf(doc), priorTagsByRef.get(doc.path) ?? []),
    driver: opts.driver,
    persistence: opts.persistence,
    ...(replayOnly('curate') ? { cacheOnly: 'curate' as const } : {}),
    ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
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
  let keptProse: DocCandidate[] = []
  const tagsByPath = new Map<string, DocAreaTags>()
  // Each kept doc's tags as its curation verdict wrote them, before any
  // reconciling or settling: the tags a fact recorded from it carries.
  const rawTagsByPath = new Map<string, AreaTag[]>()
  // Seeded with the scope-excluded docs (discovery order), so the corpus's
  // skip list shows them and the dashboard can force-include them back.
  const skippedDocs: Array<{ path: string; reason: string; category?: string }> = [...scopeExcluded]
  const reinstatedCount = { value: 0 }
  let thirdPartyDropped = 0

  const keepDoc = (doc: DocCandidate, rawTags: AreaTag[], statusRaw: string | null | undefined): void => {
    keptProse.push(doc)
    rawTagsByPath.set(doc.path, rawTags)
    const status: Status | undefined =
      (statusRaw ? classifyStatusValue(statusRaw) : undefined) ?? parseDocStatus(docBody(doc))
    // A label the session only re-spelled keeps the id the last scan gave it.
    const tags = reconcileDocTagsWithPrior(rawTags, priorTagsByRef.get(doc.path) ?? [])
    for (const [i, tag] of tags.entries()) {
      const before = rawTags[i]
      if (before && (before.product !== tag.product || before.concern !== tag.concern)) {
        fact('tag', `${doc.path}: area "${before.product}/${before.concern}" kept as "${tag.product}/${tag.concern}" from the last scan`)
      }
    }
    tagsByPath.set(doc.path, { tags, ...(status ? { status } : {}) })
  }

  /** Who answered for this doc: its curation session, or the outcome cache. */
  const curatedBy = (path: string): string =>
    verdictByPath.get(path)?.outcome.fromCache === true ? 'from cache' : 'by a session'
  const areaLabel = (tags: readonly AreaTag[]): string =>
    tags.length > 0 ? tags.map((t) => `${t.product}/${t.concern}`).join(', ') : 'no areas'

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
      fact('tag', `${doc.path}: kept with no areas, its curation session failed`)
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
      fact('tag', `${doc.path}: kept, ${areaLabel(v.areas)}, ${curatedBy(doc.path)}`)
      keepDoc(doc, v.areas, v.status)
      continue
    }
    if (attributed.category === 'third-party') {
      thirdPartyDropped++
      if (namesOurProduct(doc, ours)) {
        // The alias backstop: the doc's prose names our own product — reinstate.
        reinstatedCount.value++
        fact(
          'tag',
          `${doc.path}: read as third-party but its prose names our product, kept, ${areaLabel(v.areas)}`,
        )
        keepDoc(doc, v.areas, v.status)
        continue
      }
    }
    fact('tag', `${doc.path}: skipped, ${attributed.reason}, ${curatedBy(doc.path)}`)
    skippedDocs.push({ path: doc.path, reason: attributed.reason, category: attributed.category })
  }

  // ---- Corpus review (computer path; one session per shard) ----------------
  // What only the whole kept set shows: restatements, plans for what shipped
  // otherwise, tooling notes. Its drops are folded here, after the cache, so a
  // pin made since a cached review still wins.
  let reviewSummary: KindRun | null = null
  if (opts.computer && keptProse.length > 0) {
    const keptRefs = new Set(keptProse.map((d) => d.path))
    const areasByDoc = new Map(
      keptProse.map((d) => [
        d.path,
        canonicalDocTags(tagsByPath.get(d.path)?.tags ?? []).map((t) => `${t.product}/${t.concern}`),
      ]),
    )
    const shards = planCorpusReviewShards(keptProse, areasByDoc)
    const keptSet = corpusFingerprint(keptProse)
    const reviewed: CorpusReviewOutcome[] = []
    const dir = corpusDir(keptProse)
    try {
      reviewSummary = await runCachedSessionPool<CorpusReviewShard, CorpusReviewOutcome>({
        repoRoot,
        kind: CORPUS_REVIEW_SESSION_KIND,
        cacheName: CORPUS_REVIEW_CACHE_NAME,
        items: shards,
        workItem: (shard) => corpusReviewWorkItem(shard.index),
        cacheKey: (shard) => corpusReviewCacheKey(shard, keptSet, instructionParts),
        schema: CorpusReviewOutcomeSchema,
        session: (shard) => corpusReviewSessionDef({ shard, kept: keptRefs, dir }),
        briefing: (shard) =>
          corpusReviewBriefing({ shard, keptCount: keptProse.length, root: dir.root(), areasByDoc, instructions }),
        driver: opts.driver,
        persistence: opts.persistence,
        timeoutMs: CORPUS_REVIEW_TIMEOUT_MS,
        ...(replayOnly('curate') ? { cacheOnly: 'curate' as const } : {}),
        ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
        ...(opts.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
        ...(opts.now ? { now: opts.now } : {}),
        fold: (shard, result) => {
          const item = corpusReviewWorkItem(shard.index)
          if (result.outcome.status === 'failed') {
            // Fail-open: a shard nobody reviewed keeps every doc curation kept.
            fact('tag', `${item}: the corpus review failed, its ${shard.docs.length} docs stay`)
            return
          }
          const by = result.outcome.fromCache === true ? ', from cache' : ''
          fact('tag', `${item}: ${shard.docs.length} kept docs reviewed, ${result.outcome.output.drops.length} named to drop${by}`)
          reviewed.push(result.outcome.output)
        },
      })
    } finally {
      dir.dispose()
    }
    assertKindHealthy(reviewSummary)
    const applied = applyCorpusReview(reviewed, keptRefs, manualSet)
    for (const declined of applied.declined) {
      fact('tag', `${declined.ref}: kept although the corpus review would drop it, ${declined.why}`)
    }
    if (applied.drops.length > 0) {
      const dropped = new Set(applied.drops.map((d) => d.ref))
      keptProse = keptProse.filter((d) => !dropped.has(d.path))
      for (const drop of applied.drops) {
        tagsByPath.delete(drop.ref)
        fact('tag', `${drop.ref}: skipped by the corpus review, ${drop.reason}`)
        skippedDocs.push({ path: drop.ref, reason: drop.reason, category: drop.category })
      }
    }
  }

  if (only === 'curate') {
    return stoppedResult('curate', [...(orchestrateSummary ? [orchestrateSummary] : []), curateSummary, ...(reviewSummary ? [reviewSummary] : [])], {
      skippedDocs,
      stats: {
        docsKept: keptProse.length + structuralKept.length,
        thirdPartyDropped,
        thirdPartyRestored: reinstatedCount.value,
        classifyFailed: curateSummary.failed,
      },
    })
  }

  // ---- Settle-areas session (≤1, true barrier after the curation pool) -----
  const canonicalByPath = new Map<string, AreaTag[]>(
    keptProse.map((doc) => [doc.path, canonicalDocTags(tagsByPath.get(doc.path)?.tags ?? [])]),
  )
  const vocabView: AreaVocabView = collectAreaVocab(canonicalByPath)
  let vocabMap: VocabMap = { products: {}, concerns: {} }
  // The settlement's per-doc concern rewrites, kept for the facts recorded
  // from each doc: their tags take the same path as the doc's own.
  let reassignmentsByRef: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map()
  let settleSummary: (ScanSessionKindSummary & { firstError?: string; allTransport: boolean }) | null = null
  if (keptProse.length > 0 && settleAreasGate(vocabView, priorAreaIds)) {
    let settlement: AreaSettlement | null = null
    settleSummary = await runCachedSessionPool<typeof SETTLE_AREAS_WORK_ITEM, AreaSettlement>({
      repoRoot,
      kind: SETTLE_AREAS_SESSION_KIND,
      cacheName: SETTLE_AREAS_CACHE_NAME,
      items: [SETTLE_AREAS_WORK_ITEM],
      workItem: () => SETTLE_AREAS_WORK_ITEM,
      cacheKey: () => settleAreasCacheKey(vocabView, instructionParts),
      legacyCacheKeys: () => [settleAreasLegacyCacheKey(vocabView, instructionParts)],
      schema: AreaSettlementSchema,
      session: () => settleAreasSessionDef({ vocab: vocabView, universe, prior: priorAreaIds }),
      briefing: () => settleAreasBriefing(vocabView, universe, instructions, priorAreaIds),
      driver: opts.driver,
      persistence: opts.persistence,
      concurrency: 1,
      ...(replayOnly('settle') ? { cacheOnly: 'settle' as const } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
      ...(opts.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      fold: (_item, result) => {
        if (result.outcome.status === 'completed') settlement = result.outcome.output
      },
    })
    assertKindHealthy(settleSummary)
    if (settlement) {
      const applied = applySettlement(settlement, vocabView, priorAreaIds)
      vocabMap = applied.vocab
      const settledBy = settleSummary.fromCache > 0 ? 'from cache' : 'by a session'
      fact('tag', `area labels settled ${settledBy}`)
      for (const [from, to] of Object.entries(applied.vocab.products)) {
        if (from !== to) fact('tag', `product "${from}" merged into "${to}"`)
      }
      for (const [from, to] of Object.entries(applied.vocab.concerns)) {
        if (from !== to) fact('tag', `concern "${from}" merged into "${to}"`)
      }
      // Subdivision reassignments rewrite the CANONICAL concern per doc; the
      // merges ride the vocab map through the grouper, exactly as the old
      // normalizer's map did.
      reassignmentsByRef = applied.reassignments
      for (const [ref, perDoc] of applied.reassignments) {
        for (const [from, to] of perDoc) fact('tag', `${ref}: concern "${from}" reassigned to "${to}"`)
        const tags = canonicalByPath.get(ref)
        if (!tags) continue
        canonicalByPath.set(ref, reassignConcerns(tags, perDoc))
      }
      opts.onSettle?.(settleSummary.fromCache > 0 ? 'cached' : 'ran')
    } else {
      fact('tag', 'the area settling session failed, the labels were kept as curated')
      opts.onSettle?.('failed')
    }
  } else {
    fact('tag', 'the area labels needed no settling')
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
  // The areas, reconciled against the last scan's: what this scan kept, added
  // and retired, on the record — an added area beside a retired one is the
  // rename the rules above exist to prevent, and the reader should see it.
  if (priorAreaIds.length > 0) {
    const live = new Set(grouped.areas.map((a) => a.id))
    const kept = priorAreaIds.filter((id) => live.has(id))
    const retired = priorAreaIds.filter((id) => !live.has(id))
    const added = grouped.areas.map((a) => a.id).filter((id) => !priorAreaIds.includes(id))
    fact('tag', `areas reconciled against the last scan: ${kept.length} kept, ${added.length} added, ${retired.length} retired`)
    for (const id of retired) fact('tag', `area "${id}" retired: no document carries it now`)
    for (const id of added) fact('tag', `area "${id}" added`)
  }

  if (only === 'settle') {
    return stoppedResult(
      'settle',
      [
        ...(orchestrateSummary ? [orchestrateSummary] : []),
        curateSummary,
        ...(reviewSummary ? [reviewSummary] : []),
        ...(settleSummary ? [settleSummary] : []),
      ],
      {
        skippedDocs,
        stats: {
          docsKept: keptProse.length + structuralKept.length,
          areaCount: grouped.areas.length,
          thirdPartyDropped,
          thirdPartyRestored: reinstatedCount.value,
          classifyFailed: curateSummary.failed,
        },
      },
    )
  }

  // ---- The overlap step ----------------------------------------------------
  if (opts.disableOverlapDetection === true) fact('overlap', 'overlap detection is off for this run')

  // Which areas each doc landed in — the SPAN a flagged pair still records
  // (`overlap.areas`) even though the pair is judged in one area only.
  const areaIdsByDoc = new Map<string, string[]>()
  for (const area of grouped.areas) {
    for (const ref of area.docRefs) {
      const list = areaIdsByDoc.get(ref) ?? []
      list.push(area.id)
      areaIdsByDoc.set(ref, list)
    }
  }
  const spannedAreas = (a: string, b: string, assigned: string): string[] => {
    const bSet = new Set(areaIdsByDoc.get(b) ?? [])
    const shared = (areaIdsByDoc.get(a) ?? []).filter((id) => bSet.has(id)).sort()
    return shared.length > 0 ? shared : [assigned]
  }

  const overlapEntries: Array<{ area: string; overlap: Overlap }> = []
  const notReachedByArea = new Map<string, Set<string>>()
  const sectionsOpenedByArea = new Map<string, number>()
  const uncheckedPairsByArea = new Map<string, CandidatePair[]>()
  const addUnchecked = (areaId: string, records: readonly CandidatePair[]): void => {
    if (records.length === 0) return
    const list = uncheckedPairsByArea.get(areaId) ?? []
    list.push(...records)
    uncheckedPairsByArea.set(areaId, list)
  }
  const addNotReached = (areaId: string, refs: readonly string[]): void => {
    if (refs.length === 0) return
    const set = notReachedByArea.get(areaId) ?? new Set<string>()
    for (const ref of refs) set.add(ref)
    notReachedByArea.set(areaId, set)
  }
  // Sums across a run's clusters; a legacy cache entry without the stamp
  // contributes nothing (absent means unknown, and a partial sum is still an
  // honest floor).
  const addSectionsOpened = (areaId: string, n: number): void => {
    sectionsOpenedByArea.set(areaId, (sectionsOpenedByArea.get(areaId) ?? 0) + n)
  }
  const bodyOf = (ref: string): string | undefined => {
    const d = universe.byPath.get(ref)
    return d ? docBody(d) : undefined
  }
  /** Re-anchor a finding's pointers against the docs, recording each move. */
  const verifiedSections = (
    a: string,
    b: string,
    flagged: Pick<Parameters<typeof verifyOverlapSections>[0], 'note' | 'sections'>,
  ) => {
    const sections = flagged.sections.filter((s) => s.doc === a || s.doc === b)
    const verified = verifyOverlapSections({ docs: [a, b], note: flagged.note, sections, bodyOf })
    verified.forEach((ptr, i) => {
      const claimed = sections[i]
      if (claimed && claimed.heading !== ptr.heading) {
        fact('verify', `${ptr.doc}: pointer re-anchored from ${claimed.heading ?? 'the lead'} to ${ptr.heading ?? 'the lead'}`)
      }
    })
    return verified
  }

  /**
   * Retrieval is deterministic: global claim-token/heading pairing over the
   * kept docs, each pair assigned to exactly ONE area, connected components
   * per area — a doc with no candidate collision costs no session at all.
   */
  async function reviewCollisionClusters(): Promise<KindRun> {
    const overlapItems: OverlapWorkItem[] =
      opts.disableOverlapDetection === true ? [] : deriveOverlapWorkItems(grouped.areas, keptProse, vocabMap)
    if (opts.disableOverlapDetection !== true && overlapItems.length === 0) {
      fact('overlap', 'no two docs collide, no cluster to review')
    }
    return runCachedSessionPool<OverlapWorkItem, z.infer<typeof OverlapOutcomeSchema>>({
      repoRoot,
      kind: OVERLAP_SESSION_KIND,
      cacheName: OVERLAP_SESSION_CACHE_NAME,
      items: overlapItems,
      workItem: (item) => overlapWorkItem(item.areaId, item.cluster),
      cacheKey: (item) => overlapSessionCacheKey(item, instructionParts),
      legacyCacheKeys: (item) => [overlapSessionLegacyCacheKey(item, instructionParts)],
      schema: OverlapOutcomeSchema,
      session: (item) => overlapSessionDef({ item, universe }),
      briefing: (item) => overlapBriefing(item, instructions, opts.priorOverlaps ?? []),
      driver: opts.driver,
      persistence: opts.persistence,
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onOverlapProgress ? { onProgress: opts.onOverlapProgress } : {}),
      ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
      ...(opts.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      // The skim signal AND the pair coverage are counted off the TRANSCRIPT,
      // never self-reported: the stamps overwrite anything the session claimed,
      // and they land in the CACHED value — so a fully-cached re-run keeps the
      // corpus's `sectionsOpened`/`uncheckedPairs` instead of silently dropping
      // them. A briefed pair counts as examined only when BOTH its sections
      // were opened.
      finalizeOutput: (item, output, sessionId) => {
        const opened = openedSections(opts.persistence, sessionId)
        return {
          ...output,
          sectionsOpened: countSectionsOpened(opts.persistence, sessionId),
          uncheckedPairs: uncheckedBriefedPairs(item.pairs, opened).map(pairRecord),
        }
      },
      fold: (item, result) => {
        if (result.outcome.status === 'failed') {
          // Fail-open per cluster chunk: no flags, the failure is tallied, every
          // doc of the chunk lands in notReached and every briefed pair in
          // uncheckedPairs — a budget-exhausted session reads as "not covered",
          // in the corpus, never as a log line. The skim signal is stamped here
          // too (a failure has a transcript even though it has no outcome), so
          // the corpus separates "opened 45 sections and still ran out" from
          // "never really read".
          fact(
            'overlap',
            `${overlapWorkItem(item.areaId, item.cluster)}: session failed, ${item.pairs.length} candidate pair${item.pairs.length === 1 ? '' : 's'} left unchecked`,
          )
          addNotReached(item.areaId, item.docs.map((d) => d.path))
          addUnchecked(item.areaId, item.pairs.map(pairRecord))
          if (result.sessionId !== undefined) {
            addSectionsOpened(item.areaId, countSectionsOpened(opts.persistence, result.sessionId))
          }
          return
        }
        const briefed = new Set(item.docs.map((d) => d.path))
        const reviewedBy = result.outcome.fromCache === true ? ', from cache' : ''
        fact(
          'overlap',
          `${overlapWorkItem(item.areaId, item.cluster)}: ${item.pairs.length} candidate pair${item.pairs.length === 1 ? '' : 's'} compared, ${result.outcome.output.overlaps.length} disagreement${result.outcome.output.overlaps.length === 1 ? '' : 's'}${reviewedBy}`,
        )
        for (const flagged of result.outcome.output.overlaps) {
          // The fold's own validation — never trust the transcript: a pointer to
          // a doc the session was not briefed on is dropped, and so is a doc
          // paired with itself, which a collision cluster never nominates;
          // every kept pointer is re-anchored deterministically (quote-first)
          // against the doc text.
          const [a, b] = flagged.docs
          if (a === b || !briefed.has(a) || !briefed.has(b)) continue
          fact('overlap', `${a} vs ${b}: ${flagged.note}`)
          const verified = verifiedSections(a, b, flagged)
          overlapEntries.push({
            area: item.areaId,
            overlap: {
              docs: [a, b],
              note: flagged.note,
              sections: verified,
              areas: spannedAreas(a, b, item.areaId),
              review: flagged.review,
            },
          })
        }
        addNotReached(item.areaId, result.outcome.output.notReached.filter((ref) => briefed.has(ref)))
        // Fresh and cached alike: the run stamped `sectionsOpened` and
        // `uncheckedPairs` into the value before it entered the cache
        // (finalizeOutput above). Absent only on a legacy entry cached before
        // the stamps existed — no signal, until that cluster re-runs.
        if (result.outcome.output.sectionsOpened !== undefined) {
          addSectionsOpened(item.areaId, result.outcome.output.sectionsOpened)
        }
        addUnchecked(item.areaId, result.outcome.output.uncheckedPairs ?? [])
      },
    })
  }

  // How a fact's raw tag lands in the corpus's areas: the path the doc's own
  // tags took, one tag at a time. A doc a decision pins files every fact under
  // the pinned areas, as the pin replaces the doc's own tags.
  const corpusAreaTags = new Map(grouped.docs.map((d) => [d.ref, d.areaTags]))
  const factAreas: FactAreaContext = {
    rawTags: rawTagsByPath,
    priorTags: priorTagsByRef,
    reassignments: reassignmentsByRef,
    vocab: vocabMap,
    pinned: new Map((decisions.manualAreas ?? []).map((m) => [m.doc, corpusAreaTags.get(m.doc) ?? []])),
  }

  /**
   * The facts path's first half: every kept prose doc with an area tag is
   * recorded, one session per window of its units, and each doc's ledger is
   * collected from its windows' outcomes. A failed window leaves its units out
   * and lands its doc in each of its areas' `notReached`.
   */
  async function recordFacts(): Promise<{ summary: KindRun; ledgers: DocFactLedger[] }> {
    const windowsByDoc = new Map<string, RecordFactsItem[]>()
    if (opts.disableOverlapDetection !== true) {
      for (const doc of keptProse) {
        // A conflict in a doc with no area could be filed under none.
        const tags = rawTagsByPath.get(doc.path) ?? []
        if (tags.length === 0) {
          fact('record', `${doc.path}: not recorded, it has no area tag`)
          continue
        }
        if ((areaIdsByDoc.get(doc.path) ?? []).length === 0) {
          fact('record', `${doc.path}: not recorded, it is in no area`)
          continue
        }
        const items = recordFactsItems(doc, tags)
        if (items.length === 0) fact('record', `${doc.path}: nothing to record, it has no units`)
        else windowsByDoc.set(doc.path, items)
      }
    }
    const outcomes = new Map<string, { ledger: FactLedger | null; fromCache: boolean }>()
    const summary = await runCachedSessionPool<RecordFactsItem, FactLedger>({
      repoRoot,
      kind: RECORD_FACTS_SESSION_KIND,
      cacheName: RECORD_FACTS_CACHE_NAME,
      items: [...windowsByDoc.values()].flat(),
      workItem: recordFactsWorkItem,
      cacheKey: (item) => recordFactsCacheKey(item, instructionParts),
      schema: FactLedgerSchema,
      session: recordFactsSessionDef,
      briefing: (item) => recordFactsBriefing(item, instructions),
      driver: opts.driver,
      persistence: opts.persistence,
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onRecordProgress ? { onProgress: opts.onRecordProgress } : {}),
      ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
      ...(opts.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      fold: (item, result) => {
        // Fail-open per window: a failed session records nothing of it.
        outcomes.set(
          recordFactsWorkItem(item),
          result.outcome.status === 'completed'
            ? { ledger: result.outcome.output, fromCache: result.outcome.fromCache === true }
            : { ledger: null, fromCache: false },
        )
      },
    })
    const ledgers = [...windowsByDoc].map(([ref, items]) => {
      const windows = items.map((item) => ({ item, outcome: outcomes.get(recordFactsWorkItem(item)) }))
      const ledger = docFactLedger({
        doc: ref,
        units: items[0]!.units,
        areas: items[0]!.areas,
        windows: windows.map(({ item, outcome }) => ({ window: item.window, ledger: outcome?.ledger ?? null })),
        canonicalAreas: (raw) => factAreaIds(factAreas, ref, raw),
      })
      const fromCache = windows.every(({ outcome }) => outcome?.fromCache === true)
      fact('record', `${ref}: ${describeDocLedger(ledger, items.length)}${fromCache ? ', from cache' : ''}`)
      if (ledger.failed.length > 0) for (const areaId of areaIdsByDoc.get(ref) ?? []) addNotReached(areaId, [ref])
      return ledger
    })
    return { summary, ledgers }
  }

  // What comparing facts came to, for the corpus: per area, the facts its area
  // batches compared and the groups they formed; for the whole corpus, the
  // subjects and what the batches left unplaced.
  const comparisonByArea = new Map<string, { facts: Set<RecordedFact>; groups: number }>()
  const splitAreas = new Map<string, { parts: number; cutPairs: number }>()
  let corpusComparison: CorpusComparison | undefined

  /** File one conflict a comparison found: under the area its two docs' areas give, spanning the areas both share. */
  const fileFinding = (flagged: OverlapFinding): void => {
    const [a, b] = flagged.docs
    const pair = a === b ? `${a}, inside the doc` : `${a} vs ${b}`
    const area = assignDocPairArea(a, b, areaIdsByDoc)
    if (area === null) {
      fact('overlap', `${pair}: no area to file the conflict under`)
      return
    }
    fact('overlap', `${pair}: ${flagged.note}`)
    overlapEntries.push({
      area,
      overlap: {
        docs: [a, b],
        note: flagged.note,
        sections: verifiedSections(a, b, flagged),
        areas: spannedAreas(a, b, area),
        review: flagged.review,
      },
    })
  }

  /**
   * The facts path's second half. The facts' subject names are settled (names
   * equal but for case, spacing and markup are one before any session runs;
   * the rest are settled in parts), the facts are planned into area batches
   * and the subject batches their subject families need, and each batch is
   * compared by one session; every
   * conflict that stands is filed as a finding. A failed settling session
   * merges nothing; a failed comparison lands its facts' docs in the
   * notReached of the areas it was comparing.
   */
  async function compareFactLedgers(ledgers: readonly DocFactLedger[]): Promise<KindRun[]> {
    const facts = ledgers.flatMap((ledger) => ledger.facts)
    const names = collectSubjectNames(facts)
    const parts = planSubjectParts(names)
    if (parts.length === 0 && names.length > 0) {
      fact('subjects', `${names.length} subject name${names.length === 1 ? '' : 's'}, nothing to settle`)
    }
    const merges = new Map<string, string>()
    const settleSummary = await runCachedSessionPool<SubjectPart, SubjectSettlement>({
      repoRoot,
      kind: SETTLE_SUBJECTS_SESSION_KIND,
      cacheName: SETTLE_SUBJECTS_CACHE_NAME,
      items: parts,
      workItem: settleSubjectsWorkItem,
      cacheKey: (part) => settleSubjectsCacheKey(part, instructionParts),
      schema: SubjectSettlementSchema,
      session: settleSubjectsSessionDef,
      briefing: (part) => settleSubjectsBriefing(part, instructions),
      driver: opts.driver,
      persistence: opts.persistence,
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onSubjectsProgress ? { onProgress: opts.onSubjectsProgress } : {}),
      ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
      ...(opts.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      fold: (part, result) => {
        const label = part.parts > 1 ? `subject names, part ${part.index} of ${part.parts}` : 'subject names'
        if (result.outcome.status === 'failed') {
          fact('subjects', `${label}: the session failed, its ${part.names.length} names stay as written`)
          return
        }
        const merged = subjectMerges(part, result.outcome.output)
        for (const [key, subject] of merged) merges.set(key, subject)
        const into = new Set(merged.values()).size
        const by = result.outcome.fromCache === true ? ', from cache' : ''
        fact('subjects', `${label}: ${part.names.length} names, ${merged.size} of them merged into ${into} subject${into === 1 ? '' : 's'}${by}`)
      },
    })
    assertKindHealthy(settleSummary)
    const subjectOf = settledSubjects(facts, names, merges)
    const settledCount = new Set([...subjectOf.values()].map(subjectKey)).size
    if (facts.length > 0) {
      fact(
        'subjects',
        `${facts.length} fact${facts.length === 1 ? '' : 's'}: ${names.length} subject name${names.length === 1 ? '' : 's'}, ${settledCount} settled subject${settledCount === 1 ? '' : 's'}`,
      )
    }

    const plan = planCompareBatches(facts, (f) => subjectOf.get(f) ?? f.subject)
    for (const [area, split] of plan.splitAreas) {
      splitAreas.set(area, split)
      const count = facts.filter((f) => f.areas.includes(area)).length
      fact(
        'compare',
        `${area}: ${count} facts, over the batch bound of ${COMPARE_BATCH_FACTS}, split into ${split.parts} parts, ${split.cutPairs} linked pair${split.cutPairs === 1 ? '' : 's'} cut`,
      )
    }
    if (plan.subjectFamilies > 0) {
      fact(
        'compare',
        `${plan.subjectFamilies} subject famil${plan.subjectFamilies === 1 ? 'y' : 'ies'} formed from settled subjects whose names share a rare word`,
      )
    }
    const subjectBatches = plan.batches.filter((b) => b.kind === 'subject').length
    if (subjectBatches > 0) {
      fact(
        'compare',
        `${plan.subjectBatchFamilies} famil${plan.subjectBatchFamilies === 1 ? 'y' : 'ies'} of subjects spanning area batches, ${plan.subjectBatchFacts} facts, compared again in ${subjectBatches} subject batch${subjectBatches === 1 ? '' : 'es'}`,
      )
    }
    if (opts.disableOverlapDetection !== true) {
      for (const area of grouped.areas) comparisonByArea.set(area.id, { facts: new Set(), groups: 0 })
    }

    const unplaced = new Set<RecordedFact>()
    const items: CompareItem[] = plan.batches.map((batch) => ({
      batch,
      docs: new Map(
        [...new Set(batch.facts.map((bf) => bf.fact.doc))].flatMap((ref) => {
          const doc = universe.byPath.get(ref)
          return doc ? [[ref, doc] as const] : []
        }),
      ),
    }))
    const compareSummary = await runCachedSessionPool<CompareItem, FactComparison>({
      repoRoot,
      kind: COMPARE_FACTS_SESSION_KIND,
      cacheName: COMPARE_FACTS_CACHE_NAME,
      items,
      workItem: (item) => compareFactsWorkItem(item.batch),
      cacheKey: (item) => compareFactsCacheKey(item, instructionParts),
      schema: FactComparisonSchema,
      session: compareFactsSessionDef,
      briefing: (item) => compareFactsBriefing(item, instructions, opts.priorOverlaps ?? []),
      driver: opts.driver,
      persistence: opts.persistence,
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onCompareProgress ? { onProgress: opts.onCompareProgress } : {}),
      ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
      ...(opts.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      fold: ({ batch }, result) => {
        const label = describeBatch(batch)
        // The areas this batch compared for: its own on an area batch, every
        // area of its facts on a subject batch.
        const comparedFor = (fact: RecordedFact): string[] =>
          batch.kind === 'area' ? fact.areas.filter((a) => batch.areas.includes(a)) : fact.areas
        if (result.outcome.status === 'failed') {
          const docs = new Set(batch.facts.map((bf) => bf.fact.doc))
          fact('compare', `${label}: session failed, its ${batch.facts.length} facts from ${docs.size} docs left uncompared`)
          for (const { fact: f } of batch.facts) for (const area of comparedFor(f)) addNotReached(area, [f.doc])
          return
        }
        // Never trust the transcript: the gate runs again here, and only what
        // it lets stand is folded.
        const check = checkGroups(result.outcome.output, batch)
        if (batch.kind === 'area') {
          for (const { fact: f } of batch.facts) for (const area of comparedFor(f)) comparisonByArea.get(area)?.facts.add(f)
          for (const group of check.groups) {
            for (const area of new Set(group.facts.flatMap((bf) => comparedFor(bf.fact)))) {
              const entry = comparisonByArea.get(area)
              if (entry) entry.groups += 1
            }
          }
        }
        const byId = new Map(batch.facts.map((bf) => [bf.id, bf.fact]))
        for (const id of check.unplaced) {
          const f = byId.get(id)
          if (f) unplaced.add(f)
        }
        const by = result.outcome.fromCache === true ? ', from cache' : ''
        const left = check.unplaced.length > 0 ? `, ${check.unplaced.length} left unplaced` : ''
        fact(
          'compare',
          `${label}: ${batch.facts.length} facts, ${check.groups.length} group${check.groups.length === 1 ? '' : 's'}, ${check.findings.length} conflict${check.findings.length === 1 ? '' : 's'}${left}${by}`,
        )
        for (const finding of check.findings) fileFinding(finding)
      },
    })
    if (opts.disableOverlapDetection !== true) {
      corpusComparison = {
        subjectNames: names.length,
        settledSubjects: settledCount,
        subjectFamilies: plan.subjectFamilies,
        subjectBatchFamilies: plan.subjectBatchFamilies,
        subjectBatchFacts: plan.subjectBatchFacts,
        unplacedFacts: unplaced.size,
      }
    }
    return [settleSummary, compareSummary]
  }

  let factLedgers: DocFactLedger[] | undefined
  const overlapSummaries: KindRun[] = []
  switch (conflictMethod) {
    case 'facts': {
      const recorded = await recordFacts()
      assertKindHealthy(recorded.summary)
      factLedgers = recorded.ledgers
      overlapSummaries.push(recorded.summary, ...(await compareFactLedgers(recorded.ledgers)))
      break
    }
    case 'pairing':
      overlapSummaries.push(await reviewCollisionClusters())
      break
  }
  for (const summary of overlapSummaries) assertKindHealthy(summary)

  // Cross-area dedup (det, the rule in @truecourse/shared): the same
  // disagreement on a doc pair sharing several areas collapses to one record
  // under a representative area, every spanned area listed. A finding that
  // names its passages merges only with one naming the same two, and those are
  // folded into one that keeps every member's note.
  const overlapsByArea = new Map<string, Overlap[]>()
  for (const merged of dedupeCrossAreaOverlaps(overlapEntries)) {
    const [a, b] = merged.overlap.docs
    if (merged.areas.length > 1) {
      fact('verify', `${a} vs ${b}: one disagreement across ${merged.areas.join(', ')}`)
    }
    const folded = namesPassages(merged.overlap) && merged.members.length > 1
    if (folded) {
      fact('verify', `${a} vs ${b}: ${merged.members.length} conflicts on the same two passages, folded into one`)
    }
    const list = overlapsByArea.get(merged.area) ?? []
    list.push({ ...(folded ? foldSamePassages(merged.members) : merged.overlap), areas: merged.areas })
    overlapsByArea.set(merged.area, list)
  }
  for (const list of overlapsByArea.values()) {
    list.sort((x, y) => (x.docs.join() < y.docs.join() ? -1 : 1))
  }

  const areas: Area[] = grouped.areas.map((a) => {
    const notReached = notReachedByArea.get(a.id)
    const sectionsOpened = sectionsOpenedByArea.get(a.id)
    const uncheckedPairs = uncheckedPairsByArea.get(a.id)
    const compared = comparisonByArea.get(a.id)
    const comparison: AreaComparison | undefined = compared && {
      facts: compared.facts.size,
      groups: compared.groups,
      ...splitAreas.get(a.id),
    }
    return {
      ...a,
      overlaps: overlapsByArea.get(a.id) ?? [],
      ...(notReached && notReached.size > 0 ? { notReached: [...notReached].sort() } : {}),
      ...(sectionsOpened !== undefined ? { sectionsOpened } : {}),
      ...(uncheckedPairs && uncheckedPairs.length > 0 ? { uncheckedPairs } : {}),
      ...(comparison ? { comparison } : {}),
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
  // A recorded doc carries its ledger's counts; the ledger itself stays in the cache.
  const ledgerCounts = new Map((factLedgers ?? []).map((ledger) => [ledger.doc, docLedgerCounts(ledger)]))
  const corpus: CuratedCorpus = {
    version: 3,
    generatedAt: new Date().toISOString(),
    docs: [
      ...grouped.docs.map((doc) => {
        const ledger = ledgerCounts.get(doc.ref)
        return ledger ? { ...doc, ledger } : doc
      }),
      ...structuralCorpusDocs,
    ],
    areas,
    skippedDocs: skippedDocs.map((s) => ({ ref: s.path, reason: s.reason, category: s.category })),
    ...(corpusComparison ? { comparison: corpusComparison } : {}),
  }
  let effectiveDecisions = decisions
  let autoResolvedConflicts: CurateStats['autoResolvedConflicts'] = []
  // The last gate before the only write of the run: a cancellation that landed
  // in the deterministic fold above must not reach corpus.json either.
  throwIfAborted()
  if (!opts.skipCorpusWrite) {
    writeCorpus(repoRoot, {
      docs: corpus.docs,
      areas: corpus.areas,
      skippedDocs: corpus.skippedDocs,
      generatedAt: corpus.generatedAt,
      ...(corpus.comparison ? { comparison: corpus.comparison } : {}),
    })
    fact('verify', 'corpus.json written')
    effectiveDecisions = pruneOrphanedConflictResolutions(repoRoot, corpus, decisions)
    const auto = opts.skipAutoApply
      ? { decisions: effectiveDecisions, applied: [] }
      : autoApplyHighConfidenceRecommendations(repoRoot, corpus, effectiveDecisions)
    effectiveDecisions = auto.decisions
    autoResolvedConflicts = auto.applied
    for (const applied of auto.applied) {
      const pair = applied.a === applied.b ? `${applied.a}, inside the doc` : `${applied.a} vs ${applied.b}`
      const winner =
        applied.a === applied.b
          ? `its ${applied.verdict === 'a' ? 'first' : 'second'} passage`
          : applied.verdict === 'a' ? applied.a : applied.b
      fact(
        'verify',
        applied.verdict === 'dismissed'
          ? `${pair}: auto-dismissed in ${applied.area}`
          : `${pair}: auto-resolved in favour of ${winner}`,
      )
    }
  }

  // ---- Stats ----------------------------------------------------------------
  const summaries = [
    ...(orchestrateSummary ? [orchestrateSummary] : []),
    curateSummary,
    ...(reviewSummary ? [reviewSummary] : []),
    ...(settleSummary ? [settleSummary] : []),
    ...overlapSummaries,
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
    ...(factLedgers ? { factLedgers } : {}),
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

/**
 * The sections a session actually opened, keyed for pair-coverage matching
 * (`openedSectionKey`), read off the TRANSCRIPT: every successful
 * `read_section` result opens with the run's own header line
 * (`--- <doc> · <heading> ---`, `lead` for a null heading), so the set is a
 * parse of what the tool really answered — never what the session claims.
 */
function openedSections(persistence: SessionPersistence, sessionId: string): Set<string> {
  const opened = new Set<string>()
  for (const event of persistence.readEvents(sessionId)) {
    if (event.type !== 'tool-result' || event.toolName !== 'read_section' || event.isError === true) continue
    const header = /^--- (.+) ---$/.exec(event.content.split('\n', 1)[0])
    if (!header) continue
    const sep = header[1].indexOf(' · ')
    if (sep === -1) continue
    const doc = header[1].slice(0, sep)
    const heading = header[1].slice(sep + 3)
    opened.add(openedSectionKey(doc, heading === 'lead' ? null : heading))
  }
  return opened
}
