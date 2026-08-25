/**
 * Area-tag vocabulary + deterministic status parsing — what remains of the
 * per-doc AREA tagger after the spec-scan sessions (plan 02 step 3) absorbed
 * its LLM call into the merged `spec-scan.curate-doc` session (in
 * `@truecourse/core`'s `services/spec-scan/`).
 *
 * What stays here, and why:
 * - {@link DocAreaTags} — the per-doc verdict shape the scan run's fold still
 *   produces and the deterministic grouper consumes;
 * - {@link parseDocStatus} / {@link classifyStatusValue} — the deterministic
 *   status backstop the fold applies to every session verdict (a session that
 *   omits or free-forms the status degrades to the header parse, never to a
 *   dropped doc);
 * - {@link AREA_TAGGER_SYSTEM_PROMPT} — the retired one-shot's prompt, kept
 *   exported because the merged session prompt derives its area rules from
 *   this text (provenance, not runtime).
 *
 * The old `consolidator/area-tags` cache is neither written nor read any more
 * (the estimate probes the session cache with the run's own key builders —
 * plan 02 step 7); its files remain on disk, inert.
 */

import { OUTPUT_ONLY_GUARDRAIL } from '@truecourse/shared/llm';
import type { AreaTag } from './corpus-types.js';
import { StatusSchema, type Status } from './types.js';

/** The tagger's per-doc verdict: the raw (un-normalized) area tags + status. */
export interface DocAreaTags {
  /** Raw `{product, concern}` tags as proposed by the classifier. */
  tags: AreaTag[];
  /** Lifecycle status of the doc, when stated in its header. */
  status?: Status;
}

// ---------------------------------------------------------------------------
// Header status parsing (deterministic backstop)
// ---------------------------------------------------------------------------

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
 *
 * Exported for the scan run's fold: the curate-doc session reports the status
 * as the free-form string the doc states, and the fold coerces it through the
 * SAME classifier the header parser uses — an unrecognized value degrades to
 * the header parse rather than discarding the verdict.
 */
export function classifyStatusValue(rawValue: string): Status | undefined {
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
// The retired one-shot's prompt — see the module note for why it stays.
// ---------------------------------------------------------------------------

export const AREA_TAGGER_SYSTEM_PROMPT = `You classify ONE documentation file by the AREAS of a software system it covers. You do NOT extract facts — you only tag the whole doc.

${OUTPUT_ONLY_GUARDRAIL}

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

MULTI-AREA: a doc often covers several areas (a broad README or PRD may cover orders + customers + auth + errors). List EVERY area it materially specifies — a broad doc MUST carry the concern of EVERY section that states real behavior: a substantive "## Pagination", "## Auth", "## Errors", or "## Idempotency" section means that concern (pagination, auth, errors, idempotency) belongs among the tags, even when the doc is otherwise wide. Ignore incidental one-line mentions. An umbrella label does NOT stand in for the section topics beneath it: a broad "conventions" / "standards" / "platform" concern (e.g. api-conventions, platform-standards) may coexist with the specific section concerns but must NEVER REPLACE them — tag both the umbrella and each concrete section topic. Cap at ~8 areas.

PROCESS BUCKET: sections that are pure overview / goals / non-goals / open-questions and spec no behavior map to product "process" with one of these concerns: overview, goals, non-goals, open-questions. A doc that is ONLY process gets only process areas; a substantive doc that merely has a Goals section does NOT need a process area.

STATUS: if the doc header states a lifecycle (Status: shipped / planned / deferred / deprecated / out-of-scope, or equivalents like "done"/"draft"), report it; otherwise null.

Output ONLY a JSON object, no prose, no code fences:

{ "areas": [ { "product": "core", "concern": "orders entity" }, { "product": "core", "concern": "auth" } ],
  "status": "shipped" }

Use "status": null when no lifecycle is stated. Never invent areas the doc does not cover, but never leave a real spec doc with zero areas.`;

