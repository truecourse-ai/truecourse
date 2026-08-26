/**
 * Doc relevance — the DETERMINISTIC spine of the old LLM relevance filter, plus
 * the vocabulary the curate-doc SESSION now judges with.
 *
 * The per-doc LLM classify itself retired with the spec-scan sessions: one
 * `spec-scan.curate-doc` session per doc (in `@truecourse/core`'s
 * `services/spec-scan/`) replaces the relevance + area-tag one-shots. What
 * stays here is everything that was never an LLM call:
 *
 * - the deterministic prefilter ({@link prefilterDocs}) — archive/agent-meta/
 *   changelog/near-dup drops that run BEFORE any session is spent;
 * - the subject-attribution backstop ({@link applySubjectAttribution}) and the
 *   alias-matcher third-party reinstatement ({@link namesOurProduct}) — the
 *   scan run's fold applies both to every session verdict, cached or fresh;
 * - the closed skip-category / subject vocab the session outcome reuses.
 *
 * The old `consolidator/relevance` cache is neither written NOR read any more:
 * the pre-flight estimate probes the session cache (`consolidator/curate-doc`)
 * with the run's own key builders. The old entries' files
 * remain on disk, inert.
 */

import { z } from 'zod';
import { OUTPUT_ONLY_GUARDRAIL } from '@truecourse/shared/llm';
import { stripMarkdownExtension } from '@truecourse/shared';
import { docBody, isStructuralSpecDoc, type DocCandidate } from './discovery.js';
import { aliasMatcher, identityBlock, stripForNames, type RepoIdentity } from './repo-identity.js';

/**
 * The closed set of reasons a doc is not spec-source material — one per SKIP
 * bullet in the system prompt.
 *
 * Structured rather than parsed back out of `reason`: the prompt explicitly
 * asks the model to VARY the reason wording (it is a display string shown in
 * the dashboard), so branching on its prose would be a workaround, not a fix.
 */
export const SkipCategorySchema = z.enum([
  'third-party',
  'status-tracking',
  'superseded',
  'process',
  'scratch',
  'agent-meta',
]);
export type SkipCategory = z.infer<typeof SkipCategorySchema>;

/**
 * WHOSE product a document describes — the classifier's FIRST judgment, made
 * before it looks at whether the content is good spec material.
 *
 * Attribution has to come first because usefulness-first framing loses: asked
 * "is this good spec content?", a model says yes to any well-written product
 * document and never gets around to asking whose product it is. Splitting the
 * judgment makes ownership a separate, prior answer that quality cannot override.
 */
export const DocSubjectSchema = z.enum(['this-product', 'different-product', 'unknown']);
export type DocSubject = z.infer<typeof DocSubjectSchema>;

export interface RelevanceVerdict {
  /** Doc's repo-relative path. */
  path: string;
  /**
   * Whose product the doc describes, judged against the IDENTITY block. Absent
   * when the model omitted it or emitted an off-enum value — treated as
   * `unknown`, i.e. the content judgment decides on its own.
   */
  subject?: DocSubject;
  /** True when the doc should feed claim extraction. */
  include: boolean;
  /** Short human-readable rationale, shown in the dashboard. */
  reason: string;
  /**
   * Which SKIP bullet applied, when `include` is false. Advisory — it feeds the
   * scan counters and the third-party backstop; `include` remains the decision.
   */
  category?: SkipCategory;
}

/**
 * Attribution beats content: a doc about a DIFFERENT product is irrelevant to
 * this repo's spec corpus however good it is, so the subject — not the model's
 * own include/category — settles those. Normalizing the category to
 * `third-party` here is what keeps the deterministic alias backstop reachable
 * (it only rescues `third-party` drops) whatever category the model paired with
 * the attribution.
 *
 * Applied in `classifyOne`, so it covers every runner (the spawn runner and the
 * stubs) and the DERIVED verdict is what gets cached — a cached verdict never
 * needs re-deriving.
 */
export function applySubjectAttribution(verdict: RelevanceVerdict): RelevanceVerdict {
  if (verdict.subject !== 'different-product') return verdict;
  return { ...verdict, include: false, category: 'third-party' };
}

