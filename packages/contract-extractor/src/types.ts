/**
 * Shared type vocabulary for the contract extractor.
 *
 * Slices are content-addressed chunks of a markdown spec. Fragments are
 * the LLM's structured output for one slice — typically one or more
 * artifact `.tc` definitions plus optional UnenforceableObligation
 * entries. The merger groups fragments by `(kind, identity)` and writes
 * the result to `.truecourse/contracts/`.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Slice — input to the LLM
// ---------------------------------------------------------------------------

export interface SpecSlice {
  /** sha256(spec_path + heading_path + slice_text) — content-addressed. */
  id: string;
  /** Path to the source spec file, relative to the repo root. */
  specPath: string;
  /** Heading hierarchy ending at the slice's own heading, e.g.
   *  ["Operations", "POST /api/orders"]. The first level is the closest
   *  H1 above the slice (or just the slice's own heading if it's an H1).
   *  Used for origin labels and cache keys. */
  headingPath: string[];
  /** 1-indexed inclusive line range in the source spec. */
  lineRange: [number, number];
  /** The slice's text content (heading + body). */
  text: string;
  /** Heading level of the slice's own heading (1 for H1, 2 for H2, …). */
  headingLevel: number;
}

// ---------------------------------------------------------------------------
// Fragment — output from the LLM
// ---------------------------------------------------------------------------

/**
 * Origin reference attached to every fragment. Mirrors the `origin` line
 * the .tc grammar already supports — same field names so the writer can
 * emit it directly.
 */
export const FragmentOriginSchema = z.object({
  source: z.string(),                         // spec filename (e.g. "SPEC.md")
  section: z.string(),                        // human-readable section path
  lines: z.tuple([z.number().int(), z.number().int()]),
});
export type FragmentOrigin = z.infer<typeof FragmentOriginSchema>;

/**
 * A single artifact extracted from a slice. `tcSource` is the raw .tc
 * body the LLM produced; the validator parses it before the writer
 * commits it to disk. `obligationKeys` is recorded for diagnostics and
 * future field-level layering — currently the merger operates at the
 * artifact level and ignores this field.
 */
export const FragmentSchema = z.object({
  kind: z.string(),                           // ArtifactKind, validated downstream
  identity: z.string(),
  tcSource: z.string(),
  origin: FragmentOriginSchema,
  obligationKeys: z.array(z.string()).default([]),
  /** Reason the LLM produced an UnenforceableObligation. Required for that
   *  kind, ignored for everything else. */
  reason: z.string().optional(),
});
export type Fragment = z.infer<typeof FragmentSchema>;

/**
 * The structured response shape the LLM is asked to produce per slice.
 * Validated by Zod before caching.
 */
export const ExtractionResultSchema = z.object({
  fragments: z.array(FragmentSchema),
  /** Optional explanation the LLM wants to surface to the user — printed
   *  to the CLI when present. Useful when the LLM had to make ambiguous
   *  judgement calls and wants to flag them. */
  notes: z.string().optional(),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

// ---------------------------------------------------------------------------
// Cache shapes
// ---------------------------------------------------------------------------

export const SliceCacheEntrySchema = z.object({
  id: z.string(),
  specPath: z.string(),
  headingPath: z.array(z.string()),
  lineRange: z.tuple([z.number().int(), z.number().int()]),
  result: ExtractionResultSchema,
  /** ISO-8601 timestamp the entry was written. */
  cachedAt: z.string(),
});
export type SliceCacheEntry = z.infer<typeof SliceCacheEntrySchema>;

export const ManifestSliceSchema = z.object({
  headingPath: z.array(z.string()),
  sliceId: z.string(),
});

export const ManifestSpecSchema = z.object({
  /** sha256 of the spec file's full contents — bumped when ANY part of
   *  the file changes. Used as a cheap whole-file invalidation check. */
  fileHash: z.string(),
  slices: z.array(ManifestSliceSchema),
});

export const ManifestSchema = z.object({
  version: z.literal(1),
  specs: z.record(z.string(), ManifestSpecSchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;

// ---------------------------------------------------------------------------
// Specs config (`.truecourse/specs.yaml`)
// ---------------------------------------------------------------------------

export const SpecsConfigEntrySchema = z.object({
  /** Path or glob, relative to the repo root. */
  file: z.string(),
  /** Layering rank — higher rank overrides lower for the same artifact. */
  rank: z.number().int().nonnegative().default(0),
});
export type SpecsConfigEntry = z.infer<typeof SpecsConfigEntrySchema>;

export const SpecsConfigSchema = z.object({
  specs: z.array(SpecsConfigEntrySchema).min(1),
});
export type SpecsConfig = z.infer<typeof SpecsConfigSchema>;
