/**
 * Shared fragment→artifact tail: merge by (kind,identity) → cross-cutting tag
 * propagation → deterministic normalize → LLM repair → validate → drop hard-bad.
 *
 * The corpus (area) path builds a RankedFragment list + context slices and
 * finishes here, so dedup/normalize/repair/validate live in one place. In its
 * own module so the corpus generator can reuse it without an import cycle
 * through `index.ts`.
 */

import { mergeRankedFragments, type MergeDiagnostic, type MergedArtifact, type RankedFragment } from './merger.js';
import { propagateCrossCuttingTags } from './tag-propagator.js';
import { normalizeMergedArtifacts } from './normalizer.js';
import { repair, type RepairProgress } from './repair.js';
import { validateMerged, type ValidationIssue } from './validator.js';
import { rewriteReferencesToCanonical, snapReferencesToDeclared } from './target-reconciler.js';
import type { LlmTransport } from '@truecourse/shared/llm';
import type { SpecSlice } from './types.js';
// Type-only (erased at runtime → no cycle with index.ts which imports this module).
import type { ExtractModels } from './index.js';

export interface AssembleOptions {
  transport?: LlmTransport;
  models?: ExtractModels;
  disableRepair?: boolean;
  onRepairProgress?: (e: RepairProgress) => void;
  /**
   * Reconcile's merge map (coverage key → canonical kind+identity, chain-resolved).
   * Every artifact's cross-references are rewritten onto these canonicals before
   * validate, so a reference to a merged non-canonical identity stays resolvable
   * and byte-stable across runs. Absent (or empty) ⇒ no rewrite.
   */
  referenceMerges?: Record<string, { kind: string; identity: string }>;
}

export interface AssembleResult {
  artifactsToWrite: MergedArtifact[];
  validationIssues: ValidationIssue[];
  mergeDiagnostics: MergeDiagnostic[];
  resolverHard: boolean;
}

