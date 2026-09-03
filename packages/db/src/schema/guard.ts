/**
 * Guard tables for the hosted edition — the Postgres home for `truecourse guard`,
 * mirroring the verify + contract conventions:
 *
 *   guard_runs          — one row per (repo_key, commit_sha): every `guard run`
 *                         snapshot. The default-branch runs mark `is_baseline`, so
 *                         the current run state is the latest baseline row and the
 *                         run trend is all baseline rows over time (verify's model).
 *                         The full `GuardLatest` lives in `snapshot`; `summary`
 *                         (denormalized counts) + `run_id` + `branch` are lifted out
 *                         for cheap trend / by-runId queries without parsing it.
 *                         `evidence` is the per-run manifest `{ "<scenarioId>/<file>":
 *                         contentSha }` into the content pool (scope guard-evidence).
 *   guard_results       — one row per (repo_key, commit_sha): the last `guard
 *                         generate` report (the run-result the dashboard reads back).
 *   guard_scenario_sets — content-addressed manifest of the committable `scenarios/`
 *                         tree (yaml + recipe.json + manifest.json), exactly like
 *                         `contract_sets`: bodies live once in `content` (scope
 *                         guard), this holds the `{ relPath: sha }` map.
 *
 * The mutable guard decisions ledger (`dismissedClaims`) is NOT here — it reuses the
 * generic `decisions` table under a `guard:<repoKey>` (+ `#pr/<n>` overlay) scope,
 * mirroring how the spec store routes its decisions.
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const guardRuns = pgTable(
  'guard_runs',
  {
    repoKey: text('repo_key').notNull(),
    commitSha: text('commit_sha').notNull(),
    branch: text('branch'),
    /** The run's id (`<iso>_<short>`), also the evidence-dir key — indexed for readGuardRun. */
    runId: text('run_id').notNull(),
    /** Full `GuardLatest`: run envelope, summary, per-scenario results, section rollups. */
    snapshot: jsonb('snapshot').$type<unknown>().notNull(),
    /** Denormalized `GuardSummary` counts for the run trend (avoids parsing `snapshot`). */
    summary: jsonb('summary').$type<unknown>().notNull(),
    /** Per-run evidence manifest `{ "<scenarioId>/<file>": 'sha256-…' }` into `content`. */
    evidence: jsonb('evidence').$type<unknown>().notNull().default({}),
    /** True for default-branch runs — the baseline / trend selector (see file header). */
    isBaseline: boolean('is_baseline').notNull().default(false),
    ranAt: ts('ran_at').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.repoKey, t.commitSha] }),
    index('guard_runs_repo_ran_idx').on(t.repoKey, t.ranAt),
    index('guard_runs_baseline_idx').on(t.repoKey, t.isBaseline, t.ranAt),
    index('guard_runs_repo_run_idx').on(t.repoKey, t.runId),
  ],
);

export const guardResults = pgTable(
  'guard_results',
  {
    repoKey: text('repo_key').notNull(),
    commitSha: text('commit_sha').notNull(),
    /** Full `GuardGenerateReport` — the last `guard generate` run-result. */
    report: jsonb('report').$type<unknown>().notNull(),
    /**
     * Birth-finding evidence manifest `{ "<scenarioSeg>/<file>": 'sha256-…' }` into
     * `content` (scope guard-evidence). A birth run is `persist: false`, so it never
     * creates a `guard_runs` row — its transcripts hang off the generate report here,
     * copied out of the (ephemeral) checkout by the EE generate jobs.
     */
    evidence: jsonb('evidence').$type<unknown>().notNull().default({}),
    generatedAt: ts('generated_at').notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoKey, t.commitSha] })],
);

export const guardScenarioSets = pgTable(
  'guard_scenario_sets',
  {
    repoKey: text('repo_key').notNull(),
    commitSha: text('commit_sha').notNull(),
    /** `{ v: 1, files: { relPath: 'sha256-…' } }` — the scenario tree's content manifest. */
    manifest: jsonb('manifest').$type<unknown>().notNull(),
    /** sha256 over the canonical (sorted) manifest — stable set identity. */
    manifestHash: text('manifest_hash').notNull(),
    fileCount: integer('file_count').notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoKey, t.commitSha] })],
);
