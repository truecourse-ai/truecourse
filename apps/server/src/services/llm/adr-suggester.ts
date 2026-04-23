import { randomUUID } from 'node:crypto'
import {
  ADR_TOPIC_VOCAB,
  type AdrDraft,
  type AdrIndexEntry,
  type AdrTopicValue,
  type TopicSignature,
} from '@truecourse/shared'
import { log } from '../../lib/logger.js'
import {
  captureFragmentSnapshot,
  collectGraphEntityIds,
  computeSignature,
  ensureAdrDraftsDir,
  extractFragmentsFromBody,
  isRejected,
  writeAdrDraft,
} from '../../lib/adr-store.js'
import { buildGraphSummary } from './prompts.js'
import type { LLMProvider } from './provider.js'
import type { Graph } from '../../types/snapshot.js'

// ---------------------------------------------------------------------------
// Options + result
// ---------------------------------------------------------------------------

export interface SuggestAdrsOptions {
  /** Repo root, used for persisting drafts under `.truecourse/drafts/`. */
  repoPath: string
  /** Current code graph (from LATEST snapshot). */
  graph: Graph
  /** Accepted ADRs already in the corpus — the LLM must not re-propose these. */
  /** Index entries are sufficient — the survey prompt only consumes id + title.
   *  Pass `readAdrCorpus(...)?.adrs` directly without loading bodies. */
  existingAdrs: AdrIndexEntry[]
  /** Topic signatures the user has previously rejected. */
  rejectedSignatures: TopicSignature[]
  /** Hard cap on drafts produced this run. */
  maxDrafts?: number
  /** Confidence floor — drafts below this are dropped. */
  threshold?: number
  /** Optional user-supplied focus hint (e.g. "focus on the data layer"). */
  topicHint?: string
  /** Progress events — callback must not throw. Callers synthesize Socket.io
   *  events, CLI spinners, etc. from these. */
  onProgress?: (event: AdrSuggestEvent) => void
  /** LLM provider. Injectable so tests can pass a mock. */
  provider: LLMProvider
}

export interface SuggestAdrsResult {
  /** Drafts that survived validation and were persisted to `.truecourse/drafts/`. */
  drafts: AdrDraft[]
  /** Dropped candidates with reasons — for logging/telemetry. */
  dropped: DroppedDraft[]
  /** Raw candidate count returned by the survey pass (before any filtering). */
  surveyCandidateCount: number
}

export interface DroppedDraft {
  topic: string
  entities: string[]
  reason: DropReason
}

export type DropReason =
  | 'rejected-signature'
  | 'unknown-topic'
  | 'unknown-entities'
  | 'below-threshold'
  | 'draft-failed'

export type AdrSuggestEvent =
  | { kind: 'survey-start' }
  | { kind: 'survey-done'; candidates: number; afterFilter: number }
  | { kind: 'candidate-dropped'; topic: string; entities: string[]; reason: DropReason }
  | { kind: 'draft-start'; topic: string; entities: string[] }
  | { kind: 'draft-done'; draft: AdrDraft }
  | { kind: 'draft-dropped'; topic: string; entities: string[]; reason: DropReason; error?: string }
  | { kind: 'complete'; accepted: number; dropped: number }

const DEFAULT_MAX_DRAFTS = 5
const DEFAULT_THRESHOLD = 0

// ---------------------------------------------------------------------------
// suggestAdrsInProcess — agent-style orchestrator
// ---------------------------------------------------------------------------
//
// Two-pass loop:
//   1. Survey: one LLM call returns candidate {topic, entities, rationale} triples
//   2. Filter: drop rejected signatures, unknown topics, unknown entities
//   3. Draft: one LLM call per surviving candidate, parallel (under provider cap)
//   4. Validate: drop below-threshold drafts and drafts that cite unknown IDs
//   5. Persist: surviving drafts land in `.truecourse/drafts/<id>.json`
//
// Progress callback fires at each stage boundary. Never throws — suggester
// owns its own error handling and surfaces failures via `draft-dropped`
// events + the returned `dropped` list.