// ---------------------------------------------------------------------------
// Deterministic prefilter
// ---------------------------------------------------------------------------

/**
 * The deterministic (no-LLM) pre-filter: which docs would be dropped before the
 * classifier runs, and why. Shared by the session scan run (core's
 * `services/spec-scan/run.ts`) and the scan cost estimator, so both agree on
 * exactly how many docs reach a session. Manual includes bypass it
 * unconditionally.
 */
export function prefilterDocs(
  docs: DocCandidate[],
  manualIncludes: string[] = [],
  identity: RepoIdentity | null = null,
): { toClassify: DocCandidate[]; skipped: Array<{ path: string; reason: string }> } {
  const manualSet = new Set(manualIncludes);
  // Structural specs (OpenAPI) are never the relevance filter's concern — they
  // are admitted deterministically upstream (they are neither classified nor
  // near-dup-deduped nor listed as skipped). Excluding them HERE — the single
  // prefilter shared by the runtime and the estimate — is what keeps the two from
  // ever diverging on how many docs reach the LLM — an estimate that undercounts
  // the runtime is a silent overspend.
  const prose = docs.filter((d) => !isStructuralSpecDoc(d));
  const reasons = new Map<string, string>();
  for (const doc of prose) {
    if (manualSet.has(doc.path)) continue;
    const reason = deterministicSkip(doc, identity);
    if (reason) reasons.set(doc.path, reason);
  }
  for (const { path, reason } of dedupeNearDuplicates(
    prose.filter((d) => !manualSet.has(d.path) && !reasons.has(d.path)),
  )) {
    reasons.set(path, reason);
  }
  return {
    toClassify: prose.filter((d) => !reasons.has(d.path)),
    skipped: [...reasons].map(([path, reason]) => ({ path, reason })),
  };
}

/**
 * Does this doc's PROSE name our own product? Read from the stripped body, never
 * the raw one — an `import { x } from '@calcom/lib'` inside a fenced block, or
 * an MDX `<CalcomProvider>` wrapper, appears in plenty of genuine vendor docs
 * and would turn the backstop into a re-include-everything switch.
 *
 * One mention is enough, on purpose. The error is asymmetric in the direction
 * the system prompt already declares ("dropping a real spec doc costs more than
 * keeping noise"), so an "unlike Wekan, Trello does X" false re-inclusion is the
 * cheap side of the trade. Do NOT "fix" this into a 2-mention rule — that loses
 * exactly the docs this exists to save.
 *
 * Exported for the scan run's fold: the third-party reinstatement runs there,
 * POST-cache, so a doc a stale cached verdict wrongly dropped is rescued on
 * every run. `ours` is `aliasMatcher(identity.aliases)`.
 */
export function namesOurProduct(doc: DocCandidate, ours: RegExp): boolean {
  return ours.test(stripForNames(docBody(doc)));
}
// ---------------------------------------------------------------------------
// Deterministic pre-filter (no LLM) — high-precision structural signals only
// ---------------------------------------------------------------------------

/** Directory names that mark archived/superseded content. */
const ARCHIVE_SEGMENTS = new Set(['archive', 'archived', 'deprecated', 'old', 'legacy']);
/**
 * Filenames that are agent-instruction / prompt meta, never product spec.
 * Matched by stem so the markdown flavour doesn't matter (`CLAUDE.mdx` is as
 * much agent meta as `CLAUDE.md`). `.cursorrules` is a dotfile with no
 * extension and is matched whole.
 */
const SKIP_BASENAMES = new Set([
  'claude',
  'agents',
  '.cursorrules',
  'copilot-instructions',
  'prompt',
]);

// --- B8: doc-class drops -----------------------------------------------------
// Whole directory TREES the LLM cannot separate from spec material by content
// alone. It correctly keeps anything naming the product (post-F12), so an
// agent-config tree full of "cal.com does X" docs sails through the classifier
// as spec and orphans scenarios at generate. A deterministic class drop is the
// only fix — paired with a carve-out for the repo's OWN api-skill docs so those
// (real, testable) references survive.

