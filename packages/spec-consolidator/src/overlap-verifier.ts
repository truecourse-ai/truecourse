/**
 * OVERLAP VERIFICATION — the precision pass over the recall-biased overlap
 * detector's flags. Detection (`overlap-detector.ts`) is deliberately Haiku-tier
 * and biased to flag-for-human, so it over-flags: most of its "disagreements" are
 * two docs describing different components, one doc merely omitting what the other
 * states, a hedge, or complementary detail — not a real contradiction. This stage
 * re-reads each flagged pair with FULL context and a stronger model and rules
 * strictly: is this a genuine contradiction a human must reconcile, or a false
 * alarm?
 *
 * Detection is untouched. This pass only ever REMOVES a flag on an explicit
 * `refuted` verdict — curate filters those out before the corpus is assembled, so
 * a refuted flag never reaches `corpus.json`. Everything else is KEPT: a
 * `confirmed` verdict, and — critically — a verifier ERROR or a missing verdict.
 * Refutation is the only thing that prunes, and only ever by explicit ruling
 * (fail-open).
 *
 * Verdicts cache per flag by (prompt fingerprint, area, both content hashes, the
 * dispute), so a re-scan of unchanged docs pays nothing. The fan-out pools through
 * {@link defaultConcurrency} exactly like the sibling relevance/overlap stages.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import { getCacheEntry, setCacheEntry } from '@truecourse/llm';
import { cliTransport, jsonSchemaHint, stripCodeFences, OUTPUT_ONLY_GUARDRAIL, type LlmTransport } from '@truecourse/shared/llm';
import { parseHeadings } from '@truecourse/shared';
import type { DocCandidate } from './discovery.js';
import type { Overlap, OverlapSection } from './corpus-types.js';
import { defaultConcurrency } from './runner.js';

/** One judge ruling on a flagged overlap. `refuted` prunes the flag; anything else keeps it. */
export interface OverlapVerification {
  verdict: 'confirmed' | 'refuted';
  /** One sentence, shown to the user (e.g. in logs) explaining the ruling. */
  reason: string;
}

/** The per-flag judge — a test seam, mirroring {@link import('./overlap-detector.js').OverlapRunner}. */
export type VerifyOverlapRunner = (input: {
  areaId: string;
  overlap: Overlap;
  a: DocCandidate;
  b: DocCandidate;
}) => Promise<OverlapVerification>;

export interface VerifyFlaggedOverlapsOptions {
  /** Override the runner. Tests pass a stub. */
  runner?: VerifyOverlapRunner;
  /** LLM transport for the auto-created runner (defaults to cli). */
  transport?: LlmTransport;
  /** When false, skip verification entirely; every flag is kept. */
  enabled?: boolean;
  /** Cap on concurrent LLM calls. Default {@link defaultConcurrency}. */
  concurrency?: number;
  /** Model forwarded to the default spawn runner. */
  model?: string;
  /** Fallback model forwarded to the default spawn runner. */
  fallbackModel?: string;
  /** Fired once per flag verified, plus an initial `(0, total)`. */
  onProgress?: (done: number, total: number) => void;
}

/** The verification outcome: the flags that survived, plus how many were refuted. */
export interface VerifyOverlapsResult {
  /** The overlap map with every refuted flag removed (empty areas dropped). */
  overlaps: Map<string, Overlap[]>;
  /** How many flags an explicit `refuted` verdict pruned. */
  refuted: number;
}

/** Per-side context budget. A doc whose body fits is shown in full; a larger one
 *  is shown as its heading outline plus the full text of the disputed section(s). */
export const VERIFY_DOC_BUDGET_CHARS = 60_000;

/**
 * Verify every flagged overlap in `overlapsByArea` and return the map with the
 * refuted flags removed. Only an explicit `refuted` verdict prunes a flag; a
 * `confirmed` verdict, a thrown call, or an unresolvable doc pair all KEEP it
 * (fail-open). Pools through {@link defaultConcurrency}; caches per flag.
 */
