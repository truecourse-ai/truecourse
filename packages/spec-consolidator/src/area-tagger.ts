/**
 * Per-doc AREA tagger — the curated-corpus classifier (spec-scan redesign,
 * Phase 1). For each kept doc it asks an LLM "which AREAS does this doc cover?"
 * and returns a list of two-level `{product, concern}` tags plus the doc's
 * lifecycle status. It NEVER disassembles the doc into claims — the whole doc
 * stays the unit; tagging only annotates it.
 *
 * Cheap (Haiku-tier) and cached per-doc by (path, contentHash, prompt
 * fingerprint) through the pluggable KV seam — re-running a scan with unchanged
 * docs costs zero tokens, which is what keeps `corpus.json` stable across
 * re-scans. Failures degrade gracefully: a doc that errors out classifies to no
 * areas (it still appears in the corpus, just ungrouped) rather than breaking
 * the scan.
 *
 * The classifier proposes FREE-FORM product/concern strings; canonicalization
 * (synonym folding, slugging) happens deterministically downstream in
 * `area-grouper.ts`, so the engine carries no hardcoded per-repo vocabulary and
 * a wider alias map re-normalizes cached tags for free.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import { getCacheEntry, setCacheEntry } from '@truecourse/llm';
import { cliTransport, stripCodeFences, type LlmTransport } from '@truecourse/shared/llm';
import type { DocCandidate } from './discovery.js';
import { AreaTagSchema, type AreaTag } from './corpus-types.js';
import { StatusSchema, type Status } from './types.js';
import { defaultConcurrency } from './runner.js';

/** The tagger's per-doc verdict: the raw (un-normalized) area tags + status. */
export interface DocAreaTags {
  /** Raw `{product, concern}` tags as proposed by the classifier. */
  tags: AreaTag[];
  /** Lifecycle status of the doc, when stated in its header. */
  status?: Status;
}

export interface AreaTagRunnerInput {
  doc: DocCandidate;
}

export type AreaTagRunner = (input: AreaTagRunnerInput) => Promise<DocAreaTags>;

