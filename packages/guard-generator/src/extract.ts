/**
 * Claim extraction — the engine half of the `guard-generate.extract` SESSION
 * (the per-view one-shot engine was retired). One agent session per document
 * pages the doc itself and returns its testable claims plus per-section
 * untestable notes; the session implementation lives in
 * `@truecourse/core` (this package cannot depend on it) and is injected through
 * {@link ExtractSessionSeam}.
 *
 * What stays HERE is everything deterministic the fold must never trust the
 * model for: {@link snapExtraction} snaps every returned anchor against the
 * live section index — the session's `check_claims` tool runs it live, and the
 * seam's fold re-runs it on the outcome, so a model-authored anchor is never
 * trusted whichever path produced it.
 *
 * The retired one-shot's per-view cache (`.cache/guard/extract`) is ORPHANED:
 * its files remain on disk (derived, deletable) but nothing reads or writes
 * them any more — the session path caches per doc under `guard/extract-session`
 * (see `@truecourse/core`'s `services/guard-generate/extract.ts`).
 */

import { slugifyHeading } from '@truecourse/guard-runner'
import { type ClaimNeed, type GuardPrerequisiteTarget } from '@truecourse/shared'
import { type ExtractedClaim, type UntestableNote } from './schemas.js'
import type { GuardDoc, SectionInput } from './section-plan.js'

/**
 * One extracted claim, carrying the extraction SESSION's structured `needs` —
 * what testing it takes beyond an empty sandbox. The session always stamps the
 * array (empty when a claim needs nothing); downstream consumers treat absence
 * and emptiness alike.
 */
export type ExtractedClaimWithNeeds = ExtractedClaim & {
  needs?: ClaimNeed[]
  /** The prior claim's sentence this one supersedes (see the session outcome). */
  replaces?: string
}

/**
 * A claim as the LAST extraction of a document left it, for the next one to
 * reconcile against. `driver` is absent when the prior came from a claims
 * store written before it recorded drivers: such a claim can be briefed for
 * identity but never reused verbatim, so its section is re-extracted.
 */
export type PriorClaim = Omit<ExtractedClaimWithNeeds, 'driver'> & { driver?: ExtractedClaim['driver'] }

/**
 * What the last extraction of a document said, as the next one reconciles
 * against it: the prior claims and notes snapped onto the LIVE section index
 * (a claim whose section vanished is already gone), and `settledAnchors` —
 * the live sections whose own text is unchanged since that extraction and
 * whose prior claims are complete enough to reuse. The session never
 * re-extracts a settled section; the fold takes its prior claims byte for
 * byte. Every other section is extracted with its prior claims briefed, so
 * an unchanged sentence keeps its claim and a reworded one names what it
 * replaces.
 */
export interface ExtractPrior {
  claims: PriorClaim[]
  untestable: UntestableNote[]
  settledAnchors: string[]
}

/** A document's snapped extraction: claims + notes both bound to live anchors. */
export interface DocClaims {
  claims: ExtractedClaimWithNeeds[]
  untestable: UntestableNote[]
}

/**
 * A document's extraction outcome. On the session path a doc is one session:
 * `complete` is always true on success and `failedViews` 0 (the fields survive
 * from the per-view era so the consumer's shape is unchanged). `ok: false` is a
 * failed (or missing) session for the doc — fail-open, reported, re-attempted
 * next run.
 */
export type ExtractResult =
  | { ok: true; data: DocClaims; complete: boolean; failedViews: number }
  | { ok: false; reason: string }

// ---------------------------------------------------------------------------
// The extraction SESSION seam — typed here because the engine cannot depend on
// `@truecourse/core`, which owns the sessions; the command adapter injects the
// implementation. Mirrors the guard-setup seams.
// ---------------------------------------------------------------------------

/**
 * What one session-kind pool did — the session analog of a transport tally
 * (sessions, not calls). `allTransport` distinguishes "the provider was down"
 * (systemic ⇒ the run aborts before writing) from "a session went malformed /
 * over budget" (fail-open per doc, tallied).
 */
export interface GuardSessionSummary {
  /** The session kind that ran (`guard-generate.extract`, `guard-generate.flows`). */
  kind: string
  /** Sessions that actually ran (cache hits never do). */
  ran: number
  fromCache: number
  failed: number
  /** True when every failure was transport-class (vacuously true at 0 failures). */
  allTransport: boolean
  firstError?: string
  spent: { turns: number; tokens: number; costUsd: number }
}

