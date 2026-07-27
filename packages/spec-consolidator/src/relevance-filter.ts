/**
 * LLM-driven doc relevance filter.
 *
 * Real projects ship a lot of markdown that isn't spec material:
 * task lists, release-notes drafts, engineering research logs, AI
 * agent instructions, etc. Today every `.md` file is treated as a
 * claim source, so noise from those files competes with PRD claims
 * and produces avoidable conflicts.
 *
 * This module asks an LLM per discovered doc TWO questions, in order:
 * whose product does this describe (the SUBJECT, judged against the
 * repo's identity), and — only then — is it spec-source material?
 * Attribution comes first because a document about a different product
 * is irrelevant to this repo's corpus however good it is, and a
 * usefulness-first judgment never gets around to asking whose it is.
 * When the verdict is no, the doc is marked SKIPPED and excluded from
 * claim extraction. Skipped docs are still surfaced in the scan output
 * so the user can manually re-include them from the dashboard.
 *
 * Cached per-doc by (path, contentHash, promptFingerprint) — re-runs
 * with unchanged docs cost zero tokens. Failures degrade gracefully:
 * a doc that errors out during classification stays INCLUDED (better
 * to keep noise than silently drop a real spec doc).
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getCacheEntry, setCacheEntry } from '@truecourse/llm';
import { cliTransport, stripCodeFences, OUTPUT_ONLY_GUARDRAIL, type LlmTransport } from '@truecourse/shared/llm';
import { stripMarkdownExtension } from '@truecourse/shared';
import { docBody, isStructuralSpecDoc, type DocCandidate } from './discovery.js';
import {
  aliasMatcher,
  identityBlock,
  identityFingerprint,
  stripForNames,
  type RepoIdentity,
} from './repo-identity.js';
import { defaultConcurrency } from './runner.js';

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

export interface RelevanceRunnerInput {
  doc: DocCandidate;
  /**
   * Who this repository is, or null when nothing identified it. Required (not
   * optional) at every cache-key-adjacent signature: an optional parameter is
   * exactly how the estimator and the runtime end up keying differently, which
   * is the silent-re-spend class already documented in `spec-estimate.ts`.
   */
  identity: RepoIdentity | null;
}

export type RelevanceRunner = (input: RelevanceRunnerInput) => Promise<RelevanceVerdict>;

export interface RelevanceFilterOptions {
  /** Override the runner. Tests pass a stub. */
  runner?: RelevanceRunner;
  /** LLM transport for the auto-created runner (defaults to cli). */
  transport?: LlmTransport;
  /** When false, skip the LLM call entirely; every doc stays included. */
  enabled?: boolean;
  /**
   * Doc paths the user has manually marked as "always include" via the
   * dashboard. These bypass the filter unconditionally — useful when
   * the LLM is wrong about a doc the user knows is authoritative.
   */
  manualIncludes?: string[];
  /** Cap on concurrent LLM calls. Default 4. */
  concurrency?: number;
  /** Model forwarded to the default spawn runner. */
  model?: string;
  /** Fallback model forwarded to the default spawn runner. */
  fallbackModel?: string;
  /**
   * Fired once per doc as it's classified, plus an initial `(0, total)` so
   * the caller learns the total upfront. Classification is concurrent, so
   * `done` increments in completion order, not doc order.
   */
  onProgress?: (done: number, total: number) => void;
  /**
   * Who this repository is — stated to the classifier and used by the
   * third-party backstop. `null` means "nothing identified this repo"; EE
   * passes it explicitly and the public boundary honors it.
   */
  identity?: RepoIdentity | null;
}

