// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

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
 * jump can come from a control nested far below the tab's own props.
 */

import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PREVIEW_BASE } from '@/preview/shell/PreviewShell';

/** The dashboard's guard tab ids, as the preview's path segments. */
const TAB_PATH: Record<string, string> = {
  coverage: 'coverage',
  sources: 'sources',
  guardflows: 'tests',
  interfaces: 'interfaces',
  guarddrifts: 'runs',
  externals: 'dependencies',
};

export function useGuardTabJump(): void {
  const { slug } = useParams<{ slug: string }>();
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
    let path = TAB_PATH[tab] ?? '';
    // A coverage jump that names a document or a conflict lands on that item's
    // own Corpus page; the Coverage tab is the overview and holds no item.
    if (tab === 'coverage') {
      const doc = next.get('doc');
      const conflict = next.get('conflict');
      if (doc) {
        next.delete('doc');
        path = `corpus/doc/${encodeURIComponent(doc)}`;
      } else if (conflict) {
        next.delete('conflict');
        path = `corpus/conflict/${encodeURIComponent(conflict)}`;
      }
    }
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
