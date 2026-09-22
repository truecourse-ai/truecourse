/**
 * Guard tables — the Postgres home for the guard pipeline. Everything a run
 * produces is a SERIES, never a row that is overwritten: a new row per
 * producing run, with the current one being the newest of its series. A series
 * is addressed by `scope` — `default` for the default branch, a scope of its
 * own for a pull request's versions — and every version says which session
 * run produced it (`produced_by_run`) and on which `model`.
 *
 *   guard_runs          — one row per run (`run_id`): every `guard run`
 *                         snapshot. The current run state of a scope is its
 *                         newest row and the run trend is its rows over time; a
 *                         rerun at a commit is a new row beside the old one.
 *                         The full `GuardLatest` lives in `snapshot`; `summary`
 *                         (denormalized counts) + `branch` are lifted out for
 *                         cheap trend queries without parsing it. `evidence` is
 *                         the per-run manifest `{ "<scenarioId>/<file>":
 *                         contentSha }` into the content pool (scope guard-evidence).
 *   guard_results       — one row per `guard generate`: the report the
 *                         dashboard reads back, newest of the scope first.
 *   guard_scenario_sets — one row per generate: the content-addressed manifest
 *                         of the `scenarios/` tree (yaml + recipe.json +
 *                         manifest.json). Bodies live once in `content` (scope
 *                         guard); this holds the `{ relPath: sha }` map.
 *   guard_setup_sets    — the same shape for what `guard setup` leaves behind, so a
 *                         hosted run's settle spine survives its ephemeral clone.
 *
 * The mutable guard decisions ledger (`dismissedClaims`) is NOT here — it reuses the
 * generic `decisions` table under a `guard:<repoKey>` scope, one row per repository.
 */

import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

/** The columns every versioned row carries: its series and its provenance. */
const versioned = {
  /** The series: `default` for the default branch, a pull request's own otherwise. */
  scope: text('scope').notNull().default('default'),
  /** The session run that produced the row, when one did. */
  producedByRun: text('produced_by_run'),
  /** The model that run was on, when one was. */
  model: text('model'),
};

export const guardRuns = pgTable(
  'guard_runs',
  {
    repoKey: text('repo_key').notNull(),
    commitSha: text('commit_sha').notNull(),
    branch: text('branch'),
    /** The run's id (`<iso>_<short>`), also the evidence-dir key. */
    runId: text('run_id').notNull(),
    /** Full `GuardLatest`: run envelope, summary, per-scenario results, section rollups. */
    snapshot: jsonb('snapshot').$type<unknown>().notNull(),
    /** Denormalized `GuardSummary` counts for the run trend (avoids parsing `snapshot`). */
    summary: jsonb('summary').$type<unknown>().notNull(),
    /** Per-run evidence manifest `{ "<scenarioId>/<file>": 'sha256-…' }` into `content`. */
    evidence: jsonb('evidence').$type<unknown>().notNull().default({}),
    /**
     * The run's SECTION SUMMARY `{ "<docRef>#<anchor>": status }`, what every
     * section the run's scenario set covered was worth at that moment, written
     * beside the snapshot when the run is persisted. Null for a run whose
     * summary could not be derived, which Home's trend leaves out.
     */
    sections: jsonb('sections').$type<unknown>(),
    /**
     * The run's FLOW SUMMARY `{ "<flowId>": status }`, what every flow of the
     * repository was worth at that moment, written beside `sections`. It is
     * what Home's trend counts. Null for a run stored before flows were
     * recorded, and for one whose flow corpus could not be read.
     */
    flows: jsonb('flows').$type<unknown>(),
    ...versioned,
    ranAt: ts('ran_at').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.repoKey, t.runId] }),
    index('guard_runs_repo_ran_idx').on(t.repoKey, t.ranAt),
    index('guard_runs_scope_idx').on(t.repoKey, t.scope, t.commitSha, t.ranAt),
  ],
);

