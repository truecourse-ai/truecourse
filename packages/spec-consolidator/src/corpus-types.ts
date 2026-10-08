/**
 * Types for the **curated doc corpus** — what the spec-scan pipeline
 * curates. The corpus never disassembles a
 * doc into claims; it annotates each doc with the AREAS it covers, groups docs
 * by area, and flags the CONFLICTS within each area. Downstream, generate turns the kept
 * docs into claims, flows and scenarios.
 *
 * Storage principle: the corpus stores NO prose — it references each doc by a
 * `DocRef`, `context/<sourceId>/<docPath>`. All downstream stages read content
 * through the ref, blind to where the body is held.
 */

import { z } from 'zod';
import { DocKindSchema, StatusSchema } from './types.js';

// ---------------------------------------------------------------------------
// DocRef — where a doc's .md lives (the corpus never embeds content)
// ---------------------------------------------------------------------------

/**
 * A reference to a doc's markdown. A bare string: `context/<sourceId>/<docPath>`,
 * which the reader resolves to the document's stored body.
 */
export const DocRefSchema = z.string().min(1);
export type DocRef = z.infer<typeof DocRefSchema>;

// ---------------------------------------------------------------------------
// Area vocabulary — two-level `product / concern`, emergent + normalized
// ---------------------------------------------------------------------------

/**
 * One area tag the classifier emits for a doc: the `product` (app / service /
 * bounded context the doc is about) and the `concern` (the slice within it —
 * `users entity`, `auth`, `events`). The vocab is NOT hardcoded per repo: the
 * classifier proposes free-form pairs and {@link normalizeArea} canonicalizes
 * them at grouping time so synonyms (`auth` vs `authentication`) collapse.
 */
export const AreaTagSchema = z.object({
  product: z.string().min(1),
  concern: z.string().min(1),
});
export type AreaTag = z.infer<typeof AreaTagSchema>;

/**
 * The product axis used for cross-cutting / single-product material — shared
 * enums, error envelopes, the one obvious system in a single-product repo.
 */
export const CORE_PRODUCT = 'core';

/**
 * The product axis for meta / process material (`Overview`, `Goals`,
 * `Non-Goals`, `Open-Questions`) that appears in many docs but specs no
 * behavior. Process areas are excluded from contract generation.
 */
export const PROCESS_PRODUCT = 'process';

/** The known process concerns — the one fixed slice of the otherwise-emergent vocab. */
export const PROCESS_CONCERNS = [
  'overview',
  'goals',
  'non-goals',
  'open-questions',
] as const;

/** Alias map folding common concern synonyms onto one canonical slug. */
const CONCERN_ALIASES: Record<string, string> = {
  authentication: 'auth',
  authorization: 'auth',
  authn: 'auth',
  authz: 'auth',
  rbac: 'auth',
  permissions: 'auth',
  users: 'users-entity',
  user: 'users-entity',
  'user-entity': 'users-entity',
  endpoint: 'endpoints',
  api: 'endpoints',
  apis: 'endpoints',
  routes: 'endpoints',
  event: 'events',
  analytics: 'events',
  telemetry: 'events',
  errors: 'errors',
  error: 'errors',
  'error-handling': 'errors',
  tenant: 'tenancy',
  tenants: 'tenancy',
  'multi-tenancy': 'tenancy',
  nongoals: 'non-goals',
  'non-goal': 'non-goals',
  goal: 'goals',
  'open-question': 'open-questions',
  questions: 'open-questions',
};

/** Alias map folding common product synonyms onto one canonical slug. */
const PRODUCT_ALIASES: Record<string, string> = {
  shared: CORE_PRODUCT,
  common: CORE_PRODUCT,
  platform: CORE_PRODUCT,
  system: CORE_PRODUCT,
  backend: CORE_PRODUCT,
  meta: PROCESS_PRODUCT,
  process: PROCESS_PRODUCT,
};

/**
 * Slugify a free-form axis value: NFKD-normalize and strip diacritics so
 * accented Latin folds cleanly (`"Café"` → `"cafe"`), lowercase, trim, collapse
 * any run of non-alphanumerics to a single hyphen, strip leading/trailing
 * hyphens. `"Users Entity"` → `"users-entity"`, `"Auth/RBAC"` → `"auth-rbac"`.
 * Returns `""` for a value with no ASCII-able alphanumerics (e.g. a CJK string
 * or pure punctuation); {@link normalizeArea} handles that fallback.
 */
