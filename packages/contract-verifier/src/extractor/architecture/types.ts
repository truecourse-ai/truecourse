/**
 * Code-side architecture-detection output. Each per-category detector
 * inspects a shared `CodebaseScan` (package.json deps, characteristic
 * imports, config-file presence) and returns a `DetectedArchitectureChoice`.
 * The ArchitectureDecision comparator diffs that against the spec.
 */

import type { ArchitectureCategory, SourceLocation } from '../../types/index.js';

export interface DetectionSignal {
  kind: 'package' | 'import' | 'config-file' | 'usage-pattern';
  source: SourceLocation;
  /** Human-readable description of what matched (`pg (dependencies)`, …). */
  detail: string;
}

export interface ObservedChoice {
  /** A member of the category's closed alternative enum. */
  value: string;
  signals: DetectionSignal[];
}

export interface DetectedArchitectureChoice {
  category: ArchitectureCategory;
  /** Every choice the detector observed. Multiple are possible — e.g.
   *  redis-as-cache + postgres-as-primary — and the comparator decides
   *  whether that matches the spec. */
  observed: ObservedChoice[];
  /**
   * Whether there was enough signal to decide. `inconclusive` ⇒ no
   * signal from any alternative was found, so the comparator emits an
   * info drift instead of a false-positive unmet-choice.
   */
  confidence: 'high' | 'medium' | 'low' | 'inconclusive';
}

// ---------------------------------------------------------------------------
// Shared codebase scan — built once per verify run, reused by every detector.
// ---------------------------------------------------------------------------

export interface DeclaredPackage {
  name: string;
  version: string;
  /** `dependencies` | `devDependencies` | `peerDependencies` | `optionalDependencies` */
  field: string;
  source: SourceLocation;
}

export interface ImportRef {
  /** The module specifier (`pg`, `mongoose`, `@trpc/server`, …). */
  module: string;
  source: SourceLocation;
}

export interface CodebaseScan {
  codeDir: string;
  packages: DeclaredPackage[];
  imports: ImportRef[];
  /** Repo-relative paths of every (non-ignored) file under codeDir. */
  files: string[];
  /** Lazily read + cache a file's text by repo-relative path. */
  readFile(relPath: string): string | null;
}

export interface ArchitectureDetector {
  category: ArchitectureCategory;
  /** The closed enum of valid `chosen` values for this category. */
  alternatives: readonly string[];
  detect(scan: CodebaseScan, scope?: { pathGlob: string }): DetectedArchitectureChoice;
}