export const guardResults = pgTable(
  'guard_results',
  {
    id: text('id').primaryKey(),
    repoKey: text('repo_key').notNull(),
    commitSha: text('commit_sha').notNull(),
    /** Full `GuardGenerateReport` — one `guard generate` run-result. */
    report: jsonb('report').$type<unknown>().notNull(),
    /**
     * Birth-finding evidence manifest `{ "<scenarioSeg>/<file>": 'sha256-…' }` into
     * `content` (scope guard-evidence). A birth run is `persist: false`, so it never
     * creates a `guard_runs` row — its transcripts hang off the generate report here,
     * copied out of the ephemeral clone by the `repo.guard-generate` job.
     */
    evidence: jsonb('evidence').$type<unknown>().notNull().default({}),
    ...versioned,
    /**
     * The scenario set this report was written beside: the newest set of the
     * same scope at the same commit when the report was stored. Null for a
     * report a blocked generate stored with no set. A rollback of a set copies
     * the report paired with it, so the two series stay in step.
     */
    scenarioSetId: text('scenario_set_id'),
    /** The report this one is a rollback's copy of, when it is one. */
    restoredFrom: text('restored_from'),
    generatedAt: ts('generated_at').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('guard_results_scope_idx').on(t.repoKey, t.scope, t.commitSha, t.createdAt)],
);

/**
 * The `guard setup` bundle — what a setup run leaves in a repo (`guard/setup.json`,
 * the findings ledger, the recipe, the dependency catalog + settle record, the seed
 * script, the generated compose file), content-addressed exactly like
 * `guard_scenario_sets`. A hosted run's working tree is an ephemeral clone, so this
 * is what carries setup's per-step settle spine forward from commit to commit.
 */
export const guardSetupSets = pgTable(
  'guard_setup_sets',
  {
    id: text('id').primaryKey(),
    repoKey: text('repo_key').notNull(),
    commitSha: text('commit_sha').notNull(),
    /** `{ v: 1, files: { relPath: 'sha256-…' } }` — the bundle's content manifest. */
    manifest: jsonb('manifest').$type<unknown>().notNull(),
    /** sha256 over the canonical (sorted) manifest — stable bundle identity. */
    manifestHash: text('manifest_hash').notNull(),
    fileCount: integer('file_count').notNull(),
    ...versioned,
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('guard_setup_sets_scope_idx').on(t.repoKey, t.scope, t.commitSha, t.createdAt)],
);

export const guardScenarioSets = pgTable(
  'guard_scenario_sets',
  {
    id: text('id').primaryKey(),
    repoKey: text('repo_key').notNull(),
    commitSha: text('commit_sha').notNull(),
    /** `{ v: 1, files: { relPath: 'sha256-…' } }` — the scenario tree's content manifest. */
    manifest: jsonb('manifest').$type<unknown>().notNull(),
    /** sha256 over the canonical (sorted) manifest — stable set identity. */
    manifestHash: text('manifest_hash').notNull(),
    fileCount: integer('file_count').notNull(),
    ...versioned,
    /** The version this one is a rollback's copy of, when it is one. */
    restoredFrom: text('restored_from'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('guard_scenario_sets_scope_idx').on(t.repoKey, t.scope, t.commitSha, t.createdAt)],
);

/**
 * The supplied-dependency OVERLAYS of a hosted repo — what a working tree keeps
 * in the gitignored `scenarios/dependencies.local.json` and
 * `scenarios/externals.local.json`: the registered instances (API keys, base
 * URLs, tokens, headers). One row per repo, both overlays as ONE JSON blob
 * encrypted under the deployment's master secret, decrypted only to materialize
 * into a run's ephemeral clone. Deliberately not content-addressed: a secret must
 * never sit in the shared `content` pool.
 */
export const guardDependencyOverlays = pgTable('guard_dependency_overlays', {
  repoKey: text('repo_key').primaryKey(),
  /** `encryptSecret(JSON.stringify({ dependencies, externals }))`. */
  overlaysEnc: text('overlays_enc').notNull(),
  updatedAt: ts('updated_at').notNull(),
});
