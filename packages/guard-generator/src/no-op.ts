/**
 * THE COMMITTED-STATE NO-OP GATE — the deterministic, LLM-free answer to "will
 * this `guard generate` do anything at all?".
 *
 * The incremental gate a run actually applies is per FLOW
 * ({@link flowGenerationInputsHash}), but the run only reaches it AFTER extraction
 * and synthesis have re-derived the claim inventory over the WHOLE doc universe.
 * On the machine that generated, those two stages are free (their KV caches are
 * warm) — but the caches live in the gitignored `.truecourse/.cache/`, so they
 * never travel. A CLONE of a fully generated repo therefore paid the entire
 * extraction (and synthesis) bill to re-derive change detection that the COMMITTED
 * records — `scenarios/manifest.json` (flow bindings + `gapSections`),
 * `scenarios/flows.json`, the corpus and the docs themselves — had already
 * settled. That contradicts the manifest's whole reason for travelling: an
 * unchanged corpus must be a deterministic no-op for a cloner too.
 *
 * This module answers the question from committed state alone. Same inputs ⇒ same
 * outputs: when nothing an output depends on has moved, re-deriving the outputs
 * can only reproduce them, so the derivation is skipped whole. The predicate is
 * pure hash comparison — no LLM, no cache reads — and is shared by
 * {@link generateGuards} (which short-circuits to its noChanges result) and the
 * pre-flight estimate (which then quotes ZERO stages, so the confirm prompt is
 * skipped for a run that must cost $0).
 *
 * It is deliberately conservative: any input it cannot verify DECLINES the no-op,
 * and the run proceeds exactly as it always did.
 */

import {
  readManifest,
  readGuardDecisions,
  readGuardAutoResolutions,
} from '@truecourse/guard-runner'
import {
  dismissedClaimKey,
  violatesSettleInvariant,
  type GuardFlow,
  type GuardManifestFlow,
} from '@truecourse/shared'
import { flowGenerationInputsHash, sectionInputsKey, type GuardWorkPlan, type SectionInput } from './section-plan.js'
import { flowSectionKey, readFlowsFile } from './flows.js'

/** Why the gate declined — carried for logs and tests, never user-facing copy. */
export type GuardNoOpDeclineReason =
  | 'no-universe'
  | 'sections-changed'
  | 'sections-orphaned'
  | 'recipe-missing'
  | 'no-manifest'
  | 'flow-corpus-drift'
  | 'flow-unsettled'
  | 'flow-inputs-moved'
  | 'journeys-unknown'
  | 'orphan-would-prune'
  | 'decisions-moved'
  | 'flow-tainted'

export type GuardNoOpDecision =
  | {
      noOp: true
      /** The manifest entries the run would carry forward, unchanged. */
      flows: GuardManifestFlow[]
      /** The live flow corpus (`scenarios/flows.json`) the entries derive from,
       *  minus the flows the user dismissed — the set the run itself works from. */
      liveFlows: GuardFlow[]
      /** Corpus flows an APPLIED dismissal drops, counted as the run counts them. */
      dismissedFlows: number
    }
  | { noOp: false; reason: GuardNoOpDeclineReason }

export interface GuardNoOpInput {
  /** The deterministic section plan (the same one the run/estimate computed). */
  plan: GuardWorkPlan
  /** The recipe-inputs fingerprint the run would author against. */
  recipeFingerprint: string
  /**
   * Journey id → fingerprint, from the LIVE mapping pass (the run) or the last
   * mapping's snapshot (the estimate). `null` — no catalog at all — declines:
   * a flow's inputs hash folds the fingerprints of the journeys its plan walks, so
   * without them the gate cannot prove the code has not moved underneath.
   */
  journeyFingerprints: ReadonlyMap<string, string> | null
}

