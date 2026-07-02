/**
 * Cross-doc vocabulary reconciliation (spec-scan redesign).
 *
 * Per-doc area tagging is done in isolation (so it caches by content hash), which
 * means the SAME product or concept can come back named differently across docs —
 * a README that says `booking` and a PRD that says `booking-app`, or `authn` vs
 * `authentication`. Left alone, those drift into separate areas: multi-doc
 * consolidation breaks and within-area overlaps go undetected.
 *
 * This stage does what the plan calls "normalization to prevent drift": it takes
 * the WHOLE emergent vocabulary (every distinct slugged product + concern across
 * all docs) and asks the model, ONCE, to canonicalize it — merging surface
 * variants / synonyms of the same thing while keeping genuinely-different things
 * apart. It returns a {@link VocabMap} the grouper applies. No hardcoded word
 * lists; cached by the vocab set (free unless the vocabulary changes).
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getCacheEntry, setCacheEntry } from '@truecourse/llm';
import { cliTransport, stripCodeFences, type LlmTransport } from '@truecourse/shared/llm';
import {
  normalizeArea,
  splitArea,
  CORE_PRODUCT,
  PROCESS_PRODUCT,
  type VocabMap,
} from './corpus-types.js';
import type { DocAreaTags } from './area-tagger.js';

export interface VocabRunnerInput {
  /** Distinct emergent product slugs (excludes the fixed `core`/`process`). */
  products: string[];
  /** Distinct concern slugs. */
  concerns: string[];
}
export type VocabRunner = (input: VocabRunnerInput) => Promise<VocabMap>;

export interface VocabNormalizerOptions {
  /** Override the runner. Tests pass a stub. */
  runner?: VocabRunner;
  /** LLM transport for the auto-created runner (defaults to cli). */
  transport?: LlmTransport;
  /** When false, skip reconciliation — identity map. */
  enabled?: boolean;
  /** Model forwarded to the default spawn runner. */
  model?: string;
  /** Fallback model forwarded to the default spawn runner. */
  fallbackModel?: string;
}

const EMPTY: VocabMap = { products: {}, concerns: {} };

/**
 * Build a reconciliation map for the vocabulary that emerged from tagging.
 * Returns an identity (empty) map when disabled, when there's nothing to
 * reconcile, or on error — never throws.
 */
export async function normalizeVocabulary(
  scope: string,
  tagsByPath: Map<string, DocAreaTags>,
  opts: VocabNormalizerOptions = {},
): Promise<VocabMap> {
  if (opts.enabled === false) return EMPTY;

  // Collect the slugged vocabulary the grouper will actually see (post slug +
  // deterministic alias), excluding the fixed buckets the LLM must not touch.
  const products = new Set<string>();
  const concerns = new Set<string>();
  for (const verdict of tagsByPath.values()) {
    for (const tag of verdict.tags) {
      const id = normalizeArea(tag);
      if (!id) continue;
      const { product, concern } = splitArea(id);
      if (product !== CORE_PRODUCT && product !== PROCESS_PRODUCT) products.add(product);
      if (product !== PROCESS_PRODUCT) concerns.add(concern);
    }
  }
  // Nothing can collide unless at least one axis has ≥2 distinct values.
  if (products.size < 2 && concerns.size < 2) return EMPTY;

  const input: VocabRunnerInput = {
    products: [...products].sort(),
    concerns: [...concerns].sort(),
  };
  const key = computeCacheKey(input);
  const cached = await readCache(scope, key);
  if (cached) return cached;

  const runner = opts.runner ?? spawnVocabRunner({ transport: opts.transport, model: opts.model, fallbackModel: opts.fallbackModel });
  let map: VocabMap;
  try {
    map = sanitize(await runner(input), input);
  } catch {
    return EMPTY; // reconciliation is best-effort — fall back to the raw vocab
  }
  await writeCache(scope, key, map);
  return map;
}

/**
 * Keep only safe mappings: each side must map to another slug from the SAME
 * input axis (never to `core`/`process`, never inventing a new label), and
 * identity mappings are dropped. Guards against a model that hallucinates a
 * target or tries to collapse the fixed buckets.
 */
