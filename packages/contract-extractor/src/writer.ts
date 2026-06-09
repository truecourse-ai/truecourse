/**
 * Writer — turns merged artifacts into `.tc` files under
 * `.truecourse/contracts/`. Layout:
 *
 *   contracts/
 *     _shared/                  cross-cutting (auth, error envelope, pagination, idempotency)
 *     <domain>/                 inferred from operation paths or entity names
 *       <slug>.tc               one file per artifact
 *       operations/<slug>.tc    one per HTTP endpoint
 *
 * Domain inference: first path segment after `/api/` for operations, or
 * the entity's lowercase name for entities. Cross-cutting kinds
 * (AuthRequirement, AuthorizationRule, ErrorEnvelope, PaginationContract,
 * IdempotencyContract) land in `_shared/` regardless of identity.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { MergedArtifact } from './merger.js';

const CONTRACTS_DIR = path.join('.truecourse', 'contracts');

const SHARED_KINDS = new Set([
  'AuthRequirement',
  'AuthorizationRule',
  'ErrorEnvelope',
  'PaginationContract',
  'IdempotencyContract',
]);

export interface WriteRequest {
  /** Absolute path to write the artifact to. */
  filePath: string;
  /** Final tcSource, including any additional origin lines from layering. */
  tcSource: string;
}

export interface WriteResult {
  /** Files written this run (added or modified). */
  written: string[];
  /** Files that would have been written but weren't (--diff dry run). */
  proposed: string[];
}

export interface WriteOptions {
  /** When true, don't actually write — return the would-be paths in `proposed`. */
  dryRun?: boolean;
  /** When true, delete `.tc` files in the contracts dir that aren't in
   *  the current artifact set (e.g. the spec was edited and an artifact
   *  removed). The regular flow enables this; `--diff` (dry run)
   *  disables it. */
  prune?: boolean;
}

export function writeContracts(
  repoRoot: string,
  artifacts: MergedArtifact[],
  options: WriteOptions = {},
): WriteResult {
  const root = path.join(repoRoot, CONTRACTS_DIR);
  const requests = planWrites(root, artifacts);

  const written: string[] = [];
  const proposed: string[] = [];

  for (const req of requests) {
    if (options.dryRun) {
      proposed.push(req.filePath);
      continue;
    }
    fs.mkdirSync(path.dirname(req.filePath), { recursive: true });
    const existing = fs.existsSync(req.filePath)
      ? fs.readFileSync(req.filePath, 'utf-8')
      : null;
    if (existing === req.tcSource) continue;     // unchanged — no write
    fs.writeFileSync(req.filePath, req.tcSource);
    written.push(req.filePath);
  }

  if (options.prune && !options.dryRun && fs.existsSync(root)) {
    const live = new Set(requests.map((r) => r.filePath));
    pruneStale(root, live);
  }

  return { written, proposed };
}

/**
 * Compose the `.tc` corpus IN MEMORY: `{ posix relPath → tcSource }`, using the
 * same path planning + body composition as {@link writeContracts} but touching
 * no disk. The enterprise workspace path persists the returned map straight to
 * Postgres/Blob (no scratch tree), honoring the "no local files" rule.
 */
export function composeContractFiles(artifacts: MergedArtifact[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const req of planWrites('', artifacts)) {
    // pickFilePath('', a) yields a root-relative path; normalize to posix + strip
    // any leading separator so the keys match the file store's relPath form.
    const rel = req.filePath.split(path.sep).join('/').replace(/^\/+/, '');
    out[rel] = req.tcSource;
  }
  return out;
}

// ---------------------------------------------------------------------------
// File path planning
// ---------------------------------------------------------------------------

function planWrites(root: string, artifacts: MergedArtifact[]): WriteRequest[] {
  return artifacts.map((a) => ({
    filePath: pickFilePath(root, a),
    tcSource: composeTcSource(a),
  }));
}