/** A summary that means: sessions were attempted and the provider lost every one. */
export function isSystemicSessionLoss(s: GuardSessionSummary): boolean {
  return s.ran > 0 && s.failed === s.ran && s.allTransport
}

/**
 * The claim-extraction session seam: one `guard-generate.extract` agent session
 * per document (cache-aware — an unchanged doc spends nothing). The
 * implementation (in `@truecourse/core`) pools the sessions, re-snaps every
 * anchor in its fold, and returns per-doc results as {@link ExtractResult},
 * claims carrying the session's `needs`. Fail-open per doc: a failed session is
 * an `ok: false` entry, never a throw.
 */
export type ExtractSessionSeam = (input: {
  docs: readonly GuardDoc[]
  /** The declared dependencies a case prerequisite may name — the closed
   *  vocabulary the session is briefed on and its outcome is held to. */
  prerequisiteTargets: readonly GuardPrerequisiteTarget[]
  /** Per document, what its last extraction said (see {@link ExtractPrior});
   *  consulted only when the document's own cache entry misses. */
  priors?: ReadonlyMap<string, ExtractPrior>
  /** Ticks once per settled doc (cache hits included). */
  onDoc?: (done: number, total: number) => void
}) => Promise<{ byDoc: Map<string, ExtractResult>; summary: GuardSessionSummary }>

/** The prior extraction of a document as the claim-diff gate reads it: the raw
 *  session outcome (model anchors, un-snapped — the gate snaps it against the
 *  live sections exactly as the extraction fold does). */
export type PriorExtraction = DocClaims

/**
 * The extraction-reuse seam behind the claim-diff gate. `lookup` returns the
 * outcome the extraction session cached for the document at `priorContentHash`
 * (null when none is cached); `reuse` makes the upcoming extraction of `doc` —
 * whose content moved — resolve to that same outcome without a session, so a
 * cosmetic edit keeps its claims byte-identical. The implementation (in
 * `@truecourse/core`) owns the session cache's key recipe; tests inject a map.
 */
export interface ReuseExtractionSeam {
  lookup(doc: GuardDoc, priorContentHash: string, prerequisiteTargets?: readonly GuardPrerequisiteTarget[]): Promise<PriorExtraction | null>
  reuse(doc: GuardDoc, priorContentHash: string, prerequisiteTargets?: readonly GuardPrerequisiteTarget[]): Promise<void>
}

// ---------------------------------------------------------------------------
// Anchor snapping + dedupe
// ---------------------------------------------------------------------------

/** Re-slugify a possibly-loose anchor path segment-by-segment. */
function reslug(anchor: string): string {
  return anchor
    .split('/')
    .filter(Boolean)
    .map((seg) => slugifyHeading(seg))
    .filter(Boolean)
    .join('/')
}

/**
 * Snap model-returned anchors onto the live section index and drop the rest.
 * Precedence: exact anchor; re-slugified path; unique leaf-segment match. A claim
 * whose anchor snaps to nothing is dropped (its section then shows as a coverage
 * gap — honest) rather than bound to the wrong place.
 *
 * Exported (generic over the claim shape, so a session claim's `needs` survive
 * the snap) because the `guard-generate.extract` session uses it twice: the
 * `check_claims` tool runs it LIVE so a fabricated anchor bounces in-session,
 * and the seam's fold re-runs it on the outcome — model anchors are never
 * trusted, whichever path produced them.
 */
export function snapExtraction<C extends Pick<ExtractedClaim, 'claim' | 'sectionAnchor'> & { driver?: string }>(
  raw: { claims: C[]; untestable: UntestableNote[] },
  sections: SectionInput[],
): { claims: C[]; untestable: UntestableNote[] } {
  const valid = new Set(sections.map((s) => s.anchor))
  const bySlug = new Map<string, string>()
  const byLeaf = new Map<string, string[]>()
  for (const s of sections) {
    bySlug.set(reslug(s.anchor), s.anchor)
    const leaf = slugifyHeading(s.anchor.split('/').filter(Boolean).pop() ?? s.anchor)
    const list = byLeaf.get(leaf)
    if (list) list.push(s.anchor)
    else byLeaf.set(leaf, [s.anchor])
  }

  const snapAnchor = (rawAnchor: string): string | null => {
    if (valid.has(rawAnchor)) return rawAnchor
    const rs = reslug(rawAnchor)
    if (bySlug.has(rs)) return bySlug.get(rs)!
    const leaf = slugifyHeading(rawAnchor.split('/').filter(Boolean).pop() ?? rawAnchor)
    const cands = byLeaf.get(leaf)
    return cands && cands.length === 1 ? cands[0] : null
  }

  const claims: C[] = []
  const seenClaim = new Set<string>()
  for (const c of raw.claims) {
    const anchor = snapAnchor(c.sectionAnchor)
    if (!anchor) continue
    const key = `${anchor}\0${c.driver}\0${c.claim.replace(/\s+/g, ' ').trim().toLowerCase()}`
    if (seenClaim.has(key)) continue
    seenClaim.add(key)
    claims.push({ ...c, sectionAnchor: anchor })
  }

  const untestable: UntestableNote[] = []
  const seenNote = new Set<string>()
  for (const n of raw.untestable) {
    const anchor = snapAnchor(n.sectionAnchor)
    if (!anchor || seenNote.has(anchor)) continue
    seenNote.add(anchor)
    untestable.push({ ...n, sectionAnchor: anchor })
  }

  return { claims, untestable }
}

