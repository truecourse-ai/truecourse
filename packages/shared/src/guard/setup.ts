/**
 * `guard/setup.json` — the persisted record of the last `truecourse guard setup`.
 * GITIGNORED and derived: every fact in it is re-derivable from the
 * working tree, and the durable artifacts setup produces (`recipe.json`, the seed
 * script, `scenarios/externals.local.json`) live where they always did.
 *
 * It exists for two reasons only:
 *  1. DETECTION IS EXPENSIVE-ISH AND SHARED. The externals view used to read the
 *     detected third-party list out of `guard/result.json` — i.e. it could only
 *     answer "what does this repo talk to" AFTER a full generate. Setup detects the
 *     same list for free (one `mapJourneys` pass) and records it here, so the
 *     External APIs surfaces work before the first generate. `result.json` stays
 *     generate's own artifact.
 *  2. `guard status` needs a first-class setup row — what ran, what passed, and what
 *     is still to do — without re-booting the app to find out.
 */

import { z } from 'zod'
import { DetectedExternalServiceSchema } from '../external-services.js'
import { DatastoreUrlRefSchema } from '../types/analysis.js'

/** How a single setup step ended. `skipped` always carries a `reason`. */
export const GuardSetupStepStatusSchema = z.enum(['ok', 'skipped', 'failed'])
export type GuardSetupStepStatus = z.infer<typeof GuardSetupStepStatusSchema>

// ---------------------------------------------------------------------------
// The step taxonomy (the `steps` spine)
// ---------------------------------------------------------------------------

/**
 * The setup taxonomy, in run order. `externals` folded INTO `catalog` (the
 * skeleton write runs inside that step); `auth` is a new step of the rebuilt
 * setup. The legacy top-level `recipe`/`externals`/`seed` report fields stay
 * populated for back-compat — the `steps` array is the new spine.
 */
export const GuardSetupTaxonomyKeySchema = z.enum(['recipe', 'detect', 'catalog', 'seed', 'auth'])
export type GuardSetupTaxonomyKey = z.infer<typeof GuardSetupTaxonomyKeySchema>

/**
 * ONE row of the `steps` spine: what the step did this run, and the input
 * fingerprint it settled on. Skip-when-settled reads the fingerprint: a re-run
 * whose freshly computed fingerprint matches a settled row's skips the step
 * (`status: 'skipped'`, `reason: 'unchanged'`); `--refresh` forces every step.
 *
 * `blocked` is legal ONLY on `auth` (a supplied credential waiting on a user
 * registration) — loud, actionable, and never a reason to fail setup.
 */
export const GuardSetupTaxonomyStepSchema = z
  .object({
    key: GuardSetupTaxonomyKeySchema,
    status: z.enum(['ok', 'skipped', 'failed', 'blocked']),
    /**
     * sha256 over the step's inputs, computed over the tree AS THE STEP LEFT
     * IT — a step that writes (the catalog's skeleton, the seed's script)
     * records the post-write state, so an unchanged re-run computes the same
     * value and skips. Empty for a step with no fingerprint (detect is free
     * and always runs).
     */
    inputFingerprint: z.string(),
    reason: z.string().optional(),
    /** The sessions-store run that carried this step's agent sessions, if any. */
    sessionRunId: z.string().optional(),
  })
  .strict()
  .superRefine((step, ctx) => {
    if (step.status === 'blocked' && step.key !== 'auth') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'only the auth step may end `blocked` — every other step is ok/skipped/failed',
        path: ['status'],
      })
    }
  })
export type GuardSetupTaxonomyStep = z.infer<typeof GuardSetupTaxonomyStepSchema>

/**
 * ONE declared api server's live endpoint probe (step 1). The pass bar is
 * deliberately generous: ANY HTTP status is a pass, 401 and 404 included — a 404
 * means the route table moved, not that the recipe is broken. Only a boot failure,
 * a thrown fetch (connection refused / timeout), or 5xx on every probed path fails.
 */
export const GuardSetupServerProbeSchema = z
  .object({
    /** The `api.servers` key (or `default` for the single-server shape). */
    server: z.string(),
    /** The path that was called — the ranked health path, a static route, or the health path. */
    path: z.string(),
    /** HTTP status the server answered with; absent when nothing answered. */
    status: z.number().int().optional(),
    /** Why nothing answered (boot failure, connection refused, timeout, all-5xx). */
    error: z.string().optional(),
    /** False only for the three real failures above. */
    ok: z.boolean(),
  })
  .strict()
export type GuardSetupServerProbe = z.infer<typeof GuardSetupServerProbeSchema>

/** Step 1 — the recipe, the only hard gate. */
export const GuardSetupRecipeStepSchema = z
  .object({
    status: GuardSetupStepStatusSchema,
    reason: z.string().optional(),
    /** `exists` when a committed recipe was reused, `discovered` when one was written. */
    outcome: z.enum(['exists', 'discovered']).optional(),
    /** Which proposer produced a freshly discovered recipe. */
    source: z.enum(['deterministic', 'llm']).optional(),
    /** Repo-relative path of a freshly written recipe. */
    wrotePath: z.string().optional(),
    /** The generated datastore compose file, when discovery wrote one. */
    composePath: z.string().optional(),
    /** Fill-ins discovery could not decide — printed, never silently dropped. */
    todos: z.array(z.string()).optional(),
    /** The per-server live endpoint probes; empty for a cli-only recipe. */
    probes: z.array(GuardSetupServerProbeSchema).optional(),
  })
  .strict()
