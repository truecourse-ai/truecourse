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
import { conflictHref, docHref } from '@/preview/pages/context-hrefs';

/** The dashboard's guard tab ids, as the preview's path segments. */
const TAB_PATH: Record<string, string> = {
  coverage: 'coverage',
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
    // `section` is the real dashboard's product switch, which the preview does
    // not have: the jump wrote it, so the jump's translation drops it.
    next.delete('tab');
    next.delete('section');
    // A coverage jump that names a document or a conflict lands on that item's
    // own CONTEXT page: documents and conflicts belong to the workspace, and a
    // document is read through the repository the jump came from.
    if (tab === 'coverage') {
      const doc = next.get('doc');
      const conflict = next.get('conflict');
      if (doc || conflict) {
        next.delete('doc');
        next.delete('conflict');
        const query = next.toString();
        const to = doc ? docHref(doc, slug) : conflictHref(conflict!);
        navigate(query ? `${to}${to.includes('?') ? '&' : '?'}${query}` : to, { replace: true });
        return;
      }
    }
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
