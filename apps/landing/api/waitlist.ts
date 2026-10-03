/**
 * Vercel serverless function: POST /api/waitlist  { email, visitor? }
 *
 * Records a waitlist signup from the /builders page as the PostHog event
 * `waitlist_joined`, under the person's email. When the page
 * sends its PostHog id as `visitor`, the request first identifies that visit
 * as the same person, so the pages and sections they read before asking stay
 * attached to them. Answers 204 on success.
 *
 * Sends to the site's PostHog project; no env vars. The function imports
 * nothing, as Vercel runs each file in api/ on its own, so the project key
 * is written out here as well as in src/lib/posthog.ts, and the two
 * must name the same project.
 */

/** The site's PostHog project key (write-only, public) and ingestion host. */
const POSTHOG_KEY = 'phc_ys9Ykf49KmNqAC3fhq3jugTejc4BDqyKqRS8qRoYZYew';
const POSTHOG_HOST = 'https://us.i.posthog.com';

/** A plain address check: something, an @, a dot in the domain, no spaces. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: 'Invalid email' });
      return;
    }
    const visitor = typeof body?.visitor === 'string' && body.visitor.length <= 200 ? body.visitor : undefined;

    const now = new Date().toISOString();
    const batch: unknown[] = [];
    if (visitor && visitor !== email) {
      batch.push({
        event: '$identify',
        distinct_id: email,
        timestamp: now,
        properties: { $anon_distinct_id: visitor, $set: { email } },
      });
    }
    batch.push({
      event: 'waitlist_joined',
      distinct_id: email,
      timestamp: now,
      properties: { source: 'landing', page: 'builders', $set: { email } },
    });

    let pr: Response;
    try {
      pr = await fetch(POSTHOG_HOST + '/batch/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: POSTHOG_KEY, batch }),
      });
    } catch (fetchErr) {
      console.error('waitlist: fetch threw', fetchErr);
      res.status(502).json({ error: 'Could not reach PostHog' });
      return;
    }
    if (!pr.ok) {
      const text = await pr.text().catch(() => '');
      console.error('waitlist: posthog error', pr.status, text.slice(0, 500));
      res.status(502).json({ error: 'Could not record the request', upstream: pr.status });
      return;
    }

    res.status(204).end();
  } catch (err) {
    console.error('waitlist: unhandled error', err instanceof Error ? err.stack : err);
    try {
      res.status(500).json({ error: 'Internal error' });
    } catch {
      // Response already sent — nothing to do.
    }
  }
}

function safeJson(text: string): { email?: unknown; visitor?: unknown } | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
