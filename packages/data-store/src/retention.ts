/**
 * How much of a SERIES is kept, stated as numbers rather than left to chance.
 *
 * Every generated artifact — a repository's scenario sets, generate reports and
 * setup bundles, a workspace's corpora and document snapshots — is a series
 * of versions per (owner, scope, artifact). A version survives while it is one
 * of the newest `keep` of its series OR younger than `keepDays`; a version that
 * is neither goes, and the content pool is then swept of every body no
 * surviving version (and no run) still references. Runs are never trimmed:
 * they are the history the trend is drawn from.
 *
 * Applied after every save to the series just written, and once at boot over
 * everything (`sweepStoredVersions`), which is what takes the orphans an
 * earlier deployment left in the pool.
 */
export const VERSION_RETENTION = {
  keep: 10,
  keepDays: 90,
} as const;

/**
 * Bodies younger than this are never swept. A save puts its bodies into the
 * pool BEFORE it inserts the version row that references them, so a sweep
 * running between the two would otherwise take them; an hour is far beyond
 * the widest such window.
 */
export const CONTENT_SWEEP_GRACE_MS = 60 * 60 * 1000;

/** The moment before which a version is old enough to be trimmed. */
export function retentionCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() - VERSION_RETENTION.keepDays * 24 * 60 * 60 * 1000).toISOString();
}

/** The moment before which a body is old enough to be swept. */
export function sweepCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() - CONTENT_SWEEP_GRACE_MS).toISOString();
}
