/**
 * The preview's ROUTER SEAM for guard's cross-tab jumps.
 *
 * The vendored components jump between tabs through `useGuardView`, which is the
 * real dashboard's hook and writes the destination as `?section=guard&tab=<id>`
 * beside the selection it carries (`?flow=`, `?interface=`, `?dependency=`,
 * `?doc=`+`?section=`). The real repo page reads the tab out of that param; the
 * preview reads it out of the PATH (`/preview/repos/:slug/:tab`), so the param
 * alone would land nowhere and a call to action would quietly do nothing.
 *
 * This hook is the one line of translation, and only that: it moves the tab the
 * jump named into the address, keeps every selection param the jump wrote
 * untouched, and replaces the entry rather than pushing one, so the jump is one
 * navigation and the Back button still returns where the reader came from. The
 * ids are the ones `navigation/registry.ts` names on the current dashboard; the
 * paths are the ones `RepoConsole` routes on.
 *
 * Every tab whose surfaces can fire a jump calls it once, at the top, because a
 * jump can come from a control nested far below the tab's own props. A Context
 * page calls it with the repository it is reading through, since it has no
 * `:slug` of its own to read one from.
 */

import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PREVIEW_BASE } from '@/preview/shell/PreviewShell';
import { CONTEXT_BASE, conflictHref, docHref } from '@/preview/pages/context-hrefs';

/** The dashboard's guard tab ids, as the preview's path segments. */
const TAB_PATH: Record<string, string> = {
  // Documentation is the workspace's: a jump that named the repository's
  // retired Sources tab lands on the links this repository reads through.
  sources: 'context',
  guardflows: 'tests',
  interfaces: 'interfaces',
  guarddrifts: 'runs',
  externals: 'dependencies',
};

export function useGuardTabJump(repoId?: string): void {
  const { slug: routeSlug } = useParams<{ slug: string }>();
  const slug = repoId || routeSlug;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const search = params.toString();

  useEffect(() => {
    const next = new URLSearchParams(search);
    const tab = next.get('tab');
    if (!slug || !tab) return;
    next.delete('tab');
    // COVERAGE IS NOT A TAB. Documents, their coverage and their conflicts
    // belong to the workspace, so every coverage jump lands on Context: on the
    // document's own page (read through the repository the jump came from), on
    // the conflict's resolver, or — a jump that named neither — on the
    // documents view.
    if (tab === 'coverage') {
      const doc = next.get('doc');
      const conflict = next.get('conflict');
      next.delete('doc');
      next.delete('conflict');
      // The reading repository is the destination's own parameter, written by
      // `docHref` — carrying the old one through would double it.
      next.delete('repo');
      // `section` carries two things under one key: the real dashboard's
      // product switch (which the preview does not have) and, on a jump that
      // named a document, the within-document anchor it wrote over the switch.
      // Only the anchor survives.
      if (!doc) next.delete('section');
      const to = doc ? docHref(doc, slug) : conflict ? conflictHref(conflict) : CONTEXT_BASE;
      const query = next.toString();
      navigate(query ? `${to}${to.includes('?') ? '&' : '?'}${query}` : to, { replace: true });
      return;
    }
    // `section` is the real dashboard's product switch, which the preview does
    // not have: the jump wrote it, so the jump's translation drops it.
    next.delete('section');
    const path = TAB_PATH[tab] ?? '';
    const query = next.toString();
    navigate(
      {
        ...(path ? { pathname: `${PREVIEW_BASE}/repos/${slug}/${path}` } : {}),
        search: query ? `?${query}` : '',
      },
      { replace: true },
    );
  }, [slug, search, navigate]);
}
