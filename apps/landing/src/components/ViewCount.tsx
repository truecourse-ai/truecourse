import { useEffect, useState } from 'react';

/**
 * Live view counter for a blog post, fed by /api/blog-views (PostHog pageview
 * counts, edge-cached ~60s). Shows a small spinner while loading, then the
 * count; hides entirely on error or zero — locally there is no /api, so dev
 * settles to hidden.
 */
export function ViewCount({ path }: { path: string }) {
  const [state, setState] = useState<'loading' | 'hidden' | number>('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    fetch('/api/blog-views?path=' + encodeURIComponent(path))
      .then((r) => (r.ok ? (r.json() as Promise<{ views?: unknown }>) : null))
      .then((data) => {
        if (cancelled) return;
        const views = data && typeof data.views === 'number' ? data.views : 0;
        setState(views > 0 ? views : 'hidden');
      })
      .catch(() => {
        if (!cancelled) setState('hidden');
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (state === 'hidden') return null;
  if (state === 'loading') {
    return (
      <>
        {' · '}
        <span
          className="spinner"
          style={{ display: 'inline-block', width: 11, height: 11, verticalAlign: -1 }}
          aria-hidden="true"
        />
      </>
    );
  }
  return (
    <>
      {' · '}
      {state.toLocaleString('en-US')} {state === 1 ? 'view' : 'views'}
    </>
  );
}
