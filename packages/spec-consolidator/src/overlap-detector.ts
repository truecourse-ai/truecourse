/**
 * OVERLAP detection (spec-scan redesign, Phase 1). It flags doc PAIRS that may
 * DISAGREE — surfaced to the user as readable excerpts so they can resolve with
 * a section-scoped verdict (pick a side / dismiss) or by fixing a doc. Biased to
 * flag-for-human: complementary docs aren't a conflict, but a plausible
 * disagreement is worth a flag.
 *
 * The candidate set for an area is its own doc pairs PLUS a deterministic
 * heading-widened safety net: because the tagger labels each doc independently,
 * the same subject can land under different concerns across docs (a broad PRD's
 * `## Pagination` section tagged `core/api-conventions`, a focused note tagged
 * `core/pagination`), so the pair would never share an area to be compared. For
 * each non-process area, any OUTSIDE doc whose markdown heading slug-matches the
 * area's concern (via the grouper's own slug + alias + vocab fold) is paired with
 * each doc in the area. Widening is pure string work — no extra LLM stage — and
 * every widened candidate still goes through the same overlap judge.
 *
 * The pass runs on a cheap, fast model and is cached per pair by (area, both
 * content hashes, prompt fingerprint). Every pair is judged — nothing is capped
 * or dropped; the pre-flight cost estimate the user approves is the only spend
 * gate.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import { getCacheEntry, setCacheEntry } from '@truecourse/llm';
import { cliTransport, jsonSchemaHint, stripCodeFences, OUTPUT_ONLY_GUARDRAIL, type LlmTransport } from '@truecourse/shared/llm';
import { dedupeCrossAreaOverlaps, planDocChunks, type DocChunk } from '@truecourse/shared';
import type { DocCandidate } from './discovery.js';
import { canonicalizeConcern, isProcessArea } from './corpus-types.js';
import type { Area, Overlap, OverlapSection, VocabMap } from './corpus-types.js';
import { defaultConcurrency } from './runner.js';
import { verifyOverlapSections } from './pointer-verifier.js';

/** Which window slice of a doc a runner call judges (1-based `index` within `count`). */
export interface OverlapPart {
  index: number;
  count: number;
  isFirst: boolean;
}

export interface OverlapRunnerInput {
  areaId: string;
  /** Doc A — `content` carries the SHOWN window slice; path/contentHash are the real doc's. */
  a: DocCandidate;
  /** Doc B — windowed the same way as A. */
  b: DocCandidate;
  /** Set when doc A spans multiple windows; absent for a single-window doc. */
  aPart?: OverlapPart;
  /** Set when doc B spans multiple windows; absent for a single-window doc. */
  bPart?: OverlapPart;
}

export interface OverlapVerdict {
  /** True when the two docs may disagree on a specific decision. */
  overlap: boolean;
  /** Short note on what may disagree — shown to the user. */
  note: string;
  /** The conflicting sections per doc (markdown headings), when identifiable. */
  sections?: OverlapSection[];
}

export type OverlapRunner = (input: OverlapRunnerInput) => Promise<OverlapVerdict>;

export interface OverlapDetectorOptions {
  /** Override the runner. Tests pass a stub. */
  runner?: OverlapRunner;
  /** LLM transport for the auto-created runner (defaults to cli). */
  transport?: LlmTransport;
  /** When false, skip the LLM call entirely; no overlaps flagged. */
  enabled?: boolean;
  /**
   * Cross-doc vocab reconciliation map. Heading→concern matching folds through
   * it, so heading-widened candidates line up with the grouper's canonical areas.
   */
  vocab?: VocabMap;
  /** Cap on concurrent LLM calls. Default {@link defaultConcurrency}. */
  concurrency?: number;
  /** Model forwarded to the default spawn runner. */
  model?: string;
  /** Fallback model forwarded to the default spawn runner. */
  fallbackModel?: string;
  /** Fired once per pair examined, plus an initial `(0, total)`. */
  onProgress?: (done: number, total: number) => void;
}

/** Max chars of one doc shown to the judge per call; a larger doc splits into windows. */
export const OVERLAP_WINDOW_CHARS = 24_000;

