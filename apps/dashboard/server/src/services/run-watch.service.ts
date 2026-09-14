/**
 * The live follow of a repository's RUNS LIST: the store announces every run
 * record it commits, and this service debounces those announcements into one
 * "re-read your runs" per room, so a page watching a repository sees a run
 * start, move and settle without a refresh.
 *
 * Watches are refcounted per repository: the first viewer starts one, the last
 * one leaving stops it.
 */

import { subscribeStoredSessionRuns } from '@truecourse/core/lib/sessions-store';

interface RunsWatch {
  stop: () => void;
  refs: number;
  pending?: ReturnType<typeof setTimeout>;
}

const runsWatches = new Map<string, RunsWatch>();

const RUNS_DEBOUNCE_MS = 250;

/** Start (or join) a repository's runs watch. Pair every acquire with a release. */
export function acquireRunsWatch(repoPath: string, onChange: () => void): void {
  const existing = runsWatches.get(repoPath);
  if (existing) {
    existing.refs++;
    return;
  }
  const entry: RunsWatch = { stop: () => {}, refs: 1 };
  entry.stop = subscribeStoredSessionRuns(repoPath, () => {
    clearTimeout(entry.pending);
    entry.pending = setTimeout(onChange, RUNS_DEBOUNCE_MS);
  });
  runsWatches.set(repoPath, entry);
}

/** Release one hold on a repository's runs watch; the last release stops it. */
export function releaseRunsWatch(repoPath: string): void {
  const entry = runsWatches.get(repoPath);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0) return;
  runsWatches.delete(repoPath);
  clearTimeout(entry.pending);
  entry.stop();
}

/** Stop every watch — shutdown, so a lingering subscription cannot hold the process. */
export function stopAllRunsWatches(): void {
  for (const entry of runsWatches.values()) {
    clearTimeout(entry.pending);
    entry.stop();
  }
  runsWatches.clear();
}