export interface AreaTaggerOptions {
  /** Override the runner. Tests pass a stub. */
  runner?: AreaTagRunner;
  /** LLM transport for the auto-created runner (defaults to cli). */
  transport?: LlmTransport;
  /** When false, skip the LLM call entirely; every doc tags to no areas. */
  enabled?: boolean;
  /** Cap on concurrent LLM calls. Default {@link defaultConcurrency}. */
  concurrency?: number;
  /** Model forwarded to the default spawn runner. */
  model?: string;
  /** Fallback model forwarded to the default spawn runner. */
  fallbackModel?: string;
  /**
   * Fired once per doc as it's tagged, plus an initial `(0, total)` so the
   * caller learns the total upfront. Tagging is concurrent, so `done`
   * increments in completion order, not doc order.
   */
  onProgress?: (done: number, total: number) => void;
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

/**
 * Tag every doc with the areas it covers. Returns a map keyed by `doc.path`.
 * When `enabled === false` (or there are no docs) every doc maps to empty tags.
 */
export async function tagDocs(
  repoRoot: string,
  docs: DocCandidate[],
  opts: AreaTaggerOptions = {},
): Promise<Map<string, DocAreaTags>> {
  const out = new Map<string, DocAreaTags>();
  if (opts.enabled === false || docs.length === 0) {
    for (const d of docs) out.set(d.path, { tags: [] });
    return out;
  }

  const runner =
    opts.runner ??
    spawnAreaTagRunner({ transport: opts.transport, model: opts.model, fallbackModel: opts.fallbackModel });
  // Clamp to >=1: concurrency is a public option, and a 0/negative value would
  // stall the hand-rolled limiter (no task ever launches, the promise never resolves).
  const concurrency = Math.max(1, opts.concurrency ?? defaultConcurrency());

  const total = docs.length;
  let done = 0;
  const markDone = (): void => opts.onProgress?.(++done, total);
  opts.onProgress?.(0, total);

  let cursor = 0;
  let active = 0;
  await new Promise<void>((resolve) => {
    const launch = (): void => {
      while (active < concurrency && cursor < docs.length) {
        const doc = docs[cursor++];
        active++;
        tagOne(repoRoot, doc, runner)
          .then((verdict) => {
            out.set(doc.path, verdict);
          })
          .catch(() => {
            // A failed doc gets no areas — it still appears in the corpus,
            // ungrouped, rather than aborting the whole scan.
            out.set(doc.path, { tags: [], status: parseDocStatus(docBody(doc)) });
          })
          .finally(() => {
            markDone();
            active--;
            if (cursor >= docs.length && active === 0) resolve();
            else launch();
          });
      }
      if (cursor >= docs.length && active === 0) resolve();
    };
    launch();
  });

  return out;
}

async function tagOne(repoRoot: string, doc: DocCandidate, runner: AreaTagRunner): Promise<DocAreaTags> {
  const cacheKey = computeCacheKey(doc);
  const cached = await readCache(repoRoot, cacheKey);
  if (cached) return cached;
  const verdict = await runner({ doc });
  // Deterministic status fallback when the model omitted it — the header is the
  // more reliable source anyway.
  if (verdict.status === undefined) {
    const parsed = parseDocStatus(docBody(doc));
    if (parsed) verdict.status = parsed;
  }
  await writeCache(repoRoot, cacheKey, verdict);
  return verdict;
}

// ---------------------------------------------------------------------------
// Doc body + header status parsing
// ---------------------------------------------------------------------------

function docBody(doc: DocCandidate): string {
  if (doc.content !== undefined) return doc.content;
  if (doc.absPath) {
    try {
      return fs.readFileSync(doc.absPath, 'utf-8');
    } catch {
      /* fall through to preview */
    }
  }
  return doc.preview;
}

const STATUS_VALUES = new Set(StatusSchema.options);

/**
 * Parse a lifecycle status from a doc's header. PRDs/ADRs commonly carry a
 * `Status: shipped` line (in YAML frontmatter or a header block) in the first
 * lines. Best-effort: returns undefined when nothing recognizable is found.
 */
export function parseDocStatus(body: string): Status | undefined {
  const head = body.split(/\r?\n/).slice(0, 40);
  for (const line of head) {
    const m = /^\s*[-*]?\s*\*{0,2}status\*{0,2}\s*[:=]\s*(.+?)\s*$/i.exec(line);
    if (!m) continue;
    const status = classifyStatusValue(m[1]);
    if (status) return status;
    // Unrecognized value on this status line (e.g. a badge image) — keep scanning
    // for a clearer one rather than bailing on the first match.
  }
  return undefined;
}

/**
 * Map a free-form status value to a canonical {@link Status}. Terminal / negative
 * states are checked BEFORE "shipped" so phrasings like "completed, now
 * deprecated" or "draft, GA in Q3" classify by their governing state, not an
 * incidental keyword. Ambiguous short tokens (`ga`/`live`) only count when they
 * are the whole value.
 */
function classifyStatusValue(rawValue: string): Status | undefined {
  const raw = rawValue.toLowerCase().replace(/[`*_]/g, '').trim();
  if (!raw) return undefined;
  if (STATUS_VALUES.has(raw as Status)) return raw as Status;
  if (/\b(out[- ]?of[- ]?scope|wont[- ]?fix|rejected|cancelled|canceled)\b/.test(raw)) return 'out-of-scope';
  if (/\b(deprecated|superseded|obsolete|retired)\b/.test(raw)) return 'deprecated';
  if (/\b(deferred|on[- ]?hold|paused|backlog)\b/.test(raw)) return 'deferred';
  if (/\b(in[- ]?progress|planned|draft|proposed|todo|wip|upcoming|not[- ]?started)\b/.test(raw)) return 'planned';
  // "accepted"/"approved"/"adopted" — an ADR whose decision is in force.
  if (/\b(shipped|done|complete|completed|released|accepted|approved|adopted|active|generally[- ]?available)\b/.test(raw)) return 'shipped';
  if (raw === 'ga' || raw === 'live' || raw === 'go live') return 'shipped';
  return undefined;
}

// ---------------------------------------------------------------------------
// Prompt + subprocess runner
// ---------------------------------------------------------------------------

export const AREA_TAGGER_SYSTEM_PROMPT = `You classify ONE documentation file by the AREAS of a software system it covers. You do NOT extract facts — you only tag the whole doc.

An AREA is two levels: { "product", "concern" }.

PRODUCT = the separately-deployed APPLICATION / SERVICE the doc is about. CRITICAL: most repositories are ONE product — use "product": "core" for it. A feature, domain, or module name (orders, customers, billing, auth, events, payments, search) is a CONCERN, NOT a product. Only use a non-core product when the repo genuinely ships SEVERAL distinct, separately-deployed apps that reuse the same concept names (e.g. a customer web app AND an internal admin console AND a data pipeline that all have "events") — that is the only case where the product axis earns its keep, by keeping their same-named concerns from merging into one wrong contract. When in doubt, the product is "core".
  - WRONG: an "Orders" PRD in a single-app repo → product "orders".  (orders is a concern)
  - RIGHT: that same PRD → product "core", concerns "orders entity" / "endpoints" / "errors".

CONCERN = the slice within the product (e.g. "users entity", "auth", "events", "endpoints", "errors", "billing", "persistence", "architecture", "messaging"). Prefer a short noun phrase and reuse the same wording for the same concept across docs, so a README and a PRD that both describe orders BOTH produce "core" + "orders entity" and land in one area.

ASSIGN AT LEAST ONE AREA TO EVERY DOC. Every file you receive has already been confirmed as spec-source material, so it MUST get one or more non-process areas unless it is purely meta. In particular, an ADR / decision record decides exactly one thing — tag the concern it decides:
  - "we use Bearer JWTs"            → core / auth
  - "standard error envelope"       → core / errors
  - "we use Postgres as the store"  → core / persistence  (and/or core / architecture)
  - "we use Kafka for messaging"    → core / messaging    (and/or core / architecture)
Returning zero areas for a real spec doc is a mistake — it would be excluded from contract generation entirely.

MULTI-AREA: a doc often covers several areas (a broad README or PRD may cover orders + customers + auth + errors). List EVERY area it materially specifies. Ignore incidental one-line mentions. Cap at ~6 areas.

PROCESS BUCKET: sections that are pure overview / goals / non-goals / open-questions and spec no behavior map to product "process" with one of these concerns: overview, goals, non-goals, open-questions. A doc that is ONLY process gets only process areas; a substantive doc that merely has a Goals section does NOT need a process area.

STATUS: if the doc header states a lifecycle (Status: shipped / planned / deferred / deprecated / out-of-scope, or equivalents like "done"/"draft"), report it; otherwise null.

Output ONLY a JSON object, no prose, no code fences:

{ "areas": [ { "product": "core", "concern": "orders entity" }, { "product": "core", "concern": "auth" } ],
  "status": "shipped" }

Use "status": null when no lifecycle is stated. Never invent areas the doc does not cover, but never leave a real spec doc with zero areas.`;

/** How much of the doc to show the classifier. Tagging needs structure, not the full body. */
const TAGGER_PREVIEW_LINES = 120;

export function buildAreaTaggerUserPrompt(doc: DocCandidate, body: string): string {
  const preview = body.split(/\r?\n/).slice(0, TAGGER_PREVIEW_LINES).join('\n');
  return [
    `Path: ${doc.path}`,
    `Detected kind: ${doc.kind}`,
    `Size: ${doc.size} bytes`,
    '',
    `--- doc (first ${TAGGER_PREVIEW_LINES} lines) ---`,
    preview,
    '--- end doc ---',
    '',
    'Return the JSON object as specified.',
  ].join('\n');
}

const AreaTaggerOutputSchema = z.object({
  areas: z.array(AreaTagSchema).default([]),
  // Accept ANY status string the model echoes from the doc header ("accepted",
  // "draft", "WIP", …) and coerce it below. A strict enum here would throw on an
  // unrecognized value and discard the AREAS along with it — which silently
  // dropped every "Status: accepted" ADR to zero areas.
  status: z.string().nullish(),
});

function spawnAreaTagRunner(
  opts: { transport?: LlmTransport; bin?: string; timeoutMs?: number; model?: string; fallbackModel?: string } = {},
): AreaTagRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return async ({ doc }) => {
    const body = docBody(doc);
    const raw = await transport({
      id: `spec.areaTag:${doc.path}`,
      stage: 'spec.areaTag',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: AREA_TAGGER_SYSTEM_PROMPT,
      user: buildAreaTaggerUserPrompt(doc, body),
      responseFormat: 'json',
      timeoutMs,
    });
    const inner = JSON.parse(stripCodeFences(raw));
    const parsed = AreaTaggerOutputSchema.parse(inner);
    // Coerce the free-form status through the same classifier the header parser
    // uses; an unrecognized value becomes undefined rather than discarding the tags.
    return { tags: parsed.areas, status: parsed.status ? classifyStatusValue(parsed.status) : undefined };
  };
}

// ---------------------------------------------------------------------------
// Cache — content-addressed via the pluggable KV seam (Postgres in EE, file in
// OSS). Key folds in the prompt fingerprint + doc contentHash so an unchanged
// doc is a hit and a prompt change invalidates.
// ---------------------------------------------------------------------------

const CACHE_NAME = 'consolidator/area-tags';

const PROMPT_FINGERPRINT = createHash('sha256').update(AREA_TAGGER_SYSTEM_PROMPT).digest('hex').slice(0, 16);

function computeCacheKey(doc: DocCandidate): string {
  return createHash('sha256')
    .update(`${PROMPT_FINGERPRINT}::${doc.path}::${doc.contentHash}`)
    .digest('hex');
}

const CachedAreaTagsSchema = z.object({
  tags: z.array(AreaTagSchema),
  status: StatusSchema.optional(),
});

async function readCache(scope: string, cacheKey: string): Promise<DocAreaTags | null> {
  const raw = await getCacheEntry(scope, CACHE_NAME, cacheKey);
  if (raw === null) return null;
  const parsed = CachedAreaTagsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function writeCache(scope: string, cacheKey: string, verdict: DocAreaTags): Promise<void> {
  await setCacheEntry(scope, CACHE_NAME, cacheKey, verdict);
}
