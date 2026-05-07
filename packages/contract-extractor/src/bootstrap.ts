/**
 * Bootstrap — propose `.truecourse/specs.yaml` when the user runs
 * `truecourse contracts generate` for the first time.
 *
 * Phase 8 ships a deterministic heuristic so the system works without
 * a network call. Phase 10 will swap in an LLM call (one shot via Claude
 * Code) that reads candidate file headers and infers ranks. The two
 * implementations share this module's input shape; the LLM variant will
 * just replace `proposeWithHeuristic`.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SpecsConfig } from './types.js';

export interface BootstrapCandidate {
  /** Path relative to the repo root. */
  file: string;
  /** Heuristic classification — used to rank in the proposal. */
  kind: 'base-spec' | 'adr-series' | 'rfc' | 'changelog' | 'overview' | 'unknown';
  /** First ~200 lines, included so an LLM-driven proposer has context. */
  preview: string;
}

export interface BootstrapProposal {
  config: SpecsConfig;
  /** Files the heuristic intentionally excluded, with the reason. */
  excluded: Array<{ file: string; reason: string }>;
}

const EXCLUDED_FILES = new Set([
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'LICENSE.md',
  'AGENTS.md',
  'CLAUDE.md',
]);

const SPEC_NAMES = new Set([
  'SPEC.md',
  'SPECIFICATION.md',
  'API.md',
  'CONTRACT.md',
]);

/**
 * Walk the repo, classify markdown files, and propose a `specs.yaml`
 * config. Skips `node_modules`, `.git`, and dot directories.
 */
export function gatherCandidates(repoRoot: string): BootstrapCandidate[] {
  const out: BootstrapCandidate[] = [];

  const visit = (dir: string, depthFromRoot: number): void => {
    if (depthFromRoot > 6) return;                  // sanity: don't dive forever
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full, depthFromRoot + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const rel = path.relative(repoRoot, full);
      const candidate = classify(rel, full);
      if (candidate) out.push(candidate);
    }
  };
  visit(repoRoot, 0);
  return out;
}

function classify(relPath: string, absPath: string): BootstrapCandidate | null {
  const base = path.basename(relPath);
  if (EXCLUDED_FILES.has(base)) return null;

  const preview = readPreview(absPath);
  const dirParts = path.dirname(relPath).split(path.sep);

  // Hard signals first.
  if (SPEC_NAMES.has(base)) {
    return { file: relPath, kind: 'base-spec', preview };
  }
  if (dirParts.includes('adr') || /^adr-?\d+/i.test(base)) {
    return { file: relPath, kind: 'adr-series', preview };
  }
  if (dirParts.includes('rfc') || /^rfc-?\d+/i.test(base)) {
    return { file: relPath, kind: 'rfc', preview };
  }

  // README and similar high-level docs are excluded by default — they're
  // overviews, not specs. Users can add them manually if needed.
  if (/^readme/i.test(base)) {
    return { file: relPath, kind: 'overview', preview };
  }

  // Anything else under a docs/ tree is suspicious-but-possibly-relevant;
  // surface it as 'unknown' so the user (or LLM bootstrapper) can decide.
  if (dirParts.includes('docs')) {
    return { file: relPath, kind: 'unknown', preview };
  }

  return null;
}

function readPreview(absPath: string): string {
  try {
    const content = fs.readFileSync(absPath, 'utf-8');
    return content.split('\n').slice(0, 200).join('\n');
  } catch {
    return '';
  }
}

/**
 * Heuristic proposer — used when no LLM is available or the user passes
 * `--no-llm-bootstrap`. Phase 10 will add an LLM-driven sibling.
 *
 * Ranking convention:
 *   rank 0: base spec
 *   rank 1: ADR series (sorted by filename)
 *   rank 2: RFCs (sorted by filename)
 */
export function proposeWithHeuristic(candidates: BootstrapCandidate[]): BootstrapProposal {
  const baseSpecs = candidates.filter((c) => c.kind === 'base-spec');
  const adrs = candidates.filter((c) => c.kind === 'adr-series').sort((a, b) => a.file.localeCompare(b.file));
  const rfcs = candidates.filter((c) => c.kind === 'rfc').sort((a, b) => a.file.localeCompare(b.file));
  const excluded = candidates
    .filter((c) => c.kind === 'overview' || c.kind === 'changelog' || c.kind === 'unknown')
    .map((c) => ({
      file: c.file,
      reason:
        c.kind === 'overview'
          ? 'README — likely overview, not a spec'
          : c.kind === 'changelog'
            ? 'release notes'
            : 'unrecognised — review manually',
    }));

  const specs: SpecsConfig['specs'] = [];
  for (const c of baseSpecs) specs.push({ file: c.file, rank: 0 });
  if (adrs.length === 1) {
    specs.push({ file: adrs[0].file, rank: 1 });
  } else if (adrs.length > 1) {
    // Use a glob when multiple ADRs share a directory.
    const dir = path.dirname(adrs[0].file);
    const allInSameDir = adrs.every((a) => path.dirname(a.file) === dir);
    if (allInSameDir) specs.push({ file: path.join(dir, '*.md'), rank: 1 });
    else for (const a of adrs) specs.push({ file: a.file, rank: 1 });
  }
  for (const r of rfcs) specs.push({ file: r.file, rank: 2 });

  return { config: { specs }, excluded };
}
