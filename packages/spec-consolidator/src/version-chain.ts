/**
 * Version chain detection.
 *
 * When two docs in the same directory follow a v1/v2 naming pattern,
 * or one explicitly states `Supersedes: <other>` in its preamble,
 * they form a version chain. The consolidator surfaces the chain as
 * a single high-level decision ("v2 supersedes v1?") rather than
 * letting per-claim conflicts proliferate across the same content
 * said two different ways.
 *
 * Scope for v1: pairwise chains only. Three-step chains (v1→v2→v3)
 * register as multiple pairs and the user resolves each. Future work
 * can collapse them into one decision.
 *
 * Detection signals:
 *   - **Filename pattern** — two docs in the same directory whose
 *     names differ only in a `v1`/`v2`-style suffix.
 *   - **Supersedes header** — a doc's preview contains `Supersedes:
 *     <other-doc>` (case-insensitive). The other-doc reference is
 *     resolved against the asserting doc's directory; it has to
 *     exist in the candidate set to count.
 *
 * When both signals fire on the same pair, the chain is registered
 * once with `detectedFrom: 'supersedes-header'` (the explicit signal
 * outweighs the heuristic).
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
  detectedFrom: 'filename' | 'supersedes-header';
}

export function detectVersionChains(docs: DocCandidate[]): VersionChain[] {
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const seen = new Set<string>();
  const out: VersionChain[] = [];

  // Pass 1 — explicit Supersedes: headers
  for (const doc of docs) {
    const target = readSupersedesHeader(doc.preview);
    if (!target) continue;
    const resolved = resolveSupersedesTarget(doc.path, target, byPath);
    if (!resolved) continue;
    const older = byPath.get(resolved)!;
    const chain = makeChain([older, doc], 'supersedes-header');
    if (!seen.has(chain.id)) {
      seen.add(chain.id);
      out.push(chain);
    }
  }

  // Pass 2 — filename heuristic, only for pairs not already seen
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
// Supersedes header
// ---------------------------------------------------------------------------

/**
 * Match a `Supersedes: <target>` line in the preview. Tolerates
 * leading whitespace, code-fences, and front-matter — looks for the
 * line anywhere in the preview window.
 */
function readSupersedesHeader(preview: string): string | null {
  const match = /^\s*supersedes:\s*([^\s]+)\s*$/im.exec(preview);
  if (!match) return null;
  return match[1].replace(/^["']|["']$/g, '').trim();
}

/**
 * Resolve a `Supersedes:` reference. The target is normally a
 * filename relative to the asserting doc's directory; we accept
 * absolute repo-relative paths too.
 */
function resolveSupersedesTarget(
  fromDocPath: string,
  target: string,
  byPath: Map<string, DocCandidate>,
): string | null {
  if (byPath.has(target)) return target;
  const dir = path.dirname(fromDocPath);
  const joined = path.posix.join(dir, target);
  if (byPath.has(joined)) return joined;
  // Last-ditch: any candidate whose basename matches.
  for (const candidatePath of byPath.keys()) {
    if (path.basename(candidatePath) === target) return candidatePath;
  }
  return null;
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