// ---------------------------------------------------------------------------
// Reconciliation against the prior extraction
// ---------------------------------------------------------------------------

const normalizeSentence = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase()

/** The prior claims of the sections a session extracts — what it must account for. */
export function priorClaimsToAccount(prior: ExtractPrior): PriorClaim[] {
  const settled = new Set(prior.settledAnchors)
  return prior.claims.filter((c) => !settled.has(c.sectionAnchor))
}

/** A draft as the reconciliation reads it: anchors already snapped. */
export interface ReconcilableDraft {
  claims: readonly { claim: string; sectionAnchor: string; replaces?: string }[]
  retiredClaims?: readonly { claim: string; reason: string }[]
}

/**
 * The reconciliation discipline `check_claims` runs live and the fold re-runs
 * on the outcome. A draft against a prior must account for every prior claim
 * of a re-extracted section — KEPT with its sentence verbatim, REPLACED by a
 * claim naming it in `replaces`, or RETIRED in `retiredClaims` with a reason —
 * may continue or retire nothing the prior does not hold, may not continue one
 * prior claim twice or both continue and retire it, and may not extract a
 * settled section at all. Returns the problems; empty means reconciled.
 */
export function reconciliationProblems(draft: ReconcilableDraft, prior: ExtractPrior): string[] {
  const problems: string[] = []
  const settled = new Set(prior.settledAnchors)
  const toAccount = priorClaimsToAccount(prior)
  const byText = new Map<string, PriorClaim[]>()
  for (const c of toAccount) {
    const list = byText.get(normalizeSentence(c.claim))
    if (list) list.push(c)
    else byText.set(normalizeSentence(c.claim), [c])
  }
  const resolve = (sentence: string, anchor?: string): PriorClaim | null => {
    const cands = byText.get(normalizeSentence(sentence)) ?? []
    if (cands.length === 0) return null
    return cands.find((c) => c.sectionAnchor === anchor) ?? cands[0]!
  }
  const priorKey = (c: PriorClaim): string => `${c.sectionAnchor}\0${normalizeSentence(c.claim)}`
  const continued = new Map<string, number>()
  const account = (c: PriorClaim): void => {
    continued.set(priorKey(c), (continued.get(priorKey(c)) ?? 0) + 1)
  }

  for (const c of draft.claims) {
    if (settled.has(c.sectionAnchor)) {
      problems.push(
        `claim "${c.claim}" is bound to \`${c.sectionAnchor}\`, a section unchanged since the last extraction whose claims are settled — extract nothing for it.`,
      )
      continue
    }
    if (c.replaces !== undefined) {
      const target = resolve(c.replaces, c.sectionAnchor)
      if (!target) {
        problems.push(`claim "${c.claim}" replaces "${c.replaces}", which is no prior claim of a section being extracted. Copy a prior sentence verbatim, or drop \`replaces\` for a new claim.`)
        continue
      }
      account(target)
      continue
    }
    const kept = resolve(c.claim, c.sectionAnchor)
    if (kept && kept.sectionAnchor === c.sectionAnchor) account(kept)
  }
  const retired = new Set<string>()
  for (const r of draft.retiredClaims ?? []) {
    const target = resolve(r.claim)
    if (!target) {
      problems.push(`retired claim "${r.claim}" is no prior claim of a section being extracted.`)
      continue
    }
    retired.add(priorKey(target))
  }
  for (const c of toAccount) {
    const times = continued.get(priorKey(c)) ?? 0
    const isRetired = retired.has(priorKey(c))
    if (times > 1) problems.push(`prior claim "${c.claim}" is continued by ${times} claims — keep or replace it exactly once.`)
    if (times > 0 && isRetired) problems.push(`prior claim "${c.claim}" is both continued and retired — do one or the other.`)
    if (times === 0 && !isRetired) {
      problems.push(
        `prior claim "${c.claim}" (\`${c.sectionAnchor}\`) is unaccounted for: return it with its sentence verbatim, replace it with a claim naming it in \`replaces\`, or retire it in \`retiredClaims\` with a reason.`,
      )
    }
  }
  return problems
}

