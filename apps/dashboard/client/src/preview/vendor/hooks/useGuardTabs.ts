// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/hooks/useGuardTabs.ts; delete with the preview.
/**
 * The reusable Guard main-pane tab model, the same transient/pinned tab model as
 * the Spec doc tabs (single-click opens a preview tab the next single-click
 * replaces; double-click pins; the tab bar and close buttons render like the
 * other viewers). Parameterised by the URL it mirrors so each Guard surface gets
 * its OWN addressable tab set from ONE reducer, never a second implementation:
 * the Runs tab passes `'result'`, the Flows tab a `?gflow` codec, and Coverage
 * passes a {@link GuardTabsParam} codec that binds TWO params (`?guard` docs +
 * `?gconf` conflicts) to one heterogeneous tab set.
 *
 * `deselect` clears the selection while the open tabs stay, what the strip's
 * pinned home tab calls.
 * Owned by Guard so no state is
 * shared with BL Drift's DriftViewContext (the no-bleed rule). Writes merge into
 * the existing query so sibling params (`?gsec` and the other tab set's param)
 * are preserved.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface GuardTab {
  id: string;
  pinned: boolean;
}

/**
 * How a tab set that spans MORE than one URL param reads/writes its active id.
 * A plain `param: string` covers the single-param case; a codec covers Coverage,
 * whose active tab is a doc (`?guard`) OR a conflict (`?gconf`).
 */
export interface GuardTabsParam {
  /** The active id from the current query, or null when nothing is selected. */
  read: (params: URLSearchParams) => string | null;
  /** Write the active id into `next` (a mutable copy of the query), clearing the
   *  sibling param(s) it owns while leaving unrelated params untouched. */
  write: (next: URLSearchParams, id: string | null) => void;
  /** Ids besides the active one a deep link should also materialize as pinned
   *  tabs (e.g. the `?guard` doc alongside an active `?gconf` conflict). */
  deepLinkTabs?: (params: URLSearchParams) => string[];
}

export interface GuardTabsState {
  /** The active id, or null when nothing is selected. */
  activeId: string | null;
  openTabs: GuardTab[];
  /** Single-click = transient preview (replaces the unpinned tab); double-click = pin. */
  open: (id: string, pinned: boolean) => void;
  close: (id: string) => void;
  /** Clear the selection, keeping the open tabs, the strip's home tab. */
  deselect: () => void;
}

export function useGuardTabs(param: string | GuardTabsParam, repoId: string | undefined): GuardTabsState {
  const [params, setParams] = useSearchParams();
  const isCodec = typeof param !== 'string';
  const activeId = isCodec ? param.read(params) : params.get(param);

  const [openTabs, setOpenTabs] = useState<GuardTab[]>(() =>
    activeId ? [{ id: activeId, pinned: true }] : [],
  );

  const setActive = useCallback(
    (id: string | null) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (isCodec) param.write(next, id);
        else if (id) next.set(param, id);
        else next.delete(param);
        return next;
      });
    },
    [setParams, param, isCodec],
  );

  const open = useCallback(
    (id: string, pinned: boolean) => {
      setOpenTabs((prev) => {
        const existing = prev.find((t) => t.id === id);
        if (existing) return prev.map((t) => (t.id === id ? { ...t, pinned: pinned || t.pinned } : t));
        if (pinned) return [...prev, { id, pinned: true }];
        const hasUnpinned = prev.find((t) => !t.pinned);
        if (hasUnpinned) return prev.map((t) => (!t.pinned ? { id, pinned: false } : t));
        return [...prev, { id, pinned: false }];
      });
      setActive(id);
    },
    [setActive],
  );

  const close = useCallback(
    (id: string) => {
      setOpenTabs((prev) => prev.filter((t) => t.id !== id));
      if (activeId === id) {
        const remaining = openTabs.filter((t) => t.id !== id);
        setActive(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
      }
    },
    [openTabs, activeId, setActive],
  );

  // Back/Forward + deep links: the active id (and any sibling deep-link ids the
  // codec surfaces) that the tab set doesn't know yet get a pinned tab, mirroring
  // how the inferred/spec viewers rehydrate from the URL.
  const deepLinkIds = isCodec ? param.deepLinkTabs?.(params) ?? [] : [];
  const deepKey = deepLinkIds.join('\x00');
  useEffect(() => {
    const ids = activeId ? [...new Set([...deepLinkIds, activeId])] : deepLinkIds;
    if (ids.length === 0) return;
    setOpenTabs((prev) => {
      const missing = ids.filter((id) => !prev.some((t) => t.id === id));
      return missing.length ? [...prev, ...missing.map((id) => ({ id, pinned: true }))] : prev;
    });
    // deepKey stands in for the deepLinkIds contents in the dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, deepKey]);

  // Reset the open tabs when switching repos, but keep an initial deep link on mount.
  const repoRef = useRef(repoId);
  useEffect(() => {
    if (repoRef.current === repoId) return;
    repoRef.current = repoId;
    setOpenTabs([]);
    setActive(null);
  }, [repoId, setActive]);

  const deselect = useCallback(() => setActive(null), [setActive]);

  return { activeId, openTabs, open, close, deselect };
}