export interface RelevanceFilterOutcome {
  /** Docs to feed downstream claim extraction. */
  included: DocCandidate[];
  /** Docs the filter dropped, with the structured SKIP category where known. */
  skipped: Array<{ doc: DocCandidate; reason: string; category?: SkipCategory }>;
  /**
   * Docs the model dropped as third-party that the deterministic backstop put
   * back because they name our own product. Reported so the fix is measurable:
   * if the identity block is working this should be ~0, and a nonzero value
   * means the prompt half is incomplete and the net is carrying it.
   */
  reinstated: Array<{ doc: DocCandidate; originalReason: string }>;
  /**
   * Docs whose classification CALL failed and were kept by the fail-open
   * default. Never silent: a broken transport once failed 100% of calls and
   * the corpus looked merely permissive — every consumer must surface this
   * count loudly (the CLI scan line prints it; a full-failure run is a
   * transport defect, not a corpus).
   */
  classifyFailed: number;
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

/**
 * The deterministic (no-LLM) pre-filter: which docs would be dropped before the
 * LLM classifier runs, and why. Shared by `filterByRelevance` (the real pass)
 * and the scan cost estimator, so both agree on exactly how many docs reach the
 * LLM. Manual includes bypass it unconditionally.
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
  // ever diverging on how many docs reach the LLM (SPEC_GUARD_PLAN item 11 class).
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
 * The deterministic pre-run PLAN of the relevance stage: exactly which docs
 * `filterByRelevance` would send to the LLM, reading the same prefilter + the
 * same content-keyed cache. Shared by the runtime (which then executes the
 * calls) and the pre-flight estimate (which counts them), so the two can never
 * disagree on the doc set — a doc kept, dropped, or manual-included here is
 * treated identically by both. `known` carries the verdicts resolvable without a
 * call (cached verdicts + synthetic manual-include verdicts).
 */
export interface RelevancePlan {
  /** Prefilter-kept docs — the classify universe (the "changed" denominator). */
  toClassify: DocCandidate[];
  /** Docs the deterministic prefilter dropped, with reasons. */
  prefilterSkipped: Array<{ path: string; reason: string }>;
  /** Docs that need an LLM relevance call (uncached, non-manual-include). */
  needsCall: DocCandidate[];
  /** Verdicts known without a call, keyed by doc path (cached ∪ manual-include). */
  known: Map<string, RelevanceVerdict>;
}

export interface PlanRelevanceOptions {
  manualIncludes?: string[];
  /** Required-and-nullable: it is part of the cache key, so it can never default. */
  identity: RepoIdentity | null;
}

export async function planRelevanceWork(
  repoRoot: string,
  docs: DocCandidate[],
  opts: PlanRelevanceOptions,
): Promise<RelevancePlan> {
  const manualIncludes = opts.manualIncludes ?? [];
  const manualSet = new Set(manualIncludes);
  const { toClassify, skipped } = prefilterDocs(docs, manualIncludes, opts.identity);
  const needsCall: DocCandidate[] = [];
  const known = new Map<string, RelevanceVerdict>();
  await Promise.all(
    toClassify.map(async (doc) => {
      if (manualSet.has(doc.path)) {
        known.set(doc.path, { path: doc.path, include: true, reason: 'manual include' });
        return;
      }
      const cached = await readCache(repoRoot, computeCacheKey(doc, opts.identity));
      if (cached) known.set(doc.path, cached);
      else needsCall.push(doc);
    }),
  );
  return { toClassify, prefilterSkipped: skipped, needsCall, known };
}

export async function filterByRelevance(
  repoRoot: string,
  docs: DocCandidate[],
  opts: RelevanceFilterOptions = {},
): Promise<RelevanceFilterOutcome> {
  if (opts.enabled === false || docs.length === 0) {
    return { included: docs, skipped: [], reinstated: [], classifyFailed: 0 };
  }
  const runner =
    opts.runner ??
    spawnRelevanceRunner({ transport: opts.transport, model: opts.model, fallbackModel: opts.fallbackModel });
  const concurrency = opts.concurrency ?? defaultConcurrency();
  const identity = opts.identity ?? null;

  // Single source of truth for the doc set: the same plan the estimate reads.
  // Prefilter-skipped + cached/manual docs resolve with no LLM call; only
  // `needsCall` reaches the runner.
  const plan = await planRelevanceWork(repoRoot, docs, {
    manualIncludes: opts.manualIncludes ?? [],
    identity,
  });
  const prefilterReason = new Map(plan.prefilterSkipped.map((s) => [s.path, s.reason]));

  const total = docs.length;
  let done = 0;
  const markDone = (): void => opts.onProgress?.(++done, total);
  opts.onProgress?.(0, total);
  // Everything already resolved (prefilter-skipped + cached + manual) needs no
  // LLM call — count it toward progress up front.
  const resolvedUpfront = prefilterReason.size + plan.known.size;
  for (let i = 0; i < resolvedUpfront; i++) markDone();

  const verdicts = new Map<string, RelevanceVerdict>(plan.known);
  const pending = plan.needsCall;
  let classifyFailed = 0;
  let cursor = 0;
  let active = 0;
  await new Promise<void>((resolve) => {
    if (pending.length === 0) return resolve();
    const launch = (): void => {
      while (active < concurrency && cursor < pending.length) {
        const doc = pending[cursor++];
        active++;
        classifyOne(repoRoot, doc, runner, identity)
          .then((verdict) => {
            verdicts.set(doc.path, verdict);
          })
          .catch(() => {
            // Failures default to include — better to keep noise than drop a
            // real spec doc — but NEVER silently: the outcome counts them and
            // the scan surfaces the count (a 100% failure rate is a transport
            // defect wearing a permissive corpus).
            classifyFailed++;
            verdicts.set(doc.path, {
              path: doc.path,
              include: true,
              reason: 'classification failed; defaulting to include',
            });
          })
          .finally(() => {
            markDone();
            active--;
            if (cursor >= pending.length && active === 0) resolve();
            else launch();
          });
      }
    };
    launch();
  });

  const included: DocCandidate[] = [];
  const skipped: Array<{ doc: DocCandidate; reason: string; category?: SkipCategory }> = [];
  const reinstated: Array<{ doc: DocCandidate; originalReason: string }> = [];
  // The deterministic net, built once. It runs HERE — in the final assembly loop,
  // post-cache — deliberately: inside `classifyOne` it would fire only on fresh
  // classifications, and a doc it rescued would vanish again on the next run when
  // the (unchanged, still-wrong) verdict came back from cache.
  const ours = aliasMatcher(identity?.aliases ?? []);
  for (const doc of docs) {
    const pf = prefilterReason.get(doc.path);
    if (pf) {
      skipped.push({ doc, reason: pf, category: prefilterCategory(doc, identity) });
      continue;
    }
    const verdict = verdicts.get(doc.path);
    if (!verdict || verdict.include) {
      included.push(doc);
      continue;
    }
    if (verdict.category === 'third-party' && namesOurProduct(doc, ours)) {
      included.push(doc);
      reinstated.push({ doc, originalReason: verdict.reason });
      continue;
    }
    skipped.push({ doc, reason: verdict.reason, category: verdict.category });
  }
  return { included, skipped, reinstated, classifyFailed };
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
 */
function namesOurProduct(doc: DocCandidate, ours: RegExp): boolean {
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
// (real, testable) references survive (SPEC_GUARD_PLAN item 46).

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
 */
function prefilterCategory(doc: DocCandidate, identity: RepoIdentity | null): SkipCategory | undefined {
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

async function classifyOne(
  repoRoot: string,
  doc: DocCandidate,
  runner: RelevanceRunner,
  identity: RepoIdentity | null,
): Promise<RelevanceVerdict> {
  const cacheKey = computeCacheKey(doc, identity);
  const cached = await readCache(repoRoot, cacheKey);
  if (cached) return cached;
  const verdict = applySubjectAttribution(await runner({ doc, identity }));
  await writeCache(repoRoot, cacheKey, verdict);
  return verdict;
}

// ---------------------------------------------------------------------------
// Subprocess runner
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

/**
 * `.catch(undefined)` is load-bearing, not defensive clutter. Without it a model
 * emitting `"category":"vendor"` THROWS in the runner, so the doc falls into the
 * fail-open catch in `filterByRelevance` — and worse, a bad cached category
 * fails `safeParse` in `readCache`, is treated as a miss, gets rewritten, and
 * re-spends forever. The field is advisory; `include` is the decision.
 *
 * `subject` carries the same tolerance for the same reason: an off-enum
 * attribution ("ours", "external") must degrade to "unknown" — i.e. the content
 * judgment stands alone — never poison the cache into a permanent re-spend.
 */
const RelevanceVerdictSchema = z.object({
  subject: DocSubjectSchema.optional().catch(undefined),
  include: z.boolean(),
  reason: z.string().default(''),
  category: SkipCategorySchema.optional().catch(undefined),
});

function spawnRelevanceRunner(
  opts: {
    /** LLM transport. Defaults to `cliTransport()` (spawns `claude -p`). */
    transport?: LlmTransport;
    bin?: string;
    timeoutMs?: number;
    model?: string;
    fallbackModel?: string;
  } = {},
): RelevanceRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return async (input: RelevanceRunnerInput): Promise<RelevanceVerdict> => {
    const raw = await transport({
      id: `spec.relevance:${input.doc.path}`,
      stage: 'spec.relevance',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: RELEVANCE_SYSTEM_PROMPT,
      user: buildRelevanceUserPrompt(input.doc, input.identity),
      responseFormat: 'json',
      timeoutMs,
    });
    const inner = JSON.parse(stripCodeFences(raw));
    const parsed = RelevanceVerdictSchema.parse(inner);
    return {
      path: input.doc.path,
      subject: parsed.subject,
      include: parsed.include,
      reason: parsed.reason,
      category: parsed.category,
    };
  };
}

// ---------------------------------------------------------------------------
// Cache — content-addressed, via the pluggable KV seam (`@truecourse/llm`
// get/setCacheEntry): Postgres in EE, file in OSS. The cache KEY already folds
// in the prompt fingerprint + the doc's contentHash, so an unchanged doc is a
// hit and a prompt change invalidates. No direct fs — so an EE workspace scan
// (ephemeral scratch scope) still gets hits across syncs.
// ---------------------------------------------------------------------------

const CACHE_NAME = 'consolidator/relevance';

const PROMPT_FINGERPRINT = createHash('sha256')
  .update(RELEVANCE_SYSTEM_PROMPT)
  .digest('hex')
  .slice(0, 16);

/**
 * Two ORTHOGONAL fingerprints rather than one hash of the effective prompt:
 * `PROMPT_FINGERPRINT` says the instructions changed, `identityFingerprint` says
 * the subject did. A miss then tells you which.
 */
function computeCacheKey(doc: DocCandidate, identity: RepoIdentity | null): string {
  return createHash('sha256')
    .update(`${PROMPT_FINGERPRINT}::${identityFingerprint(identity)}::${doc.path}::${doc.contentHash}`)
    .digest('hex');
}

const CachedVerdictSchema = z.object({
  path: z.string(),
  subject: DocSubjectSchema.optional().catch(undefined),
  include: z.boolean(),
  reason: z.string(),
  category: SkipCategorySchema.optional().catch(undefined),
});

async function readCache(scope: string, cacheKey: string): Promise<RelevanceVerdict | null> {
  const raw = await getCacheEntry(scope, CACHE_NAME, cacheKey);
  if (raw === null) return null;
  const parsed = CachedVerdictSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function writeCache(scope: string, cacheKey: string, verdict: RelevanceVerdict): Promise<void> {
  await setCacheEntry(scope, CACHE_NAME, cacheKey, verdict);
}

/**
 * The cached relevance verdict for a doc, or null on a cache miss (the doc will
 * need an LLM classify on the next run). Reuses the runtime cache key, so the
 * pre-flight estimate sees exactly what the next scan will hit.
 */
export async function readRelevanceCache(
  repoRoot: string,
  doc: DocCandidate,
  identity: RepoIdentity | null,
): Promise<RelevanceVerdict | null> {
  return readCache(repoRoot, computeCacheKey(doc, identity));
}

/**
 * Characters a relevance USER prompt costs for this identity — the identity
 * block plus the capped preview plus the fixed field labels. Exported so the
 * pre-flight estimate reads it from the module that BUILDS the prompt instead of
 * maintaining its own copy of the preview arithmetic.
 */
export function relevanceUserPromptChars(identity: RepoIdentity | null): number {
  const PREVIEW_CHARS_PER_LINE = 50; // a discovery preview line, roughly
  const FIELD_LABEL_CHARS = 200; // PATH/kind/size labels + the preview fences
  return identityBlock(identity).length + PREVIEW_LINES * PREVIEW_CHARS_PER_LINE + FIELD_LABEL_CHARS;
}
