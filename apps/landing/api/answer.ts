/**
 * Vercel serverless function: POST /api/answer  { question, needs, note?, email, visitor?, page?, utm? }
 *
 * Records a visitor's answer to a hero question as `cto_need_shared` under
 * the person's email, with the question it answers: what they need from a
 * CTO (`cto-need`) or what worries them about their app (`app-worry`).
 * When the page sends its PostHog id as `visitor`, the
 * request first identifies that visit as the same person, so the pages they
 * read and the ad they came from stay attached to them. Answers 204 on
 * success.
 *
 * Sends to the site's PostHog project; no env vars. The function imports
 * nothing, as Vercel runs each file in api/ on its own, so the project key
 * and the questions' answers are written out here as well as in
 * src/builders/AskForm.tsx, and both copies must match.
 */

/** The site's PostHog project key (write-only, public) and ingestion host. */
const POSTHOG_KEY = 'phc_ys9Ykf49KmNqAC3fhq3jugTejc4BDqyKqRS8qRoYZYew';
const POSTHOG_HOST = 'https://us.i.posthog.com';

/** The answers each question offers, by question id. */
const QUESTIONS: Record<string, Set<string>> = {
  'cto-need': new Set(['build', 'fix', 'strategy', 'developers', 'security', 'other']),
  'app-worry': new Set(['bugs', 'night', 'stuck', 'security', 'other']),
};

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
    const question = typeof body?.question === 'string' && QUESTIONS[body.question] ? body.question : undefined;
    if (!question) {
      res.status(400).json({ error: 'Unknown question' });
      return;
    }
    const answers = QUESTIONS[question]!;
    const needs = Array.isArray(body?.needs)
      ? [...new Set(body.needs.filter((n: unknown): n is string => typeof n === 'string' && answers.has(n)))]
      : [];
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, MAX_NOTE) : '';
    if (needs.length === 0 && !note) {
      res.status(400).json({ error: 'No answer given' });
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
      properties: { source: 'landing', question, page, needs, note: note || undefined, ...utm, $set: { email } },
    });

    let pr: Response;
    try {
      pr = await fetch(POSTHOG_HOST + '/batch/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: POSTHOG_KEY, batch }),
      });
    } catch (fetchErr) {
      console.error('answer: fetch threw', fetchErr);
      res.status(502).json({ error: 'Could not reach PostHog' });
      return;
    }
    if (!pr.ok) {
      const text = await pr.text().catch(() => '');
      console.error('answer: posthog error', pr.status, text.slice(0, 500));
      res.status(502).json({ error: 'Could not record the request', upstream: pr.status });
      return;
    }

    res.status(204).end();
  } catch (err) {
    console.error('answer: unhandled error', err instanceof Error ? err.stack : err);
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
