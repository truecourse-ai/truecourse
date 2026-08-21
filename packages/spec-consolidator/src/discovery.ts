/**
 * Doc discovery — walk a repo, find every markdown file, classify it
 * with a `DocKind`, and attach provenance the consolidator's later
 * stages need (git mtime, content preview, content hash).
 *
 * Design rule: classification is a *signal*, not a filter. Every
 * markdown file becomes a candidate; the kind tag biases later
 * merge-weight priors and prompt selection but never gates whether a
 * doc is read at all. New filename conventions onboard with zero
 * engine changes — they fall into `kind: unknown` and still flow
 * through the pipeline.
 *
 * Exclusions:
 *   - Build/tooling dirs (node_modules, dist, .next, build, .turbo,
 *     .git) — never user content. A repo whose docs genuinely live
 *     under such a name (e.g. dagster's `docs/docs/guides/build/`) can
 *     override the skip with an explicit `.truecourseignore` re-include
 *     (`!.../build/**`); the dotfile skip below is not overridable.
 *   - `.truecourse/` — the consolidator's own outputs live here. If
 *     we re-discovered them, every run would compound on its previous
 *     output and the canonical spec would echo into itself.
 *
 * Include-scope: when `spec.include` is set in `.truecourse/config.json`, only
 * markdown matching one of its globs enters the universe. `.truecourseignore`
 * is still applied first, so it always subtracts — an include glob can never
 * resurrect an ignored path. Absent/empty scope → everything (unchanged).
 *
 * Web sources: the markdown snapshot of every registered docs site
 * (`specs/sources.json`) joins the universe after the walk. It lives under the
 * `.truecourse/` the walk hard-skips, so it is enumerated from the registry
 * instead — and it is exempt from both the include-scope and `.truecourseignore`,
 * because registering the source IS the opt-in.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadTcIgnore,
  loadSpecScope,
  DOC_DISCOVERY_SKIP_DIRS as SKIP_DIRS,
  hasMarkdownExtension,
  stripMarkdownExtension,
  type SpecScope,
} from '@truecourse/shared';
import {
  hasOpenApiExtension,
  looksLikeOpenApi,
  isOpenApiDoc,
  isResolvedOpenApiWithinCap,
  OPENAPI_HEAD_BYTES,
  OPENAPI_MAX_BYTES,
} from '@truecourse/shared/openapi';
import { nodeRefContext } from '@truecourse/shared/openapi-node';
import { readSourcesFile, sourceDirPath, sourceDocAbsPath, sourceDocRef } from './sources/store.js';
import type { DocKind } from './types.js';

export interface DocCandidate {
  /** Repo-relative path with forward slashes — stable across platforms. */
  path: string;
  /** Absolute path, for downstream readers. `''` when the doc isn't on disk. */
  absPath: string;
  /**
   * In-memory body. When set, downstream stages read this instead of `absPath`
   * — used by sources with no real file on disk (e.g. an EE connector holding a
   * fetched page in RAM). File-based discovery leaves it undefined and the
   * extractor reads `absPath` lazily, exactly as before.
   */
  content?: string;
  kind: DocKind;
  /** First N lines of the file, for kind-tie-breaking heuristics + UI. */
  preview: string;
  /**
   * ISO timestamp of the last commit that touched this file. Falls
   * back to the file's mtime when git history isn't available (e.g.
   * an untracked file or a non-git directory).
   */
  lastTouched: string;
  /** sha256 of the file's full contents — cache key for downstream stages. */
  contentHash: string;
  /** Bytes — let UIs decide whether to fetch full content lazily. */
  size: number;
}

/**
 * A doc's full text, wherever it lives: the in-memory `content` an injected
 * source supplies (EE holds fetched bodies in RAM), the file on disk, or — if
 * neither is readable — the discovery preview.
 *
 * Lives beside `DocCandidate` rather than in any one consumer: the relevance
 * filter's near-duplicate detector, the third-party backstop, and corpus name
 * expansion all need it, and a shared home is what keeps `repo-identity` and
 * `relevance-filter` from importing each other.
 */
