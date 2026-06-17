/**
 * Post-merge cross-cutting tag propagator.
 *
 * Some tags on `operation` artifacts come from cross-cutting policies in
 * the spec (idempotency contract, pagination, etc.) rather than the
 * per-operation slice itself. The LLM often misses these because the
 * relevant signal sits in the operation's slice as prose ("This endpoint
 * is idempotent under Idempotency-Key") and never reaches the structured
 * `tags [...]` clause of the `.tc`.
 *
 * This pass scans each operation artifact's origin slice text for known
 * cross-cutting markers and rewrites the `tcSource` to include the
 * corresponding tag. Tags already present on the contract are preserved
 * and not duplicated.
 *
 * Why post-merge instead of part of the LLM prompt: the LLM is trained
 * to encode what the slice literally says. Cross-cutting policy
 * propagation is a deterministic textual rule and is more reliable as a
 * post-merge step than as additional prompt guidance the LLM may or may
 * not follow.
 */

import type { MergedArtifact } from './merger.js';
import type { SpecSlice } from './types.js';

interface TagRule {
  /** Tag to inject on the operation. */
  tag: string;
  /** Slice text patterns that imply the tag. Matched case-insensitively. */
  triggers: RegExp[];
}

const TAG_RULES: TagRule[] = [
  {
    tag: 'idempotent',
    triggers: [
      /\bidempotent\b/i,
      /\bidempotency[-\s]?key\b/i,
    ],
  },
  {
    tag: 'paginated',
    triggers: [
      // The classic cursor-pagination response shape is the strongest
      // signal — when the response body has both `items` and `nextCursor`
      // we can confidently mark the operation paginated, even if the
      // word "paginated" never appears in the slice prose.
      /\bnextCursor\b/,
      /\bcursor\b[\s\S]{0,200}\blimit\b/i,
      /\bpaginated\b/i,
      /cursor[-\s]based\s+pagination/i,
    ],
  },
];

/**
 * Rewrite operation artifacts in-place: for each operation whose origin
 * slice contains a tag-trigger phrase, inject the corresponding tag into
 * its `tcSource` (creating the `tags [...]` line if absent, augmenting it
 * if already present). Returns the modified artifact array.
 */
export function propagateCrossCuttingTags(
  artifacts: MergedArtifact[],
  slices: SpecSlice[],
): MergedArtifact[] {
  // Index slices by (specPath, startLine) — fragment origins reference
  // their source spec + line range, so we can look up the slice text
  // without re-reading from disk.
  const sliceLookup = new Map<string, SpecSlice>();
  for (const slice of slices) {
    sliceLookup.set(sliceKey(slice.specPath, slice.lineRange[0]), slice);
  }

  return artifacts.map((artifact) => {
    if (artifact.kind !== 'Operation') return artifact;
    const slice = findSliceForFragment(artifact, sliceLookup, slices);
    if (!slice) return artifact;

    let tcSource = artifact.winning.tcSource;
    for (const rule of TAG_RULES) {
      if (!rule.triggers.some((re) => re.test(slice.text))) continue;
      tcSource = injectTag(tcSource, rule.tag);
    }
    if (tcSource === artifact.winning.tcSource) return artifact;
    return {
      ...artifact,
      winning: { ...artifact.winning, tcSource },
    };
  });
}

function sliceKey(specPath: string, startLine: number): string {
  return `${specPath}:${startLine}`;
}

function findSliceForFragment(
  artifact: MergedArtifact,
  sliceLookup: Map<string, SpecSlice>,
  slices: SpecSlice[],
): SpecSlice | null {
  const origin = artifact.winning.origin;
  if (!origin) return null;
  // origin.lines = [start, end]; match by start line.
  const exact = sliceLookup.get(sliceKey(origin.source, origin.lines[0]));
  if (exact) return exact;
  // Fall back to "slice whose lineRange contains origin.lines[0]" — the
  // operation's heading may be at line N but the slice starts at N-K
  // because the slicer keeps the H2 header.
  return (
    slices.find(
      (s) =>
        s.specPath === origin.source &&
        s.lineRange[0] <= origin.lines[0] &&
        s.lineRange[1] >= origin.lines[0],
    ) ?? null
  );
}

/**
 * Insert or merge `tag` into the `tags [...]` clause of `tcSource`. If
 * no `tags` clause exists, append one just before the artifact's closing
 * brace. If `tag` is already present, return `tcSource` unchanged.
 */
function injectTag(tcSource: string, tag: string): string {
  const tagsMatch = tcSource.match(/^(\s*)tags\s*\[([^\]]*)\]\s*$/m);
  if (tagsMatch) {
    const existing = tagsMatch[2]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (existing.includes(tag)) return tcSource;
    const next = [...existing, tag].join(', ');
    return tcSource.replace(tagsMatch[0], `${tagsMatch[1]}tags [${next}]`);
  }
  // No existing tags clause — insert one just before the artifact's
  // closing brace. We find the LAST `}` line at column 0 (the operation
  // block's closer) and insert the tags line before it.
  const lines = tcSource.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^}\s*$/.test(lines[i])) {
      lines.splice(i, 0, `  tags [${tag}]`);
      return lines.join('\n');
    }
  }
  return tcSource;
}
