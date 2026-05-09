/**
 * Vercel serverless function: POST /api/waitlist
 *
 * Forwards waitlist submissions to the Airtable "Waitlist" table in the
 * "TrueCourse Founder CRM" base. All credentials are server-only env vars.
 *
 * Required env vars (Vercel project settings):
 *   AIRTABLE_API_KEY  Personal access token with `data.records:write` scope
 *                     for the target base. airtable.com/create/tokens
 *
 * Optional (defaults baked in below):
 *   AIRTABLE_BASE_ID  Defaults to appGuf6PL5dDfYK3f
 *   AIRTABLE_TABLE    Defaults to "Waitlist"
 *
 * Schema (verified 2026-05-08):
 *   Email                singleLineText (primary)
 *   Company Name         singleLineText
 *   Company Size Range   singleSelect — see SIZE_TO_AIRTABLE
 *   Submitted Date       dateTime
 *   Source               singleLineText
 */

const SIZE_TO_AIRTABLE: Record<string, string> = {
  '1-10': '1 – 10 engineers',
  '11-50': '11 – 50',
  '51-200': '51 – 200',
  '200+': '200+',
};

const ALLOWED_SIZES = new Set([...Object.keys(SIZE_TO_AIRTABLE), '']);

const DEFAULT_BASE_ID = 'appGuf6PL5dDfYK3f';
const DEFAULT_TABLE = 'Waitlist';

// Vercel injects Node IncomingMessage / ServerResponse augmented with `body`,
// `status`, `json`, `send`. Use `any` so the bundler doesn't get tripped up
// by structural type mismatches.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any): Promise<void> {
  console.log('waitlist: invoked', { method: req?.method });

  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const body = parseBody(req.body);
    console.log('waitlist: body keys', Object.keys(body));

    // Honeypot
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      res.status(200).json({ ok: true });
      return;
    }

    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const company = typeof body.company === 'string' ? body.company.trim().slice(0, 200) : '';
    const size = typeof body.size === 'string' ? body.size.trim() : '';

    if (!email || email.length > 254 || !email.includes('@') || email.includes(' ')) {
      res.status(400).json({ error: 'Valid email required' });
      return;
    }
    if (!ALLOWED_SIZES.has(size)) {
      res.status(400).json({ error: 'Invalid team size' });
      return;
    }

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID || DEFAULT_BASE_ID;
    const table = process.env.AIRTABLE_TABLE || DEFAULT_TABLE;

    if (!apiKey) {
      console.error('waitlist: missing AIRTABLE_API_KEY');
      res.status(500).json({ error: 'Server misconfigured: missing AIRTABLE_API_KEY' });
      return;
    }

    const url =
      'https://api.airtable.com/v0/' +
      encodeURIComponent(baseId) +
      '/' +
      encodeURIComponent(table);

    const fields: Record<string, string> = {
      Email: email,
      Source: 'truecourse.dev/teams',
      'Submitted Date': new Date().toISOString(),
    };
    if (company) fields['Company Name'] = company;
    if (size) fields['Company Size Range'] = SIZE_TO_AIRTABLE[size];

    console.log('waitlist: posting to airtable', { baseId, table, fields: Object.keys(fields) });

    let ar: Response;
    try {
      ar = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ fields, typecast: true }),
      });
    } catch (fetchErr) {
      console.error('waitlist: fetch threw', fetchErr);
      res.status(502).json({ error: 'Could not reach Airtable' });
      return;
    }

    if (!ar.ok) {
      const text = await ar.text().catch(() => '');
      console.error('waitlist: airtable error', ar.status, text.slice(0, 500));
      res.status(502).json({ error: 'Could not save submission', upstream: ar.status });
      return;
    }

    console.log('waitlist: ok');
    res.status(200).json({ ok: true });
  } catch (err) {
    // Catch-all so Vercel never sees an unhandled rejection.
    console.error('waitlist: unhandled error', err instanceof Error ? err.stack : err);
    try {
      res.status(500).json({ error: 'Internal error', detail: err instanceof Error ? err.message : String(err) });
    } catch {
      // Response already sent — nothing to do.
    }
  }
}

function parseBody(raw: unknown): {
  email?: unknown;
  company?: unknown;
  size?: unknown;
  website?: unknown;
} {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}