/** A dir segment that roots an agent-config tree. */
const AGENT_DIR_SEGMENTS = new Set(['agents', '.claude', '.agent', '.agents']);
/** The child of an agent dir that marks it as config, not product spec. */
const AGENT_CHILD_SEGMENTS = new Set(['rules', 'skills', 'commands', 'prompts']);
/** A skill-leaf that looks like an API surface: `calcom-api`, `public-api`, `v2-api`, `apis`. */
const API_LEAF = /(^|[-_])apis?([-_]|$)/i;

/**
 * Basename stems that mark a pure changelog UNAMBIGUOUSLY — dropped by path
 * alone, no content check needed.
 */
const CHANGELOG_STEMS_STRICT = new Set(['changelog', 'release-notes', 'releases']);
/**
 * Basename stems that OFTEN name a changelog but also name legitimate prose
 * (`history.md` as an architecture history, `changes.md` as a migration guide,
 * `news.md` as an announcements page). These drop only when the content
 * version-bump majority ALSO confirms — never by stem alone.
 */
const CHANGELOG_STEMS_AMBIGUOUS = new Set(['news', 'history', 'changes']);
/** Dir segments that mark a changelog/release-notes tree. */
const CHANGELOG_DIRS = new Set(['changelog', 'changelogs', 'release-notes']);
/** Share of non-blank body lines that must be version-bump entries to drop by content. */
const CHANGELOG_CONTENT_MAJORITY = 0.6;

/** Dir segments that mark a template/boilerplate tree. */
const TEMPLATE_DIRS = new Set(['template', 'templates', '_templates', '.template', 'boilerplate', 'scaffold']);

/**
 * The agent-config tree a path sits in, or null. `child` is the config subtree
 * (`rules`/`skills`/…); `leaf` is the segment right below a `skills` child (the
 * skill's own dir, or the basename when a skill file sits directly under it),
 * which the F12 carve-out inspects.
 */
function agentTreeMatch(segs: string[]): { child: string; leaf: string } | null {
  const dirs = segs.slice(0, -1);
  const base = segs[segs.length - 1];
  for (let i = 0; i < dirs.length - 1; i++) {
    if (AGENT_DIR_SEGMENTS.has(dirs[i]) && AGENT_CHILD_SEGMENTS.has(dirs[i + 1])) {
      return { child: dirs[i + 1], leaf: dirs[i + 2] ?? base };
    }
  }
  return null;
}

/**
 * F12 carve-out: keep an `agents/skills/<leaf>/**` doc when the leaf names an
 * API surface or the repo's own product. The LLM cannot make this separation
 * (it keeps anything naming the product), and a prefilter drop never reaches the
 * `namesOurProduct` backstop — so the exemption MUST live here. Exported so the
 * predicate is unit-testable in isolation.
 */
export function isCarvedOutAgentSkill(leaf: string, identity: RepoIdentity | null): boolean {
  // A single-FILE skill leaf carries a markdown extension (`foo-api.md`); strip
  // it so the api/alias match sees the bare name, exactly like a directory leaf.
  const core = stripMarkdownExtension(leaf);
  if (API_LEAF.test(core)) return true;
  return aliasMatcher(identity?.aliases ?? []).test(core);
}

/**
 * Does this path sit under an `agents/skills/<leaf>/**` tree the F12 carve-out
 * keeps? A carved-out skill short-circuits ALL class rules, not just the agent
 * rule — otherwise `agents/skills/calcom-api/news.md` would clear the agent rule
 * and then be dropped by the changelog stem, and a `templates/` subdir under a
 * kept skill would be dropped by the template rule.
 */
function isCarvedOutSkillPath(segs: string[], identity: RepoIdentity | null): boolean {
  const agent = agentTreeMatch(segs);
  return !!agent && agent.child === 'skills' && isCarvedOutAgentSkill(agent.leaf, identity);
}