/**
 * The fold's merge: the prior's claims and notes of every settled section,
 * byte for byte, then the draft's for every other section. `retiredClaims`
 * served the accounting and is dropped, so the merged outcome is a
 * whole-document extraction like any other — which is what the cache keeps
 * and what a later run reads back as its prior.
 */
export function mergeSettledSections<C extends { sectionAnchor: string }>(
  draft: { claims: readonly C[]; untestable: readonly UntestableNote[]; retiredClaims?: unknown },
  prior: ExtractPrior,
): { claims: C[]; untestable: UntestableNote[] } {
  const settled = new Set(prior.settledAnchors)
  const claims: C[] = []
  for (const c of prior.claims) {
    if (!settled.has(c.sectionAnchor) || c.driver === undefined) continue
    const { replaces: _replaces, ...rest } = c
    claims.push({ ...rest, needs: c.needs ?? [] } as unknown as C)
  }
  for (const c of draft.claims) if (!settled.has(c.sectionAnchor)) claims.push(c)
  const untestable: UntestableNote[] = [
    ...prior.untestable.filter((n) => settled.has(n.sectionAnchor)),
    ...draft.untestable.filter((n) => !settled.has(n.sectionAnchor)),
  ]
  return { claims, untestable }
}

/**
 * Identity below the claim: a KEPT claim (its sentence verbatim) takes its
 * prior driver, proof alternatives, cases and needs byte for byte — the
 * sentence is the claim, a re-chosen driver on an unchanged claim unbinds
 * every flow milestone proved on the old one, and a re-spelled case id
 * orphans every milestone that selects it; a REPLACED claim keeps the id of
 * every prior case whose own sentence it re-states, and the prior need names
 * for the same kinds. Applied to the draft's extracted sections only; settled
 * sections are prior already. Deterministic, so a session cannot re-mint what
 * did not change.
 */
export function carryPriorCaseIdentity<C extends { claim: string; sectionAnchor: string; replaces?: string; driver?: ExtractedClaim['driver']; alternativeDrivers?: ExtractedClaim['alternativeDrivers']; verification?: ExtractedClaim['verification']; needs?: ClaimNeed[] }>(
  draft: { claims: readonly C[] },
  prior: ExtractPrior,
): C[] {
  const settled = new Set(prior.settledAnchors)
  const byText = new Map<string, PriorClaim>()
  for (const c of prior.claims) if (!settled.has(c.sectionAnchor)) byText.set(normalizeSentence(c.claim), c)
  return draft.claims.map((c) => {
    if (settled.has(c.sectionAnchor)) return c
    const kept = c.replaces === undefined ? byText.get(normalizeSentence(c.claim)) : undefined
    if (kept && kept.sectionAnchor === c.sectionAnchor) {
      const { alternativeDrivers: _alt, ...rest } = c
      return {
        ...(kept.driver ? rest : c),
        ...(kept.driver ? { driver: kept.driver, ...(kept.alternativeDrivers ? { alternativeDrivers: kept.alternativeDrivers } : {}) } : {}),
        ...(kept.verification ? { verification: kept.verification } : {}),
        ...(kept.needs !== undefined ? { needs: kept.needs } : {}),
      } as C
    }
    const replaced = c.replaces === undefined ? undefined : byText.get(normalizeSentence(c.replaces))
    if (!replaced) return c
    const priorCases = replaced.verification?.cases ?? []
    const cases = c.verification?.cases?.map((k) => {
      const same = priorCases.find((p) => normalizeSentence(p.claim) === normalizeSentence(k.claim))
      return same && same.id !== k.id ? { ...k, id: same.id } : k
    })
    const priorNeeds = replaced.needs ?? []
    const needs = c.needs?.map((n) => {
      const same = priorNeeds.find((p) => p.kind === n.kind && normalizeSentence(p.name) !== normalizeSentence(n.name) && (p.detail ?? '') === (n.detail ?? ''))
      return same ? { ...n, name: same.name } : n
    })
    return {
      ...c,
      ...(c.verification && cases ? { verification: { ...c.verification, cases } } : {}),
      ...(needs ? { needs } : {}),
    }
  })
}
