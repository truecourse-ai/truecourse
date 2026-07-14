/**
 * Guard scenario format v1 — the committed, declarative test that binds a spec
 * section to executable behavior. One YAML file per scenario under
 * `.truecourse/scenarios/<area>/`.
 *
 * The envelope (`guard`, `id`, `title`, `binds`, `driver`, `setup`, `steps`,
 * `normalize`) is frozen across drivers; only the per-driver verb sub-schema
 * (keyed by `driver`) grows. v1 ships the `cli` driver: a `run` argv appended to
 * the recipe entrypoint, with `expect` matchers on exit code, streams, and files.
 */

import { z } from 'zod'

/** Scenario format version carried in every file and echoed into the run store. */
export const GUARD_FORMAT_VERSION = 1

// --- Stream & file matchers -----------------------------------------

/** Stream (stdout/stderr) matcher — one of the three, compared post-normalization. */
export const GuardStreamMatcherSchema = z
  .object({
    equals: z.string().optional(),
    contains: z.string().optional(),
    /** Regex source; matched with `RegExp(pattern).test(stream)`. */
    matches: z.string().optional(),
  })
  .strict()
  .refine(
    (m) => m.equals !== undefined || m.contains !== undefined || m.matches !== undefined,
    { message: 'stream matcher needs one of equals | contains | matches' },
  )

/** File matcher — presence or content of a path under the sandbox cwd. */
export const GuardFileMatcherSchema = z
  .object({
    exists: z.boolean().optional(),
    absent: z.boolean().optional(),
    equals: z.string().optional(),
    contains: z.string().optional(),
  })
  .strict()
  .refine(
    (m) =>
      m.exists !== undefined ||
      m.absent !== undefined ||
      m.equals !== undefined ||
      m.contains !== undefined,
    { message: 'file matcher needs one of exists | absent | equals | contains' },
  )

export const GuardExpectSchema = z
  .object({
    exit: z.number().int().optional(),
    stdout: GuardStreamMatcherSchema.optional(),
    stderr: GuardStreamMatcherSchema.optional(),
    /** Sandbox-relative path → matcher. */
    files: z.record(z.string(), GuardFileMatcherSchema).optional(),
  })
  .strict()

// --- Steps ----------------------------------------------------------

export const GuardStepSchema = z
  .object({
    /** Argv appended to the recipe entrypoint. May be empty (run the bare entry). */
    run: z.array(z.string()),
    stdin: z.string().optional(),
    /** Run the step N times; every iteration must satisfy `expect`. Default 1. */
    repeat: z.number().int().positive().optional(),
    expect: GuardExpectSchema,
  })
  .strict()

// --- The closed normalizer set --------------------------------------

export const GuardNormalizerSchema = z.enum([
  'timestamps',
  'abs-paths',
  'versions',
  'durations',
])

// --- Setup capabilities (world-state vocabulary) --------------------

/**
 * One commit in a declared git history: stage `files` and commit them. Every
 * path must already exist in the sandbox — seeded by `setup.files` or created by
 * an earlier commit. The engine materializes the commit with pinned
 * author/committer/date, so declaring the same history twice yields the same
 * commit hash.
 */
export const GuardGitCommitSchema = z
  .object({
    /** Sandbox-relative paths to stage for this commit; each must already exist. */
    files: z.array(z.string()).min(1),
    /** Commit message; a fixed constant is used when omitted. */
    message: z.string().optional(),
  })
  .strict()

/**
 * Declarative git world-state a scenario needs. Presence of the block — even an
 * empty `git: {}` — means "initialize a repo in the sandbox cwd". The scenario
 * declares WHAT the repo looks like (its commits, its staged working-index, its
 * branch); the engine's git provider materializes it deterministically after
 * `setup.files` seeding. There is no HOW here — no commands, no shell.
 */
export const GuardGitSchema = z
  .object({
    /** Ordered commit history, built after `setup.files` are seeded. */
    commits: z.array(GuardGitCommitSchema).optional(),
    /** Paths staged but left uncommitted (the working index), applied after all commits. */
    staged: z.array(z.string()).optional(),
    /** Initial branch name; defaults to `main`. */
    branch: z.string().optional(),
  })
  .strict()

// --- Setup & binding ------------------------------------------------

export const GuardSetupSchema = z
  .object({
    /** Declarative sandbox seeding: sandbox-relative path → file content. */
    files: z.record(z.string(), z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    /**
     * The `git` setup capability — declare a git repo (commits, staged files,
     * branch) the test needs. Optional and additive: scenarios without it are
     * unaffected. See {@link GuardGitSchema}.
     */
    git: GuardGitSchema.optional(),
  })
  .strict()

export const GuardBindsSchema = z
  .object({
    /** Repo-relative path of the spec document. */
    doc: z.string().min(1),
    /** Slugified heading path (the section anchor). */
    section: z.string().min(1),
    /** `sha256:…` over the normalized section text. */
    fingerprint: z.string().min(1),
  })
  .strict()

// --- The scenario ---------------------------------------------------

export const GuardScenarioSchema = z
  .object({
    guard: z.literal(GUARD_FORMAT_VERSION),
    id: z.string().min(1),
    /** Restates the section's claim in one line. */
    title: z.string().min(1),
    binds: GuardBindsSchema,
    driver: z.literal('cli'),
    setup: GuardSetupSchema.optional(),
    steps: z.array(GuardStepSchema).min(1),
    normalize: z.array(GuardNormalizerSchema).default([]),
  })
  .strict()

export type GuardStreamMatcher = z.infer<typeof GuardStreamMatcherSchema>
export type GuardFileMatcher = z.infer<typeof GuardFileMatcherSchema>
export type GuardExpect = z.infer<typeof GuardExpectSchema>
export type GuardStep = z.infer<typeof GuardStepSchema>
export type GuardNormalizer = z.infer<typeof GuardNormalizerSchema>
export type GuardGitCommit = z.infer<typeof GuardGitCommitSchema>
export type GuardGit = z.infer<typeof GuardGitSchema>
export type GuardSetup = z.infer<typeof GuardSetupSchema>
export type GuardBinds = z.infer<typeof GuardBindsSchema>
export type GuardScenario = z.infer<typeof GuardScenarioSchema>
