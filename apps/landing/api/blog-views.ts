/**
 * Vercel serverless function: GET /api/blog-views?path=/blog/<slug>
 *
 * Returns the number of unique viewers PostHog has recorded for a blog post
 * (distinct `distinct_id`s with a `$pageview` there), as `{ views: number }`. Responses carry an edge-cache header (60s +
 * stale-while-revalidate) so PostHog's query API is hit at most ~once a
 * minute per post regardless of traffic.
 *
 * Required env vars (Vercel project settings):
 *   POSTHOG_PERSONAL_API_KEY  Personal API key with `query:read` scope.
 *                             posthog.com → Settings → Personal API keys
 *   POSTHOG_PROJECT_ID        Numeric project id (Settings → Project)
 *
 * Optional:
 *   POSTHOG_API_HOST          Defaults to https://us.posthog.com (the private
 *                             API host — NOT the us.i.posthog.com ingestion
 *                             host posthog-js talks to)
 */

const DEFAULT_API_HOST = 'https://us.posthog.com';

/** Only real post paths reach PostHog; anything else is rejected up front. */
const PATH_RE = /^\/blog\/[a-z0-9][a-z0-9-]*$/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const path = typeof req.query?.path === 'string' ? req.query.path : '';
    if (!PATH_RE.test(path)) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }

    const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
    const projectId = process.env.POSTHOG_PROJECT_ID;
    if (!apiKey || !projectId) {
      console.error('blog-views: missing POSTHOG_PERSONAL_API_KEY or POSTHOG_PROJECT_ID');
      res.status(500).json({ error: 'Server misconfigured' });
      return;
    }

    const host = process.env.POSTHOG_API_HOST || DEFAULT_API_HOST;
    const url = host + '/api/projects/' + encodeURIComponent(projectId) + '/query/';

    let pr: Response;
    try {
      pr = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: {
            kind: 'HogQLQuery',
            // {path} is a HogQL placeholder bound via `values` — the path is
            // never spliced into the query string.
            query:
              "SELECT count(DISTINCT distinct_id) FROM events WHERE event = '$pageview' " +
              "AND (properties.$pathname = {path} OR properties.$pathname = concat({path}, '/'))",
            values: { path },
          },
        }),
      });
    } catch (fetchErr) {
      console.error('blog-views: fetch threw', fetchErr);
      res.status(502).json({ error: 'Could not reach PostHog' });
      return;
    }

    if (!pr.ok) {
      const text = await pr.text().catch(() => '');
      console.error('blog-views: posthog error', pr.status, text.slice(0, 500));
      res.status(502).json({ error: 'Could not query views', upstream: pr.status });
      return;
    }

    const data = (await pr.json()) as { results?: unknown[][] };
    const raw = data.results?.[0]?.[0];
    const views = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ views });
  } catch (err) {
    console.error('blog-views: unhandled error', err instanceof Error ? err.stack : err);
    try {
      res.status(500).json({ error: 'Internal error' });
    } catch {
      // Response already sent — nothing to do.
    }
  }
}
