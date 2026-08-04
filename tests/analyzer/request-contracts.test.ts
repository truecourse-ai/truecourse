/**
 * INBOUND REQUEST CONTRACTS.
 *
 * The measured failure: a scenario signed up with `{email, password}` while the
 * bench app's body validation also requires `name`, so a SETUP step 400'd and the
 * scenario died before the claim under test ran. The bench shape is the last
 * describe block here — a route handing `req.body` to a validator declared in
 * ANOTHER module, whose requiredness lives in its declared return interface.
 */

import { describe, it, expect } from 'vitest';
import { parseCode } from '../../packages/analyzer/src/parser';
import { extractRequestContracts } from '../../packages/analyzer/src/extractors/request-contracts';

function extract(code: string, filePath = '/repo/src/app.ts') {
  return extractRequestContracts(parseCode(code, 'typescript'), filePath, 'typescript');
}

/** The only contract in a source, whichever route it belongs to. */
function onlyContract(code: string) {
  const { byRouteLocation } = extract(code);
  expect(byRouteLocation.size).toBe(1);
  return [...byRouteLocation.values()][0];
}

describe('extractRequestContracts — what a handler reads off the request', () => {
  it('reads direct property access and destructuring, requiredness UNKNOWN', () => {
    const contract = onlyContract(`
      app.post('/v1/favorites', async (req, res) => {
        const { city } = req.body;
        res.json({ city, note: req.body.note });
      });
    `);
    expect(contract.bodyFields).toEqual([
      { name: 'city', required: 'unknown' },
      { name: 'note', required: 'unknown' },
    ]);
  });

  it("a handler's own guard makes the field REQUIRED — the source says so", () => {
    const contract = onlyContract(`
      app.post('/v1/favorites', (req, res) => {
        if (!req.body.city) return res.status(400).json({ error: 'city required' });
        if (req.body.label === undefined) return res.status(400).json({ error: 'label required' });
        res.json({ ok: true, note: req.body.note });
      });
    `);
    expect(contract.bodyFields).toEqual([
      { name: 'city', required: true },
      { name: 'label', required: true },
      { name: 'note', required: 'unknown' },
    ]);
  });

  it('reads a zod shape parsed from the body, optional keys included', () => {
    const contract = onlyContract(`
      const SignupSchema = z.object({
        email: z.string().email(),
        name: z.string(),
        referrer: z.string().optional(),
      });
      app.post('/v1/auth/signup', (req, res) => {
        const body = SignupSchema.parse(req.body);
        res.status(201).json(body);
      });
    `);
    expect(contract.bodyFields).toEqual([
      { name: 'email', required: true },
      { name: 'name', required: true },
      { name: 'referrer', required: false },
    ]);
  });

  it('separates query fields from body fields', () => {
    const contract = onlyContract(`
      app.get('/v1/weather', (req, res) => {
        const city = req.query.city;
        const units = req.query['units'];
        res.json({ city, units });
      });
    `);
    expect(contract.queryFields).toEqual([
      { name: 'city', required: 'unknown' },
      { name: 'units', required: 'unknown' },
    ]);
    expect(contract.bodyFields).toBeUndefined();
  });

  it('records the SYMBOL when the handler hands the body to a validator', () => {
    const contract = onlyContract(`
      app.post('/v1/auth/signup', async (req, res) => {
        const body = parseSignupBody(req.body);
        res.status(201).json(await auth.signup(body.email, body.name, body.password));
      });
    `);
    expect(contract.bodyValidatorRefs).toEqual(['parseSignupBody']);
    expect(contract.bodyFields).toBeUndefined();
  });

  it('follows a handler registered by NAME, and middleware never hides it', () => {
    const contract = onlyContract(`
      async function createFavorite(req, res) {
        const { city } = req.body;
        res.status(201).json({ city });
      }
      app.post('/v1/favorites', requireAuth, createFavorite);
    `);
    expect(contract.bodyFields).toEqual([{ name: 'city', required: 'unknown' }]);
  });

  it('says nothing about a handler that reads nothing off the request', () => {
    expect(
      extract(`app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));`).byRouteLocation.size,
    ).toBe(0);
  });

  it('yields nothing for a language whose walk this slice does not do', () => {
    const out = extractRequestContracts(parseCode('@app.post("/x")\ndef x(): pass', 'python'), '/repo/app.py', 'python');
    expect(out.byRouteLocation.size).toBe(0);
    expect(out.validators).toEqual([]);
  });
});

describe('extractRequestContracts — validator functions', () => {
  /** The bench's body validator, reduced to the shape that matters. */
  const BODY_VALIDATION = `
    export interface SignupBody {
      email: string;
      name: string;
      password: string;
      referrer?: string;
    }

    function asRecord(body: unknown): Record<string, unknown> {
      if (typeof body !== 'object' || body === null) throw invalidRequest('must be an object');
      return body as Record<string, unknown>;
    }

    function readString(body: Record<string, unknown>, name: string, details: string[]): string | undefined {
      const raw = body[name];
      if (raw === undefined) { details.push(name + ': required'); return undefined; }
      return String(raw);
    }

    export function parseSignupBody(body: unknown): SignupBody {
      const record = asRecord(body);
      const details: string[] = [];
      const email = readString(record, 'email', details);
      let name = readString(record, 'name', details);
      if (name !== undefined) name = name.trim();
      const password = readString(record, 'password', details);
      const referrer = readString(record, 'referrer', details);
      if (details.length > 0) throw invalidRequest('Invalid signup body.', details);
      return { email, name, password, referrer } as SignupBody;
    }
  `;

  it('reads the fields through the local accessor and takes requiredness from the declared return shape', () => {
    const { validators } = extract(BODY_VALIDATION, '/repo/src/routes/bodyValidation.ts');
    const signup = validators.find((v) => v.name === 'parseSignupBody');
    expect(signup?.fields).toEqual([
      { name: 'email', required: true },
      { name: 'name', required: true },
      { name: 'password', required: true },
      { name: 'referrer', required: false },
    ]);
  });

  it("never mistakes an accessor's RESULT for another handle on the record", () => {
    // `name.trim()` and `name.length` are string operations on a FIELD; treating the
    // accessor call as a record alias would publish `trim` and `length` as request
    // fields — noise a scenario author would then dutifully try to send.
    const { validators } = extract(BODY_VALIDATION, '/repo/src/routes/bodyValidation.ts');
    const names = validators.flatMap((v) => v.fields.map((f) => f.name));
    expect(names).not.toContain('trim');
    expect(names).not.toContain('length');
  });

  it('reads destructuring and direct index access off the parameter', () => {
    const { validators } = extract(
      `
        export function parseFavoriteBody(body: Record<string, unknown>) {
          const { label } = body;
          const city = body['city'];
          if (!body['city']) throw invalidRequest('city required');
          return { city, label };
        }
      `,
      '/repo/src/routes/bodyValidation.ts',
    );
    expect(validators[0].fields).toEqual([
      { name: 'label', required: 'unknown' },
      { name: 'city', required: true },
    ]);
  });

  it('takes an INLINE return shape too', () => {
    const { validators } = extract(
      `
        export function parseUnits(query: Record<string, unknown>): { units: string; verbose?: boolean } {
          const units = readString(query, 'units', []);
          const verbose = readString(query, 'verbose', []);
          return { units, verbose } as { units: string; verbose?: boolean };
        }
      `,
      '/repo/src/routes/validation.ts',
    );
    expect(validators[0].fields).toEqual([
      { name: 'units', required: true },
      { name: 'verbose', required: false },
    ]);
  });
});