export async function verifyFlaggedOverlaps(
  repoRoot: string,
  overlapsByArea: Map<string, Overlap[]>,
  docs: DocCandidate[],
  opts: VerifyFlaggedOverlapsOptions = {},
): Promise<VerifyOverlapsResult> {
  if (opts.enabled === false) return { overlaps: overlapsByArea, refuted: 0 };

  const byPath = new Map(docs.map((d) => [d.path, d]));

  interface Work {
    areaId: string;
    overlap: Overlap;
    a: DocCandidate;
    b: DocCandidate;
  }
  const work: Work[] = [];
  for (const [areaId, list] of overlapsByArea) {
    for (const overlap of list) {
      const a = byPath.get(overlap.docs[0]);
      const b = byPath.get(overlap.docs[1]);
      // Can't judge without both bodies — leave the flag in place (fail-open).
      if (a && b) work.push({ areaId, overlap, a, b });
    }
  }

  const total = work.length;
  let done = 0;
  const markDone = (): void => opts.onProgress?.(++done, total);
  opts.onProgress?.(0, total);
  if (total === 0) return { overlaps: overlapsByArea, refuted: 0 };

  const runner =
    opts.runner ??
    spawnVerifyRunner({ transport: opts.transport, model: opts.model, fallbackModel: opts.fallbackModel });
  // Clamp to >=1: a 0/negative value would stall the hand-rolled limiter.
  const concurrency = Math.max(1, opts.concurrency ?? defaultConcurrency());

  // The set of flags an explicit `refuted` verdict pruned — by object identity, so
  // the filter below reaches the exact overlap objects in the map.
  const refutedSet = new Set<Overlap>();

  let cursor = 0;
  let active = 0;
  await new Promise<void>((resolve) => {
    const launch = (): void => {
      while (active < concurrency && cursor < work.length) {
        const item = work[cursor++];
        active++;
        verifyOne(repoRoot, item, runner)
          .then((verification) => {
            // ONLY an explicit refutation prunes; confirmed keeps the flag.
            if (verification.verdict === 'refuted') refutedSet.add(item.overlap);
          })
          .catch(() => {
            // Fail-open: a thrown call keeps the flag (no verdict = no prune).
          })
          .finally(() => {
            markDone();
            active--;
            if (cursor >= work.length && active === 0) resolve();
            else launch();
          });
      }
      if (cursor >= work.length && active === 0) resolve();
    };
    launch();
  });

  if (refutedSet.size === 0) return { overlaps: overlapsByArea, refuted: 0 };

  const overlaps = new Map<string, Overlap[]>();
  for (const [areaId, list] of overlapsByArea) {
    const kept = list.filter((o) => !refutedSet.has(o));
    if (kept.length > 0) overlaps.set(areaId, kept);
  }
  return { overlaps, refuted: refutedSet.size };
}

// ---------------------------------------------------------------------------
// Per-flag cache + runner
// ---------------------------------------------------------------------------

async function verifyOne(
  repoRoot: string,
  item: { areaId: string; overlap: Overlap; a: DocCandidate; b: DocCandidate },
  runner: VerifyOverlapRunner,
): Promise<OverlapVerification> {
  const cacheKey = computeCacheKey(item.areaId, item.overlap, item.a, item.b);
  const cached = await readCache(repoRoot, cacheKey);
  if (cached) return cached;
  const verification = await runner(item);
  await writeCache(repoRoot, cacheKey, verification);
  return verification;
}

const VerifyVerdictSchema = z.object({
  verdict: z.enum(['confirmed', 'refuted']),
  reason: z.string().default(''),
});

const VERIFY_VERDICT_SCHEMA = jsonSchemaHint(VerifyVerdictSchema);