/**
 * Flag within-area overlaps. Returns a map keyed by area id → the overlaps
 * found in that area (empty/absent areas omitted).
 */
export async function flagOverlaps(
  repoRoot: string,
  areas: Area[],
  docs: DocCandidate[],
  opts: OverlapDetectorOptions = {},
): Promise<Map<string, Overlap[]>> {
  const result = new Map<string, Overlap[]>();
  if (opts.enabled === false) return result;

  const byPath = new Map(docs.map((d) => [d.path, d]));
  const vocab = opts.vocab;

  // Build the work list. Per area: its own doc pairs, PLUS the heading-widened
  // cross-area pairs — an outside doc whose markdown heading slug-matches the
  // area's concern is paired with each doc already in the area, so a subject the
  // tagger filed under a different concern per doc still gets compared. Pairs are
  // deduped order-insensitively; every pair goes into the work list — nothing is
  // capped, so no comparison is ever skipped.
  interface Pair { areaId: string; a: DocCandidate; b: DocCandidate }
  const pairs: Pair[] = [];
  for (const area of areas) {
    const refs = area.docRefs;
    const areaPairs: Pair[] = [];
    const seen = new Set<string>();
    const addPair = (x: string, y: string): void => {
      if (x === y) return;
      const a = byPath.get(x);
      const b = byPath.get(y);
      if (!a || !b) return;
      const key = x < y ? `${x}\x00${y}` : `${y}\x00${x}`;
      if (seen.has(key)) return;
      seen.add(key);
      areaPairs.push({ areaId: area.id, a, b });
    };

    // Within-area pairs.
    for (let i = 0; i < refs.length; i++) {
      for (let j = i + 1; j < refs.length; j++) addPair(refs[i], refs[j]);
    }

    // Heading-widened cross-area pairs. Excluded for process areas, whose
    // concerns (overview/goals/…) name generic structural sections, not behavior.
    if (!isProcessArea(area.id)) {
      const inArea = new Set(refs);
      for (const d of docs) {
        if (inArea.has(d.path)) continue;
        if (!hasConcernHeading(d, area.concern, vocab)) continue;
        for (const ref of refs) addPair(d.path, ref);
      }
    }

    if (areaPairs.length === 0) continue;
    pairs.push(...areaPairs);
  }

  const total = pairs.length;
  let done = 0;
  const markDone = (): void => opts.onProgress?.(++done, total);
  opts.onProgress?.(0, total);
  if (total === 0) return result;

  const runner =
    opts.runner ??
    spawnOverlapRunner({ transport: opts.transport, model: opts.model, fallbackModel: opts.fallbackModel });
  // Clamp to >=1: a 0/negative value would stall the hand-rolled limiter.
  const concurrency = Math.max(1, opts.concurrency ?? defaultConcurrency());

  // A flagged verdict lands in the per-area result list; every settled pair ticks.
  const applyVerdict = (pair: Pair, verdict: OverlapVerdict): void => {
    if (verdict.overlap) {
      const list = result.get(pair.areaId) ?? [];
      // `areas` is set by the cross-area merge below (the single area here
      // for an unmerged flag, every spanned area for a merged one).
      list.push({ docs: [pair.a.path, pair.b.path], note: verdict.note, sections: verdict.sections ?? [], areas: [] });
      result.set(pair.areaId, list);
    }
    markDone();
  };

  // Expand every non-cached pair into its FULL window matrix — every window of A
  // against every window of B, judged completely: coverage is never truncated.
  // The pre-flight estimate (which models this exact matrix) is the cost gate,
  // not a silent cap. Cache hits settle their pair without any call.
  interface PairState {
    pair: Pair;
    cacheKey: string;
    cells: OverlapRunnerInput[];
    /** Per-cell verdicts in matrix order, so aggregation is deterministic. */
    verdicts: Array<OverlapVerdict | null>;
    anyFailed: boolean;
    remaining: number;
  }
  const states: PairState[] = [];
  for (const pair of pairs) {
    const cacheKey = computeCacheKey(pair.areaId, pair.a, pair.b);
    const cached = await readCache(repoRoot, cacheKey);
    if (cached) {
      applyVerdict(pair, cached);
      continue;
    }
    const aWindows = planDocChunks(pair.a.path, docBody(pair.a), OVERLAP_WINDOW_CHARS);
    const bWindows = planDocChunks(pair.b.path, docBody(pair.b), OVERLAP_WINDOW_CHARS);
    const cells: OverlapRunnerInput[] = [];
    for (const aw of aWindows) {
      for (const bw of bWindows) {
        const input: OverlapRunnerInput = {
          areaId: pair.areaId,
          a: windowDoc(pair.a, aw.text),
          b: windowDoc(pair.b, bw.text),
        };
        if (aw.total > 1) input.aPart = { index: aw.index, count: aw.total, isFirst: aw.isFirst };
        if (bw.total > 1) input.bPart = { index: bw.index, count: bw.total, isFirst: bw.isFirst };
        cells.push(input);
      }
    }
    states.push({ pair, cacheKey, cells, verdicts: new Array<OverlapVerdict | null>(cells.length).fill(null), anyFailed: false, remaining: cells.length });
  }

  // One window-pair judgement. When its pair's last cell settles: aggregate in
  // matrix order, cache only a fully-successful pass (a pair with failed calls
  // must re-run; an all-failed pair flags nothing), and deliver the verdict.
  const runCell = async (state: PairState, idx: number): Promise<void> => {
    try {
      state.verdicts[idx] = await runner(state.cells[idx]);
    } catch {
      state.anyFailed = true;
    }
    state.remaining -= 1;
    if (state.remaining > 0) return;
    const got = state.verdicts.filter((v): v is OverlapVerdict => v !== null);
    if (got.length === 0) {
      markDone();
      return;
    }
    const merged = aggregateVerdicts(got);
    if (!state.anyFailed) await writeCache(repoRoot, state.cacheKey, merged);
    applyVerdict(state.pair, merged);
  };

  // All cells across all pairs share the ONE concurrency pool, so a many-window
  // pair parallelizes instead of serializing behind a single pair slot.
  const work: Array<{ state: PairState; idx: number }> = [];
  for (const state of states) {
    for (let idx = 0; idx < state.cells.length; idx++) work.push({ state, idx });
  }
  let cursor = 0;
  let active = 0;
  if (work.length > 0) {
    await new Promise<void>((resolve) => {
      const launch = (): void => {
        while (active < concurrency && cursor < work.length) {
          const { state, idx } = work[cursor++];
          active++;
          runCell(state, idx).finally(() => {
            active--;
            if (cursor >= work.length && active === 0) resolve();
            else launch();
          });
        }
        if (cursor >= work.length && active === 0) resolve();
      };
      launch();
    });
  }

  // Pointer verification: the overlap judge names section pointers but
  // nothing validates them, and it can mis-anchor (taskline's README `rm` dispute
  // pointed at `## Storage` when the disputed sentence lives in the doc's lead).
  // Deterministically re-anchor each side against its doc's own content BEFORE
  // dedup, so duplicate records that disagreed on an anchor converge and the
  // representative choice (fewest-null) sees verified pointers. Pure function of
  // note + doc text, no LLM — corrects fresh AND cached verdicts alike.
  for (const list of result.values()) {
    for (const overlap of list) {
      overlap.sections = verifyOverlapSections({
        docs: overlap.docs,
        note: overlap.note,
        sections: overlap.sections,
        bodyOf: (ref) => {
          const d = byPath.get(ref);
          return d ? docBody(d) : undefined;
        },
      });
    }
  }

  // Cross-area dedup: detection runs per area, so the SAME disagreement on a doc
  // pair sharing several areas is flagged once per shared area (the SCOPE prompt
  // biases against off-topic flags but can't structurally prevent a dispute that
  // genuinely belongs to two areas). Collapse them via the ONE deterministic rule
  // (@truecourse/shared, re-used by the read-side): same unordered pair + a shared
  // section pointer on at least one side ⇒ one dispute, surfaced under a single
  // representative area with every spanned area recorded. Two genuinely different
  // disputes on the pair point at disjoint sections and are kept separate.
  const entries = [...result].flatMap(([area, list]) => list.map((overlap) => ({ area, overlap })));
  const merged = dedupeCrossAreaOverlaps(entries);
  result.clear();
  for (const m of merged) {
    const list = result.get(m.area) ?? [];
    list.push({ ...m.overlap, areas: m.areas });
    result.set(m.area, list);
  }

  // Stable ordering for deterministic corpus output.
  for (const [areaId, list] of result) {
    list.sort((x, y) => (x.docs.join() < y.docs.join() ? -1 : 1));
    result.set(areaId, list);
  }
  return result;
}

