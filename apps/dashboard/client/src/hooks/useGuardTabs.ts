/**
 * The reusable Guard main-pane tab model — the same transient/pinned tab model as
 * the Spec doc tabs (single-click opens a preview tab the next single-click
 * replaces; double-click pins; the tab bar and close buttons render like the
 * other viewers). Parameterised by the URL param it mirrors so each Guard surface
 * gets its OWN addressable tab set from ONE reducer, never a second
 * implementation: the Scenarios tab passes `gscn`, the Runs tab passes `gdrift`.
 * Owned by Guard so no state is shared with BL Drift's DriftViewContext (the
 * no-bleed rule). Writes merge into the existing query so sibling params
 * (`?guard`/`?gsec`/`?gconf` and the other tab set's param) are preserved.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface GuardTab {
  id: string;
  pinned: boolean;
}

export interface GuardTabsState {
  /** The active id (the `param` value), or null when the overview shows. */
  activeId: string | null;
  openTabs: GuardTab[];
  /**
   * The permanent Overview pseudo-tab is active exactly when no item tab is —
   * i.e. when the URL param is absent. It is never one of {@link openTabs}
   * (nothing to close, no pin state) — the strip renders it first from this flag.
   */
  /** Single-click = transient preview (replaces the unpinned tab); double-click = pin. */
  open: (id: string, pinned: boolean) => void;
  close: (id: string) => void;
  /** Select the Overview tab: clear the item selection (the URL param), open no new tab. */
  selectOverview: () => void;
}

export function useGuardTabs(param: string, repoId: string | undefined): GuardTabsState {
  const [params, setParams] = useSearchParams();
  const activeId = params.get(param);

  const [openTabs, setOpenTabs] = useState<GuardTab[]>(() =>
    activeId ? [{ id: activeId, pinned: true }] : [],
  );

  const setActive = useCallback(
    (id: string | null) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set(param, id);
        else next.delete(param);
        return next;
      });
    },
    [setParams, param],
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

  // The permanent Overview tab: clearing the param drops the item selection back
  // to the overview without adding a tab (closing the last item tab lands here too).
  const selectOverview = useCallback(() => setActive(null), [setActive]);

  // Back/Forward + deep links: an active id the tab set doesn't know yet
  // (e.g. the param restored by the browser) gets a pinned tab, mirroring how
  // the inferred/spec viewers rehydrate from the URL.
  useEffect(() => {
    if (!activeId) return;
    setOpenTabs((prev) =>
      prev.some((t) => t.id === activeId) ? prev : [...prev, { id: activeId, pinned: true }],
    );
  }, [activeId]);

  // Reset the open tabs when switching repos — but keep an initial deep link on mount.
  const repoRef = useRef(repoId);
  useEffect(() => {
    if (repoRef.current === repoId) return;
    repoRef.current = repoId;
    setOpenTabs([]);
    setActive(null);
  }, [repoId, setActive]);

  return { activeId, openTabs, open, close, selectOverview };
}
