/**
 * THE SCAN ORCHESTRATOR SESSION — `spec-scan.orchestrate`, at most one per scan
 * (plan 02 step 6). It settles the SCAN SCOPE before any per-doc session
 * spends: which subtrees of the doc universe (directory prefixes of repo docs,
 * registered llms.txt sources) are spec-source territory, and which standing
 * `instructions` bind every downstream scan session.
 *
 * SCOPE-ONLY, deliberately (a recorded deviation from the plan prose, noted in
 * section 06): the orchestrator does NOT `dispatchChild` the curation/settle/
 * overlap pools. `dispatchChild` runs children serially, and the scan's pools
 * are network-bound — they need the session pool's concurrency, throttle
 * governor and transient re-queue. So the run (`run.ts`) chains the pools
 * itself; this session only produces the scope + instructions they run under.
 *
 * THE DETERMINISTIC PRE-PASS spends zero sessions on the common case: the
 * universe tree (dirs with doc counts, sources with page counts) is diffed
 * against the covered `scopeVerdicts` already in decisions.json — when every
 * doc and source is covered, the verdicts are applied and the scan proceeds
 * with no orchestrator session at all. Growth (a new subtree, a new source)
 * re-opens exactly the uncovered part.
 *
 * FOLD RULES (run.ts calls {@link mergeScopeOutcome}): session verdicts land
 * as `resolvedBy: 'auto'` rows stamped with the fold's clock; a user row for
 * the same path is NEVER overwritten (an auto row is — the session may revise
 * its own prior calls). Instructions are append-merged. Verdict application
 * ({@link applyScopeVerdicts}) excludes subtrees BEFORE the discovery-cost
 * stages — identity resolution, the prefilter, and every curation session.
 *
 * NO CACHE for this kind: the covered-universe pre-pass IS its cheap path, and
 * caching a scope decision would hide universe growth behind a stale key.
 */

import { z } from 'zod'
import { defineSessionTool, type SessionBudget, type SessionDef, type SessionTool } from '@truecourse/agent-loop'
import {
  SOURCES_REF_PREFIX,
  docBody,
  headingOutline,
  type DecisionsFile,
  type DocCandidate,
  type ScopeVerdict,
  type SpecSource,
} from '@truecourse/spec-consolidator'
import { docTitle, type ScanDocUniverse } from './tools.js'

export const SPEC_SCAN_ORCHESTRATE_SESSION_KIND = 'spec-scan.orchestrate'

/** The work item, as the session index and the transcript record it. */
export const ORCHESTRATE_WORK_ITEM = 'scan-scope'

/**
 * The three numbers (§3.3). Twenty turns covers a tour of a large universe's
 * outlines with room to sample; one resume grant because a monorepo's doc
 * sprawl legitimately needs the second pass. Interactive, so a question the
 * user never answers still ends within budget (the loop never blocks).
 */
export const ORCHESTRATE_BUDGET: SessionBudget = {
  turns: 20,
  maxResumes: 1,
  tokenCeiling: 150_000,
}

/**
 * The session outcome. `decidedAt`/`resolvedBy` are deliberately NOT here —
 * the fold stamps them (same discipline as interface authoring's `origin`):
 * a session cannot claim a clock or an authority.
 */
export const ScanScopeOutcomeSchema = z
  .object({
    /** One verdict per subtree: a dir prefix, a root doc, `.`, or a source id. */
    scopeVerdicts: z.array(
      z
        .object({
          path: z.string().min(1),
          verdict: z.enum(['keep', 'exclude']),
          reason: z.string(),
        })
        .strict(),
    ),
    /** Standing instructions for every scan session. Empty = none to add. */
    instructions: z.array(z.string()),
    /** Verbatim observations worth human eyes (reported, never acted on). */
    findings: z.array(z.string()).optional(),
  })
  .strict()
export type ScanScopeOutcome = z.infer<typeof ScanScopeOutcomeSchema>