export function docBody(doc: DocCandidate): string {
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

// Synthetic markdown child used to ask `.truecourseignore` whether a
// `SKIP_DIRS` directory has been explicitly re-included. An allow-list
// ignore (`*.md` + `!path/build/**`) re-includes the markdown *under* a
// dir, never the bare dir, so we test a `.md` descendant: `unignored`
// comes back true only when a `!`-rule deliberately opted the tree in.
const SKIP_DIR_PROBE = '__tc_skipdir_probe__.md';

const PREVIEW_LINE_LIMIT = 200;

export interface DiscoveryOptions {
  /**
   * Override the preview line cap. Tests use this to keep previews
   * tight; production uses the default.
   */
  previewLines?: number;
  /**
   * When true, skip the git-log lookup and always use filesystem
   * mtime. Useful for tests that don't want a git dependency.
   */
  skipGit?: boolean;
  /**
   * Include-scope override. Defaults to the repo's `spec.include` read from
   * `.truecourse/config.json`. Callers that already loaded the scope pass it
   * here so discovery and their own scope checks agree without re-reading.
   */
  scope?: SpecScope;
}

/**
 * Walk `rootDir` recursively and return one `DocCandidate` per
 * markdown file found. Order is filesystem-walk-deterministic
 * (sorted by relative path) so re-runs produce identical lists for
 * cache stability.
 */
export function discoverDocs(rootDir: string, opts: DiscoveryOptions = {}): DocCandidate[] {
  const previewLines = opts.previewLines ?? PREVIEW_LINE_LIMIT;
  const out: DocCandidate[] = [];
  // Repo-root `.truecourseignore` — same exclusions as code analysis.
  const tcIgnore = loadTcIgnore(rootDir);
  // Opt-in include-scope (`spec.include`). Inactive ⇒ everything, and the guard
  // below is skipped, so a no-config repo walks byte-identically to before.
  const scope = opts.scope ?? loadSpecScope(rootDir);

  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Sort for deterministic walk order across runs / platforms.
    // Plain ASCII comparison (not localeCompare) so the output order
    // matches what `.sort()` produces on the resulting paths — tests
    // and tooling can rely on a single deterministic ordering.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      // Build/tooling dirs are skipped by default — but an explicit
      // `.truecourseignore` re-include (`!some/dir/build/**`) overrides the
      // skip, so a doc tree that legitimately lives under a dir named
      // `build`/`dist` is still discovered when the scope opts into it.
      // The allow-list re-includes `.md` files, not the bare directory, so
      // probe a markdown descendant rather than the directory itself.
      if (
        SKIP_DIRS.has(entry.name) &&
        !(entry.isDirectory() && tcIgnore.reincludes(path.join(full, SKIP_DIR_PROBE)))
      ) {
        continue;
      }
      // Dotfiles stay unconditionally skipped — this guards the
      // consolidator's own `.truecourse/` outputs from re-discovery even if
      // an ignore file re-includes them above.
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      if (tcIgnore.ignores(full)) continue;
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      // Two kinds of spec source enter the universe: prose markdown and
      // structural OpenAPI (yaml/json). Everything else is skipped here.
      const isMarkdown = hasMarkdownExtension(entry.name);
      const maybeOpenApi = !isMarkdown && hasOpenApiExtension(entry.name);
      if (!isMarkdown && !maybeOpenApi) continue;
      // Include-scope: when configured, only files matching a scope glob enter the
      // universe. `.truecourseignore` already subtracted above, so a scope glob can
      // never resurrect an ignored path. Out-of-scope files are never candidates —
      // they don't appear in skippedDocs either. Applies to both kinds identically.
      if (scope.active) {
        const rel = path.relative(rootDir, full).split(path.sep).join('/');
        if (!scope.includes(rel)) continue;
      }

      const candidate = isMarkdown
        ? makeCandidate(full, rootDir, previewLines, opts)
        : makeOpenApiCandidate(full, rootDir, previewLines, opts);
      if (candidate) out.push(candidate);
    }
  };
  visit(rootDir);
  out.push(...discoverSourceDocs(rootDir, previewLines, opts));
  return out;
}

/**
 * A YAML frontmatter block opening the document, if it has one. The fence must
 * be the first line and must close, so a `---` used as a horizontal rule is not
 * mistaken for one.
 */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/**
 * The document beneath any frontmatter — what the doc SAYS, separated from what
 * it says ABOUT itself.
 *
 * That line matters twice. A doc's content hash keys the per-doc LLM caches, and
 * frontmatter carries fields that move without the text moving: a synced ticket
 * restates its `updated` on any comment or label change, so hashing it makes a
 * sprint of comments buy a paid re-tag of every unchanged doc. And the preview
 * is the window the relevance classifier judges a doc through — metadata spent
 * out of that window is content the classifier never sees.
 *
 * The parsers that READ frontmatter keep the whole file; only identity and the
 * preview window are taken from the document itself.
 */
