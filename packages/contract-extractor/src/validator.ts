/**
 * Validation gate. Before the writer commits any merged `.tc` to disk,
 * we run the verifier's parser + resolver over the in-memory corpus to
 * confirm the LLM's output is structurally valid:
 *
 *   1. Every artifact's `tcSource` parses cleanly (no syntax errors).
 *   2. The resolver indexes the corpus without duplicate identities.
 *   3. Every cross-reference resolves to a known artifact (or a
 *      well-known forward reference).
 *
 * Failure surfaces actionable diagnostics — file not on disk yet, but we
 * can still point at the slice id, heading path, and offending tcSource
 * so the user can re-run, edit the spec, or fall back to a manual `.tc`.
 */

import { parserOhm, resolver } from '@truecourse/contract-verifier';
import type { MergedArtifact } from './merger.js';

export interface ValidationIssue {
  artifactKey: string;
  message: string;
  /** Verbatim tcSource the LLM produced — included so the user can debug. */
  tcSource?: string;
  /**
   * Hard issues block the write (parse errors, duplicate identities — the
   * corpus would be corrupt if we proceeded). Soft issues are reported to
   * the user but don't block the write — the most common is an
   * unresolved cross-reference between two LLM slices that coined
   * different identities for the same artifact, which doesn't hurt the
   * artifacts that DID resolve.
   */
  severity: 'hard' | 'soft';
}

export interface ValidationResult {
  /** Whether the writer should proceed — true when no HARD issues. */
  ok: boolean;
  issues: ValidationIssue[];
  /** Number of artifacts the resolver indexed (sanity check). */
  artifactCount: number;
}

export function validateMerged(artifacts: MergedArtifact[]): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Pass 1: parse each artifact's tcSource individually so we can
  // attribute parse errors to the exact LLM output. The strict ohm parser
  // throws on any unrecognized clause, so a malformed slice surfaces here as
  // a HARD issue attributed to the exact artifact key.
  const fileNodes: ReturnType<typeof parserOhm.parseTcFile>[] = [];
  for (const a of artifacts) {
    const key = `${a.kind}:${a.identity}`;
    try {
      const node = parserOhm.parseTcFile(`<llm:${key}>`, a.winning.tcSource);
      if (node.statements.length === 0) {
        issues.push({
          artifactKey: key,
          message: 'tcSource produced zero statements',
          tcSource: a.winning.tcSource,
          severity: 'hard',
        });
        continue;
      }
      fileNodes.push(node);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      issues.push({
        artifactKey: key,
        message: `parse error: ${message}`,
        tcSource: a.winning.tcSource,
        severity: 'hard',
      });
    }
  }

  // Pass 2: feed the parsed nodes through the resolver and check for
  // duplicate identities + unresolved cross-references.
  const resolution = resolver.resolve(fileNodes);
  for (const err of resolution.errors) {
    issues.push({
      artifactKey: 'resolver',
      message: `${err.filePath}:${err.line} ${err.message}`,
      severity: err.severity ?? 'hard',
    });
  }
  // The verifier surfaces forward refs to artifact kinds it doesn't yet
  // implement (e.g. `PerformanceSLA`) under `ref.type === 'Unknown'`.
  // Tolerating Unknown lets the LLM declare future-friendly references
  // without breaking validation; everything else must resolve.
  const trulyUnresolved = resolution.unresolvedRefs.filter(
    (u) => u.ref.type !== 'Unknown',
  );
  for (const u of trulyUnresolved) {
    issues.push({
      artifactKey: `${u.ref.type}:${u.ref.identity}`,
      message: `cross-reference ${u.ref.type}:${u.ref.identity} doesn't resolve`,
      severity: 'soft',
    });
  }

  // The writer can proceed as long as there are no HARD issues. Soft
  // issues (unresolved refs) are surfaced to the user but the artifacts
  // that DID resolve are still useful — the verifier will flag any
  // remaining drift downstream.
  const hasHard = issues.some((i) => i.severity === 'hard');
  return {
    ok: !hasHard,
    issues,
    artifactCount: resolution.index.size,
  };
}
