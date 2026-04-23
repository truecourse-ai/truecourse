/**
 * Centralized URL-param writer for the repo-graph page.
 *
 * Before this existed, each state setter (`setActiveFilePath`,
 * `setActiveFlowId`, `setLeftTab`, `setScopedServiceId`, …) constructed
 * its own `new URL(window.location.href)`, set/deleted its own params,
 * and called `navigate()`. Bugs like "clicking Home leaves `?draft=…` in
 * the URL" traced to inconsistent cross-clearing rules between sites.
 *
 * This hook gives every caller one function: `updateUrl(patch)`.
 *
 *   - Pass a string value for a param → it's `set`.
 *   - Pass `null` / `undefined` → it's `delete`d.
 *   - Pass the sentinel `CLEAR_ALL_DETAILS` as the key → all detail-kind
 *     params (`file`, `flow`, `adr`, `draft`, `db`) are cleared.
 *
 * All writes go through `navigate(...)` so browser history and the
 * downstream `searchParams`-driven useEffects stay consistent.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/** Detail-kind URL params — at most one should be set at a time since
 *  the viewer can only show one detail pane. */
export const DETAIL_PARAMS = ['file', 'flow', 'adr', 'draft', 'db'] as const;
export type DetailParam = (typeof DETAIL_PARAMS)[number];

export const CLEAR_ALL_DETAILS = '__clearDetails' as const;

/** A map of URL param names → desired value. `null`/`undefined` deletes
 *  the param. The special key `CLEAR_ALL_DETAILS` (with a truthy value)
 *  wipes every detail-kind param — use this when switching to a view
 *  that doesn't have a detail (e.g., Home tab). */
export type UrlPatch = Record<string, string | null | undefined> & {
  [CLEAR_ALL_DETAILS]?: boolean;
};

export function useRepoUrl() {
  const navigate = useNavigate();
  return useCallback(
    (patch: UrlPatch) => {
      const url = new URL(window.location.href);
      if (patch[CLEAR_ALL_DETAILS]) {
        for (const k of DETAIL_PARAMS) url.searchParams.delete(k);
      }
      for (const [key, value] of Object.entries(patch)) {
        if (key === CLEAR_ALL_DETAILS) continue;
        if (value == null || value === '') url.searchParams.delete(key);
        else url.searchParams.set(key, value);
      }
      navigate(url.pathname + url.search);
    },
    [navigate],
  );
}

/** Patch for setting a detail kind to an id. Clears every other detail
 *  param so only one detail is represented in the URL. */
export function setDetailPatch(kind: DetailParam, id: string): UrlPatch {
  const patch: UrlPatch = { [CLEAR_ALL_DETAILS]: true };
  patch[kind] = id;
  return patch;
}

/** Patch for clearing a single detail kind only. Other detail params
 *  are preserved — use this from `setActiveX(null)` so a subsequent
 *  `setActiveY(null)` in a "switch view" sequence can't undo the
 *  detail we just set via the counterpart `setActiveY(id)`. */
export function clearDetailPatch(kind: DetailParam): UrlPatch {
  return { [kind]: null };
}