// ---------------------------------------------------------------------------
// The universe view — what the pre-pass diffs and the briefing/tools render.
// ---------------------------------------------------------------------------

/** One registered llms.txt source, as the scope surface sees it. */
export interface ScopeSourceView {
  id: string
  title: string
  pages: number
}

export interface ScanScopeUniverse {
  /** Repo docs (source snapshots excluded — those are attributed to their source). */
  repoDocs: DocCandidate[]
  /** Registered llms.txt sources, with page counts. */
  sources: ScopeSourceView[]
  /** The whole doc universe (repo + source docs), for `doc_outline`. */
  universe: ScanDocUniverse
}

/** Is this ref a registered-source snapshot (lives under `.truecourse/`)? */
function isSourceRef(ref: string): boolean {
  return ref.startsWith(`${SOURCES_REF_PREFIX}/`)
}

export function buildScanScopeUniverse(
  universe: ScanDocUniverse,
  sources: readonly SpecSource[],
): ScanScopeUniverse {
  return {
    repoDocs: universe.ordered.filter((d) => !isSourceRef(d.path)),
    sources: sources.map((s) => ({ id: s.id, title: s.title, pages: s.docs.length })),
    universe,
  }
}

/** A verdict path, normalized: no trailing slash (`docs/` and `docs` are one path). */
export function normalizeScopePath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '')
  return trimmed === '' ? '.' : trimmed
}

/**
 * Does a verdict path cover a doc ref? Three forms:
 * - `.`            — root-level repo docs only (refs with no `/`);
 * - a source id    — every snapshot of that registered source;
 * - a dir prefix / exact ref — the subtree under it (or the one doc).
 * Source snapshots are also covered by their full `.truecourse/...` prefix, so
 * a hand-written prefix row works too.
 */
export function verdictCoversDoc(
  verdictPath: string,
  ref: string,
  sourceIds: ReadonlySet<string>,
): boolean {
  const path = normalizeScopePath(verdictPath)
  if (path === '.') return !ref.includes('/')
  if (sourceIds.has(path)) return ref.startsWith(`${SOURCES_REF_PREFIX}/${path}/`)
  return ref === path || ref.startsWith(`${path}/`)
}

/** How specific a verdict path is — the longest match wins at application. */
function scopePathSpecificity(verdictPath: string, sourceIds: ReadonlySet<string>): number {
  const path = normalizeScopePath(verdictPath)
  if (path === '.') return 0
  if (sourceIds.has(path)) return `${SOURCES_REF_PREFIX}/${path}`.length
  return path.length
}

export interface ScopeCoverage {
  /** Every repo doc and every source is covered — zero sessions, apply and go. */
  covered: boolean
  /** Uncovered repo docs, grouped by top-level entry (`.` for root files). */
  uncoveredDirs: Array<{ path: string; docs: number }>
  /** Registered sources no verdict covers. */
  uncoveredSources: ScopeSourceView[]
}

/**
 * The deterministic pre-pass: diff the universe against the covered verdicts.
 * Coverage is per DOC (a subtree is covered exactly when every doc under it
 * is), so universe growth inside an unverdicted corner re-opens the session
 * while a fully verdicted universe costs nothing.
 */
export function scopeCoverage(
  scope: ScanScopeUniverse,
  verdicts: readonly ScopeVerdict[],
): ScopeCoverage {
  const sourceIds = new Set(scope.sources.map((s) => s.id))
  const coveredDoc = (ref: string): boolean =>
    verdicts.some((v) => verdictCoversDoc(v.path, ref, sourceIds))

  const uncoveredByTop = new Map<string, number>()
  for (const doc of scope.repoDocs) {
    if (coveredDoc(doc.path)) continue
    const top = doc.path.includes('/') ? doc.path.slice(0, doc.path.indexOf('/')) : '.'
    uncoveredByTop.set(top, (uncoveredByTop.get(top) ?? 0) + 1)
  }
  const uncoveredSources = scope.sources.filter((s) => {
    const named = verdicts.some((v) => {
      const path = normalizeScopePath(v.path)
      return path === s.id || path === `${SOURCES_REF_PREFIX}/${s.id}`
    })
    if (named) return false
    // A source with pages is also covered when every page ref is (a broad
    // hand-written prefix); a pageless source needs its id named.
    const refs = scope.universe.ordered.filter((d) => d.path.startsWith(`${SOURCES_REF_PREFIX}/${s.id}/`))
    return refs.length === 0 || refs.some((d) => !coveredDoc(d.path))
  })

  return {
    covered: uncoveredByTop.size === 0 && uncoveredSources.length === 0,
    uncoveredDirs: [...uncoveredByTop.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([path, docs]) => ({ path, docs })),
    uncoveredSources,
  }
}