function documentBody(content: string): string {
  const m = FRONTMATTER.exec(content);
  return m ? content.slice(m[0].length).replace(/^\r?\n/, '') : content;
}

/**
 * The snapshot docs of every registered web source, as ordinary candidates —
 * appended after the walk, sorted among themselves by ref.
 *
 * Enumerated from `sources.json` (the registry owns the tree), so a registry
 * entry whose file is gone is skipped silently: it comes back on the next
 * `spec source refresh`. A corrupt registry throws `SourcesFileError` rather than
 * scanning without docs the user registered — a repo that never added a source
 * has no registry file at all and takes the empty path.
 */
function discoverSourceDocs(
  rootDir: string,
  previewLines: number,
  opts: DiscoveryOptions,
): DocCandidate[] {
  const out: DocCandidate[] = [];
  for (const source of readSourcesFile(rootDir).sources) {
    const dir = sourceDirPath(rootDir, source.id);
    for (const doc of source.docs) {
      const absPath = sourceDocAbsPath(dir, doc.path);
      if (!absPath) continue;
      const candidate = makeCandidate(absPath, rootDir, previewLines, opts, sourceDocRef(source.id, doc.path));
      if (candidate) out.push(candidate);
    }
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function makeCandidate(
  absPath: string,
  rootDir: string,
  previewLines: number,
  opts: DiscoveryOptions,
  /** Ref to record instead of the path relative to `rootDir` (web sources). */
  ref?: string,
): DocCandidate | null {
  let content: string;
  let stat: fs.Stats;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
    stat = fs.statSync(absPath);
  } catch {
    return null;
  }

  const rel = ref ?? path.relative(rootDir, absPath).split(path.sep).join('/');
  // Identity and the preview window come from the document, not from the
  // metadata block above it. See {@link documentBody}.
  const body = documentBody(content);
  const preview = body.split(/\r?\n/).slice(0, previewLines).join('\n');
  const contentHash = createHash('sha256').update(body).digest('hex');
  const lastTouched = opts.skipGit
    ? stat.mtime.toISOString()
    : (gitLastTouched(rootDir, rel) ?? stat.mtime.toISOString());
  const kind = classifyDoc(rel, content);

  return {
    path: rel,
    absPath,
    kind,
    preview,
    lastTouched,
    contentHash,
    size: stat.size,
  };
}

/**
 * Build a candidate for a possible OpenAPI/Swagger document, or `null` when the
 * file isn't one. Bounded on purpose (constraint: cheap before expensive):
 *   1. cap the file size — a huge yaml/json is never parsed;
 *   2. read only a bounded HEAD and run the cheap key check — this rejects
 *      package.json / tsconfig / lockfiles without a full parse;
 *   3. only then read + fully parse to confirm a top-level `openapi`/`swagger`.
 * A confirmed doc gets `kind: 'openapi'` and skips the prose relevance filter.
 */
function makeOpenApiCandidate(
  absPath: string,
  rootDir: string,
  previewLines: number,
  opts: DiscoveryOptions,
): DocCandidate | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return null;
  }
  if (stat.size > OPENAPI_MAX_BYTES) return null;

  // Bounded head read for the cheap key check, before any full parse.
  let head: string;
  try {
    const fd = fs.openSync(absPath, 'r');
    try {
      const len = Math.min(OPENAPI_HEAD_BYTES, stat.size);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, 0);
      head = buf.toString('utf-8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  if (!looksLikeOpenApi(head)) return null;

  // Confirm with the definitive predicate (extension + head + full parse).
  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }
  if (!isOpenApiDoc(absPath, content)) return null;

  // Resolved-size gate (B6): a split spec whose external `$ref`s inline to more
  // than the cap is refused here, so the pre-flight estimate and the runtime admit
  // the same corpus (estimate/runtime symmetry). The cheap `stat.size` gate above
  // only bounds the entry file; this bounds the fully-inlined document.
  if (!isResolvedOpenApiWithinCap(content, nodeRefContext(rootDir, absPath))) return null;

  const rel = path.relative(rootDir, absPath).split(path.sep).join('/');
  const preview = content.split(/\r?\n/).slice(0, previewLines).join('\n');
  const contentHash = createHash('sha256').update(content).digest('hex');
  const lastTouched = opts.skipGit
    ? stat.mtime.toISOString()
    : (gitLastTouched(rootDir, rel) ?? stat.mtime.toISOString());

  return {
    path: rel,
    absPath,
    kind: 'openapi',
    preview,
    lastTouched,
    contentHash,
    size: stat.size,
  };
}