export async function assembleArtifacts(
  ranked: RankedFragment[],
  slices: SpecSlice[],
  opts: AssembleOptions = {},
): Promise<AssembleResult> {
  const models = opts.models ?? {};
  const merged = mergeRankedFragments(ranked);
  merged.artifacts = propagateCrossCuttingTags(merged.artifacts, slices);
  // Deterministic post-merge normalization — canonicalize Entity:<x>
  // cross-references against declared entities, lift parseable
  // `raw "<expr>"` query-rule predicates into the structured algebra,
  // and dedup query-rules that bind to the same (entity, predicate set)
  // under different identities. Runs before repair so the repair LLM
  // sees the cleaned shape.
  const normalized = normalizeMergedArtifacts(merged.artifacts);
  merged.artifacts = normalized.artifacts;
  if (
    normalized.stats.entityRefsRewritten +
      normalized.stats.rawPredicatesLifted +
      normalized.stats.identitiesAssigned +
      normalized.stats.artifactsDeduplicated >
    0
  ) {
    merged.diagnostics.push({
      artifactKey: 'normalize',
      severity: 'info',
      message: `normalize: entity-refs=${normalized.stats.entityRefsRewritten}, raw→structured=${normalized.stats.rawPredicatesLifted}, identities=${normalized.stats.identitiesAssigned}, dedup=${normalized.stats.artifactsDeduplicated}`,
    });
  }
  // Deterministic cross-reference canonicalization, run BEFORE repair (repair is
  // the LLM last resort). Two steps, in order:
  //   1. Rewrite references to reconcile-MERGED non-canonical identities onto their
  //      canonical spelling, so a cache-hit fragment can't ship a dangling ref and
  //      identities stay byte-stable across runs.
  //   2. Snap any remaining dangling reference onto a DECLARED identity of the same
  //      kind via the resolution ladder (coverage-key fold → token-multiset →
  //      unique meaningful-token overlap). This catches a reference the LLM invents
  //      from whole cloth (`Entity:core.customers` vs the declared `Entity:Customer`)
  //      that reconcile's merge map — enumerated targets only — can't see.
  // Both run before repair so a snapped ref resolves and repair spends no re-prompt
  // trying to GENERATE an artifact that already exists under its real identity.
  if (opts.referenceMerges && Object.keys(opts.referenceMerges).length > 0) {
    for (const a of merged.artifacts) {
      const rewritten = rewriteReferencesToCanonical(a.winning.tcSource, opts.referenceMerges);
      if (rewritten !== a.winning.tcSource) a.winning = { ...a.winning, tcSource: rewritten };
    }
  }
  const snaps = snapReferencesToDeclared(merged.artifacts);
  // Each snap is surfaced as a soft note (visible provenance, not a silent rewrite).
  const snapNotes: ValidationIssue[] = snaps.map((s) => ({
    artifactKey: `${s.from.kind}:${s.from.identity}`,
    message: `cross-reference ${s.from.kind}:${s.from.identity} snapped to declared ${s.to.kind}:${s.to.identity} (${s.via})`,
    severity: 'soft',
  }));

  // `repair` runs LLM-targeted re-prompts when an artifact references a
  // missing cross-ref or violates a per-kind structural rule. Tests
  // opt out via `disableRepair: true` because repair spawns `claude`
  // directly and would bypass any injected stub runner.
  if (slices.length > 0 && !opts.disableRepair) {
    const repaired = await repair(merged.artifacts, slices, {
      transport: opts.transport,
      model: models.repair,
      parseModel: models.repairParse,
      fallbackModel: models.fallback,
      onProgress: opts.onRepairProgress,
    });
    merged.artifacts = repaired.artifacts;
    merged.diagnostics.push(
      ...repaired.log.map((message) => ({
        artifactKey: 'repair',
        severity: 'info' as const,
        message,
      })),
    );
  }

  const validation = validateMerged(merged.artifacts);

  // Drop artifacts with HARD validation issues and keep the rest. A single bad
  // artifact (a tcSource the LLM mangled, a duplicate identity, etc.) must NOT
  // discard every other contract. Two sources of hard issues are attributable to
  // a specific artifact and therefore droppable:
  //   - per-artifact parse errors (artifactKey = `<kind>:<identity>`), and
  //   - resolver-level errors (duplicate identity) whose message names the
  //     offending artifact via the `<llm:<kind>:<identity>>` filename the
  //     validator parses each artifact under.
  const drop = new Set<string>();
  for (const i of validation.issues) {
    if (i.severity !== 'hard') continue;
    if (i.artifactKey !== 'resolver') {
      drop.add(i.artifactKey);
      continue;
    }
    const m = /<llm:([^>]+)>/.exec(i.message);
    if (m) drop.add(m[1]);
  }

  let artifactsToWrite = merged.artifacts;
  // A hard resolver error we could NOT attribute to a specific artifact is the
  // only thing that still aborts — genuine, unrecoverable corpus corruption.
  let resolverHard = validation.issues.some((i) => i.severity === 'hard' && i.artifactKey === 'resolver');

  if (drop.size > 0) {
    artifactsToWrite = merged.artifacts.filter((a) => !drop.has(`${a.kind}:${a.identity}`));
    // Re-validate the survivors (pure parse+resolve, no LLM): the dropped
    // artifacts are gone, so a previously-blocking resolver error should clear.
    // If one still remains we couldn't pin down, keep the abort as a safety net.
    resolverHard = validateMerged(artifactsToWrite).issues.some(
      (i) => i.severity === 'hard' && i.artifactKey === 'resolver',
    );
  }

  return {
    artifactsToWrite,
    // Report the ORIGINAL issues so the user sees exactly what was dropped, plus a
    // soft note per deterministic reference snap (provenance for the rewrite).
    validationIssues: [...snapNotes, ...validation.issues],
    mergeDiagnostics: merged.diagnostics,
    resolverHard,
  };
}
