/**
 * Persistence for the consolidator's structured output: a single
 * `.truecourse/specs/claims.json` snapshot of every renderable claim
 * plus the detected modules. Replaces the per-section markdown tree the
 * old materializer produced.
 *
 * Downstream consumers (contract-extractor) read this file instead of
 * walking `.truecourse/specs/modules/<name>/*.md`. The file is written
 * deterministically by `consolidate()` — no LLM call, no timeout class.
 *
 * Shape is intentionally close to the in-memory `Claim` + `ModuleManifest`
 * types so the file is human-readable and round-trippable. Custom
 * resolutions live alongside extracted claims, tagged with
 * `source: "custom"`. Out-of-scope claims are filtered out of `claims[]`
 * because they contribute nothing positive to the contract corpus —
 * they survive on `modules[].outOfScope[]` as anti-spec.
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  ClaimSchema,
  ModuleManifestSchema,
  type Claim,
  type ModuleManifest,
} from './types.js';

const CLAIMS_FILE = 'claims.json';

export function claimsFilePath(repoRoot: string): string {
  return path.join(repoRoot, '.truecourse', 'specs', CLAIMS_FILE);
}

export const ClaimsFileModuleSchema = ModuleManifestSchema;
export type ClaimsFileModule = z.infer<typeof ClaimsFileModuleSchema>;

/**
 * One entry in `claims.json`. Adds the module attribution + a `source`
 * tag distinguishing extracted vs. user-supplied claims. Everything
 * else mirrors the in-memory `Claim` shape unchanged.
 */
export const ClaimsFileEntrySchema = ClaimSchema.extend({
  /** Module slug the claim belongs to (`_shared` for cross-cutting). */
  module: z.string(),
  /**
   * Where this claim came from. `extracted` is the default — produced
   * by the per-block LLM extraction. `custom` is a user-authored
   * resolution (`decisions.json#resolution.kind === 'custom'`).
   */
  source: z.enum(['extracted', 'custom']).default('extracted'),
});
export type ClaimsFileEntry = z.infer<typeof ClaimsFileEntrySchema>;

export const ClaimsFileSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  modules: z.array(ClaimsFileModuleSchema),
  claims: z.array(ClaimsFileEntrySchema),
});
export type ClaimsFile = z.infer<typeof ClaimsFileSchema>;

export function readClaims(repoRoot: string): ClaimsFile | null {
  const file = claimsFilePath(repoRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return ClaimsFileSchema.parse(raw);
  } catch {
    return null;
  }
}

export function writeClaims(
  repoRoot: string,
  input: { modules: ModuleManifest[]; claims: ClaimsFileEntry[] },
): void {
  const file = claimsFilePath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload: ClaimsFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    modules: input.modules,
    claims: input.claims,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n');
}

export function hasClaims(repoRoot: string): boolean {
  return fs.existsSync(claimsFilePath(repoRoot));
}

/**
 * Helper: build a `ClaimsFileEntry` from a regular `Claim` and the
 * module it was attributed to. Used by the orchestrator when writing
 * the file at the end of `consolidate()`.
 */
export function entryFromClaim(claim: Claim, module: string, source: ClaimsFileEntry['source'] = 'extracted'): ClaimsFileEntry {
  return { ...claim, module, source };
}
