/**
 * Types for the **curated doc corpus** — the spec-scan redesign's unit of
 * curation (docs/SPEC_SCAN_REDESIGN_PLAN.md). The corpus never disassembles a
 * doc into claims; it annotates each doc with the AREAS it covers, groups docs
 * by area, flags within-area OVERLAPS, and records doc→doc RELATIONS. The only
 * structured artifact downstream is the contract, produced later at generate
 * time.
 *
 * Storage principle: the corpus stores NO prose — it references each doc by a
 * `DocRef` (where the .md lives). In OSS a DocRef is a repo-relative path; in EE
 * it is a content-addressed blob id. All downstream stages read content through
 * the ref, blind to file-vs-blob.
 */

import { z } from 'zod';
import { DocKindSchema, StatusSchema, RelationSchema } from './types.js';

// ---------------------------------------------------------------------------
// DocRef — where a doc's .md lives (the corpus never embeds content)
// ---------------------------------------------------------------------------

/**
 * A reference to a doc's markdown. A bare string for forward-compatibility
 * with EE blob ids; in OSS it is the repo-relative path (forward slashes).
 * The reader resolves it to content (file in OSS, blob in EE).
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

/** One doc in the curated corpus — a reference + its tags, never its prose. */
export const CorpusDocSchema = z.object({
  /** Where the doc's .md lives. */
  ref: DocRefSchema,
  /** Coarse doc classification (signal, not gate). */
  kind: DocKindSchema,
  /** Lifecycle status parsed from the doc's H1 header, when present. */
  status: StatusSchema.optional(),
  /** ISO timestamp of the last change to the doc (git mtime in OSS). */
  lastTouched: z.string(),
  /** Canonical area ids (`product/concern`) this doc covers. May be many. */
  areaTags: z.array(z.string()),
});
export type CorpusDoc = z.infer<typeof CorpusDocSchema>;

/**
 * A flagged within-area overlap — two docs in the same area that MAY disagree.
 * Carries refs only; the CLI/UI derive the prose passages at display time. The
 * user resolves it by recording a {@link RelationSchema}.
 */
/** A specific section (markdown heading) in one doc that participates in an overlap. */
export const OverlapSectionSchema = z.object({
  /** The doc this section lives in, by ref (one of the overlap's two docs). */
  doc: DocRefSchema,
  /** The heading text of the conflicting section (verbatim from the doc). */
  heading: z.string(),
});
export type OverlapSection = z.infer<typeof OverlapSectionSchema>;

export const OverlapSchema = z.object({
  /** The two docs that overlap, by ref. */
  docs: z.tuple([DocRefSchema, DocRefSchema]),
  /** Short note on what may disagree ("auth0_id vs auth0_sub"). */
  note: z.string().default(''),
  /** The specific conflicting sections per doc (markdown headings), when known. */
  sections: z.array(OverlapSectionSchema).default([]),
});
export type Overlap = z.infer<typeof OverlapSchema>;

/** A group of docs sharing one normalized area. */
export const AreaSchema = z.object({
  /** Canonical area id, `product/concern`. */
  id: z.string(),
  product: z.string(),
  concern: z.string(),
  /** Docs tagged with this area, by ref. */
  docRefs: z.array(DocRefSchema),
  /** Within-area overlaps still awaiting a relation. */
  overlaps: z.array(OverlapSchema).default([]),
});
export type Area = z.infer<typeof AreaSchema>;

/**
 * The curated corpus — `.truecourse/specs/corpus.json`. Committable (expensive
 * to regenerate, not purely deterministic), inherited from git like LATEST.json.
 * Holds docs + area tags + auto-detected relations; user-authored relations live
 * in `decisions.json`. The effective relation set at generate time is the union.
 */
/** A doc the relevance filter dropped, with the reason — surfaced so the user can force-include it. */
export const SkippedDocSchema = z.object({
  ref: z.string(),
  reason: z.string(),
});
export type SkippedDoc = z.infer<typeof SkippedDocSchema>;

export const CuratedCorpusSchema = z.object({
  version: z.literal(3),
  generatedAt: z.string(),
  docs: z.array(CorpusDocSchema),
  areas: z.array(AreaSchema),
  /** Auto-detected doc→doc relations (filename / llm provenance). */
  relations: z.array(RelationSchema).default([]),
  /** Docs the relevance filter dropped (path + reason); empty for older corpora. */
  skippedDocs: z.array(SkippedDocSchema).default([]),
});
export type CuratedCorpus = z.infer<typeof CuratedCorpusSchema>;