export async function suggestAdrsInProcess(
  opts: SuggestAdrsOptions,
): Promise<SuggestAdrsResult> {
  const maxDrafts = opts.maxDrafts ?? DEFAULT_MAX_DRAFTS
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD
  const emit = opts.onProgress ?? (() => {})

  const knownNodeIds = collectGraphEntityIds(opts.graph)
  const graphSummary = buildGraphSummary(opts.graph)

  const dropped: DroppedDraft[] = []
  const accepted: AdrDraft[] = []

  // --- Pass 1: survey ------------------------------------------------------

  emit({ kind: 'survey-start' })

  const surveyResult = await opts.provider.generateAdrSurvey({
    graphSummary,
    existingAdrs: opts.existingAdrs.map((a) => ({ id: a.id, title: a.title })),
    rejectedSignatures: opts.rejectedSignatures,
    vocab: ADR_TOPIC_VOCAB,
    maxCandidates: maxDrafts,
    topicHint: opts.topicHint,
  })

  const surveyCandidateCount = surveyResult.candidates.length

  // Filter survey candidates before spending LLM calls on them.
  const survivingCandidates = []
  for (const candidate of surveyResult.candidates) {
    const reason = validateSurveyCandidate(
      candidate.topic,
      candidate.entities,
      opts.rejectedSignatures,
      knownNodeIds,
    )
    if (reason) {
      dropped.push({ topic: candidate.topic, entities: candidate.entities, reason })
      emit({
        kind: 'candidate-dropped',
        topic: candidate.topic,
        entities: candidate.entities,
        reason,
      })
      continue
    }
    survivingCandidates.push(candidate)
    if (survivingCandidates.length >= maxDrafts) break
  }

  emit({
    kind: 'survey-done',
    candidates: surveyCandidateCount,
    afterFilter: survivingCandidates.length,
  })

  // --- Pass 2: draft -------------------------------------------------------
  //
  // We await each draft in parallel — the provider's own concurrency cap
  // handles pacing. Each draft either lands in `accepted` + is persisted,
  // or lands in `dropped`. No throw escapes this loop.

  ensureAdrDraftsDir(opts.repoPath)

  await Promise.all(
    survivingCandidates.map(async (candidate) => {
      emit({ kind: 'draft-start', topic: candidate.topic, entities: candidate.entities })
      let draftResult
      try {
        draftResult = await opts.provider.generateAdrDraft({
          topic: candidate.topic,
          entities: candidate.entities,
          rationale: candidate.rationale,
          graphSummary,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        dropped.push({
          topic: candidate.topic,
          entities: candidate.entities,
          reason: 'draft-failed',
        })
        emit({
          kind: 'draft-dropped',
          topic: candidate.topic,
          entities: candidate.entities,
          reason: 'draft-failed',
          error: msg,
        })
        log.warn(`[adr-suggest] draft call failed for topic=${candidate.topic}: ${msg}`)
        return
      }

      const reason = validateDraftResult(
        draftResult.topic,
        draftResult.entities,
        draftResult.confidence,
        threshold,
        knownNodeIds,
      )
      if (reason) {
        dropped.push({
          topic: draftResult.topic,
          entities: draftResult.entities,
          reason,
        })
        emit({
          kind: 'draft-dropped',
          topic: draftResult.topic,
          entities: draftResult.entities,
          reason,
        })
        return
      }

      // Double-check against rejected signatures — the LLM may have refined
      // entity set to match a previously-rejected one. Topic is already
      // validated to be in vocab by validateDraftResult above, so the cast
      // is safe.
      const draftSig: TopicSignature = {
        topic: draftResult.topic as AdrTopicValue,
        entities: [...draftResult.entities].sort(),
      }
      if (isRejected(draftSig, opts.rejectedSignatures)) {
        dropped.push({
          topic: draftResult.topic,
          entities: draftResult.entities,
          reason: 'rejected-signature',
        })
        emit({
          kind: 'draft-dropped',
          topic: draftResult.topic,
          entities: draftResult.entities,
          reason: 'rejected-signature',
        })
        return
      }

      // Strip invalid `adr-graph` / `adr-flow` fenced blocks from the body
      // before persisting (M12). A block is "invalid" when its references
      // don't resolve against the current graph — the LLM occasionally
      // hallucinates service names or flow ids. We drop the block, keep
      // the prose. Valid blocks remain in place and will have snapshots
      // captured at accept time (M11 writer).
      const cleanedBody = stripInvalidFragmentBlocks(draftResult.madrBody, opts.graph)

      const draft: AdrDraft = {
        id: `draft-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        createdAt: new Date().toISOString(),
        title: draftResult.title,
        topic: draftResult.topic as AdrTopicValue,
        entities: draftResult.entities,
        madrBody: cleanedBody,
        confidence: draftResult.confidence,
      }

      writeAdrDraft(opts.repoPath, draft)
      // Double-check with computeSignature would be idempotent here; the
      // inline sort above already matches its output.
      void computeSignature  // retained for future use; no-op reference.
      accepted.push(draft)
      emit({ kind: 'draft-done', draft })
    }),
  )

  emit({ kind: 'complete', accepted: accepted.length, dropped: dropped.length })

  return {
    drafts: accepted,
    dropped,
    surveyCandidateCount,
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateSurveyCandidate(
  topic: string,
  entities: string[],
  rejected: TopicSignature[],
  knownNodeIds: Set<string>,
): DropReason | null {
  if (!isKnownTopic(topic)) return 'unknown-topic'
  if (!entitiesAreKnown(entities, knownNodeIds)) return 'unknown-entities'
  const sig = { topic, entities: [...entities].sort() }
  if (isRejected(sig, rejected)) return 'rejected-signature'
  return null
}

function validateDraftResult(
  topic: string,
  entities: string[],
  confidence: number,
  threshold: number,
  knownNodeIds: Set<string>,
): DropReason | null {
  if (!isKnownTopic(topic)) return 'unknown-topic'
  if (!entitiesAreKnown(entities, knownNodeIds)) return 'unknown-entities'
  if (confidence < threshold) return 'below-threshold'
  return null
}

function isKnownTopic(topic: string): topic is AdrTopicValue {
  return (ADR_TOPIC_VOCAB as readonly string[]).includes(topic)
}

function entitiesAreKnown(entities: string[], known: Set<string>): boolean {
  if (entities.length === 0) return true // topic-only decisions are allowed
  return entities.every((e) => known.has(e))
}

/**
 * Remove fenced `adr-graph` / `adr-flow` blocks whose references don't
 * resolve against the current graph. Preserves all surrounding prose and
 * any blocks that DO resolve. Walked in reverse index order so earlier
 * offsets stay valid as we splice.
 */
function stripInvalidFragmentBlocks(body: string, graph: Graph): string {
  const fragments = extractFragmentsFromBody(body)
  if (fragments.length === 0) return body

  // Identify blocks with no snapshot (unresolvable) and splice them out.
  const toStrip = fragments
    .filter((f) => captureFragmentSnapshot(f, graph) === null)
    .sort((a, b) => b.start - a.start) // reverse order so indices stay valid

  if (toStrip.length === 0) return body

  let out = body
  for (const f of toStrip) {
    const before = out.slice(0, f.start)
    const after = out.slice(f.end)
    // Collapse the blank line left behind by removing the block.
    out = (before + after).replace(/\n{3,}/g, '\n\n')
    log.warn(
      `[adr-suggest] stripped invalid ${f.kind} fragment block (references not in graph)`,
    )
  }
  return out
}