/** A doc candidate whose body is one window slice; path/hash stay the real doc's. */
function windowDoc(doc: DocCandidate, window: string): DocCandidate {
  return { ...doc, content: window };
}

/**
 * Merge every successful window verdict for a pair into one. Overlap is true if any
 * window flagged; the note joins the distinct non-empty flagged notes (cap 3, ' …'
 * when more); sections union the flagged verdicts' sections, deduped by
 * (doc, heading, quote).
 */
function aggregateVerdicts(verdicts: OverlapVerdict[]): OverlapVerdict {
  const flagged = verdicts.filter((v) => v.overlap);
  if (flagged.length === 0) return { overlap: false, note: '', sections: [] };

  const notes: string[] = [];
  for (const v of flagged) {
    const n = v.note.trim();
    if (n && !notes.includes(n)) notes.push(n);
  }
  const note = notes.length > 3 ? `${notes.slice(0, 3).join('; ')} …` : notes.join('; ');

  const sections: OverlapSection[] = [];
  const seen = new Set<string>();
  for (const v of flagged) {
    for (const s of v.sections ?? []) {
      const key = JSON.stringify([s.doc, s.heading, s.quote ?? null]);
      if (seen.has(key)) continue;
      seen.add(key);
      sections.push(s);
    }
  }
  return { overlap: true, note, sections };
}