export type GuardSetupRecipeStep = z.infer<typeof GuardSetupRecipeStepSchema>

/** Step 3 — the externals declaration skeleton. SOFT: it never blocks. */
export const GuardSetupExternalsStepSchema = z
  .object({
    status: GuardSetupStepStatusSchema,
    reason: z.string().optional(),
    /** Services whose declaration this run ADDED to `api.externals`. */
    declared: z.array(z.string()),
    /** Services already declared before this run — left byte-identical. */
    alreadyDeclared: z.array(z.string()),
    /**
     * Detected services that could NOT be declared: detection saw no base-URL
     * override variable for them, and `baseUrlEnv` is required — a fabricated
     * variable name would be injected into the app's env on every run.
     */
    undeclarable: z.array(z.string()),
    /** Services with a declaration but no resolvable value yet (the honest to-do list). */
    unprovided: z.array(z.string()),
  })
  .strict()
export type GuardSetupExternalsStep = z.infer<typeof GuardSetupExternalsStepSchema>

/** Step 4 — the one seed covering data AND auth. */
export const GuardSetupSeedStepSchema = z
  .object({
    status: GuardSetupStepStatusSchema,
    reason: z.string().optional(),
    /** `exists` when the recipe already declared one and no refresh was asked for. */
    outcome: z.enum(['exists', 'drafted']).optional(),
    /** Repo-relative path of the drafted (or declared) seed script. */
    scriptPath: z.string().optional(),
    /** The `api.seed.command`. */
    command: z.string().optional(),
    /** Fixture names the seed provides. */
    fixtures: z.array(z.string()).optional(),
    /** Credential names the seed mints — one principal per detected role. */
    credentials: z.array(z.string()).optional(),
    /** The session died without an outcome; the engine folded its last verified draft. */
    salvaged: z.boolean().optional(),
  })
  .strict()
export type GuardSetupSeedStep = z.infer<typeof GuardSetupSeedStepSchema>

/**
 * The whole record. `status` is `ok` when the HARD gate (step 1) held — the soft
 * steps report their own outcome and never demote the run.
 */
export const GuardSetupReportSchema = z
  .object({
    ranAt: z.string(),
    status: z.enum(['ok', 'failed']),
    /** For `failed`: the user-facing reason (step 0, 0.5, or the recipe gate). */
    reason: z.string().optional(),
    /**
     * THE STEP SPINE: one row per taxonomy step this run reached, in run order.
     * A run that fails at the recipe gate carries only the rows up to it. Old
     * records without the field read as an empty spine (nothing settled).
     */
    steps: z.array(GuardSetupTaxonomyStepSchema).default([]),
    recipe: GuardSetupRecipeStepSchema,
    externals: GuardSetupExternalsStepSchema.optional(),
    seed: GuardSetupSeedStepSchema.optional(),
    /**
     * The credential `satisfies` verdict against the corpus's OpenAPI schemes (item
     * 56). Reported HERE, where fixing it costs nothing; generate re-validates it
     * cheaply because specs can move between the two stages.
     */
    credentialSchemes: z
      .object({ errors: z.array(z.string()), warnings: z.array(z.string()) })
      .strict()
      .optional(),
    /**
     * THE DETECTION SNAPSHOT (step 2) — one `mapJourneys` pass, deterministic and
     * free. `readGuardExternalsView` reads its detected list from here.
     */
    detection: z
      .object({
        externalServices: z.array(DetectedExternalServiceSchema),
        /** The datastore family + driver, when one was detected. */
        database: z
          .object({ type: z.string(), driver: z.string(), tables: z.number().int().nonnegative() })
          .strict()
          .nullable(),
        datastoreUrls: z.array(DatastoreUrlRefSchema),
      })
      .strict()
      .optional(),
    /** LLM call/token/cost totals for the run — omitted when nothing was spent. */
    usage: z
      .object({
        calls: z.number().int().nonnegative(),
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        costUsd: z.number().nonnegative(),
        /**
         * The AGENT-SESSION share of the spend, in the loop's own units.
         * `BudgetSpent` counts turns and TOTAL tokens (no input/output split),
         * so it is recorded beside the one-shot fields rather than folded into
         * them — mapping total tokens onto `inputTokens` would be a lie the
         * cost column then repeats. `costUsd` above is the whole run
         * (one-shots + sessions); this block says how much of it was sessions.
         */
        sessions: z
          .object({
            count: z.number().int().nonnegative(),
            turns: z.number().int().nonnegative(),
            tokens: z.number().int().nonnegative(),
            costUsd: z.number().nonnegative(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type GuardSetupReport = z.infer<typeof GuardSetupReportSchema>
