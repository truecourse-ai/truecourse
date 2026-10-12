/**
 * Vercel serverless function: POST /api/cto-need  { needs, note?, email, visitor?, page?, utm? }
 *
 * Records what a visitor needs from a CTO, sent from the form on the
 * /fractional-cto hero, as the PostHog event `cto_need_shared` under the
 * person's email. When the page sends its PostHog id as `visitor`, the
 * request first identifies that visit as the same person, so the pages they
 * read and the ad they came from stay attached to them. Answers 204 on
 * success.
 *
 * Sends to the site's PostHog project; no env vars. The function imports
 * nothing, as Vercel runs each file in api/ on its own, so the project key
 * and the list of needs are written out here as well as in the page, and
 * both copies must match.
 */

/** The site's PostHog project key (write-only, public) and ingestion host. */
const POSTHOG_KEY = 'phc_ys9Ykf49KmNqAC3fhq3jugTejc4BDqyKqRS8qRoYZYew';
const POSTHOG_HOST = 'https://us.i.posthog.com';

/** The needs the form offers, by id. The same list is in src/builders/NeedForm.tsx. */
const NEEDS = new Set(['build', 'fix', 'strategy', 'developers', 'security', 'other']);

/** A plain address check: something, an @, a dot in the domain, no spaces. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;
const MAX_NOTE = 2000;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

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
    const needs = Array.isArray(body?.needs)
      ? [...new Set(body.needs.filter((n: unknown): n is string => typeof n === 'string' && NEEDS.has(n)))]
      : [];
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, MAX_NOTE) : '';
    if (needs.length === 0 && !note) {
      res.status(400).json({ error: 'No need given' });
      return;
    }
    const visitor = typeof body?.visitor === 'string' && body.visitor.length <= 200 ? body.visitor : undefined;
    const page = typeof body?.page === 'string' && body.page.length <= 200 ? body.page : undefined;
    const utm: Record<string, string> = {};
    for (const key of UTM_KEYS) {
      const value = body?.utm?.[key];
      if (typeof value === 'string' && value.length <= 200) utm[key] = value;
    }

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
      event: 'cto_need_shared',
      distinct_id: email,
      timestamp: now,
      properties: { source: 'landing', page, needs, note: note || undefined, ...utm, $set: { email } },
    });

    let pr: Response;
    try {
      pr = await fetch(POSTHOG_HOST + '/batch/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: POSTHOG_KEY, batch }),
      });
    } catch (fetchErr) {
      console.error('cto-need: fetch threw', fetchErr);
      res.status(502).json({ error: 'Could not reach PostHog' });
      return;
    }
    if (!pr.ok) {
      const text = await pr.text().catch(() => '');
      console.error('cto-need: posthog error', pr.status, text.slice(0, 500));
      res.status(502).json({ error: 'Could not record the request', upstream: pr.status });
      return;
    }

    res.status(204).end();
  } catch (err) {
    console.error('cto-need: unhandled error', err instanceof Error ? err.stack : err);
    try {
      res.status(500).json({ error: 'Internal error' });
    } catch {
      // Response already sent — nothing to do.
    }
  }
}

function safeJson(text: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