/** Is a single body line a version-bump entry (leading semver or date token)? */
function isVersionBumpLine(line: string): boolean {
  const l = line.trim().replace(/^#{1,6}\s*/, '').replace(/^[-*]\s*/, '');
  return /^\[?v?\d+\.\d+\.\d+/.test(l) || /^\[?\d{4}-\d{2}-\d{2}\b/.test(l);
}

/**
 * A doc whose body is overwhelmingly version-bump lines is a changelog by
 * CONTENT, whatever its name. Floored at MIN_DEDUP_LINES so a design doc with a
 * lone `## 1.2.0` heading never trips the rule.
 */
function looksLikeChangelogContent(doc: DocCandidate): boolean {
  const lines = docBody(doc)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < MIN_DEDUP_LINES) return false;
  const bumps = lines.filter(isVersionBumpLine).length;
  return bumps / lines.length >= CHANGELOG_CONTENT_MAJORITY;
}

/**
 * The SKIP category behind a deterministic prefilter drop. Kept in step with
 * {@link deterministicSkip} — the two run the same rules in the same order, one
 * returning a category and the other a reason string. `undefined` for
 * near-duplicate drops — "superseded" would over-claim, since a near-dup is a
 * redundant copy, not an older version.
 *
 * Exported for the scan run's fold, which stamps the category on each
 * prefilter-skipped doc exactly as the old assembly loop did.
 */
export function prefilterCategory(doc: DocCandidate, identity: RepoIdentity | null): SkipCategory | undefined {
  const segs = doc.path.toLowerCase().split('/');
  const base = segs[segs.length - 1];
  if (SKIP_BASENAMES.has(stripMarkdownExtension(base))) return 'agent-meta';
  const dirs = segs.slice(0, -1);
  if (dirs.some((d) => ARCHIVE_SEGMENTS.has(d))) return 'superseded';
  // A carved-out skill short-circuits every class rule below.
  if (isCarvedOutSkillPath(segs, identity)) return undefined;
  if (agentTreeMatch(segs)) return 'agent-meta';
  if (isChangelogByPath(base, dirs) || looksLikeChangelogContent(doc)) return 'status-tracking';
  if (dirs.some((d) => TEMPLATE_DIRS.has(d))) return 'process';
  return undefined;
}

/** Strict-path / dir changelog signal (unconditional — no content check). */
function isChangelogByPath(base: string, dirs: string[]): boolean {
  return CHANGELOG_STEMS_STRICT.has(stripMarkdownExtension(base)) || dirs.some((d) => CHANGELOG_DIRS.has(d));
}

/**
 * A changelog reason from CONTENT, or null. Any doc whose body is overwhelmingly
 * version-bump lines qualifies; an AMBIGUOUS stem (`history`/`news`/`changes`)
 * gets a stem-specific reason, but still only when the content confirms — an
 * architecture `history.md` (prose, no version log) survives.
 */
function changelogContentReason(base: string, doc: DocCandidate): string | null {
  if (!looksLikeChangelogContent(doc)) return null;
  return CHANGELOG_STEMS_AMBIGUOUS.has(stripMarkdownExtension(base))
    ? `version log ${base} (confirmed by content)`
    : `changelog by content (mostly version-bump entries)`;
}

/** Path/name/content-based skip reason, or null to defer the call to the LLM. */
function deterministicSkip(doc: DocCandidate, identity: RepoIdentity | null): string | null {
  const segs = doc.path.toLowerCase().split('/');
  const base = segs[segs.length - 1];
  const dirs = segs.slice(0, -1);
  // Only DIRECTORY segments trigger the archive rule — a file literally named
  // "old-pricing.md" is fine; "archive/foo.md" is not.
  for (const seg of dirs) {
    if (ARCHIVE_SEGMENTS.has(seg)) return `archived/superseded location (under ${seg}/)`;
  }
  if (SKIP_BASENAMES.has(stripMarkdownExtension(base))) {
    return `agent-instruction/meta file (${base})`;
  }
  // A carved-out `agents/skills/<api|product>/**` doc is KEPT and short-circuits
  // every class rule below — otherwise a kept skill's `news.md` or `templates/`
  // subdir would be re-dropped by the changelog/template rules.
  if (isCarvedOutSkillPath(segs, identity)) return null;
  // (a) Agent-config tree.
  const agent = agentTreeMatch(segs);
  if (agent) return `agent-config tree (${agent.child}/)`;
  // (b) Pure changelog — strict by path, ambiguous stems only when content confirms.
  if (isChangelogByPath(base, dirs)) return `changelog / release-notes (${base})`;
  const changelogReason = changelogContentReason(base, doc);
  if (changelogReason) return changelogReason;
  // (c) Template / boilerplate dir.
  const templateDir = dirs.find((d) => TEMPLATE_DIRS.has(d));
  if (templateDir) return `template / boilerplate (under ${templateDir}/)`;
  return null;
}

/** Content lines normalized for similarity (drop blanks + pure-markup lines). */
function normalizedLines(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim().toLowerCase();
    if (l.length === 0) continue;
    if (/^[#>*\-=|`_~ ]+$/.test(l)) continue; // markdown rules / bullet-only lines
    out.add(l);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const NEAR_DUP_THRESHOLD = 0.85;
/** Below this many distinct content lines a doc is too thin to judge as a dup. */
const MIN_DEDUP_LINES = 8;

/**
 * Drop near-duplicate docs (e.g. a "condensed" copy of a fuller doc). For each
 * pair with normalized-line Jaccard >= threshold, keep the longer and drop the
 * shorter. O(n^2) — fine for the hundreds of docs a repo has. Docs with too few
 * content lines are never deduped (thin/stub content can collide spuriously).
 */
function dedupeNearDuplicates(docs: DocCandidate[]): Array<{ path: string; reason: string }> {
  const sigs = docs.map((d) => {
    const body = docBody(d);
    return { doc: d, lines: normalizedLines(body), len: body.length };
  });
  const droppedSet = new Set<string>();
  const dropped: Array<{ path: string; reason: string }> = [];
  for (let i = 0; i < sigs.length; i++) {
    if (droppedSet.has(sigs[i].doc.path)) continue;
    if (sigs[i].lines.size < MIN_DEDUP_LINES) continue;
    for (let j = i + 1; j < sigs.length; j++) {
      if (droppedSet.has(sigs[j].doc.path)) continue;
      if (sigs[j].lines.size < MIN_DEDUP_LINES) continue;
      if (jaccard(sigs[i].lines, sigs[j].lines) < NEAR_DUP_THRESHOLD) continue;
      const [keep, drop] = sigs[i].len >= sigs[j].len ? [sigs[i], sigs[j]] : [sigs[j], sigs[i]];
      droppedSet.add(drop.doc.path);
      dropped.push({
        path: drop.doc.path,
        reason: `near-duplicate of ${keep.doc.path} (kept the fuller copy)`,
      });
      if (drop.doc.path === sigs[i].doc.path) break; // i itself dropped → next i
    }
  }
  return dropped;
}

// ---------------------------------------------------------------------------
// The retired one-shot's system prompt — kept EXPORTED because the pre-flight
// estimate still sizes with it (until step 7's session rework) and because the
// curate-doc session's merged prompt in core states it derives its two-step
// subject-then-content order from this text.
// ---------------------------------------------------------------------------

export const RELEVANCE_SYSTEM_PROMPT = `You are a documentation relevance classifier. You judge ONE document for ONE repository's spec corpus, in TWO STEPS, IN THIS ORDER. Never merge them, and never start at step 2.

${OUTPUT_ONLY_GUARDRAIL}

STEP 1 — SUBJECT: whose product does this document describe?

The user message opens with an IDENTITY block naming this repository's product, the other names it goes by, and what it is. Attribute the document against that block:

  this-product      — it describes the product in the IDENTITY block: its API, UI, data, events, behavior, architecture, or the decisions behind them. A doc about our own product stays this-product however much it reads like public vendor documentation — our own reference names our own product, and that is not evidence it belongs to someone else.
  different-product — it describes some OTHER product, service or system: a vendor's or competitor's API, an upstream dependency, or any invented, illustrative or unrelated product that this repository merely happens to store a document about. Its behavior is not this repository's to implement and cannot be verified against this code.
  unknown           — it names no product, or describes generic behavior, process or notes that could belong to anyone.

A different-product document is IRRELEVANT — whatever that product is, wherever the document is stored, and however well written, detailed or specification-like it is. Quality is not evidence of ownership: a polished requirements document about someone else's product is still someone else's. Decide the subject BEFORE you look at how good the content is, and do not revise it because the content impressed you.

Weigh, in this order: (1) which product the prose names and treats as its subject; (2) whether the entities, endpoints, screens, commands and rules it describes are plausibly parts of the product in the IDENTITY block, given what that block says the product IS; (3) the PATH given below — evidence, never a verdict: a location can suggest whose material a document is, but the content decides.

When the identity is genuinely unclear, answer unknown. Do not guess this-product to be safe.

STEP 2 — CONTENT (run this only when the subject is this-product or unknown; a different-product doc is already decided). Does the doc state durable, intended behavior or decisions about THE SYSTEM IN THIS REPOSITORY (its endpoints, data, auth, events, invariants, business rules, architecture)?

INCLUDE (spec-source material):
  - PRDs, ADRs, RFCs, design proposals, spec / API docs, module-level design docs, pipeline/workflow guides
  - Any doc that states our system's contracts, behavior, or decisions — in ANY folder, including tasks/ or backlog/
  - A PRD or decision record IS spec even under a tasks/ folder (a completed one describes implemented behavior; a draft one describes planned behavior)
  - A README only if it describes what the system does / how it behaves

SKIP (not spec-source material):
  - Pure status / TODO checklists, kanban boards, release notes / changelog drafts
  - SUPERSEDED docs — an older version of a newer doc covering the same subject
  - Process / meta docs not about product behavior: contribution / onboarding guides, code-style guides, deployment runbooks (keep a deployment doc ONLY if it states our runtime contracts)
  - Exploratory scratch with no committed decisions (brain dumps, open-questions-only notes)
  - AI-agent instructions / prompt templates; personal engineering journals

Distinguish "states a decision about our system" (INCLUDE) from "tracks status / is superseded / is process" (SKIP). Those SKIP categories are explicit — they are not "doubt." WHEN GENUINELY AMBIGUOUS ABOUT THE CONTENT: include (dropping a real spec doc costs more than keeping noise). That tie-break belongs to step 2 only — it never overturns a different-product attribution.

Output ONLY a JSON object, "subject" first:

  { "subject": "this-product"|"different-product"|"unknown", "include": true|false, "category": "<one of the categories below>", "reason": "short explanation" }

"subject" is ALWAYS required. When it is "different-product", "include" MUST be false and "category" MUST be "third-party".
"category" is REQUIRED when include is false and OMITTED when include is true. Choose exactly one from this closed list:

  third-party      — describes a DIFFERENT product than the one in the IDENTITY block
  status-tracking  — status / TODO checklist, kanban board, release notes
  superseded       — an older version of a newer doc on the same subject
  process          — contribution / onboarding / style guide, deployment runbook
  scratch          — exploratory notes with no committed decisions
  agent-meta       — AI-agent instructions, prompt templates, engineering journals

The reason is shown to the user in the dashboard — be specific ("describes a different product (ServiceTitan)", "superseded by capacity-ml-plan-v3", "deployment runbook, no product contracts") so they can verify the call.`;

const PREVIEW_LINES = 60;

export function buildRelevanceUserPrompt(doc: DocCandidate, identity: RepoIdentity | null): string {
  // Cap the preview hard — classification doesn't need the full doc.
  const preview = doc.preview.split('\n').slice(0, PREVIEW_LINES).join('\n');
  return [
    // Per-run DATA, so it rides the USER prompt: the system prompt stays the rule
    // set (a `const`, one fingerprint change ever) and the guardrail table over
    // the four prompt consts needs no contortion.
    identityBlock(identity),
    `PATH (repo-relative): ${doc.path}`,
    `Detected kind: ${doc.kind}`,
    `Size: ${doc.size} bytes`,
    '',
    '--- preview (first 60 lines) ---',
    preview,
    '--- end preview ---',
    '',
    'Attribute the subject first, then judge the content. Return the JSON object as specified.',
  ].join('\n');
}