/**
 * A STRUCTURAL (non-prose) spec source — currently only an OpenAPI document.
 * Structural docs are admitted into the corpus deterministically: they skip the
 * LLM relevance filter and every prose-only stage (area tagging, vocab, overlap).
 * The single predicate both the runtime (`filterByRelevance`/`planRelevanceWork`)
 * and the pre-flight estimate use to exclude them identically.
 */
export function isStructuralSpecDoc(doc: DocCandidate): boolean {
  return doc.kind === 'openapi';
}

/**
 * Resolve the last-commit timestamp for a single file. Returns null
 * when git isn't available, the directory isn't a repo, or the file
 * has no commit history (e.g. untracked).
 */
function gitLastTouched(rootDir: string, relPath: string): string | null {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', relPath], {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Classification — filename/path first, content fallback for PRDs
// ---------------------------------------------------------------------------

/**
 * Classify a single doc. Returns the most specific kind that applies.
 * Resolution order: SPEC > ADR > RFC > PRD > runbook > readme >
 * design-note > unknown.
 *
 * Filename and path patterns are the primary signals; content
 * patterns serve as a fallback for PRDs because they often live under
 * generic `docs/` paths without a PRD-shaped filename.
 */
export function classifyDoc(relPath: string, content: string): DocKind {
  const base = path.basename(relPath).toLowerCase();
  const dirParts = path.dirname(relPath).split('/').map((p) => p.toLowerCase());
  // Match by stem so the markdown flavour (.md / .mdx / .markdown …) never
  // decides the kind.
  const stem = stripMarkdownExtension(base);

  // SPEC — explicit-name matches.
  if (/^(specs?|specification|specs?-.*)$/i.test(stem)) return 'spec';

  // ADR — filename or directory name.
  if (/^adr[-_]?\d+/i.test(base) || dirParts.some((p) => p === 'adr' || p === 'adrs')) {
    return 'adr';
  }

  // RFC — filename or directory name.
  if (/^rfc[-_]?\d+/i.test(base) || dirParts.some((p) => p === 'rfc' || p === 'rfcs')) {
    return 'rfc';
  }

  // PRD — filename, directory, or content-shape fallback.
  if (
    // `feature.prd.md` is already caught by the delimiter-bounded match above —
    // no extension-specific alternative is needed.
    /(^|[^a-z])prd($|[^a-z])/i.test(base) ||
    dirParts.some((p) => p === 'prd' || p === 'prds' || p === 'product')
  ) {
    return 'prd';
  }
  if (looksLikePrd(content)) return 'prd';

  // Runbook — operational ("how to deploy / restart / fix").
  if (
    /^(runbook|operations|operation|deployment|deploy|on[-_]?call)/i.test(base) ||
    dirParts.some((p) => p === 'runbooks' || p === 'ops')
  ) {
    return 'runbook';
  }

  // README — last because some READMEs live under docs/PRDs/ etc.,
  // and we'd rather catch them as their content suggests.
  if (/^readme/i.test(base)) return 'readme';

  // Design note — explicit dirs only; otherwise the catch-all is
  // `unknown` to avoid pulling random docs/* into a meaningful kind.
  if (dirParts.some((p) => p === 'design' || p === 'notes' || p === 'design-notes' || p === 'designs')) {
    return 'design-note';
  }

  return 'unknown';
}

/**
 * Content-shape heuristic for PRDs. PRDs reliably contain a
 * "Requirements"-style section AND either an "Acceptance Criteria"
 * section or an "Out of Scope" section. Either single signal is too
 * common in design notes; the conjunction is more reliable.
 *
 * Only checks the first preview window so this stays cheap on big
 * docs.
 */
function looksLikePrd(content: string): boolean {
  const window = content.slice(0, 16_000);
  const hasRequirements = /(^|\n)#{1,6}\s+requirements?\b/i.test(window);
  const hasAcceptance = /(^|\n)#{1,6}\s+acceptance\s+criteria/i.test(window);
  const hasOutOfScope = /(^|\n)#{1,6}\s+out\s+of\s+scope/i.test(window);
  return hasRequirements && (hasAcceptance || hasOutOfScope);
}