/**
 * Apply the verdicts to the discovered docs — BEFORE identity resolution, the
 * prefilter and the sessions (the whole point: an excluded subtree costs
 * nothing downstream). Per doc the MOST SPECIFIC matching verdict decides;
 * an uncovered doc is kept (exclusion is explicit, never a default).
 */
export function applyScopeVerdicts(
  docs: readonly DocCandidate[],
  verdicts: readonly ScopeVerdict[],
  sources: readonly ScopeSourceView[],
): DocCandidate[] {
  if (verdicts.length === 0) return [...docs]
  const sourceIds = new Set(sources.map((s) => s.id))
  return docs.filter((doc) => {
    let winner: ScopeVerdict | undefined
    let winnerSpecificity = -1
    for (const v of verdicts) {
      if (!verdictCoversDoc(v.path, doc.path, sourceIds)) continue
      const specificity = scopePathSpecificity(v.path, sourceIds)
      if (specificity > winnerSpecificity) {
        winner = v
        winnerSpecificity = specificity
      }
    }
    return winner === undefined || winner.verdict === 'keep'
  })
}

/**
 * Fold the session's outcome into the decisions: auto verdict rows stamped
 * `decidedAt: now`, USER ROWS NEVER OVERWRITTEN (an existing auto row for the
 * same path is replaced — the session may revise its own prior call);
 * instructions append-merged (existing order kept, duplicates dropped).
 */
export function mergeScopeOutcome(
  decisions: DecisionsFile,
  outcome: Pick<ScanScopeOutcome, 'scopeVerdicts' | 'instructions'>,
  now: string,
): DecisionsFile {
  const merged: ScopeVerdict[] = [...(decisions.scopeVerdicts ?? [])]
  const indexByPath = new Map(merged.map((v, i) => [normalizeScopePath(v.path), i]))
  for (const row of outcome.scopeVerdicts) {
    const path = normalizeScopePath(row.path)
    const stamped: ScopeVerdict = {
      path,
      verdict: row.verdict,
      reason: row.reason,
      decidedAt: now,
      resolvedBy: 'auto',
    }
    const at = indexByPath.get(path)
    if (at === undefined) {
      indexByPath.set(path, merged.length)
      merged.push(stamped)
    } else if (merged[at].resolvedBy === 'auto') {
      merged[at] = stamped
    }
    // else: a user row — authoritative, the auto row is dropped.
  }
  const instructions = [...(decisions.instructions ?? [])]
  for (const line of outcome.instructions) {
    if (!instructions.includes(line)) instructions.push(line)
  }
  return { ...decisions, scopeVerdicts: merged, instructions }
}

// ---------------------------------------------------------------------------
// Rendering — the tree the briefing and `list_universe` share.
// ---------------------------------------------------------------------------

/** Cap on rendered directories — context is the budget (§3.3). */
const MAX_TREE_DIRS = 300

function docsWord(n: number): string {
  return `${n} doc${n === 1 ? '' : 's'}`
}

/** The universe tree: every repo-doc directory with rolled-up counts, full
 *  paths (verdict paths are copied from these lines), then the sources. */
