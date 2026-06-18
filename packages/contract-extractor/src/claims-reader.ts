/**
 * Claims-driven slice source for the contract extractor.
 *
 * Replaces the old `canonical-spec-reader.ts` / `slicer.ts` pair. Module 1
 * now writes a single structured snapshot at `.truecourse/specs/claims.json`
 * instead of a markdown tree under `modules/<name>/<topic>.md`. This
 * module reads the snapshot, groups claims by `(module, topic)`, and
 * renders each group as a `SpecSlice` so the downstream pipeline
 * (cache → runner → merger → validator → writer) is unchanged.
 *
 * The slice's `text` is a deterministic markdown rendering of the
 * group — subjects + JSON-formatted content + provenance lines. No
 * LLM call to produce it. Opus then translates the slice into `.tc`
 * artifacts, same as before.
 *
 * Modules with manifest status `out-of-scope` contribute zero slices —
 * their content is negative spec, not positive contract. (Out-of-scope
 * survives on the manifest's `outOfScope[]`; the consolidator already
 * filters those claims from `claims.json#claims[]`.)
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  readClaims,
  type ClaimsFileEntry,
  type ClaimsFileModule,
} from '@truecourse/spec-consolidator';
import type { SpecSlice } from './types.js';

/** The parsed `claims.json` document (Module 1's canonical output). */
export type ClaimsFile = NonNullable<ReturnType<typeof readClaims>>;

export interface CanonicalModuleInfo {
  /** Module slug. `_shared` for cross-cutting. */
  name: string;
  /** Module manifest from claims.json. */
  manifest: ClaimsFileModule;
}

export interface CanonicalReadResult {
  /** Slices to feed the extraction pipeline. */
  slices: SpecSlice[];
  /** Per-module info for downstream stages that care about manifests. */
  modules: CanonicalModuleInfo[];
}

export function canonicalSpecPath(repoRoot: string): string {
  return path.join(repoRoot, '.truecourse', 'specs', 'claims.json');
}

/**
 * True when a usable `claims.json` exists at the canonical location.
 * Used by `generateContracts()` and the CLI to short-circuit with a
 * helpful "run spec scan first" message.
 */
export function hasCanonicalSpec(repoRoot: string): boolean {
  const file = canonicalSpecPath(repoRoot);
  if (!fs.existsSync(file)) return false;
  const parsed = readClaims(repoRoot);
  return parsed !== null;
}

/**
 * Read `claims.json` and produce one `SpecSlice` per `(module, topic)`
 * group. Modules with status `out-of-scope` are skipped entirely.
 */
export function readCanonicalSpec(repoRoot: string): CanonicalReadResult {
  const file = readClaims(repoRoot);
  if (!file) return { slices: [], modules: [] };
  return canonicalFromClaims(file);
}

/**
 * Pure variant of {@link readCanonicalSpec}: produce slices + module info from an
 * IN-MEMORY `claims.json` document (no disk read). The enterprise workspace path
 * holds its canonical claims in Postgres, not on disk, so it injects them here.
 * Identical slice ids (content-addressed) ⇒ identical extraction-cache keys ⇒
 * unchanged claims cost 0 LLM regardless of where the claims came from.
 */
export function canonicalFromClaims(file: ClaimsFile): CanonicalReadResult {
  const inScopeManifestByName = new Map<string, ClaimsFileModule>();
  const modules: CanonicalModuleInfo[] = [];
  for (const manifest of file.modules) {
    modules.push({ name: manifest.name, manifest });
    if (manifest.status === 'out-of-scope') continue;
    inScopeManifestByName.set(manifest.name, manifest);
  }

  // Group eligible claims by (module, topic). Sort module names then
  // topic names for deterministic slice ordering.
  const groups = new Map<string, ClaimsFileEntry[]>();
  for (const claim of file.claims) {
    if (!inScopeManifestByName.has(claim.module)) continue;
    const key = `${claim.module}::${claim.topic}`;
    const list = groups.get(key) ?? [];
    list.push(claim);
    groups.set(key, list);
  }

  const slices: SpecSlice[] = [];
  const orderedKeys = [...groups.keys()].sort();
  for (const key of orderedKeys) {
    const [moduleName, topic] = key.split('::');
    const entries = (groups.get(key) ?? []).sort((a, b) =>
      a.subject.localeCompare(b.subject),
    );
    const manifest = inScopeManifestByName.get(moduleName)!;
    slices.push(renderGroupSlice(moduleName, topic, manifest, entries));
  }

  return { slices, modules };
}