function sanitize(map: VocabMap, input: VocabRunnerInput): VocabMap {
  const out: VocabMap = { products: {}, concerns: {} };
  const productSet = new Set(input.products);
  const concernSet = new Set(input.concerns);
  const clean = (
    raw: Record<string, string> | undefined,
    domain: Set<string>,
    dest: Record<string, string>,
  ): void => {
    for (const [from, to] of Object.entries(raw ?? {})) {
      if (from === to) continue;
      if (!domain.has(from) || !domain.has(to)) continue;
      if (to === CORE_PRODUCT || to === PROCESS_PRODUCT) continue;
      dest[from] = to;
    }
  };
  clean(map.products, productSet, out.products);
  clean(map.concerns, concernSet, out.concerns);
  return out;
}

// ---------------------------------------------------------------------------
// Prompt + subprocess runner
// ---------------------------------------------------------------------------

export const VOCAB_NORMALIZER_SYSTEM_PROMPT = `You reconcile the AREA VOCABULARY that emerged from tagging ONE repository's docs. Each doc was tagged independently, so the same thing may appear under different names. Your job: cluster names that mean the SAME thing and pick ONE canonical label per cluster — WITHOUT merging things that are genuinely different.

You get two lists from ONE repo: "products" (apps/services) and "concerns" (slices within them). For each, output a mapping from every non-canonical name to its canonical name.

MERGE when names denote the same thing:
  - surface-name variants of one product: "booking" / "booking-app" / "booking-web" → one (prefer the plain noun, e.g. "booking").
  - synonyms / spellings of one concern: "authn" / "authentication" → "auth"; "appointment" / "appointments" → one form.

DO NOT MERGE genuinely different things:
  - two distinct products that merely share a word: "capacity" vs "ccm", "billing" vs "billing-history" only if they're truly different surfaces (when unsure, keep separate).
  - unrelated concerns: "auth" and "events" are different.

Rules:
  - Canonical target MUST be one of the input names (don't invent new labels).
  - Only output entries that change something; omit a name that is already canonical.
  - Prefer the shortest / plainest member of a cluster as canonical.
  - When in doubt, DO NOT merge (a wrong merge is worse than leaving a near-duplicate).

Output ONLY a JSON object, no prose, no code fences:

{ "products": { "booking-app": "booking", "ops-console": "ops" },
  "concerns": { "authentication": "auth" } }

Use empty objects when nothing needs reconciling.`;

export function buildVocabUserPrompt(input: VocabRunnerInput): string {
  return [
    'Reconcile the vocabulary from this repository.',
    '',
    `products (${input.products.length}): ${JSON.stringify(input.products)}`,
    `concerns (${input.concerns.length}): ${JSON.stringify(input.concerns)}`,
    '',
    'Return the JSON mapping object as specified.',
  ].join('\n');
}

const VocabMapSchema = z.object({
  products: z.record(z.string(), z.string()).default({}),
  concerns: z.record(z.string(), z.string()).default({}),
});

function spawnVocabRunner(
  opts: { transport?: LlmTransport; bin?: string; timeoutMs?: number; model?: string; fallbackModel?: string } = {},
): VocabRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  const timeoutMs = opts.timeoutMs ?? 90_000;
  return async (input) => {
    const raw = await transport({
      id: 'spec.vocab',
      stage: 'spec.vocab',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: VOCAB_NORMALIZER_SYSTEM_PROMPT,
      user: buildVocabUserPrompt(input),
      responseFormat: 'json',
      timeoutMs,
    });
    const inner = JSON.parse(stripCodeFences(raw));
    return VocabMapSchema.parse(inner);
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_NAME = 'consolidator/vocab';
const PROMPT_FINGERPRINT = createHash('sha256').update(VOCAB_NORMALIZER_SYSTEM_PROMPT).digest('hex').slice(0, 16);

function computeCacheKey(input: VocabRunnerInput): string {
  return createHash('sha256')
    .update(`${PROMPT_FINGERPRINT}::${input.products.join(',')}::${input.concerns.join(',')}`)
    .digest('hex');
}

async function readCache(scope: string, key: string): Promise<VocabMap | null> {
  const raw = await getCacheEntry(scope, CACHE_NAME, key);
  if (raw === null) return null;
  const parsed = VocabMapSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function writeCache(scope: string, key: string, map: VocabMap): Promise<void> {
  await setCacheEntry(scope, CACHE_NAME, key, map);
}