export function renderUniverseTree(scope: ScanScopeUniverse): string {
  const direct = new Map<string, number>()
  for (const doc of scope.repoDocs) {
    const dir = doc.path.includes('/') ? doc.path.slice(0, doc.path.lastIndexOf('/')) : '.'
    direct.set(dir, (direct.get(dir) ?? 0) + 1)
  }
  const total = new Map<string, number>()
  for (const [dir, n] of direct) {
    if (dir === '.') continue
    const parts = dir.split('/')
    for (let i = 1; i <= parts.length; i += 1) {
      const prefix = parts.slice(0, i).join('/')
      total.set(prefix, (total.get(prefix) ?? 0) + n)
    }
  }

  const lines: string[] = [`Repo docs (${docsWord(scope.repoDocs.length)}):`]
  const rootCount = direct.get('.') ?? 0
  if (rootCount > 0) lines.push(`  .  (${docsWord(rootCount)} at the repo root)`)
  const dirs = [...total.keys()].sort()
  for (const dir of dirs.slice(0, MAX_TREE_DIRS)) {
    const depth = dir.split('/').length - 1
    const own = direct.get(dir) ?? 0
    const sum = total.get(dir) ?? 0
    const ownTail = own > 0 && own !== sum ? `, ${own} direct` : ''
    lines.push(`  ${'  '.repeat(depth)}${dir}/  (${docsWord(sum)}${ownTail})`)
  }
  if (dirs.length > MAX_TREE_DIRS) lines.push(`  … ${dirs.length - MAX_TREE_DIRS} more directories`)

  if (scope.sources.length > 0) {
    lines.push('', `Registered documentation sources (verdict by source id):`)
    for (const s of scope.sources) {
      lines.push(`  ${s.id}  ·  ${s.title}  (${s.pages} page${s.pages === 1 ? '' : 's'})`)
    }
  } else {
    lines.push('', 'Registered documentation sources: none.')
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

export const ORCHESTRATE_SYSTEM_PROMPT = `You settle the SCAN SCOPE of ONE repository's documentation universe, before any per-doc curation spends. The universe is a tree of directories holding markdown docs, plus registered external documentation sources. You decide, per SUBTREE, whether it is spec-source territory — and you author the standing instructions every later scan session works under.

# Scope verdicts

One verdict per subtree: { "path", "verdict": "keep" | "exclude", "reason" }.
- "path" is a repo-relative DIRECTORY PREFIX exactly as the universe tree lists it (\`docs/archive\`), a single root-level doc (\`CHANGELOG.md\`), \`.\` for the repo-root files as a group, or a registered SOURCE ID.
- COVER EVERY UNCOVERED ENTRY the briefing lists. A covered universe is what lets the next scan skip this session entirely.
- "exclude" drops the subtree from the ENTIRE scan — its docs are never read again by any stage. Exclude only trees that are CATEGORICALLY not spec-source for this repository: vendored/third-party documentation mirrors, generated dumps duplicated by a canonical source elsewhere in the tree, archives of superseded material, machine-translated localization copies of a canonical-language tree, test fixture corpora.
- WHEN UNSURE, KEEP. Per-doc curation judges individual docs far more carefully; a wrong keep costs a few curation sessions, a wrong exclude silently hides a subtree from everything, forever. Prefer verdicting a PARENT "keep" and its genuinely dead CHILD "exclude" over guessing at the parent.
- Existing verdicts marked "user" are authoritative — never contradict one. You may revise a verdict marked "auto" (your own kind's earlier call).

# Standing instructions

Short imperative notes that ride EVERY scan session's briefing (e.g. "docs under handbook/ describe company process, not product behavior"; "the English tree under docs/en is canonical — treat other locales as derived"). Add one only on concrete evidence from this universe: instructions bind every judgment, and editing them re-runs the whole scan. An empty list is the normal outcome.

# Findings

Verbatim observations worth a human's eyes that fit no verdict — an apparently abandoned doc tree, a source whose snapshot looks truncated. Optional.

# Tools

- \`list_universe\` — the universe tree again (directories with doc counts, sources with page counts).
- \`doc_outline\` — one doc's heading outline, to sample what a directory actually holds. Sample a few representative docs before excluding anything; never exclude a subtree you did not look into.

The outcome is one object: { "scopeVerdicts": [...], "instructions": [...], "findings": [...] }.`

function listUniverseTool(scope: ScanScopeUniverse): SessionTool {
  return defineSessionTool({
    name: 'list_universe',
    description:
      'The doc universe as a tree: every directory with its doc count, and the registered documentation sources with page counts.',
    kind: 'list-scan-universe',
    readOnly: true,
    destructive: false,
    inputSchema: z.object({}).strict(),
    async execute() {
      return { content: renderUniverseTree(scope) }
    },
  })
}

function docOutlineTool(scope: ScanScopeUniverse): SessionTool {
  return defineSessionTool({
    name: 'doc_outline',
    description:
      'One doc\'s heading outline (title structure only, no body) — sample what a directory actually holds before verdicting it.',
    kind: 'doc-outline',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({ ref: z.string().min(1).describe('Repo-relative doc ref, e.g. `docs/api/auth.md`.') })
      .strict(),
    async execute(args) {
      const doc = scope.universe.byPath.get(args.ref)
      if (!doc) {
        return {
          content: `No doc \`${args.ref}\` in the universe — refs are full repo-relative paths; \`list_universe\` shows the directories.`,
          isError: true,
        }
      }
      const outline = headingOutline(docBody(doc))
      return {
        content: outline.trim()
          ? [`--- ${doc.path}  ·  ${docTitle(doc)} ---`, outline, '--- end ---'].join('\n')
          : `\`${doc.path}\` has no headings (title: ${docTitle(doc)}).`,
      }
    },
  })
}

export function orchestrateSessionDef(scope: ScanScopeUniverse): SessionDef<ScanScopeOutcome> {
  return {
    kind: SPEC_SCAN_ORCHESTRATE_SESSION_KIND,
    systemPrompt: ORCHESTRATE_SYSTEM_PROMPT,
    tools: [listUniverseTool(scope), docOutlineTool(scope)],
    outcomeSchema: ScanScopeOutcomeSchema,
    budget: ORCHESTRATE_BUDGET,
    // §3.7: the session may wait on user input where a surface can carry it;
    // non-interactive runs never block — unanswered questions land on the
    // outcome as pendingQuestions and the run surfaces them loudly.
    interactive: true,
  }
}

/** The opening message: the tree, the standing state, and the uncovered growth. */
export function orchestrateBriefing(
  scope: ScanScopeUniverse,
  decisions: DecisionsFile,
  coverage: ScopeCoverage,
): string {
  const verdicts = decisions.scopeVerdicts ?? []
  const instructions = decisions.instructions ?? []
  const lines = [
    'Settle the scan scope of this repository\'s doc universe.',
    '',
    renderUniverseTree(scope),
    '',
    verdicts.length > 0
      ? `Existing scope verdicts (${verdicts.length}) — "user" rows are authoritative:`
      : 'Existing scope verdicts: none.',
    ...verdicts.map(
      (v) => `  [${v.resolvedBy === 'auto' ? 'auto' : 'user'}] ${v.verdict.toUpperCase()}  ${v.path}  — ${v.reason}`,
    ),
    '',
    instructions.length > 0
      ? `Existing standing instructions (${instructions.length}):`
      : 'Existing standing instructions: none.',
    ...instructions.map((line) => `  - ${line}`),
    '',
    'UNCOVERED — no verdict covers these yet; your verdicts must cover every entry:',
    ...coverage.uncoveredDirs.map((d) => `  ${d.path === '.' ? '. (repo-root files)' : `${d.path}/`}  (${docsWord(d.docs)})`),
    ...coverage.uncoveredSources.map((s) => `  source: ${s.id}  (${s.pages} page${s.pages === 1 ? '' : 's'})`),
    '',
    'Sample outlines where a directory\'s nature is unclear, then produce the outcome.',
  ]
  return lines.join('\n')
}
