/**
 * Prompts for the corpus generate path (spec-scan redesign, Phase 2).
 *
 * Two stages:
 *   1. ENUMERATE (`contract.enumerate`) — a light pass that lists an area's
 *      TARGETS (the entity(ies), the N operations, the events, …) as names only,
 *      not full contracts. This list is both the work plan and the completeness
 *      checklist for the gate.
 *   2. GENERATE (`contract.extract`) — a goal-directed pass: given the area, a
 *      BATCH of targets, and the area's docs in precedence order, produce the
 *      `.tc` contract for each target. Reuses the rich artifact-catalog + grammar
 *      SYSTEM_PROMPT from `prompt.ts`; only the user prompt is corpus-shaped.
 */

import { z } from 'zod';
import type { AreaGenInput } from './corpus-reader.js';
import { canonicalIdentity } from './identity.js';
import { KIND_CAPABILITIES } from './prompt.js';

// ---------------------------------------------------------------------------
// Enumerate
// ---------------------------------------------------------------------------

export const TargetSpecSchema = z.object({
  /** ArtifactKind, e.g. Operation / Entity / Enum / EffectGroup / StateMachine / QueryRule. */
  kind: z.string(),
  /** Identity per the kind's rule (Operation = "METHOD /path", Entity = name, …). */
  identity: z.string(),
  /** Optional one-line note on what the target is, to steer generation. */
  hint: z.string().optional(),
});
export type TargetSpec = z.infer<typeof TargetSpecSchema>;

export const EnumerateResultSchema = z.object({
  targets: z.array(TargetSpecSchema).default([]),
});
export type EnumerateResult = z.infer<typeof EnumerateResultSchema>;

/**
 * Tolerant identity key for matching a target to an emitted fragment and for
 * de-duping targets across areas. Normalizes benign drift (kind case, interior
 * whitespace, HTTP-method case, trailing slash, path-param style `:id`↔`{id}`)
 * without collapsing distinct Entity/Enum names. Shared by the generator
 * (completeness gate) and the target reconciler.
 */
export function coverageKey(kind: string, identity: string): string {
  // The match key and the canonical identity fold the SAME benign drift, so they
  // can never disagree — both go through canonicalIdentity.
  return `${kind.trim().toLowerCase()}:${canonicalIdentity(kind, identity)}`;
}

export const ENUMERATE_SYSTEM_PROMPT = `You read the documentation for ONE AREA of a software system and LIST the contract TARGETS its docs specify — names only, never the contract bodies.

A target is one artifact the docs define. Output its kind + identity. The "kind" MUST be one of these EXACT values — never invent others. Pick the kind whose capability actually FITS; do NOT force everything into ValidationRule, and do NOT split a facet of a structured contract (see each kind's "belongs to" note) into its own target:

${KIND_CAPABILITIES}

Identity: an Operation is "<METHOD> <path>" (e.g. "POST /api/orders"); an Entity or Enum is its type name; a StateMachine is "<Entity>.<field>"; every other kind is a short slug.

Quick disambiguators: "only the owner / admins may call these" → AuthorizationRule; "field X is required when Y" → ValidationRule; "requires a bearer token" → AuthRequirement; "total = subtotal + tax − discount" → Formula.

Rules:
  - Be EXHAUSTIVE within the area: list EVERY distinct entity, endpoint, event, enum, and rule the docs actually specify. The downstream generator produces a contract for each item you list, and a completeness gate checks coverage against THIS list — a target you omit will never be generated.
  - Names only. Do NOT write fields, responses, or any contract body.
  - Read across ALL the provided docs (a thing is often specced incrementally across versions); list each target ONCE even if several docs mention it.
  - Ignore non-spec prose (employee lists, meeting notes, goals/overview narration).
  - Do not invent targets the docs don't specify.

Output ONLY a JSON object, no prose, no code fences:

{ "targets": [ { "kind": "Entity", "identity": "Order", "hint": "the order aggregate" },
               { "kind": "Operation", "identity": "POST /api/orders", "hint": "create order" } ] }`;