/**
 * Compose the final `.tc` body for a merged artifact. The winning fragment's
 * tcSource is the structural body; lower-rank overridden fragments get
 * their `origin` lines stacked under the winner's so the lineage is
 * visible in the file. The grammar accepts multiple origin lines per
 * artifact — readers see the full chain that produced the obligation.
 */
function composeTcSource(artifact: MergedArtifact): string {
  let body = artifact.winning.tcSource;
  if (!body.endsWith('\n')) body += '\n';
  if (artifact.overridden.length === 0) return body;

  // Inject the extra origin lines right after the existing origin (if any),
  // or at the top of the body block. A best-effort textual injection is
  // sufficient since the grammar is line-oriented for these fields.
  const lines = body.split('\n');
  const originIdx = lines.findIndex((l) => /^\s*origin\s/.test(l));
  const extras = artifact.overridden.map((rf) => {
    const indent = originIdx >= 0 ? lines[originIdx].match(/^(\s*)/)?.[1] ?? '  ' : '  ';
    const o = rf.fragment.origin;
    return `${indent}origin ${o.source} "${o.section}" ${o.lines[0]}..${o.lines[1]}    // overridden by rank ${artifact.winningRank}`;
  });
  if (originIdx >= 0) {
    lines.splice(originIdx + 1, 0, ...extras);
  } else {
    // Inject right after the artifact head's opening `{`.
    const braceIdx = lines.findIndex((l) => /\{\s*$/.test(l));
    if (braceIdx >= 0) lines.splice(braceIdx + 1, 0, ...extras);
  }
  return lines.join('\n');
}

function pickFilePath(root: string, artifact: MergedArtifact): string {
  const slug = slugifyIdentity(artifact.identity);
  if (SHARED_KINDS.has(artifact.kind)) {
    return path.join(root, '_shared', `${slug}.tc`);
  }
  if (artifact.kind === 'Operation') {
    const domain = inferOperationDomain(artifact.identity);
    return path.join(root, domain, 'operations', `${slug}.tc`);
  }
  if (artifact.kind === 'UnenforceableObligation') {
    return path.join(root, 'unenforceable', `${slug}.tc`);
  }
  // Entity, Enum, StateMachine, EffectGroup, Formula, AuthorizationRule
  // → grouped by inferred domain.
  const domain = inferKindDomain(artifact);
  return path.join(root, domain, `${slug}.tc`);
}

function inferOperationDomain(identity: string): string {
  // identity = "METHOD path" — strip method, walk the path.
  const space = identity.indexOf(' ');
  const url = space >= 0 ? identity.slice(space + 1) : identity;
  const segments = url.split('/').filter(Boolean);
  // /api/<domain>/... → domain = segments[1]
  if (segments[0] === 'api' && segments[1]) return segments[1];
  if (segments[0]) return segments[0];
  return 'misc';
}

function inferKindDomain(artifact: MergedArtifact): string {
  // Use identity's first dot-segment when it has one (e.g. "Order.status" → "order"),
  // otherwise the lowercase first character of the identity.
  const dot = artifact.identity.indexOf('.');
  const stem = dot >= 0 ? artifact.identity.slice(0, dot) : artifact.identity;
  return stem.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function slugifyIdentity(identity: string): string {
  return identity
    .toLowerCase()
    .replace(/[\s/]+/g, '-')
    .replace(/[^a-z0-9.-]+/g, '')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Prune — remove .tc files no longer matching any artifact.
// ---------------------------------------------------------------------------

function pruneStale(root: string, live: Set<string>): void {
  const visit = (dir: string): boolean => {
    if (!fs.existsSync(dir)) return false;
    let dirEmpty = true;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const childEmpty = visit(full);
        if (childEmpty) {
          // Only prune empty directories we created.
          try { fs.rmdirSync(full); } catch { /* ignore */ }
        } else {
          dirEmpty = false;
        }
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.tc') && !live.has(full)) {
          fs.unlinkSync(full);
        } else {
          dirEmpty = false;
        }
      } else {
        dirEmpty = false;
      }
    }
    return dirEmpty;
  };
  visit(root);
}
