/**
 * THE cross-navigation rule, in one hook.
 *
 * Every jump between guard surfaces behaves the same way: the selection goes in
 * the URL, the target opens as a preview tab, and the target LIST SCROLLS to the
 * selected row. The third part is this hook — without it a deep link selects a
 * row the user can't see, which reads as "nothing happened".
 *
 * Usage: keep a ref-map from row id → element, and pass it with the selected id.
 *
 *   const rows = useScrollToSelected(activeId, [visibleRows]);
 *   …
 *   <div ref={rows.set(id)} />
 *
 * `deps` re-runs the scroll when the list itself changes (a filter/search that
 * re-renders the rows, or data arriving after the link), so the row is brought
 * into view whenever it first exists.
 */

import { useCallback, useEffect, useRef } from 'react';

export interface ScrollToSelected<T extends HTMLElement> {
  /** Ref callback for a row: `ref={rows.set(id)}`. */
  set: (id: string) => (el: T | null) => void;
}

export function useScrollToSelected<T extends HTMLElement = HTMLElement>(
  selectedId: string | null | undefined,
  deps: readonly unknown[] = [],
): ScrollToSelected<T> {
  const rows = useRef(new Map<string, T>());

  const set = useCallback(
    (id: string) => (el: T | null) => {
      if (el) rows.current.set(id, el);
      else rows.current.delete(id);
    },
    [],
  );

  useEffect(() => {
    if (!selectedId) return;
    // Optional call: jsdom doesn't implement scrollIntoView in every version.
    rows.current.get(selectedId)?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ...deps]);

  return { set };
}
