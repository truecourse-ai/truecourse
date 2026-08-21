import { useEffect, useState } from 'react';

/**
 * Live view counter for a blog post, fed by /api/blog-views (PostHog pageview
 * counts, edge-cached ~60s). Renders nothing until the count arrives, and
 * stays hidden on error or zero — locally there is no /api, so dev simply
 * never shows it.
 */
export function ViewCount({ path }: { path: string }) {
  const [views, setViews] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setViews(null);
    fetch('/api/blog-views?path=' + encodeURIComponent(path))
      .then((r) => (r.ok ? (r.json() as Promise<{ views?: unknown }>) : null))
      .then((data) => {
        if (!cancelled && data && typeof data.views === 'number') setViews(data.views);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!views) return null;
  return (
    <>
      {' · '}
      {views.toLocaleString('en-US')} {views === 1 ? 'view' : 'views'}
    </>
  );
}
