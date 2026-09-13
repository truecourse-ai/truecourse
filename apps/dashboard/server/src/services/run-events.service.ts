/**
 * Every run-record write, as one frame on the workspace's live stream.
 *
 * The sessions store already announces each committed write — its own and the
 * ones other replicas `pg_notify`. A repository's runs reached the browser
 * through that repository's socket room; a run of the WORKSPACE (a Document
 * scan) has no room, so between two job frames nothing told the page that a
 * session had started, finished, or moved. This relay is the missing signal:
 * one `run.changed` per run onto `/api/events`, which every page already holds
 * open.
 *
 * A busy run writes many events per second, so announcements are THROTTLED per
 * run: the first is relayed at once (the page moves immediately) and anything
 * that lands inside the window costs exactly one more frame at its end.
 */

import { workspaceOfSessionsKey } from '@truecourse/core/lib/sessions-store';
import { log } from '@truecourse/core/lib/logger';
import type { ServerEvent } from '@truecourse/shared';

/** One relay per run per window; a leading frame keeps the page prompt. */
const WINDOW_MS = 500;

export interface RunChangeRelayDeps {
  /** The store's announcements: every committed record write. */
  subscribe(notify: (repoKey: string, runId: string) => void): () => void;
  /** The workspace a repository's runs belong to, null when nothing links it. */
  workspaceOf(repoKey: string): Promise<string | null>;
  publish(orgId: string, event: ServerEvent): Promise<void>;
}

interface Window {
  timer: ReturnType<typeof setTimeout>;
  /** The key of an announcement that landed inside the window, if any. */
  pending: string | null;
}

/** Start the relay; the returned function stops it. */
export function startRunChangeRelay(
  deps: RunChangeRelayDeps,
  windowMs: number = WINDOW_MS,
): () => void {
  const windows = new Map<string, Window>();

  const publish = (repoKey: string, runId: string): void => {
    void (async () => {
      const org = workspaceOfSessionsKey(repoKey) ?? (await deps.workspaceOf(repoKey));
      // A repository no workspace connected has nobody to tell.
      if (!org) return;
      await deps.publish(org, { type: 'run.changed', runId, repoKey });
    })().catch((err: unknown) => {
      log.warn(`[runs] could not relay ${runId}: ${(err as Error).message}`);
    });
  };

  const closeWindow = (runId: string): void => {
    const window = windows.get(runId);
    if (!window) return;
    if (window.pending === null) {
      windows.delete(runId);
      return;
    }
    const repoKey = window.pending;
    window.pending = null;
    publish(repoKey, runId);
    window.timer = setTimeout(() => closeWindow(runId), windowMs);
    window.timer.unref?.();
  };

  const stop = deps.subscribe((repoKey, runId) => {
    const window = windows.get(runId);
    if (window) {
      window.pending = repoKey;
      return;
    }
    publish(repoKey, runId);
    const timer = setTimeout(() => closeWindow(runId), windowMs);
    timer.unref?.();
    windows.set(runId, { timer, pending: null });
  });

  return () => {
    stop();
    for (const window of windows.values()) clearTimeout(window.timer);
    windows.clear();
  };
}