function spawnVerifyRunner(
  opts: { transport?: LlmTransport; bin?: string; timeoutMs?: number; model?: string; fallbackModel?: string } = {},
): VerifyOverlapRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  const timeoutMs = opts.timeoutMs ?? 90_000;
  return async ({ areaId, overlap, a, b }) => {
    const raw = await transport({
      id: `spec.verifyOverlap:${areaId}:${a.path}:${b.path}`,
      stage: 'spec.verifyOverlap',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: VERIFY_OVERLAP_SYSTEM_PROMPT,
      user: buildVerifyOverlapUserPrompt(areaId, overlap, a, b),
      responseFormat: 'json',
      schema: VERIFY_VERDICT_SCHEMA,
      timeoutMs,
    });
    const inner = VerifyVerdictSchema.parse(JSON.parse(stripCodeFences(raw)));
    return { verdict: inner.verdict, reason: inner.reason };
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const VERIFY_OVERLAP_SYSTEM_PROMPT = `You are a strict adjudicator of documentation conflicts. Another pass — deliberately biased toward catching everything — flagged TWO documentation sections as possibly contradicting each other. With the full context below, rule whether this is a REAL contradiction a human must reconcile, or a false alarm.

${OUTPUT_ONLY_GUARDRAIL}

CONFIRM only a GENUINE contradiction: the two docs state INCOMPATIBLE things about the SAME decision of the SAME component — the same field, value, default, type, rule, enum member, status code, endpoint shape, or named behavior — where both statements cannot be true at once. A confirmed conflict is one a human must resolve by editing a doc or picking a side.

REFUTE when it is not that. Any ONE of the following makes it a REFUTE; give a one-sentence reason naming which rule applies:

(a) TWO IMPLEMENTATIONS / SUBSYSTEMS — each statement is true of a DIFFERENT component, so both hold at once. Example: one section describes how component A's parser handles input, the other how component B's parser handles input — different parsers, no conflict.

(b) OMISSION IS NOT CONTRADICTION — one doc simply does not mention what the other states. Example: one section lists three supported options and the other lists two of them without denying the third — silence is not disagreement.

(c) HEDGED / SPECULATIVE — the "conflict" is ambiguity, a maybe, or a difference of emphasis, with no two incompatible STATED values. Example: one section says a limit "may be tuned later" while the other gives the current limit — a plan and a present value do not contradict.

(d) COMPLEMENTARY DETAIL — the two sections state the SAME fact at different depth, or one elaborates the other consistently. Example: one section says requests are authenticated and the other says they are authenticated with a bearer token — the second refines the first, it does not contradict it.

Judge ONLY the specific claim the flag names, using each side's quote and surrounding context. Do not hunt for other disagreements. When you genuinely cannot tell whether two STATED values are incompatible, CONFIRM — a human should look. But never confirm on the strength of an omission, a hedge, or a difference that dissolves once you see the two sides describe different components.

Output ONLY a JSON object, no prose, no code fences:

  { "verdict": "confirmed", "reason": "the two sections give a different default for the same retry setting" }
  { "verdict": "refuted", "reason": "the two sections describe different services, so both statements hold (rule a)" }

The reason is one sentence, shown to the user.`;

/**
 * Build the judge's user message for one flagged dispute: the detector's note and,
 * for each side, its section pointer(s) + verbatim quote(s) and its doc context.
 * A doc whose body fits {@link VERIFY_DOC_BUDGET_CHARS} is shown in full; a larger
 * one is shown as its heading outline plus the full text of the disputed
 * section(s) named by the flag's pointers (and its lead for a `null` pointer).
 */
export function buildVerifyOverlapUserPrompt(
  areaId: string,
  overlap: Overlap,
  a: DocCandidate,
  b: DocCandidate,
): string {
  return [
    `Area: ${areaId}`,
    '',
    'The recall-biased detector flagged these two documents as possibly disagreeing.',
    `Detector's note: ${overlap.note || '(none)'}`,
    '',
    renderSide('A', a, overlap),
    '',
    renderSide('B', b, overlap),
    '',
    'Return the JSON verdict as specified.',
  ].join('\n');
}

function renderSide(label: 'A' | 'B', doc: DocCandidate, overlap: Overlap): string {
  const body = docBody(doc);
  const pointers = (overlap.sections ?? []).filter((s) => s.doc === doc.path);
  const ptrLines = pointers.length
    ? pointers.map((s) => {
        const where = s.heading === null ? '(lead / preamble)' : s.heading;
        const quote = s.quote ? `  quote: "${s.quote}"` : '';
        return `  - section: ${where}${quote}`;
      })
    : ['  - (no specific section named)'];
  return [
    `--- doc ${label}: ${doc.path} ---`,
    'flagged section(s):',
    ...ptrLines,
    '',
    'context:',
    sideContext(body, pointers),
    `--- end doc ${label} ---`,
  ].join('\n');
}

/**
 * The context shown for one side. A doc within budget is shown whole. A larger doc
 * is shown as its full heading outline plus the full text of each disputed section
 * (and the doc's lead when a pointer is `null`), so the judge sees exactly the
 * passages in dispute without the whole (oversized) body.
 */
function sideContext(body: string, pointers: readonly OverlapSection[]): string {
  if (body.length <= VERIFY_DOC_BUDGET_CHARS) return body;

  const parts: string[] = ['DOCUMENT OUTLINE (headings only):', headingOutline(body)];
  const seen = new Set<string>();
  for (const ptr of pointers) {
    if (ptr.heading === null) {
      if (seen.has('\x00lead')) continue;
      seen.add('\x00lead');
      const lead = leadText(body);
      if (lead.trim()) parts.push('', 'LEAD (text before the first heading):', lead);
    } else {
      const key = headingKey(ptr.heading);
      if (seen.has(key)) continue;
      seen.add(key);
      const text = sectionText(body, ptr.heading);
      if (text) parts.push('', `SECTION "${ptr.heading}":`, text);
    }
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Section machinery — via the shared doc-chunks heading scan (`parseHeadings`),
// the one fence-aware ATX scanner every doc consumer shares. The section-text
// boundary (a heading down to the next same-or-higher heading, descendants
// included) mirrors the shared section convention; kept local so this module
// stays dependency-lean, matching the sibling pointer-verifier.
// ---------------------------------------------------------------------------

const headingKey = (h: string): string => h.replace(/[`*_~]/g, '').trim().toLowerCase();

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

/** The doc's headings, one per line, prefixed with their level's hashes. */
function headingOutline(body: string): string {
  const headings = parseHeadings(body.split('\n'));
  if (headings.length === 0) return '(no headings)';
  return headings.map((h) => `${'#'.repeat(h.level)} ${h.text}`).join('\n');
}

/** The doc's lead: everything before its first heading (the whole body if none). */
function leadText(body: string): string {
  const lines = body.split('\n');
  const headings = parseHeadings(lines);
  const end = headings.length ? headings[0].line : lines.length;
  return lines.slice(0, end).join('\n');
}

/**
 * The full text of the section whose heading matches `heading` — the heading line
 * down to the next heading of the same or higher level (its subsections included),
 * or `null` when no heading matches. Heading match folds inline markers + case, so
 * a backtick-styled or emphasized heading still resolves.
 */
function sectionText(body: string, heading: string): string | null {
  const lines = body.split('\n');
  const headings = parseHeadings(lines);
  const key = headingKey(heading);
  const idx = headings.findIndex((h) => headingKey(h.text) === key);
  if (idx === -1) return null;
  const level = headings[idx].level;
  let end = lines.length;
  for (let j = idx + 1; j < headings.length; j++) {
    if (headings[j].level <= level) {
      end = headings[j].line;
      break;
    }
  }
  return lines.slice(headings[idx].line, end).join('\n');
}

// ---------------------------------------------------------------------------
// Cache — content-addressed via the pluggable KV seam, like the sibling stages.
// The key folds the prompt fingerprint + the area + both content hashes + the
// dispute (note + section pointers), so an unchanged flag is a hit and a prompt
// change invalidates.
// ---------------------------------------------------------------------------

const CACHE_NAME = 'consolidator/verify-overlap';

const PROMPT_FINGERPRINT = createHash('sha256')
  .update(`v1::${VERIFY_OVERLAP_SYSTEM_PROMPT}`)
  .digest('hex')
  .slice(0, 16);

function computeCacheKey(areaId: string, overlap: Overlap, a: DocCandidate, b: DocCandidate): string {
  // Order-insensitive on the two docs so (a,b) and (b,a) share a cache entry.
  const hashes = [a.contentHash, b.contentHash].sort().join('::');
  const dispute = createHash('sha256')
    .update(`${overlap.note}${JSON.stringify(overlap.sections ?? [])}`)
    .digest('hex');
  return createHash('sha256').update(`${PROMPT_FINGERPRINT}::${areaId}::${hashes}::${dispute}`).digest('hex');
}

async function readCache(scope: string, cacheKey: string): Promise<OverlapVerification | null> {
  const raw = await getCacheEntry(scope, CACHE_NAME, cacheKey);
  if (raw === null) return null;
  const parsed = VerifyVerdictSchema.safeParse(raw);
  return parsed.success ? { verdict: parsed.data.verdict, reason: parsed.data.reason } : null;
}

async function writeCache(scope: string, cacheKey: string, verification: OverlapVerification): Promise<void> {
  await setCacheEntry(scope, CACHE_NAME, cacheKey, verification);
}
