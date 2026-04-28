import type { ZodType } from 'zod'
import type {
  FileAnalysis,
  Invariant,
  InvariantDraft,
  Violation,
} from '@truecourse/shared'

// ---------------------------------------------------------------------------
// Spec sources — pre-ingested per `suggest` run, passed to plugins
// ---------------------------------------------------------------------------

export interface SpecSection {
  /** Stable identifier — `FILE:<path>#<heading-slug>` for files. */
  id: string
  /** Origin connector: 'file' for v1; future: 'jira', 'linear', etc. */
  origin: 'file'
  /** Source path (or external URL) the section came from. */
  sourcePath: string
  /** Heading text or section label. */
  heading: string
  /** Raw section content (markdown for files). */
  content: string
  /** Stable hash of `content`; powers `--diff`. */
  contentHash: string
}

export interface SpecBundle {
  sections: SpecSection[]
  /** Paths searched during discovery; useful for the no-spec UX message. */
  searchedPaths: string[]
  /** True when no sections were found; consumers surface the explicit message. */
  empty: boolean
}

// ---------------------------------------------------------------------------
// LLM access exposed to plugins — narrowed surface, not the full provider
// ---------------------------------------------------------------------------

export interface LLMRunner {
  /**
   * Run a structured-output prompt against the centralized LLM provider.
   * Plugins ship the prompt text and a Zod schema; the framework owns
   * the spawn, concurrency limits, retries, and usage accounting.
   */
  run<T>(args: {
    prompt: string
    schema: ZodType<T>
    label: string
  }): Promise<T>
}

// ---------------------------------------------------------------------------
// Progress reporting — observable events for long-running pipelines
// ---------------------------------------------------------------------------

export type ProgressEvent =
  | { kind: 'start'; mode: SuggestMode }
  | { kind: 'spec-loaded'; sections: number; empty: boolean; searchedPaths: string[] }
  | { kind: 'files-analyzed'; count: number }
  | { kind: 'plugin-start'; plugin: string }
  | { kind: 'plugin-progress'; plugin: string; current: number; total: number; label: string }
  | { kind: 'plugin-end'; plugin: string; drafts: number; durationMs: number }
  | { kind: 'plugin-failed'; plugin: string; error: string }
  | { kind: 'done'; drafts: number; durationMs: number }

export type ProgressReporter = (e: ProgressEvent) => void

// ---------------------------------------------------------------------------
// Discover / Enforce contexts
// ---------------------------------------------------------------------------

export type SuggestMode = 'full' | 'diff'

export interface DiscoverDiff {
  changedFiles: string[]
  changedSpecSectionIds: string[]
}

export interface DiscoverContext {
  repoPath: string
  mode: SuggestMode
  diff?: DiscoverDiff
  files: FileAnalysis[]
  spec: SpecBundle
  existingInvariants: Invariant[]
  rejectedSignatures: Set<string>
  llm: LLMRunner
  /** Optional progress reporter — plugins emit `plugin-progress` events as they iterate. */
  report?: ProgressReporter
}

export interface EnforceContext {
  repoPath: string
  files: FileAnalysis[]
  /**
   * LLM access. Optional — undefined when the user opted out of LLM-powered
   * checks for this run (or LLM is disabled at config level). Plugins with
   * static enforcement ignore this field; plugins that need the LLM at
   * enforce time must check for `undefined` and skip cleanly (return [] +
   * one-line log).
   */
  llm?: LLMRunner
}

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

export interface PluginMetadata {
  /** Human label, e.g. "Spec-Code Drift". */
  name: string
  /** One-paragraph description of what the plugin detects. */
  description: string
  /** How `enforce` runs. Vocabulary matches the rule catalog's `RuleType`. */
  enforcement: 'deterministic' | 'llm' | 'mixed'
  /** Default severity used for emitted violations when not overridden. */
  defaultSeverity: 'critical' | 'high' | 'medium' | 'low' | 'info'
}

export interface InvariantEnforceEstimate {
  /** Number of LLM calls this invariant will make at enforce time (0 for static). */
  llmCalls: number
  /** Rough token estimate for those calls. 0 if no LLM calls. */
  estimatedTokens: number
  /**
   * Absolute paths of files this invariant will read at enforce time.
   * Used to deduplicate the displayed "files" count across the rule
   * pipeline and invariant enforcement (a file scanned by both shouldn't
   * count twice). Plugins that can't enumerate their files up front (e.g.
   * graph-walking static plugins) can leave this undefined.
   */
  filePaths?: string[]
}

/**
 * Token-estimate constants. Mirror the values used by the rule-LLM estimator
 * (`packages/core/src/services/llm/context-router.ts`) so the two cost
 * models stay comparable. CHARS_PER_TOKEN=4 is the standard rough conversion
 * for English / TypeScript source.
 */
export const TOKEN_ESTIMATE = {
  CHARS_PER_TOKEN: 4,
  /** Per-call: prompt template + system instructions. */
  PROMPT_OVERHEAD: 500,
  /** Per-call: structured response budget (LLM JSON output). */
  RESPONSE_OVERHEAD: 600,
} as const

/**
 * Context passed to `Plugin.estimateEnforce`. Plugins read on-disk content
 * (or the optional cached map) here so the cost is grounded in real file
 * sizes rather than a flat default.
 */
export interface EstimateContext {
  repoPath: string
  /**
   * Pre-loaded file contents keyed by absolute path, if the caller already
   * read them (e.g. analyze-core's pipeline). When absent, plugins fall
   * back to `fs.statSync` for a cheap size check.
   */
  fileContents?: Map<string, string>
}

export interface Plugin<I extends Invariant = Invariant> {
  readonly type: string
  readonly version: number
  readonly metadata: PluginMetadata
  /** Validates the `declaration` field of an invariant of this type. */
  readonly declarationSchema: ZodType<I['declaration']>

  discover(ctx: DiscoverContext): Promise<InvariantDraft[]>
  enforce(invariant: I, ctx: EnforceContext): Promise<Violation[]>

  /**
   * Optional: predict the LLM cost of enforcing this invariant. Used by the
   * pre-flight estimate prompt so users see the full token cost (rule LLM
   * + invariant LLM) before approving. Static plugins return zeros.
   */
  estimateEnforce?(invariant: I, ctx: EstimateContext): InvariantEnforceEstimate

  /**
   * Optional: declare whether an existing invariant's anchor still exists
   * (the field, route group, or spec section it targets). Drives the
   * "scope no longer exists; consider retiring" Stale variant.
   */
  checkAnchor?(invariant: I, ctx: DiscoverContext): 'present' | 'missing'

  /**
   * Optional: migrate a stored invariant from a previous plugin version.
   * Called when a stored invariant's pluginVersion is older than this
   * plugin's current version.
   */
  migrate?(invariant: unknown, fromVersion: number): I
}