// ---------------------------------------------------------------------------
// Prompt + subprocess runner
// ---------------------------------------------------------------------------

export const OVERLAP_DETECTOR_SYSTEM_PROMPT = `You compare TWO documentation files that both cover the same AREA of a software system and decide whether they may DISAGREE.

${OUTPUT_ONLY_GUARDRAIL}

DISAGREE = the two docs state different things about the SAME specific decision: a different value, field name, type, default, rule, enum member, status code, endpoint shape, or named behavior. That is something a human must reconcile.

SCOPE — judge ONLY disagreements that belong to THIS area (the "Area:" named in the message below). These docs usually span several areas and may also disagree on topics that belong ELSEWHERE; ignore those here — each is flagged in the area it belongs to, not twice. If the only contradiction you find is outside this area's concern, return overlap:false.

NOT a disagreement (do NOT flag):
  - Complementary coverage — each doc specs different parts of the area (different fields, different endpoints) with no contradiction.
  - One doc is a high-level summary and the other adds detail, consistently.
  - Identical or trivially compatible statements.

Bias: when there is a PLAUSIBLE contradiction a human should check, flag it. When the docs are clearly complementary or agree, do not.

When you flag an overlap, point at WHERE each side's disputed claim lives. Below each doc you are given a CLOSED list of that doc's section options — its headings, plus a "lead" option. Do NOT recall or guess a heading; SELECT from the list. For EACH side output a pointer with two fields:
  - \`heading\`: EXACTLY one of that doc's listed section headings, copied verbatim — OR the JSON literal \`null\` (not the string "null", not "") for the LEAD, the text ABOVE its first heading (or, when the doc opens straight with a title, that opening title block). Never emit a heading that is not one of the listed options.
  - \`quote\`: a SHORT verbatim excerpt (≤ 25 words) of the disputed sentence, copied EXACTLY from that doc — the words that state the claim in dispute. This is your evidence for the heading you picked; copy it, do not paraphrase.
List one entry per side; omit a side only when it genuinely has no conflicting passage.

PREAMBLE: use \`heading\`: \`null\` ONLY for that lead/preamble block; whenever the disputed passage is under a listed heading, select that heading verbatim.

PARTS — a long doc is shown to you ONE SLICE at a time; a header reading "(part k/n)" means other parts of that doc EXIST but are NOT shown here. When either doc is labeled "part k/n":
  - NEVER flag that it omits, lacks, is missing, or stops short of something — the rest may live in a part you cannot see.
  - Flag ONLY when BOTH shown texts EXPLICITLY STATE things that differ (a different value, name, or rule). Silence in one part is never a disagreement.

In the NOTE, refer to each doc by its FILENAME (the basename shown in the header, e.g. \`users.md\`) — NEVER "doc A" / "doc B", which mean nothing to the reader.

Output ONLY a JSON object, no prose, no code fences:

{ "overlap": true,
  "note": "users.md uses auth0_id; identity.md uses auth0_sub for the same user column",
  "sections": [
    { "side": "A", "heading": "User model", "quote": "the auth0_id column stores the Auth0 subject" },
    { "side": "B", "heading": "Identity", "quote": "we persist the Auth0 subject in auth0_sub" }
  ] }

Preamble example — doc A's disputed claim is a README tagline ABOVE its first heading, so its side uses \`heading\`: null and quotes that tagline verbatim:

{ "overlap": true,
  "note": "README.md lists C# as a supported language in the preamble; plan.md's Tech Stack omits it",
  "sections": [
    { "side": "A", "heading": null, "quote": "Supports TypeScript, Python, and C# out of the box" },
    { "side": "B", "heading": "Tech Stack", "quote": "The stack is TypeScript and Python" }
  ] }

Use { "overlap": false, "note": "", "sections": [] } when they are complementary or agree. The note is shown to the user — name the specific thing that differs.`;

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