// ---------------------------------------------------------------------------
// Slice rendering
// ---------------------------------------------------------------------------

/**
 * Render a (module, topic) group as a `SpecSlice`. The text is the
 * blob Opus will see — subject blocks with claim content as JSON and
 * provenance lines so the artifact's `origin {…}` block can name a
 * real source file + line range.
 *
 * `specPath` is set to the synthetic path `claims.json/<module>/<topic>`
 * so the manifest can still key by a stable identifier (mirroring how
 * the old per-section .md files were keyed by their on-disk path).
 */
function renderGroupSlice(
  moduleName: string,
  topic: string,
  manifest: ClaimsFileModule,
  claims: ClaimsFileEntry[],
): SpecSlice {
  const specPath = `.truecourse/specs/claims.json#${moduleName}/${topic}`;
  const headingPath = [moduleName, topic];
  const sources = collectSources(claims);

  const lines: string[] = [];
  lines.push(`# ${moduleName} — ${topic}`);
  lines.push('');
  lines.push(`Module: ${moduleName}`);
  lines.push(`Status: ${manifest.status}`);
  if (manifest.description) lines.push(`Description: ${manifest.description}`);
  if (manifest.scope?.paths && manifest.scope.paths.length > 0) {
    lines.push(`Scope paths: ${manifest.scope.paths.join(', ')}`);
  }
  if (sources.length > 0) {
    lines.push(`Sources: ${sources.join(', ')}`);
  }
  lines.push('');

  for (const claim of claims) {
    lines.push(`## ${claim.subject}`);
    if (claim.metadata.status) {
      lines.push(`Status: ${claim.metadata.status}`);
    }
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(claim.content, null, 2));
    lines.push('```');
    lines.push('');
    lines.push(`Source: ${claim.provenance.file}:${claim.provenance.line}`);
    if (claim.provenance.additionalSources && claim.provenance.additionalSources.length > 0) {
      for (const extra of claim.provenance.additionalSources) {
        lines.push(`Also: ${extra.file}:${extra.line}`);
      }
    }
    if (claim.provenance.quote && claim.provenance.quote.trim().length > 0) {
      lines.push('');
      lines.push('Quote:');
      lines.push('> ' + claim.provenance.quote.split('\n').join('\n> '));
    }
    lines.push('');
  }

  // Negative spec — if the manifest lists out-of-scope endpoints, surface
  // them so the prompt's "do not invent" rule has the data to mark them.
  if (manifest.outOfScope && manifest.outOfScope.length > 0) {
    lines.push('## Out of scope');
    lines.push('');
    for (const oos of manifest.outOfScope) {
      const reason = oos.reason ? ` — ${oos.reason}` : '';
      lines.push(`- ${oos.id}${reason} (from ${oos.source})`);
    }
    lines.push('');
  }

  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  // Line range is synthetic — it indexes into the slice text itself, not
  // into a source doc. The merger surfaces this through fragment.origin
  // so contract files retain a deterministic identifier.
  const lineRange: [number, number] = [1, Math.max(1, text.split('\n').length)];

  const id = sliceHash(specPath, headingPath, text);

  return {
    id,
    specPath,
    headingPath,
    lineRange,
    text,
    headingLevel: 1,
  };
}

function collectSources(claims: ClaimsFileEntry[]): string[] {
  const out = new Set<string>();
  for (const c of claims) {
    out.add(c.provenance.file);
    for (const extra of c.provenance.additionalSources ?? []) {
      out.add(extra.file);
    }
  }
  return [...out].sort();
}

export function sliceHash(specPath: string, headingPath: string[], text: string): string {
  const h = crypto.createHash('sha256');
  h.update(specPath);
  h.update(' ');
  h.update(headingPath.join('/'));
  h.update(' ');
  h.update(text);
  return h.digest('hex');
}

export function fileHash(source: string): string {
  return crypto.createHash('sha256').update(source).digest('hex');
}
