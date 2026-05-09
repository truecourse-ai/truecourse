/**
 * Vercel serverless function: POST /api/waitlist
 *
 * Forwards waitlist submissions to the Airtable "Waitlist" table in the
 * "TrueCourse Founder CRM" base. All credentials are server-only env vars —
 * the browser never sees the API key.
 *
 * Required env vars (set in Vercel project settings):
 *   AIRTABLE_API_KEY  Personal access token with `data.records:write` scope
 *                     for the target base. Create at airtable.com/create/tokens
 *   AIRTABLE_BASE_ID  Defaults to the TrueCourse Founder CRM base
 *                     (appGuf6PL5dDfYK3f). Override only if you move bases.
 *
 * Optional:
 *   AIRTABLE_TABLE    Table name. Defaults to "Waitlist".
 *
 * Wired against the real schema as of 2026-05-08:
 *   Email                singleLineText (primary)
 *   Company Name         singleLineText
 *   Company Size Range   singleSelect — see SIZE_TO_AIRTABLE map
 *   Submitted Date       dateTime (ISO timestamp)
 *   Source               singleLineText  (we tag every submission with the page)
 */

type Req = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

type Res = {
  status(code: number): Res;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
};

type Body = {
  email?: unknown;
  company?: unknown;
  size?: unknown;
  // Honeypot — humans never see/fill this. Bots usually do.
  website?: unknown;
};

/**
 * Form values (left) → exact Airtable single-select option names (right).
 * These must match the strings configured in the "Company Size Range" field
 * exactly (en-dash vs hyphen matters in Airtable).
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

export default async function handler(req: Req, res: Res): Promise<void> {
  res.setHeader('content-type', 'application/json');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = parseBody(req.body);

  // Honeypot: bots fill hidden fields, real users don't. Quietly succeed
  // without writing anything so spam goes nowhere.
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
  const baseId = process.env.AIRTABLE_BASE_ID ?? DEFAULT_BASE_ID;
  const table = process.env.AIRTABLE_TABLE ?? DEFAULT_TABLE;

  if (!apiKey) {
    console.error('waitlist: missing AIRTABLE_API_KEY');
    res.status(500).json({ error: 'Server misconfigured' });
    return;
  }

  const url = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}`;

  const fields: Record<string, string> = {
    Email: email,
    Source: 'truecourse.dev/teams',
    'Submitted Date': new Date().toISOString(),
  };
  if (company) fields['Company Name'] = company;
  if (size) fields['Company Size Range'] = SIZE_TO_AIRTABLE[size];

  try {
    const ar = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ fields, typecast: true }),
    });

    if (!ar.ok) {
      const text = await ar.text().catch(() => '');
      console.error('waitlist: airtable error', ar.status, text.slice(0, 500));
      res.status(502).json({ error: 'Could not save submission' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('waitlist: airtable fetch threw', err);
    res.status(502).json({ error: 'Could not reach Airtable' });
  }
}

function parseBody(raw: unknown): Body {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Body;
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as Body;
  return {};
}