export function slugifyAxis(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks left by NFKD
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Stable, dependency-free FNV-1a hash → base36, for non-sluggable axis values. */
function stableHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function applyAlias(slug: string, aliases: Record<string, string>): string {
  const aliased = aliases[slug];
  if (aliased) return aliased;
  // Light singular/plural fold: a trailing 's' alias (e.g. "tenants" → "tenant"
  // → "tenancy") is handled above; here we only catch the plural→singular alias
  // when the singular has an entry.
  if (slug.endsWith('s') && aliases[slug.slice(0, -1)]) return aliases[slug.slice(0, -1)];
  return slug;
}

const PROCESS_CONCERN_SET = new Set<string>(PROCESS_CONCERNS);

/**
 * Canonicalize one axis value, or `null` when it carries no real content.
 * Pure punctuation / whitespace → null (drop the garbage tag). A meaningful
 * value that slugs to empty (a non-Latin script) keeps a stable, collision-free
 * id rather than vanishing — so non-English repos don't silently lose docs.
 */
function canonAxis(raw: string, aliases: Record<string, string>): string | null {
  const trimmed = raw.trim();
  // Require at least one letter or number in ANY script; pure punctuation is garbage.
  if (!trimmed || !/[\p{L}\p{N}]/u.test(trimmed)) return null;
  let slug = slugifyAxis(trimmed);
  if (!slug) slug = `u-${stableHash(trimmed.normalize('NFKD'))}`;
  return applyAlias(slug, aliases);
}

/**
 * Normalize a raw `{product, concern}` tag into a canonical area id of the
 * form `product/concern`. Folds known synonyms; routes any process-named
 * concern (overview/goals/non-goals/open-questions) under the fixed `process`
 * product regardless of the proposed product. Returns `null` when either axis
 * has no real content.
 */
/**
 * Cross-doc vocabulary reconciliation map (built by `vocab-normalizer.ts`):
 * canonical slug per drifted slug, per axis — e.g. `booking-app` → `booking`,
 * `authentication` → `auth`. Applied by {@link normalizeArea} after slugging so
 * the same product/concept named differently across docs lands in one area.
 */
export interface VocabMap {
  products: Record<string, string>;
  concerns: Record<string, string>;
}

export function normalizeArea(tag: AreaTag, vocab?: VocabMap): string | null {
  let product = canonAxis(tag.product, PRODUCT_ALIASES);
  let concern = canonAxis(tag.concern, CONCERN_ALIASES);
  if (!product || !concern) return null;
  if (vocab) {
    product = vocab.products[product] ?? product;
    concern = vocab.concerns[concern] ?? concern;
  }
  // The process bucket is the one fixed slice of the otherwise-emergent vocab.
  if (PROCESS_CONCERN_SET.has(concern)) product = PROCESS_PRODUCT;
  return `${product}/${concern}`;
}

/**
 * Canonicalize a free-form concern label (e.g. a markdown heading) into the same
 * concern slug the grouper produces on the concern axis — slug + alias fold +
 * vocab remap. Returns `null` when the value carries no real content. Mirrors the
 * concern half of {@link normalizeArea} so heading-based matching lines up with
 * an area's `concern` exactly.
 */
export function canonicalizeConcern(raw: string, vocab?: VocabMap): string | null {
  const concern = canonAxis(raw, CONCERN_ALIASES);
  if (!concern) return null;
  return vocab?.concerns[concern] ?? concern;
}

/** Split a canonical area id back into its `{product, concern}` axes. */
export function splitArea(id: string): AreaTag {
  const slash = id.indexOf('/');
  if (slash === -1) return { product: CORE_PRODUCT, concern: id };
  return { product: id.slice(0, slash), concern: id.slice(slash + 1) };
}

/** True for an area whose product is the process bucket (excluded from generate). */
export function isProcessArea(id: string): boolean {
  return id.startsWith(`${PROCESS_PRODUCT}/`);
}

// ---------------------------------------------------------------------------
// Corpus artifacts
// ---------------------------------------------------------------------------

/**
 * Why a doc's sentences were skipped when its claims were extracted: the
 * sentences state no concrete claim another doc could state differently.
 * `other` carries a note in the ledger itself.
 */
export const SentenceSkipReasonSchema = z.enum([
  'navigation',
  'advice',
  'rationale',
  'marketing',
  'competitor',
  'example',
  'legal',
  'other',
]);
export type SentenceSkipReason = z.infer<typeof SentenceSkipReasonSchema>;

/**
 * What extracting a doc's claims came to, counted: its sentences, the claims
 * extracted, the sentences skipped per reason, and the sentences the extraction
 * left unaccounted for. The ledger itself stays in the scan's cache.
 */
export const DocLedgerCountsSchema = z.object({
  sentences: z.number().int().nonnegative(),
  /** The claims extracted. */
  claims: z.number().int().nonnegative(),
  skipped: z.record(SentenceSkipReasonSchema, z.number().int().nonnegative()),
  unrecorded: z.number().int().nonnegative(),
});
export type DocLedgerCounts = z.infer<typeof DocLedgerCountsSchema>;

/** One doc in the curated corpus — a reference + its tags, never its prose. */
export const CorpusDocSchema = z.object({
  /** Where the doc's .md lives. */
  ref: DocRefSchema,
  /** Coarse doc classification (signal, not gate). */
  kind: DocKindSchema,
  /** Lifecycle status parsed from the doc's H1 header, when present. */
  status: StatusSchema.optional(),
  /** ISO timestamp of the last change to the doc at its source. */
  lastTouched: z.string(),
  /** Canonical area ids (`product/concern`) this doc covers. May be many. */
  areaTags: z.array(z.string()),
  /**
   * The workspace source the document came from, and what kind of source that
   * is — stamped INTO the artifact by the workspace scan (the ref already
   * carries the id; the kind is what the ref cannot say). Absent on a
   * per-repository corpus, where the source is read at display time instead.
   */
  sourceId: z.string().optional(),
  sourceKind: z.string().optional(),
  /**
   * What extracting this doc's claims came to, on a scan that finds conflicts
   * by comparing claims. Absent on any other scan, and on a doc not read.
   */
  ledger: DocLedgerCountsSchema.optional(),
});
export type CorpusDoc = z.infer<typeof CorpusDocSchema>;

/** One side of a conflict: a sentence of one of its docs. */
export const ConflictSideSchema = z.object({
  /** The doc the sentence lives in, by ref (one of the conflict's two docs). */
  doc: DocRefSchema,
  /**
   * A short verbatim excerpt (≤ ~25 words) of the disputed sentence, copied from
   * the doc, so the viewer can show the exact disputed words. NOT part of the
   * conflict's identity (that is the doc and the sentence key below).
   */
  quote: z.string().optional(),
  /**
   * The key (`sentenceKey` in `@truecourse/shared`) of the document sentence the
   * quote is cut from. With the doc, the side's identity: two different sentences
   * of one doc name two conflicts, and anything else changing in the doc leaves
   * the conflict in place.
   */
  sentence: z.string(),
});
export type ConflictSide = z.infer<typeof ConflictSideSchema>;

/**
 * The resolution brief a judge-confirmed conflict carries — a persisted verdict
 * the user (or a downstream stage) acts on without re-reading both docs. Present
 * only on a confirmed flag whose brief parsed cleanly; a confirmed flag with a
 * malformed brief keeps the flag but omits this field.
 */
export const ConflictReviewSchema = z.object({
  /** 2–4 sentences naming the exact disagreement — which values/keys/rules conflict, quoting both sides. */
  explanation: z.string(),
  recommendation: z.object({
    /** `pick-a` = the flag's `docs[0]` side wins, `pick-b` = `docs[1]`. */
    action: z.enum(['pick-a', 'pick-b', 'fix-doc', 'dismiss']),
    /** One sentence: why this side/fix. */
    rationale: z.string(),
    /** Only for `fix-doc`: which doc and what to change. */
    fix: z.string().optional(),
    /**
     * The judge's confidence in the recommended action. `high` on an actionable
     * recommendation (pick-a-side / dismiss, never `fix-doc`) is AUTO-APPLIED at
     * scan as a `resolvedBy: 'auto'` conflict resolution; lower grades stay
     * advisory and surfaces show the grade. Optional so pre-confidence corpora
     * and cached verdicts still parse (absent = never auto-applied).
     */
    confidence: z.enum(['low', 'medium', 'high']).optional(),
  }),
});
export type ConflictReview = z.infer<typeof ConflictReviewSchema>;

/**
 * A conflict — two docs in the same area (or two sentences of one doc) that
 * state incompatible things. Carries refs only; the UI derives the prose
 * sentences at display time. The user resolves it with a verdict
 * (pick-a-side or dismissal) or a force-exclude.
 */
export const ConflictSchema = z.object({
  /** The two docs that disagree, by ref. */
  docs: z.tuple([DocRefSchema, DocRefSchema]),
  /** Short note on what disagrees ("auth0_id vs auth0_sub"). */
  note: z.string().default(''),
  /** The sides, one per doc (markdown headings), when known. */
  sections: z.array(ConflictSideSchema).default([]),
  /**
   * The area ids this conflict spans. Detection runs per area, so one disagreement
   * on a doc pair sharing several areas is flagged in each; the cross-area merge
   * collapses those to this single record and lists every area it spanned here, so
   * a resolution scoped to any of them clears the conflict everywhere.
   */
  areas: z.array(z.string()).default([]),
  /**
   * The verify pass's resolution brief, stamped only on a judge-confirmed flag
   * whose brief parsed cleanly. Absent on flags kept without a valid brief
   * (detector-only flags, verifier errors, or confirmed flags with a malformed
   * brief) and on older corpora — the field is additive and optional.
   */
  review: ConflictReviewSchema.optional(),
});
export type Conflict = z.infer<typeof ConflictSchema>;

/**
 * What comparing the extracted claims came to for one area: the area's claims
 * its area batches compared (a failed batch's claims are not counted), and the
 * groups of two or more those batches formed that hold one of them. An area
 * over the batch bound also carries how many parts it was cut into and how
 * many linked pairs of claims the cut separated.
 */
export const AreaComparisonSchema = z.object({
  /** The claims compared. */
  claims: z.number().int().nonnegative(),
  groups: z.number().int().nonnegative(),
  parts: z.number().int().positive().optional(),
  cutPairs: z.number().int().nonnegative().optional(),
});
export type AreaComparison = z.infer<typeof AreaComparisonSchema>;

/**
 * What comparing the extracted claims came to for the whole corpus: the distinct
 * subject names the claims use (after names equal but for case, spacing and
 * markup are merged), the subjects they settled into, the subject families
 * formed (settled subjects joined by a rare word of their names, two or more
 * to a family), the families whose claims span area batches and were compared
 * again in subject batches, the claims those batches held, and the claims a
 * comparison session placed in no group and not alone.
 */
export const CorpusComparisonSchema = z.object({
  subjectNames: z.number().int().nonnegative(),
  settledSubjects: z.number().int().nonnegative(),
  subjectFamilies: z.number().int().nonnegative(),
  subjectBatchFamilies: z.number().int().nonnegative(),
  subjectBatchClaims: z.number().int().nonnegative(),
  unplacedClaims: z.number().int().nonnegative(),
});
export type CorpusComparison = z.infer<typeof CorpusComparisonSchema>;

/** A group of docs sharing one normalized area. */
export const AreaSchema = z.object({
  /** Canonical area id, `product/concern`. */
  id: z.string(),
  product: z.string(),
  concern: z.string(),
  /** Docs tagged with this area, by ref. */
  docRefs: z.array(DocRefSchema),
  /** The conflicts found within this area. */
  conflicts: z.array(ConflictSchema).default([]),
  /**
   * Docs of this area a failed session left unjudged: a window whose record
   * session failed, or the docs of a comparison batch that failed. Absent when
   * every session of the area completed.
   */
  notReached: z.array(DocRefSchema).optional(),
  /**
   * What comparing the extracted claims came to here, on a scan that finds
   * conflicts by comparing claims. Absent on any other scan.
   */
  comparison: AreaComparisonSchema.optional(),
});
export type Area = z.infer<typeof AreaSchema>;

/**
 * The curated corpus — `.truecourse/specs/corpus.json`. Stored as the
 * workspace's spec set and materialized into a run's work tree. Holds docs +
 * area tags + the conflicts within each area.
 */
/** A doc the relevance filter dropped, with the reason — surfaced so the user can force-include it. */
export const SkippedDocSchema = z.object({
  ref: z.string(),
  reason: z.string(),
  /**
   * The structured SKIP category behind the drop, when the classifier gave one.
   * Additive and optional — older corpora have none, so no `CuratedCorpusSchema`
   * version bump. Lets the dashboard group drops ("3 third-party") instead of
   * regex-ing the deliberately-varied `reason` prose.
   */
  category: z.string().optional(),
});
export type SkippedDoc = z.infer<typeof SkippedDocSchema>;

export const CuratedCorpusSchema = z.object({
  version: z.literal(6),
  generatedAt: z.string(),
  docs: z.array(CorpusDocSchema),
  areas: z.array(AreaSchema),
  /** Docs the relevance filter dropped (path + reason); empty for older corpora. */
  skippedDocs: z.array(SkippedDocSchema).default([]),
  /**
   * What comparing the extracted claims came to, on a scan that finds conflicts
   * by comparing claims. Absent on any other scan.
   */
  comparison: CorpusComparisonSchema.optional(),
});
export type CuratedCorpus = z.infer<typeof CuratedCorpusSchema>;