/**
 * ATX markdown heading texts (`#`…`######` lines) from a doc body. The leading
 * (and optional trailing) hashes are dropped and inline emphasis / code markers
 * stripped, so `## \`Pagination\` ##` and `### **Auth**` yield `Pagination` /
 * `Auth`. Setext (underline) headings and fenced-code `#` lines are ignored.
 */
function extractHeadings(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[1].replace(/[`*_~]/g, '').trim();
    if (text) out.push(text);
  }
  return out;
}

/**
 * Whether any of the doc's headings canonicalizes to `concern` — the same
 * slug/alias/vocab fold the grouper applies to an area's concern axis, so a
 * heading `Authentication` matches the `auth` concern and `Pagination` matches
 * `pagination`.
 */
function hasConcernHeading(doc: DocCandidate, concern: string, vocab?: VocabMap): boolean {
  for (const heading of extractHeadings(docBody(doc))) {
    if (canonicalizeConcern(heading, vocab) === concern) return true;
  }
  return false;
}

/**
 * ATX heading texts (verbatim, WITHOUT the leading #s, inline markers KEPT) from a
 * markdown body — the closed choice set the prompt offers per side. Mirrors the
 * section index the assembly-time verifier splits on (same `HEADING_RE` shape), so
 * a heading the model selects here resolves to the same section on verification.
 */
function sectionHeadings(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^ {0,3}#{1,6}\s+(.*)$/.exec(line);
    if (!m) continue;
    const text = m[1].replace(/\s*#*\s*$/, '').trim();
    if (text) out.push(text);
  }
  return out;
}

/**
 * One side's closed section set: a lead option (offered ONLY when this window
 * starts the doc) plus one bullet per heading in the SHOWN window text.
 */
function sectionOptions(shown: string, isFirst: boolean): string[] {
  const lines: string[] = [];
  if (isFirst) lines.push('  - the lead (text above the first heading, or the opening title block) → use heading: null');
  for (const h of sectionHeadings(shown)) lines.push(`  - ${h}`);
  return lines;
}

export function buildOverlapUserPrompt(
  areaId: string,
  a: DocCandidate,
  b: DocCandidate,
  aPart?: OverlapPart,
  bPart?: OverlapPart,
): string {
  const shownA = docBody(a);
  const shownB = docBody(b);
  const headerA =
    aPart && aPart.count > 1
      ? `--- doc A: ${a.path} (part ${aPart.index}/${aPart.count}) ---`
      : `--- doc A: ${a.path} ---`;
  const headerB =
    bPart && bPart.count > 1
      ? `--- doc B: ${b.path} (part ${bPart.index}/${bPart.count}) ---`
      : `--- doc B: ${b.path} ---`;
  const aIsFirst = aPart ? aPart.isFirst : true;
  const bIsFirst = bPart ? bPart.isFirst : true;
  return [
    `Area: ${areaId}`,
    '',
    headerA,
    shownA,
    `--- end doc A ---`,
    '',
    headerB,
    shownB,
    `--- end doc B ---`,
    '',
    'SECTION OPTIONS — each side pointer MUST be one of these (verbatim), or the lead (heading: null):',
    '',
    `doc A (${a.path}):`,
    ...sectionOptions(shownA, aIsFirst),
    '',
    `doc B (${b.path}):`,
    ...sectionOptions(shownB, bIsFirst),
    '',
    'Return the JSON object as specified.',
  ].join('\n');
}

// What the LLM returns — sections keyed by SIDE (A/B), which the runner maps to
// the concrete doc paths (more robust than asking it to echo the paths).
const LlmOverlapSchema = z.object({
  overlap: z.boolean(),
  note: z.string().default(''),
  sections: z
    // heading is null when the conflicting passage is in the doc's preamble; quote
    // is the model's verbatim disputed-sentence excerpt (optional — a stray verdict
    // without it, or an old cached one, still parses).
    .array(z.object({ side: z.enum(['A', 'B']), heading: z.string().nullable(), quote: z.string().optional() }))
    .default([]),
});

/** The response schema sent on the request — the API transport enforces it via
 *  structured output; the cli transport ignores it. */
const OVERLAP_RESPONSE_SCHEMA = jsonSchemaHint(LlmOverlapSchema);

// What we cache + return — sections carry the resolved doc ref. `quote` is optional
// so older cached verdicts (no quote) still parse and flow.
const OverlapVerdictSchema = z.object({
  overlap: z.boolean(),
  note: z.string().default(''),
  sections: z
    .array(z.object({ doc: z.string(), heading: z.string().nullable(), quote: z.string().optional() }))
    .default([]),
});

function spawnOverlapRunner(
  opts: { transport?: LlmTransport; bin?: string; timeoutMs?: number; model?: string; fallbackModel?: string } = {},
): OverlapRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  const timeoutMs = opts.timeoutMs ?? 90_000;
  return async ({ areaId, a, b, aPart, bPart }) => {
    const part = aPart || bPart ? `:${aPart?.index ?? 1}-${bPart?.index ?? 1}` : '';
    const raw = await transport({
      id: `spec.overlap:${areaId}:${a.path}:${b.path}${part}`,
      stage: 'spec.overlap',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: OVERLAP_DETECTOR_SYSTEM_PROMPT,
      user: buildOverlapUserPrompt(areaId, a, b, aPart, bPart),
      responseFormat: 'json',
      schema: OVERLAP_RESPONSE_SCHEMA,
      timeoutMs,
    });
    const inner = LlmOverlapSchema.parse(JSON.parse(stripCodeFences(raw)));
    return {
      overlap: inner.overlap,
      note: inner.note,
      sections: inner.sections.map((s) => ({
        doc: s.side === 'A' ? a.path : b.path,
        heading: s.heading,
        ...(s.quote !== undefined ? { quote: s.quote } : {}),
      })),
    };
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_NAME = 'consolidator/overlap';

// The version prefix retires cached verdicts whose COVERAGE semantics changed even
// where the prompt text alone wouldn't: v2 ended the 120-line head slice; v3 moved
// windowing onto the shared heading-aware chunker (different window boundaries).
const PROMPT_FINGERPRINT = createHash('sha256').update(`v3::${OVERLAP_DETECTOR_SYSTEM_PROMPT}`).digest('hex').slice(0, 16);

function computeCacheKey(areaId: string, a: DocCandidate, b: DocCandidate): string {
  // Order-insensitive on the two docs so (a,b) and (b,a) share a cache entry.
  const hashes = [a.contentHash, b.contentHash].sort().join('::');
  return createHash('sha256').update(`${PROMPT_FINGERPRINT}::${areaId}::${hashes}`).digest('hex');
}

async function readCache(scope: string, cacheKey: string): Promise<OverlapVerdict | null> {
  const raw = await getCacheEntry(scope, CACHE_NAME, cacheKey);
  if (raw === null) return null;
  const parsed = OverlapVerdictSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function writeCache(scope: string, cacheKey: string, verdict: OverlapVerdict): Promise<void> {
  await setCacheEntry(scope, CACHE_NAME, cacheKey, verdict);
}
