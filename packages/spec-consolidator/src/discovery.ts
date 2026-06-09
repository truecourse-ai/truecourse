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
 *     .git) — never user content.
 *   - `.truecourse/` — the consolidator's own outputs live here. If
 *     we re-discovered them, every run would compound on its previous
 *     output and the canonical spec would echo into itself.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadTcIgnore } from '@truecourse/shared';
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

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.truecourse', // consolidator's own outputs — never re-discover
  '.cache',
  'coverage',
]);

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
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      const full = path.join(dir, entry.name);
      if (tcIgnore.ignores(full)) continue;
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (path.extname(entry.name).toLowerCase() !== '.md') continue;

      const candidate = makeCandidate(full, rootDir, previewLines, opts);
      if (candidate) out.push(candidate);
    }
  };
  visit(rootDir);
  return out;
}

function makeCandidate(
  absPath: string,
  rootDir: string,
  previewLines: number,
  opts: DiscoveryOptions,
): DocCandidate | null {
  let content: string;
  let stat: fs.Stats;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
    stat = fs.statSync(absPath);
  } catch {
    return null;
  }

  const rel = path.relative(rootDir, absPath).split(path.sep).join('/');
  const preview = content.split(/\r?\n/).slice(0, previewLines).join('\n');
  const contentHash = createHash('sha256').update(content).digest('hex');
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

  // SPEC — explicit-name matches.
  if (/^(specs?|specification|specs?-.*)\.md$/i.test(base)) return 'spec';

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
    /(^|[^a-z])prd($|[^a-z])/i.test(base) ||
    /\.prd\.md$/i.test(base) ||
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
