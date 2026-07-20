import type { CodeViolation, DatabaseDetectionResult } from '@truecourse/shared'

/**
 * One file to scan, pre-resolved by the caller so the worker never has to
 * re-implement the pipeline's path/key logic.
 */
export interface ScanFileInput {
  /**
   * The identity used for the produced violations (what the old in-thread loop
   * passed to `checkCodeRules` as `filePath`): the repo-relative path for a full
   * analyze, or the absolute path in changed-file (diff) mode.
   */
  filePath: string
  /** Absolute path the worker reads the file content from. */
  absPath: string
}

/**
 * Everything the deterministic scan needs. Every field is JSON-serializable so
 * the whole object can cross the worker boundary via `workerData`.
 */
export interface DeterministicScanInput {
  repoPath: string
  files: ScanFileInput[]
  /** Enabled deterministic code-rule keys (drives visitor selection + type/schema gating). */
  enabledRuleKeys: string[]
  /** Absolute paths of TS/JS files, for the whole-project TypeQuery program. */
  tsFiles: string[]
  /** Database detection result used to build the schema index (when schema-aware visitors are enabled). */
  databaseResult: DatabaseDetectionResult | undefined
  /** Resume point: index into `files` to start from (skips already-done files and any stalled one). */
  startIndex: number
}

/** Messages the worker posts back to the controller on the main thread. */
export type WorkerToMainMessage =
  /** Emitted immediately before a file is processed — arms/identifies the per-file watchdog. */
  | { type: 'file-start'; index: number; filePath: string }
  /** Emitted after a file's violations are computed. */
  | { type: 'file-result'; index: number; violations: CodeViolation[] }
  /** All files in this pass processed. */
  | { type: 'complete' }
  /** Fatal error inside the worker (setup or an unexpected throw). */
  | { type: 'error'; message: string }
