/**
 * Per-commit verify snapshots — the single home for ALL drift state in the hosted
 * edition. One row per (repo_key, commit_sha): the default-branch baseline, every
 * PR head, and every ad-hoc branch verify are all just snapshots here. The repo's
 * "baseline" is a pointer (`gh_baselines.commit_sha`) into this table; a PR view
 * diffs its head snapshot against the baseline snapshot (computed on read, not
 * stored). The gate writes only the PR-head row, so it can never touch the
 * baseline's — clobber-proof by key.
 *
 * `snapshot` holds the full VerifyState (drifts, counts, unresolved refs, branch,
 * changedFiles); `drift_count` + `by_severity` are denormalized for the cheap
 * drift-trend query (baseline snapshots over time) without parsing the payload.
 *
 * `is_baseline` marks the default-branch runs: the current baseline is the latest
 * `is_baseline` row, and the drift trend is all of them over time. PR-head rows
 * stay `false`, so they're excluded from both — no PR pollutes the baseline view.
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

export const verifySnapshots = pgTable(
  'verify_snapshots',
  {
    repoKey: text('repo_key').notNull(),
    commitSha: text('commit_sha').notNull(),
    branch: text('branch'),
    /** Full VerifyState: drifts, artifactCount, extractedOperationCount, unresolvedRefs, resolverErrors, changedFiles. */
    snapshot: jsonb('snapshot').$type<unknown>().notNull(),
    /** Denormalized for the trend query (avoids parsing `snapshot`). */
    driftCount: integer('drift_count').notNull(),
    bySeverity: jsonb('by_severity').$type<Record<string, number>>().notNull(),
    /** True for default-branch (baseline) runs — see file header. */
    isBaseline: boolean('is_baseline').notNull().default(false),
    verifiedAt: ts('verified_at').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.repoKey, t.commitSha] }),
    index('verify_snapshots_repo_verified_idx').on(t.repoKey, t.verifiedAt),
    index('verify_snapshots_baseline_idx').on(t.repoKey, t.isBaseline, t.verifiedAt),
  ],
);
