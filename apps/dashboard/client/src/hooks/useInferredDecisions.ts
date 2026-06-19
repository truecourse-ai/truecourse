import { useEffect, useState } from 'react';
import type { GithubInferredResponse, InferredDiffResponse, InferredDecisionView } from '@truecourse/shared';
import { getServerUrl } from '@/lib/server-url';

export const inferredKey = (d: InferredDecisionView) => `${d.kind} ${d.identity}`;

export interface InferredDecisions {
  decisions: InferredDecisionView[] | null;
  dismissed: InferredDecisionView[];
  error: string | null;
  busyKey: string | null;
  /** PR view: the list is the PR delta (added + changed), read-only — no actions. */
  diffMode: boolean;
  /** Promote / dismiss a decision; drops it from the active set on success. Returns ok. */
  act: (d: InferredDecisionView, action: 'dismiss' | 'promote') => Promise<boolean>;
  /** Un-dismiss a decision — moves it back from the dismissed list to active. */
  restore: (d: InferredDecisionView) => Promise<void>;
}

/**
 * Owns the repo's inferred-decision set so the sidebar list and the main-pane
 * detail (rendered in different parts of the tree) share one source. Reads the
 * shared `/api/repos/:id/inferred` route — identical in OSS and EE. In diff mode
 * the list becomes the delta (added + changed, review-only): EE reads the PR diff
 * (`prRef` = the head sha → GET), OSS runs the working-tree diff (`ossDiff` → POST,
 * re-infer vs the committed `inferredDecisions.json` baseline).
 */
export function useInferredDecisions(
  repoId: string,
  enabled = true,
  prRef?: string,
  ossDiff = false,
): InferredDecisions {
  const [decisions, setDecisions] = useState<InferredDecisionView[] | null>(null);
  const [dismissed, setDismissed] = useState<InferredDecisionView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const base = `${getServerUrl()}/api/repos/${encodeURIComponent(repoId)}/inferred`;
  const diffMode = !!prRef || ossDiff;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const showDiff = (d: InferredDiffResponse) =>
      !cancelled &&
      setDecisions([
        ...d.added,
        ...d.changed.map((x) => ({ ...x, changed: true })),
        ...(d.resolved ?? []).map((x) => ({ ...x, resolved: true })),
      ]);
    if (prRef || ossDiff) {
      // Diff delta: added + changed (tagged), review-only. No dismissed section.
      // EE = GET the PR diff at the head sha; OSS = POST to run the working-tree diff.
      const req = prRef
        ? fetch(`${base}/diff?ref=${encodeURIComponent(prRef)}`, { credentials: 'include' })
        : fetch(`${base}/diff`, { method: 'POST', credentials: 'include' });
      req
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Request failed (${r.status})`))))
        .then(showDiff)
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
      return () => {
        cancelled = true;
      };
    }
    fetch(base, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Request failed (${r.status})`))))
      .then((d: GithubInferredResponse) => {
        if (!cancelled) setDecisions(d.decisions);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    fetch(`${base}/dismissed`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Request failed (${r.status})`))))
      .then((d: GithubInferredResponse) => {
        if (!cancelled) setDismissed(d.decisions);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [base, enabled, prRef, ossDiff]);

  const act = async (d: InferredDecisionView, action: 'dismiss' | 'promote'): Promise<boolean> => {
    if (busyKey) return false;
    setBusyKey(inferredKey(d));
    setError(null);
    try {
      const r = await fetch(`${base}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: d.kind, identity: d.identity }),
      });
      if (!r.ok) {
        const msg = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(msg.error || `${action} failed (${r.status})`);
      }
      setDecisions((cur) => (cur ?? []).filter((x) => !(x.kind === d.kind && x.identity === d.identity)));
      if (action === 'dismiss') setDismissed((cur) => [...cur, d]);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const restore = async (d: InferredDecisionView): Promise<void> => {
    if (busyKey) return;
    setBusyKey(inferredKey(d));
    setError(null);
    try {
      const r = await fetch(`${base}/restore`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: d.kind, identity: d.identity }),
      });
      if (!r.ok) {
        const msg = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(msg.error || `restore failed (${r.status})`);
      }
      setDismissed((cur) => cur.filter((x) => !(x.kind === d.kind && x.identity === d.identity)));
      setDecisions((cur) => [...(cur ?? []), d]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  return { decisions, dismissed, error, busyKey, diffMode, act, restore };
}
