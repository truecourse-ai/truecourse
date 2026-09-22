/**
 * Shared in-process entry points for the document scan. The dashboard server
 * imports these so progress wiring and the decisions read-modify-writes live in
 * exactly one place.
 *
 * The caller passes a `StepTracker` and we drive it through the high-level
 * phases:
 *
 *   curate         discover → tag areas → group → flag overlaps → corpus.json
 *
 * Step keys + labels are a stable taxonomy the progress UI keys on.
 * Implementations of the actual pipelines come from
 * `@truecourse/spec-consolidator`; this module just orchestrates them
 * and reports progress.
 */

import {
  classifyDoc,
  writeDecisions,
  type CuratedCorpus,
  type CurateResult,
  type ConflictResolution,
  type DecisionsFile,
  type DocCandidate,
  type RepoIdentity,
} from '@truecourse/spec-consolidator';
import type { LlmTransportMode } from '../services/llm/provider-config.js';
import { openConflicts } from '@truecourse/shared';

export type {
  DecisionsFile,
  ConflictResolution,
  CuratedCorpus,
} from '@truecourse/spec-consolidator';
import type { SessionDriver, UserInputQuestion } from '@truecourse/agent-loop';
import { runSpecScanSessions, type ScanStep } from '../services/spec-scan/run.js';
export {
  SCAN_STEPS,
  ScanAbortedError,
  ScanStepNotReadyError,
  type ScanStep,
} from '../services/spec-scan/run.js';
import { ScanAbortedError } from '../services/spec-scan/run.js';
import {
  SPEC_SCAN_ORCHESTRATE_SESSION_KIND,
  normalizeScopePath,
  type ScopeSourceView,
} from '../services/spec-scan/orchestrate.js';
import {
  CURATE_DOC_SESSION_KIND,
  type DocOrigin,
} from '../services/spec-scan/curate-doc.js';
import { SETTLE_AREAS_SESSION_KIND } from '../services/spec-scan/settle-areas.js';
import { OVERLAP_SESSION_KIND } from '../services/spec-scan/overlap.js';
import { createStoredSessionRun, type SessionRunStartedInfo } from '../lib/sessions-store.js';
import { resolveCommitSha, type WorkspaceRef } from '../lib/repo-ref.js';
import {
  createClaudeCodeSessionDriver,
  type ConfiguredSessionDriver,
} from '../services/llm/session-driver.js';
import type { LlmEstimate } from '../services/llm/token-estimator.js';
import { estimateScanTokens } from '../services/llm/spec-estimate.js';
import { getModelPrices } from '../services/llm/model-prices.js';

/**
 * Thrown when the user declines the pre-flight LLM cost estimate. Scan and
 * generate are entirely LLM-driven, so a decline aborts the run. Callers catch
 * this to exit cleanly.
 */
export class EstimateDeclined extends Error {
  constructor(public readonly kind: 'scan' | 'guard' | 'guard setup') {
    super(`${kind} declined at the LLM cost estimate`);
    this.name = 'EstimateDeclined';
  }
}

/**
 * Await a confirm that may block on a human, or throw {@link ScanAbortedError}
 * the moment `signal` aborts — whichever comes first. The abandoned confirm is
 * left to settle on its own (its handler owns its cleanup/backstop); its late
 * answer just resolves a promise nobody holds.
 */