/**
 * Decide whether `guard generate` is a complete no-op, from committed state only.
 *
 * Every condition below is one the run itself would otherwise discover only after
 * paying for extraction + synthesis:
 *
 *  - the spec side is settled: no section's text moved (`work`), and no section a
 *    SETTLING flow binds vanished (`orphaned`) — both projected off the manifest's
 *    flow bindings AND its `gapSections`, so a section that settled with nothing
 *    to bind it counts as accounted for;
 *  - the flow corpus agrees with the manifest: every committed flow has a settled
 *    manifest entry and vice versa, with the same composition fingerprint, so the
 *    "synthesis reproduces the same flows" premise is checked, not assumed;
 *  - every entry's `generationInputsHash` still equals the hash recomputed from
 *    LIVE inputs (section content keys, journey fingerprints, recipe fingerprint,
 *    format version, every stage's prompt fingerprint) — the exact gate the run
 *    applies per flow, so a prompt edit, a recipe move, or a journey whose code
 *    changed still re-authors;
 *  - nothing the user curated is still PENDING: a dismissal is work only until it
 *    has been applied — a dismissed flow whose manifest entry still exists would
 *    be pruned, and a dismissed claim a live flow is still composed from would
 *    re-synthesize it. An APPLIED dismissal is settled state, not perpetual work.
 *    A tainted flow re-authors.
 *
 * A `true` verdict means: the run would author nothing, write no scenario, delete
 * none, and rewrite `manifest.json` byte-identically.
 */