/**
 * Per-doc render cap, a last-resort guard only. Enumeration sees the WHOLE doc
 * because the orchestrator chunks big docs by heading and enumerates each chunk
 * (so this cap is set high for the enumerate views, which are already chunked).
 * Generate truncates over its budget, but a truncated tail simply yields targets
 * the completeness gate reports as GAPS — never a silent loss.
 */
const ENUMERATE_DOC_CHAR_CAP = 120_000;
const GENERATE_DOC_CHAR_CAP = 60_000;

/**
 * Split markdown into heading-delimited chunks, each ≤ `maxChars`. Sections are
 * kept whole and packed greedily; a single section larger than `maxChars` is
 * hard-split (rare). The transient slicer the plan calls for — used in-memory by
 * the enumerator on big docs, never persisted.
 */
export function chunkByHeading(content: string, maxChars: number): string[] {
  if (content.length <= maxChars) return [content];
  const sections: string[] = [];
  let buf: string[] = [];
  for (const line of content.split('\n')) {
    if (/^#{1,6}\s/.test(line) && buf.length > 0) {
      sections.push(buf.join('\n'));
      buf = [];
    }
    buf.push(line);
  }
  if (buf.length > 0) sections.push(buf.join('\n'));

  const chunks: string[] = [];
  let cur = '';
  const flush = (): void => {
    if (cur) chunks.push(cur);
    cur = '';
  };
  for (const sec of sections) {
    if (sec.length > maxChars) {
      flush();
      for (let i = 0; i < sec.length; i += maxChars) chunks.push(sec.slice(i, i + maxChars));
      continue;
    }
    if (cur.length + sec.length + 1 > maxChars) flush();
    cur = cur ? `${cur}\n${sec}` : sec;
  }
  flush();
  return chunks.length > 0 ? chunks : [content];
}

function renderAreaDocs(area: AreaGenInput, cap: number): string {
  const lines: string[] = [];
  area.docs.forEach((d, i) => {
    const body = d.content.length > cap ? d.content.slice(0, cap) + '\n…[truncated]…' : d.content;
    lines.push(`--- doc #${i + 1} (precedence ${i + 1} of ${area.docs.length}): ${d.ref}${d.status ? ` [status: ${d.status}]` : ''} ---`);
    lines.push(body);
    lines.push(`--- end ${d.ref} ---`, '');
  });
  return lines.join('\n');
}

export function buildEnumerateUserPrompt(area: AreaGenInput): string {
  return [
    `Area: ${area.areaId}  (product: ${area.product}, concern: ${area.concern})`,
    `Docs: ${area.docs.length} (listed in precedence order, highest authority first).`,
    '',
    renderAreaDocs(area, ENUMERATE_DOC_CHAR_CAP),
    'List the contract targets this area specifies. Return the JSON object as specified.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Generate (goal-directed) — uses prompt.ts SYSTEM_PROMPT for the catalog/grammar
// ---------------------------------------------------------------------------

export function buildCorpusGenerateUserPrompt(area: AreaGenInput, targets: TargetSpec[]): string {
  const targetList = targets
    .map((t) => `  - ${t.kind}: ${t.identity}${t.hint ? ` — ${t.hint}` : ''}`)
    .join('\n');
  return [
    `You are generating .tc contracts for ONE area of a software system.`,
    `Area: ${area.areaId}  (product: ${area.product}, concern: ${area.concern})`,
    '',
    `Produce a contract for EXACTLY these ${targets.length} target(s) — one fragment per target, using the kind/identity given:`,
    targetList,
    '',
    `Consolidate across the docs below (a target is often specced incrementally across versions — combine the pieces into one complete contract).`,
    `The docs are in PRECEDENCE ORDER, highest authority first: when two docs state different things about the SAME point, the earlier-listed doc wins; keep the unique content of each.`,
    `Shared artifacts (cross-cutting enums, the auth scheme, the error envelope) may be defined in OTHER areas — REFERENCE them by cross-ref, do NOT redefine them here.`,
    `Set each fragment's origin.source to the doc ref you drew it from. Ignore non-spec prose.`,
    `Do NOT emit contracts for anything outside the target list above.`,
    '',
    renderAreaDocs(area, GENERATE_DOC_CHAR_CAP),
    'Return the ExtractionResult JSON ({ "fragments": [ … ] }) as specified by the system prompt.',
  ].join('\n');
}