async function raceAbort<T>(confirm: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return confirm;
  if (signal.aborted) throw new ScanAbortedError();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new ScanAbortedError());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([confirm, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { saveWorkspaceSpec, loadWorkspaceSpec } from '../lib/spec-store.js';
import { readRepoDoc } from '../lib/repo-doc-reader.js';
import { withEstimatePhase, type EstimatePhase, type StepTracker } from '../progress.js';

// ---------------------------------------------------------------------------
// Step taxonomies — exported so callers can pre-build the tracker.
// ---------------------------------------------------------------------------

// Curate docs into corpus.json.
export const CURATE_STEPS = [
  { key: 'discover', label: 'Discovering docs' },
  { key: 'tag', label: 'Tagging doc areas' },
  { key: 'overlap', label: 'Flagging overlaps' },
  { key: 'verify', label: 'Verifying conflicts' },
] as const;

/**
 * Which session kinds do each scan phase's work — declared here, beside the
 * checklist itself, and stamped onto the run record so a reader places sessions
 * under phases without a mapping of its own. `verify` is the deterministic fold
 * (re-anchoring, dedup, auto-apply): no sessions at all.
 */
const CURATE_STEP_SESSION_KINDS: Record<string, readonly string[]> = {
  discover: [SPEC_SCAN_ORCHESTRATE_SESSION_KIND],
  tag: [CURATE_DOC_SESSION_KIND, SETTLE_AREAS_SESSION_KIND],
  overlap: [OVERLAP_SESSION_KIND],
  verify: [],
};

// ---------------------------------------------------------------------------
// Corpus path driver — the entry point the dashboard routes call.
// `curateInProcess` builds corpus.json via the SESSION-based scan run
// (`services/spec-scan/run.ts`): one `spec-scan.curate-doc`
// session per doc, at most one `spec-scan.settle-areas` session, one
// `spec-scan.overlap` session per area. The four CURATE_STEPS keys are kept so
// the progress UI renders unchanged.
// ---------------------------------------------------------------------------

export interface SpecCurateInProcessResult {
  curate: CurateResult;
  /** True when the scan made zero LLM calls — every doc was unchanged (cached). */
  noChanges: boolean;
  /**
   * Questions the interactive scope orchestrator left unanswered. A
   * non-interactive run never blocks on them; the dashboard summary must
   * surface them LOUDLY.
   */
  pendingQuestions: UserInputQuestion[];
  /** The orchestrator session's findings — verbatim observations for human eyes. */
  scanFindings: string[];
  /**
   * Set when a single-step run (`only`) stopped before assembly — the step ran,
   * corpus.json is untouched. Absent on a completed scan (including
   * `only: 'overlap'`, which runs through the corpus write).
   */
  stoppedAfter?: ScanStep;
  /** The sessions-store scratch dir this run used, under the runtime directory —
   *  for stepwise inspection. */
  sessionsRunDir: string;
}

export interface CurateInProcessOptions {
  /** The dashboard finishes only after its server-side corpus persistence succeeds. */
  deferRunCompletion?: boolean;
  tracker?: StepTracker;
  skipGit?: boolean;
  /** Compute the corpus without overwriting corpus.json — for read-only callers. */
  skipCorpusWrite?: boolean;
  /**
   * User resolutions (manual areas / includes / conflict verdicts) to fold into
   * the scan. The caller MUST pass the stored decisions: a scan runs on a fresh
   * working tree that holds no resolutions of its own, so without this it
   * re-detects already-resolved conflicts.
   */
  decisions?: DecisionsFile;
  /**
   * The corpus the last scan wrote, for the areas to reconcile against. The
   * workspace scan passes the stored version (its scratch tree holds none);
   * omit and the run reads `corpus.json` from the tree.
   */
  previousCorpus?: CuratedCorpus | null;
  /**
   * Inject the doc set instead of walking the working tree — the workspace scan
   * sources its documents through the repo-doc seam (`readRepoDoc`).
   */
  docSource?: () => DocCandidate[] | Promise<DocCandidate[]>;
  /**
   * Who this repository is, for the curation session's IDENTITY block. Passed
   * explicitly — including explicit `null` — because a scan runs on an
   * ephemeral clone whose directory name says nothing. Omit and the run
   * resolves it from the tree.
   */
  repoIdentity?: RepoIdentity | null;
  /**
   * Pre-flight LLM cost estimate gate. Called with the token estimate before any
   * LLM work; return `false` to abort (throws {@link EstimateDeclined}). Omit to
   * run without confirmation.
   */
  onLlmEstimate?: (estimate: LlmEstimate) => Promise<boolean>;
  /**
   * Progress surface for the estimate itself (it runs before the first pipeline
   * step, so the tracker can't carry it). The dashboard passes
   * `estimateStepPhase(tracker)`.
   */
  onEstimatePhase?: EstimatePhase;
  /** Ceiling on concurrent sessions (the pool's governor may run fewer). */
  concurrency?: number;
  /**
   * Cancel the scan. In-flight sessions get the signal, queued ones never
   * start, corpus.json is never written, and the call rejects with
   * {@link ScanAbortedError} — the run record closes `interrupted`. The
   * dashboard passes this so disconnecting a repository can stop the
   * onboarding scan that is holding it.
   */
  signal?: AbortSignal;
  /**
   * Single-step mode (`only`): run only this step's
   * sessions — prior steps replay from their durable artifacts (a missing one
   * throws {@link ScanStepNotReadyError}), later steps never start, and
   * corpus.json is written only by the final step (`overlap`). The estimate
   * gate prices only the chosen step.
   */
  only?: ScanStep;
  /** Skip the overlap sessions (the workspace corpus sync passes this). */
  disableOverlapDetection?: boolean;
  /**
   * Skip the scope-orchestrator session (stored verdicts still apply). The
   * workspace corpus sync passes this — its scratch tree (and the decisions
   * materialized into it) is deleted after the run, so a scope session there
   * would re-spend on every sync and settle nothing durable.
   */
  disableScopeOrchestration?: boolean;
  /**
   * UNIVERSE MODE (the workspace Document scan): the sources whose documents
   * make up the tree, with their document counts. Present ⇒ the scope session
   * runs over the CONTEXT ref grammar (`context/<sourceId>/…`), verdicting a
   * whole source by id or a subtree of one by path.
   */
  scopeSources?: readonly ScopeSourceView[];
  /** Universe mode: each document's source, for the curation briefing + key. */
  docOrigins?: ReadonlyMap<string, DocOrigin>;
  /**
   * What the "Discovering docs" step reports. The default counts docs; the
   * workspace scan states which source yielded how many documents, because it
   * walked no repository.
   */
  discoverDetail?: (docs: number, toCurate: number) => string;
  /**
   * A `question-asked` event from a scan session (the interactive scope
   * orchestrator), as it happens. Nothing ever blocks on it — an unanswered
   * question lands in the result's `pendingQuestions`.
   */
  onQuestion?: (workItem: string, question: UserInputQuestion) => void;
  /**
   * The sessions-store run record was just created (post-estimate-confirm,
   * before any session runs). The caller learns the run's id from it.
   */
  onRunStarted?: (info: SessionRunStartedInfo) => void;
  /**
   * Where the run record + transcripts are keyed — the repo IDENTITY when
   * `repoRoot` is an ephemeral clone that is deleted after the run (the
   * dashboard's per-run work trees). Defaults to `repoRoot`: for a persistent
   * checkout the sessions belong to the tree being scanned.
   */
  sessionsKey?: string;
  /**
   * Test seam / hosted injection: run the sessions on THIS driver instead of the
   * configured one. Tests pass a scripted driver; a hosted run passes the one it
   * built from the asking workspace's provider config.
   */
  driver?: SessionDriver;
  /**
   * The mode an injected `driver` runs in — the run record's attribution needs
   * it and the driver itself carries none. Unset, the saved selection (as a
   * `--llm` flag may have overridden it) answers.
   */
  transportMode?: LlmTransportMode;
}

/**
 * Run the session-based scan (corpus path) and drive a tracker through
 * CURATE_STEPS. Writes `.truecourse/specs/corpus.json` (the run does).
 * Idempotent: unchanged docs hit the per-doc session cache and cost nothing.
 *
 * The four step keys survive from the one-shot pipeline so the progress UI
 * renders unchanged; what each covers moved: `discover` =
 * discovery + prefilter, `tag` = the curate-doc pool + the settle session,
 * `overlap` = the per-area overlap sessions, `verify` = the deterministic
 * fold (pointer re-anchoring, cross-area dedup, confidence auto-apply).
 */
export async function curateInProcess(
  repoRoot: string,
  options: CurateInProcessOptions = {},
): Promise<SpecCurateInProcessResult> {
  const { tracker } = options;
  const mode: LlmTransportMode = options.transportMode ?? 'claude-code';

  // Pre-flight cost estimate + confirm, before any LLM work. Skip the prompt
  // when there's nothing to spend (a warmed cache yields an empty estimate).
  // Decline → abort. The estimate models SESSIONS: it probes the same scan
  // caches (same key builders, instructions fingerprint included) the run
  // reads, so estimate and run agree on what is actually spent.
  //
  // The confirm can wait on a human for minutes, so it must observe `signal`:
  // a scan cancelled while parked here (disconnecting the repository closes
  // the estimate's audience) ends NOW as aborted, instead of surviving the
  // cancel and dying confusingly whenever the stale confirm finally answers.
  if (options.onLlmEstimate) {
    const prices = await getModelPrices();
    const estimate = await withEstimatePhase(options.onEstimatePhase, () =>
      estimateScanTokens(repoRoot, prices, {
        identity: options.repoIdentity,
        ...(options.driver?.attribution.model ? { sessionModel: options.driver.attribution.model } : {}),
        only: options.only,
      }),
    );
    if ((estimate.stages?.length ?? 0) > 0) {
      const proceed = await raceAbort(options.onLlmEstimate(estimate), options.signal);
      if (!proceed) throw new EstimateDeclined('scan');
    }
  }

  // The run record every session's transcript is appended to.
  // Created after the estimate gate, so a declined scan leaves no run record.
  const gitRef = await resolveCommitSha(repoRoot);
  const run = await createStoredSessionRun(options.sessionsKey ?? repoRoot, { command: 'spec-scan', gitRef });
  options.onRunStarted?.({ command: 'spec-scan', runId: run.runId, dir: run.dir });
  // Mirror the step checklist into the run record as the run's own display:
  // the dashboard can only see what run.json carries, and the early phases
  // (discover/tag) have no sessions to show progress through.
  const untap = tracker?.tap((p) => {
    if (!p.steps) return;
    run.setChecklist(
      p.steps.map((step) => {
        const kinds = CURATE_STEP_SESSION_KINDS[step.key];
        return kinds ? { ...step, sessionKinds: [...kinds] } : step;
      }),
    );
  });

  // The driver, LAZILY: a fully-cached re-scan resolves nothing (so an edition
  // that cannot construct a driver offline still re-scans for free), and the
  // run record learns what it ran on the moment the first session needs it.
  let configured: ConfiguredSessionDriver | null = null;
  let injectedStamped = false;
  const driver = async (): Promise<SessionDriver> => {
    if (options.driver) {
      // An injected driver states what it calls too — a hosted run that showed
      // no provider at all was the record lying about a real one.
      if (!injectedStamped) {
        injectedStamped = true;
        const { provider, model, fallbackModel } = options.driver.attribution;
        run.setLlm({
          mode: options.transportMode ?? mode,
          provider,
          model,
          ...(fallbackModel ? { fallbackModel } : {}),
        });
      }
      return options.driver;
    }
    if (!configured) {
      configured = createClaudeCodeSessionDriver({
        cwd: repoRoot,
        providerStateDir: path.join(run.dir, 'provider'),
      });
      run.setLlm({
        mode: configured.mode,
        provider: configured.attribution.provider,
        model: configured.attribution.model,
        ...(configured.attribution.fallbackModel
          ? { fallbackModel: configured.attribution.fallbackModel }
          : {}),
      });
    }
    return configured.driver;
  };

  let tagStarted = false;
  let overlapStarted = false;
  let verifyStarted = false;
  // The overlap step counts two different things: the collision CLUSTERS it
  // reviews, and the AREAS of the whole corpus. Both lines name their own.
  let overlapClusters = 0;
  const ensureTag = (): void => {
    if (tagStarted) return;
    tracker?.done('discover');
    tracker?.start('tag');
    tagStarted = true;
  };
  const ensureOverlap = (): void => {
    ensureTag();
    if (overlapStarted) return;
    tracker?.done('tag');
    tracker?.start('overlap');
    overlapStarted = true;
  };
  // The verify step is now the deterministic fold: pointer re-anchoring,
  // cross-area dedup, and the confidence auto-apply.
  const ensureVerify = (): void => {
    ensureOverlap();
    if (verifyStarted) return;
    tracker?.done('overlap');
    tracker?.start('verify');
    verifyStarted = true;
  };

  try {
    tracker?.start('discover');
    let result: Awaited<ReturnType<typeof runSpecScanSessions>>;
    try {
      result = await runSpecScanSessions({
        repoRoot,
        driver,
        persistence: run.persistence,
        decisions: options.decisions,
        ...(options.previousCorpus !== undefined ? { previousCorpus: options.previousCorpus } : {}),
        docSource: options.docSource,
        repoIdentity: options.repoIdentity,
        skipGit: options.skipGit,
        skipCorpusWrite: options.skipCorpusWrite,
        disableOverlapDetection: options.disableOverlapDetection,
        disableScopeOrchestration: options.disableScopeOrchestration,
        ...(options.scopeSources ? { scopeSources: options.scopeSources } : {}),
        ...(options.docOrigins ? { docOrigins: options.docOrigins } : {}),
        ...(options.only !== undefined ? { only: options.only } : {}),
        ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        // What each phase did, line by line, onto the step it belongs to. The
        // phase keys ARE the checklist's step keys, so no mapping is needed.
        onFact: (step, line) => tracker?.fact(step, line),
        onDiscover: (docs, toCurate) =>
          tracker?.detail(
            'discover',
            options.discoverDetail
              ? options.discoverDetail(docs, toCurate)
              : `${docs} docs · ${toCurate} to curate`,
          ),
        onScope: (state) => {
          if (state === 'covered') tracker?.detail('discover', 'scope covered — no orchestrator session');
          else if (state === 'ran') tracker?.detail('discover', 'scan scope settled');
          else if (state === 'failed')
            tracker?.detail('discover', 'scope session failed — stored verdicts kept');
        },
        onSessionEvent: (workItem, event) => {
          if (event.type === 'question-asked') options.onQuestion?.(workItem, event.question);
        },
        onCurateProgress: (done, total) => {
          ensureTag();
          if (total > 0) tracker?.detail('tag', `${done}/${total} docs`);
        },
        onSettle: (state) => {
          ensureTag();
          if (state !== 'skipped') tracker?.detail('tag', `vocabulary ${state === 'cached' ? 'settled (cached)' : state === 'ran' ? 'settled' : 'settlement failed — labels kept as-is'}`);
        },
        onOverlapProgress: (done, total) => {
          ensureOverlap();
          overlapClusters = total;
          tracker?.detail(
            'overlap',
            total > 0
              ? `${done}/${total} cluster${total === 1 ? '' : 's'} to review`
              : 'no clusters to review',
          );
        },
      });
    } catch (e) {
      const active = verifyStarted ? 'verify' : overlapStarted ? 'overlap' : tagStarted ? 'tag' : 'discover';
      tracker?.error(active, (e as Error).message);
      // A cancelled scan is not a failed one: it stopped because the caller
      // said so, which is the same word the boot sweep gives a run whose
      // process died under it.
      run.finish(e instanceof ScanAbortedError ? 'interrupted' : 'failed', {
        ...(e instanceof ScanAbortedError ? {} : { error: { message: e instanceof Error ? e.message : String(e) } }),
      });
      throw e;
    }

    if (result.stoppedAfter) {
      // Single-step run: close only the steps that actually opened. A caller
      // may hand the tracker a reduced checklist, so the later keys don't
      // exist (and StepTracker no-ops on unknown keys anyway).
      const note = `stopped after ${result.stoppedAfter}`;
      if (tagStarted) tracker?.done('tag', note);
      else tracker?.done('discover', note);
    } else {
      ensureVerify();
      // The tag step's line is its outcome, not the last thing it was doing.
      tracker?.detail(
        'tag',
        `${result.stats.docsKept} kept · ${result.stats.docsScanned - result.stats.docsKept} skipped · ${result.stats.areaCount} areas`,
      );
      tracker?.done(
        'overlap',
        `${result.stats.areaCount} areas · ${overlapClusters} cluster${overlapClusters === 1 ? '' : 's'} reviewed · ${result.stats.overlapFlags} overlaps`,
      );
      tracker?.done(
        'verify',
        result.stats.autoResolvedConflicts.length > 0
          ? `${result.stats.autoResolvedConflicts.length} auto-resolved`
          : 'anchors verified',
      );
    }
    if (!options.deferRunCompletion) run.finish('completed');

    // "Nothing changed" = the scan ran zero fresh sessions (every kind was a
    // cache hit) and lost none. Computed by the run itself.
    return {
      curate: result,
      noChanges: result.noChanges,
      pendingQuestions: result.pendingQuestions,
      scanFindings: result.scanFindings,
      ...(result.stoppedAfter ? { stoppedAfter: result.stoppedAfter } : {}),
      sessionsRunDir: run.dir,
    };
  } catch (e) {
    // The run record is closed exactly once; the inner catch handled the scan
    // path, this covers the estimate/telemetry edges around it.
    if (run.record().status === 'running') run.finish('failed', { error: { message: e instanceof Error ? e.message : String(e) } });
    throw e;
  } finally { untap?.(); await run.flush?.(); }
}

// ---------------------------------------------------------------------------
// Workspace Knowledge (enterprise) — corpus path.
//
// External KB sources (Confluence, …) are synced as in-memory markdown. The
// corpus engine is disk-based, so we materialize the docs into a TRANSIENT
// scratch tree, run curate over it exactly like a repo, then persist the curated
// corpus under WORKSPACE scope (Postgres in EE). The scratch tree — and the
// bodies — are deleted after. Unchanged docs hit the per-doc caches → ~0 LLM on
// re-sync. Scenario generation runs separately (the auto-chained workspace guard
// job); this path is corpus-only.
// ---------------------------------------------------------------------------

/** One source document handed to the workspace corpus sync. The body is transient. */
export interface WorkspaceDocInput {
  /** Stable, namespaced relative path, e.g. `knowledge/confluence/<externalId>.md`. */
  docPath: string;
  /** The transient markdown body. Never persisted. */
  markdown: string;
  /** ISO timestamp (the source tool's `updatedAt`); informational. */
  lastTouched?: string;
}

export interface WorkspaceCorpusSyncResult {
  /** Areas in the curated workspace corpus. */
  areaCount: number;
}

/**
 * Curate the workspace Knowledge docs on the corpus path and persist the curated
 * corpus under workspace scope. Returns the area count for the sync notice.
 * Scenario generation runs separately (the auto-chained workspace guard job); this
 * path is corpus-only — it never generates or stores workspace `.tc` contracts.
 */
export async function syncWorkspaceCorpusInProcess(options: {
  workspaceOrgId: string;
  docs: WorkspaceDocInput[];
  /**
   * The workspace's curation decisions (force includes/excludes, conflict
   * verdicts). Materialized as `decisions.json` in the scratch tree so curate
   * folds them exactly as it does for a repo — a force-exclude drops its doc, a
   * verdict marks its conflict resolved. Omit for an un-curated sync.
   */
  decisions?: DecisionsFile;
  tracker?: StepTracker;
  // --- test seams (mirror curateInProcess(); production passes none) --------
  driver?: CurateInProcessOptions['driver'];
  disableOverlapDetection?: boolean;
}): Promise<WorkspaceCorpusSyncResult> {
  const ref: WorkspaceRef = { workspaceOrgId: options.workspaceOrgId };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ws-corpus-'));
  try {
    // Materialize the synced docs into the scratch tree (the corpus engine reads files).
    for (const doc of options.docs) {
      const dest = path.join(tmp, doc.docPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, doc.markdown, 'utf-8');
    }
    // Materialize the decisions BEFORE curate so it reads them from the tree,
    // the same channel every scan uses.
    if (options.decisions) writeDecisions(tmp, options.decisions);

    const { curate: curateResult } = await curateInProcess(tmp, {
      tracker: options.tracker,
      skipGit: true,
      driver: options.driver,
      disableOverlapDetection: options.disableOverlapDetection,
      // The scratch tree is transient — a scope session here would re-spend on
      // every sync and its verdicts die with the tree.
      disableScopeOrchestration: true,
    });
    // Persist the curated corpus under workspace scope (the dashboard reads it).
    await saveWorkspaceSpec(ref, 'corpus', curateResult.corpus);
    return { areaCount: curateResult.stats.areaCount };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * A stable content signature of a curated corpus — the sha over its meaningful
 * structure with the volatile fields zeroed (the top-level `generatedAt` and each
 * doc's `lastTouched`, both of which move on every run/sync without any content
 * change). Two corpora with the same signature curate to the same doc universe, so
 * the workspace ripple compares it before/after a process to skip re-scanning the
 * org's repos when nothing meaningful changed. Null corpus → the empty signature.
 */
export function corpusContentSha(corpus: CuratedCorpus | null): string {
  if (!corpus) return '';
  const stable = {
    ...corpus,
    generatedAt: '',
    docs: corpus.docs.map((d) => ({ ...d, lastTouched: '' })),
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

// ---------------------------------------------------------------------------
// Decisions, routed through the SpecStore seam.
//
// The user's accumulated resolutions — a single always-latest document per
// WORKSPACE, since the documents they resolve belong to the workspace and every
// repository reads a slice of them.
// ---------------------------------------------------------------------------

/** An empty decisions document (all lists empty) — the "no resolutions yet" base. */
export const EMPTY_DECISIONS: DecisionsFile = {
  version: 2,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
  conflictResolutions: [],
  scopeVerdicts: [],
  instructions: [],
};
/**
 * Merge one decisions layer over another. Pure. The overlay wins on
 * every dimension:
 *   - manualIncludes / manualExcludes: union by path, but the overlay's verb wins
 *     per path — a path the overlay excludes is dropped from includes and vice
 *     versa (never a contradictory pair).
 *   - manualAreas: the overlay's override replaces the base's for that doc.
 *   - scopeVerdicts (v2): the overlay wins per verdict path.
 *   - instructions (v2): union — base order kept, overlay's new lines appended.
 */
export function mergeDecisions(base: DecisionsFile, overlay: DecisionsFile): DecisionsFile {
  const overlayIncludes = new Set(overlay.manualIncludes ?? []);
  const overlayExcludes = new Set(overlay.manualExcludes ?? []);
  const manualIncludes = uniqueStrings([
    ...(base.manualIncludes ?? []),
    ...(overlay.manualIncludes ?? []),
  ]).filter((p) => !overlayExcludes.has(p));
  const manualExcludes = uniqueStrings([
    ...(base.manualExcludes ?? []),
    ...(overlay.manualExcludes ?? []),
  ]).filter((p) => !overlayIncludes.has(p));

  const overlayAreaDocs = new Set((overlay.manualAreas ?? []).map((a) => a.doc));
  const manualAreas = [
    ...(base.manualAreas ?? []).filter((a) => !overlayAreaDocs.has(a.doc)),
    ...(overlay.manualAreas ?? []),
  ];

  // Conflict verdicts: the overlay wins per dispute identity (same unordered pair
  // + same section anchors), other base verdicts survive.
  const overlayResKeys = new Set((overlay.conflictResolutions ?? []).map(conflictResolutionKey));
  const conflictResolutions = [
    ...(base.conflictResolutions ?? []).filter((r) => !overlayResKeys.has(conflictResolutionKey(r))),
    ...(overlay.conflictResolutions ?? []),
  ];

  // Scope verdicts: the overlay wins per verdict path (same normalization the
  // scan's own fold applies, so `docs/` and `docs` are one path).
  const overlayScopePaths = new Set((overlay.scopeVerdicts ?? []).map((v) => normalizeScopePath(v.path)));
  const scopeVerdicts = [
    ...(base.scopeVerdicts ?? []).filter((v) => !overlayScopePaths.has(normalizeScopePath(v.path))),
    ...(overlay.scopeVerdicts ?? []),
  ];
  const instructions = uniqueStrings([...(base.instructions ?? []), ...(overlay.instructions ?? [])]);

  return {
    version: 2,
    manualIncludes,
    manualExcludes,
    manualAreas,
    conflictResolutions,
    scopeVerdicts,
    instructions,
  };
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)];
}

// ---------------------------------------------------------------------------
// Decisions-file mutations
//
// Pure read-modify-write helpers around decisions, called by the dashboard
// server routes. None of these re-curate the corpus.
// ---------------------------------------------------------------------------

// Pure DecisionsFile transforms — the read-modify-write core, shared by the
// workspace helpers below so every surface agrees on update semantics. An
// `apply*` that makes no change returns the SAME object reference, letting
// callers skip a redundant store.

/**
 * Dispute-identity key for a section-scoped conflict verdict: the
 * unordered doc pair plus each side's section anchor, oriented by doc so the same
 * dispute keys identically regardless of which doc was recorded as A. One verdict
 * per dispute — re-recording replaces it.
 */
const conflictResolutionKey = (r: ConflictResolution): string => {
  const sides = [
    `${r.docA}#${r.anchorA ?? ''}`,
    `${r.docB}#${r.anchorB ?? ''}`,
  ].sort();
  return sides.join(' \x00 ');
};

// Include and exclude are mutually exclusive per doc: adding one clears the
// other for that path, so decisions.json can never hold a contradictory pair.

/**
 * The v2 fields every rebuild carries through untouched — a mutation of one
 * dimension must never drop another's rows (a row stored before v2 may
 * genuinely lack them, hence the `?? []`).
 */
function carriedV2Fields(existing: DecisionsFile): Pick<DecisionsFile, 'scopeVerdicts' | 'instructions'> {
  return {
    scopeVerdicts: existing.scopeVerdicts ?? [],
    instructions: existing.instructions ?? [],
  };
}

function applyAddManualInclude(existing: DecisionsFile, docPath: string): DecisionsFile {
  const includes = existing.manualIncludes ?? [];
  const excludes = existing.manualExcludes ?? [];
  if (includes.includes(docPath) && !excludes.includes(docPath)) return existing;
  return {
    version: 2,
    manualIncludes: includes.includes(docPath) ? includes : [...includes, docPath],
    manualExcludes: excludes.filter((p) => p !== docPath),
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: existing.conflictResolutions ?? [],
    ...carriedV2Fields(existing),
  };
}

function applyRemoveManualInclude(existing: DecisionsFile, docPath: string): DecisionsFile {
  return {
    version: 2,
    manualIncludes: (existing.manualIncludes ?? []).filter((p) => p !== docPath),
    manualExcludes: existing.manualExcludes ?? [],
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: existing.conflictResolutions ?? [],
    ...carriedV2Fields(existing),
  };
}

function applyAddManualExclude(existing: DecisionsFile, docPath: string): DecisionsFile {
  const includes = existing.manualIncludes ?? [];
  const excludes = existing.manualExcludes ?? [];
  if (excludes.includes(docPath) && !includes.includes(docPath)) return existing;
  return {
    version: 2,
    manualIncludes: includes.filter((p) => p !== docPath),
    manualExcludes: excludes.includes(docPath) ? excludes : [...excludes, docPath],
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: existing.conflictResolutions ?? [],
    ...carriedV2Fields(existing),
  };
}

function applyRemoveManualExclude(existing: DecisionsFile, docPath: string): DecisionsFile {
  return {
    version: 2,
    manualIncludes: existing.manualIncludes ?? [],
    manualExcludes: (existing.manualExcludes ?? []).filter((p) => p !== docPath),
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: existing.conflictResolutions ?? [],
    ...carriedV2Fields(existing),
  };
}

// Section-scoped conflict verdicts. One verdict per dispute identity —
// recording a verdict for a dispute already resolved replaces it (a side verdict
// overwrites a prior dismissal and vice versa).

function applyAddConflictResolution(existing: DecisionsFile, input: ConflictResolution): DecisionsFile {
  if (input.docA === input.docB) {
    throw new Error('addConflictResolution: docA and docB must be different docs');
  }
  const key = conflictResolutionKey(input);
  const dedup = (existing.conflictResolutions ?? []).filter((r) => conflictResolutionKey(r) !== key);
  return {
    version: 2,
    manualIncludes: existing.manualIncludes ?? [],
    manualExcludes: existing.manualExcludes ?? [],
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: [...dedup, input],
    ...carriedV2Fields(existing),
  };
}

function applyRemoveConflictResolution(
  existing: DecisionsFile,
  input: { docA: string; anchorA: string | null; docB: string; anchorB: string | null },
): DecisionsFile {
  const key = conflictResolutionKey({ ...input, verdict: 'dismissed', resolvedAt: '' });
  return {
    version: 2,
    manualIncludes: existing.manualIncludes ?? [],
    manualExcludes: existing.manualExcludes ?? [],
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: (existing.conflictResolutions ?? []).filter((r) => conflictResolutionKey(r) !== key),
    ...carriedV2Fields(existing),
  };
}

// ---------------------------------------------------------------------------
// Workspace decisions — the pure DecisionsFile transforms above, persisted
// under WORKSPACE scope (the `decisions` artifact, keyed by org, no commit).
// Context's decision endpoints call these; each write is followed (by the
// caller) with a re-process so the corpus reflects the decision.
// ---------------------------------------------------------------------------

async function loadWorkspaceDecisions(org: string): Promise<DecisionsFile> {
  return (await loadWorkspaceSpec<DecisionsFile>({ workspaceOrgId: org }, 'decisions')) ?? EMPTY_DECISIONS;
}

async function storeWorkspaceDecisions(org: string, next: DecisionsFile): Promise<void> {
  await saveWorkspaceSpec({ workspaceOrgId: org }, 'decisions', next);
}

/** The workspace's current decisions (Context's read), or empty when none. */
export function getWorkspaceDecisions(org: string): Promise<DecisionsFile> {
  return loadWorkspaceDecisions(org);
}

export async function addWorkspaceManualInclude(org: string, docPath: string): Promise<DecisionsFile> {
  const existing = await loadWorkspaceDecisions(org);
  const next = applyAddManualInclude(existing, docPath);
  if (next !== existing) await storeWorkspaceDecisions(org, next);
  return next;
}

export async function removeWorkspaceManualInclude(org: string, docPath: string): Promise<DecisionsFile> {
  const next = applyRemoveManualInclude(await loadWorkspaceDecisions(org), docPath);
  await storeWorkspaceDecisions(org, next);
  return next;
}

export async function addWorkspaceManualExclude(org: string, docPath: string): Promise<DecisionsFile> {
  const existing = await loadWorkspaceDecisions(org);
  const next = applyAddManualExclude(existing, docPath);
  if (next !== existing) await storeWorkspaceDecisions(org, next);
  return next;
}

export async function removeWorkspaceManualExclude(org: string, docPath: string): Promise<DecisionsFile> {
  const next = applyRemoveManualExclude(await loadWorkspaceDecisions(org), docPath);
  await storeWorkspaceDecisions(org, next);
  return next;
}

export async function addWorkspaceConflictResolution(
  org: string,
  input: ConflictResolution,
): Promise<DecisionsFile> {
  const next = applyAddConflictResolution(await loadWorkspaceDecisions(org), input);
  await storeWorkspaceDecisions(org, next);
  return next;
}

export async function removeWorkspaceConflictResolution(
  org: string,
  input: { docA: string; anchorA: string | null; docB: string; anchorB: string | null },
): Promise<DecisionsFile> {
  const next = applyRemoveConflictResolution(await loadWorkspaceDecisions(org), input);
  await storeWorkspaceDecisions(org, next);
  return next;
}