export function planGuardNoOp(repoRoot: string, input: GuardNoOpInput): GuardNoOpDecision {
  const { plan } = input
  if (!plan.hasUniverse) return { noOp: false, reason: 'no-universe' }
  if (plan.work.length > 0) return { noOp: false, reason: 'sections-changed' }
  // A missing recipe means discovery runs (an LLM call) and writes a file.
  if (plan.recipeMissing) return { noOp: false, reason: 'recipe-missing' }

  const manifest = readManifest(repoRoot)
  // No manifest at all ⇒ nothing was ever generated here: the first run must write
  // one. (With a manifest absent, `planGuardWork` reports every section as work
  // anyway — unless the corpus has no sections, the only case this catches.)
  if (!manifest) return { noOp: false, reason: 'no-manifest' }

  // The user's curation, applied to the committed corpus exactly as the run applies
  // it: a dismissed flow is dropped WHOLE before anything else looks at it. It is
  // never removed from `scenarios/flows.json` — synthesis keeps producing it, and
  // every run drops it again on the way past — so the live flow set the manifest is
  // compared against is the corpus MINUS the dismissed ids.
  const decisions = readGuardDecisions(repoRoot)
  const dismissedFlowIds = new Set(decisions.dismissedFlows.map((d) => d.flowId))
  const corpusFlows = readFlowsFile(repoRoot)?.flows ?? []
  const liveFlows = corpusFlows.filter((f) => !dismissedFlowIds.has(f.id))
  const liveById = new Map(liveFlows.map((f) => [f.id, f]))

  // ORPHANED SECTIONS — manifest bindings with no live section. A settling flow
  // with one is real work (the spec under it moved). But an ORPHANED entry is
  // carried forward verbatim by every run, dead bindings and all, so its orphaned
  // sections are a PERMANENT state: reported every run, changing nothing. Treating
  // them as work is what made a repo with one carried orphan re-extract its whole
  // universe on every clone, forever. They are reported by the no-op run just the
  // same — reporting is not work.
  const orphanedEntryIds = new Set(manifest.flows.filter((f) => f.orphaned).map((f) => f.flowId))
  for (const section of plan.orphaned) {
    if (!section.flowIds.every((id) => orphanedEntryIds.has(id))) {
      return { noOp: false, reason: 'sections-orphaned' }
    }
  }

  // The manifest's ORPHANED entries (a flow synthesis stopped producing, whose
  // committed scenarios are real coverage) are carried forward untouched by every
  // run — but one with no scenario left is PRUNED, which rewrites the manifest and
  // is therefore never a no-op.
  const carried: GuardManifestFlow[] = []
  const settling: GuardManifestFlow[] = []
  for (const entry of manifest.flows) {
    if (entry.orphaned) {
      if (entry.scenarios.length === 0) return { noOp: false, reason: 'orphan-would-prune' }
      carried.push(entry)
      continue
    }
    settling.push(entry)
  }

  // The committed flow corpus and the manifest must describe the SAME flows, with
  // the same composition. A flow in one and not the other is work: the run would
  // author it, orphan it, or prune it.
  if (settling.length !== liveFlows.length) return { noOp: false, reason: 'flow-corpus-drift' }
  for (const entry of settling) {
    const live = liveById.get(entry.flowId)
    if (!live || live.fingerprint !== entry.flowFingerprint) return { noOp: false, reason: 'flow-corpus-drift' }
  }

  // A curation decision changes what the run produces and none of it rides a
  // fingerprint — but only while it is PENDING. The question is therefore whether
  // the dismissal has already been APPLIED to the committed state, not whether it
  // exists:
  //
  //  - a dismissed FLOW is applied when its manifest entry is gone (the run that
  //    applied it deleted the entry and its scenario files). While an entry
  //    survives, the next run would delete it — real work, and a manifest rewrite.
  //    Asking instead whether the flow is still in `flows.json` asked something
  //    that is true FOREVER (dismissal never removes it from the corpus), so a
  //    repo with a single dismissal could never be a no-op again.
  //  - a dismissed CLAIM is applied when no live flow is composed from it any
  //    more: applying it re-synthesizes the area without that milestone, so the
  //    condition clears itself on the corpus the run rewrote.
  const entryIds = new Set(manifest.flows.map((f) => f.flowId))
  for (const dismissal of decisions.dismissedFlows) {
    if (entryIds.has(dismissal.flowId)) return { noOp: false, reason: 'decisions-moved' }
  }
  if (decisions.dismissedClaims.length > 0) {
    const milestoneKeys = new Set<string>()
    for (const flow of liveFlows) {
      for (const m of flow.milestones) milestoneKeys.add(dismissedClaimKey(m.doc, m.anchor, m.claimTitle))
    }
    for (const d of decisions.dismissedClaims) {
      if (milestoneKeys.has(dismissedClaimKey(d.doc, d.anchor, d.title))) {
        return { noOp: false, reason: 'decisions-moved' }
      }
    }
  }

  // A TAINTED flow (its test ended a prior run rejected) bypasses the author cache
  // and re-authors. Its entry is normally unsettled too (the hash check below would
  // catch it), but the ledger is the authority on the taint, so it is asked directly.
  const tainted = readGuardAutoResolutions(repoRoot).tainted
  for (const key of Object.keys(tainted)) {
    if (liveById.has(tainted[key].flowId)) return { noOp: false, reason: 'flow-tainted' }
  }

  const sectionByKey = new Map<string, SectionInput>(plan.sections.map((s) => [flowSectionKey(s.doc, s.anchor), s]))

  for (const entry of settling) {
    if (entry.generationInputsHash === null) return { noOp: false, reason: 'flow-unsettled' }
    // A settled entry that leaves a planned surface unaccounted for is treated as
    // work by the run, whatever its hash says — so it is not a no-op either.
    if (violatesSettleInvariant(entry)) return { noOp: false, reason: 'flow-unsettled' }

    // The flow's bound sections, deduplicated exactly as the run dedups them.
    const seen = new Set<string>()
    const sectionKeys: string[] = []
    for (const binding of entry.bindings) {
      const key = flowSectionKey(binding.doc, binding.anchor)
      if (seen.has(key)) continue
      seen.add(key)
      const section = sectionByKey.get(key)
      // A binding with no live section cannot be re-derived here (the run would
      // have reported it as an orphan, which is already excluded above).
      if (!section) return { noOp: false, reason: 'sections-orphaned' }
      sectionKeys.push(sectionInputsKey(section))
    }

    // The journeys the entry's realization PLANS walk, resolved to their live
    // fingerprints: this is the half of the hash that moves when the CODE moves.
    if (!input.journeyFingerprints) return { noOp: false, reason: 'journeys-unknown' }
    const journeyFingerprints: string[] = []
    for (const plan of entry.journeys) {
      for (const id of plan.journeyIds) {
        const fingerprint = input.journeyFingerprints.get(id)
        // A journey the mapper no longer produces: the flow's realization moved.
        if (fingerprint === undefined) return { noOp: false, reason: 'flow-inputs-moved' }
        journeyFingerprints.push(fingerprint)
      }
    }

    const inputsHash = flowGenerationInputsHash({
      flowFingerprint: entry.flowFingerprint,
      sectionKeys,
      journeyFingerprints,
      recipeFingerprint: input.recipeFingerprint,
    })
    if (inputsHash !== entry.generationInputsHash) return { noOp: false, reason: 'flow-inputs-moved' }
  }

  return {
    noOp: true,
    flows: [...settling, ...carried],
    liveFlows,
    dismissedFlows: corpusFlows.length - liveFlows.length,
  }
}
