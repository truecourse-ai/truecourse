/**
 * Version chain detection.
 *
 * When two docs in the same directory follow a v1/v2 naming pattern,
 * they form a version chain. The consolidator surfaces the chain as
 * a single high-level decision ("v2 supersedes v1?") rather than
 * letting per-claim conflicts proliferate across the same content
 * said two different ways.
 *
 * Scope for v1: pairwise chains only. Three-step chains (v1→v2→v3)
 * register as multiple pairs and the user resolves each. Future work
 * can collapse them into one decision.
 *
 * Signals beyond filename versioning (e.g. content-based successor
 * detection) come from the LLM-augmented detector in
 * `version-chain-llm.ts`. This module stays narrow: filename pattern
 * only, deterministic, zero LLM cost.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import type { DocCandidate } from './discovery.js';

export interface VersionChain {
  /** Stable id — sha256 of sorted member paths. */
  id: string;
  /** Docs in oldest → newest order. */
  docs: DocCandidate[];
  /** Which signal surfaced this chain. */
  detectedFrom: 'filename' | 'llm' | 'manual';
}

/**
 * Materialize user-marked chains (from `decisions.json#manualChains`)
 * into VersionChain objects so they merge with the auto-detected ones.
 * Drops entries whose referenced docs aren't in the discovered set —
 * the user may have marked a chain against a doc that no longer
 * exists; surfacing that as a hard error would be worse UX than
 * silently dropping.
 *
 * Cross-directory chains ARE allowed here (unlike the filename
 * detector's same-dir rule) — the user explicitly knows their docs.
 */
export function materializeManualChains(
  manualChains: Array<{ older: string; newer: string }>,
  docs: DocCandidate[],
): VersionChain[] {
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const out: VersionChain[] = [];
  for (const m of manualChains) {
    const olderDoc = byPath.get(m.older);
    const newerDoc = byPath.get(m.newer);
    if (!olderDoc || !newerDoc) continue;
    if (olderDoc.path === newerDoc.path) continue;
    out.push(makeChain([olderDoc, newerDoc], 'manual'));
  }
  return out;
}

export function detectVersionChains(docs: DocCandidate[]): VersionChain[] {
  const seen = new Set<string>();
  const out: VersionChain[] = [];

  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const a = docs[i];
      const b = docs[j];
      const pair = filenameVersionPair(a, b);
      if (!pair) continue;
      const chain = makeChain(pair, 'filename');
      if (!seen.has(chain.id)) {
        seen.add(chain.id);
        out.push(chain);
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Filename heuristic
// ---------------------------------------------------------------------------

const VERSION_SUFFIX_RE = /(.*?)(v\d+)(\.[^./]+)?$/i;

/**
 * Detect the v1/v2 suffix pattern between two docs in the same
 * directory. Returns the pair in oldest → newest order, or null when
 * they're not a match.
 */
function filenameVersionPair(
  a: DocCandidate,
  b: DocCandidate,
): [DocCandidate, DocCandidate] | null {
  if (path.dirname(a.path) !== path.dirname(b.path)) return null;
  const aMatch = VERSION_SUFFIX_RE.exec(stripExt(path.basename(a.path)));
  const bMatch = VERSION_SUFFIX_RE.exec(stripExt(path.basename(b.path)));
  if (!aMatch || !bMatch) return null;
  // The non-version prefix must match (case-insensitive). Without
  // this guard, "frontend_PRDv1.md" + "backend_PRDv2.md" would pair.
  if (aMatch[1].toLowerCase() !== bMatch[1].toLowerCase()) return null;

  const aV = parseInt(aMatch[2].slice(1), 10);
  const bV = parseInt(bMatch[2].slice(1), 10);
  if (aV === bV) return null;
  return aV < bV ? [a, b] : [b, a];
}

function stripExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? filename : filename.slice(0, dot);
}

// ---------------------------------------------------------------------------
// Chain construction
// ---------------------------------------------------------------------------

function makeChain(docs: DocCandidate[], detectedFrom: VersionChain['detectedFrom']): VersionChain {
  const id = createHash('sha256')
    .update(docs.map((d) => d.path).sort().join('|'))
    .digest('hex');
  return { id, docs, detectedFrom };
}
