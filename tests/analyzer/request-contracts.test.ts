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
import { extractRouteRegistrations } from '../../packages/analyzer/src/extractors/route-registrations';

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

  it('states the RESPONSE side of a handler that reads nothing but answers', () => {
    // Not a no-contract case any more: the handler says what it answers with, and
    // that half is as much the operation's contract as the request half.
    const contract = onlyContract(
      `app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));`,
    );
    expect(contract.produces).toEqual({ statuses: [200], bodyKeys: ['status'] });
    expect(contract.bodyFields).toBeUndefined();
    expect(contract.queryFields).toBeUndefined();
  });

  it('says nothing about a handler that neither reads nor answers visibly', () => {
    // The honest gap the pilots measured: 7 of documenso's 50 route-backed
    // operations, whose handler lives in a module this file never sees.
    expect(extract(`app.get('/healthz', healthz);`).byRouteLocation.size).toBe(0);
  });

  it('yields nothing for a language whose walk this slice does not do', () => {
    const out = extractRequestContracts(parseCode('@app.post("/x")\ndef x(): pass', 'python'), '/repo/app.py', 'python');
    expect(out.byRouteLocation.size).toBe(0);
    expect(out.validators).toEqual([]);
  });
});

describe('extractRequestContracts — the response side (`produces`)', () => {
  it('claims Express’s implicit 200 only when NOTHING in the handler sets a status', () => {
    expect(
      onlyContract(`app.get('/a', (req, res) => res.json({ ok: true }));`).produces,
    ).toEqual({ statuses: [200], bodyKeys: ['ok'] });
  });

  it('never invents a 200 for a bare send that shares the handler with a status setter', () => {
    // `res.json(x)` after some branch's `res.status(500)` answers whatever was set.
    const contract = onlyContract(`
      app.get('/a', (req, res) => {
        if (broken) return res.status(500).json({ error: 'boom' });
        res.json({ ok: true });
      });
    `);
    expect(contract.produces).toEqual({ statuses: [500], bodyKeys: ['error', 'ok'] });
  });

  it('reads `res.sendStatus`', () => {
    expect(onlyContract(`app.delete('/a/:id', (req, res) => res.sendStatus(204));`).produces).toEqual({
      statuses: [204],
    });
  });

  it('reads a Hono context’s per-send status, and its status-bearing throw', () => {
    const contract = onlyContract(`
      app.post('/session', async (c) => {
        const { email } = await c.req.json();
        if (!email) throw new HTTPException(429, { message: 'slow down' });
        if (locked) return c.json({ error: 'locked' }, 401);
        return c.json({ token: 't' });
      });
    `);
    expect(contract.bodyFields).toEqual([{ name: 'email', required: 'unknown' }]);
    expect(contract.produces).toEqual({ statuses: [200, 401, 429], bodyKeys: ['error', 'token'] });
  });

  it('records only the top-level LITERAL keys — spreads and computed keys state nothing', () => {
    expect(
      onlyContract(`app.get('/a', (req, res) => res.json({ ...base, [key]: 1, ok: true }));`).produces,
    ).toEqual({ statuses: [200], bodyKeys: ['ok'] });
  });
});

describe('extractRequestContracts — chained registrations keep their own contracts', () => {
  it('gives each link of a Hono chain the fields ITS handler reads', () => {
    // Every link of a chain STARTS where the chain's head does, so a start-only
    // key handed one handler's contract to every route in the chain.
    const { byRouteLocation } = extract(`
      const app = new Hono()
        .post('/a', (c) => { const { alpha } = c.req.valid('json'); return c.json({ a: 1 }, 201) })
        .post('/b', (c) => { const { beta } = c.req.valid('json'); return c.json({ b: 1 }, 202) })
    `);
    expect(byRouteLocation.size).toBe(2);
    const shapes = [...byRouteLocation.values()].map((contract) => ({
      fields: contract.bodyFields?.map((f) => f.name),
      statuses: contract.produces?.statuses,
    }));
    expect(shapes).toContainEqual({ fields: ['alpha'], statuses: [201] });
    expect(shapes).toContainEqual({ fields: ['beta'], statuses: [202] });
  });
});

describe('extractRequestContracts — Hono validator middleware', () => {
  it('records the SYMBOL of a schema declared in another file', () => {
    const contract = onlyContract(`
      app.post('/auth/sign-in', sValidator('json', ZSignInSchema), async (c) => {
        const { email } = c.req.valid('json');
        return c.json({ ok: true });
      });
    `);
    expect(contract.bodyValidatorRefs).toEqual(['ZSignInSchema']);
    // The destructure is still a read: the field is known even before the join.
    expect(contract.bodyFields).toEqual([{ name: 'email', required: 'unknown' }]);
  });

  it('upgrades a `c.req.valid` destructure to the requiredness of a SAME-FILE schema', () => {
    const contract = onlyContract(`
      const SignIn = z.object({ email: z.string(), totp: z.string().optional() });
      app.post('/auth/sign-in', zValidator('json', SignIn), async (c) => {
        const { email, totp } = c.req.valid('json');
        return c.json({ ok: true });
      });
    `);
    expect(contract.bodyFields).toEqual([
      { name: 'email', required: true },
      { name: 'totp', required: false },
    ]);
    expect(contract.bodyValidatorRefs).toBeUndefined();
  });

  it('binds a `query` validator to the query half, and skips the parts that name nothing', () => {
    const contract = onlyContract(`
      app.get('/slots', zValidator('query', SlotsQuery), zValidator('param', Ignored), (c) => {
        const day = c.req.query('day');
        return c.json({ slots: [] });
      });
    `);
    expect(contract.queryValidatorRefs).toEqual(['SlotsQuery']);
    expect(contract.queryFields).toEqual([{ name: 'day', required: 'unknown' }]);
    expect(contract.bodyValidatorRefs).toBeUndefined();
  });
});

describe('extractRequestContracts — the exported-handler idioms (Next.js)', () => {
  it('keys an app-router verb export at BOTH the export statement and the declaration', () => {
    const { byRouteLocation } = extract(`
      export async function POST(req: Request) {
        const { title, done } = await req.json();
        if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });
        return NextResponse.json({ id: 1 });
      }
    `);
    // One contract, two join points — whichever location a future registration
    // derivation records, the contract is there.
    expect(byRouteLocation.size).toBe(2);
    const contracts = [...byRouteLocation.values()];
    expect(contracts[0]).toEqual(contracts[1]);
    expect(contracts[0].bodyFields).toEqual([
      { name: 'title', required: 'unknown' },
      { name: 'done', required: 'unknown' },
    ]);
    // A fetch Response carries its status per construction, so the unnamed one IS 200.
    expect(contracts[0].produces).toEqual({ statuses: [200, 400], bodyKeys: ['error', 'id'] });
  });

  it('reads the app-router query idiom through the searchParams alias', () => {
    const contract = [
      ...extract(`
        export const GET = async (req) => {
          const { searchParams } = new URL(req.url);
          const cursor = searchParams.get('cursor');
          return Response.json({ items: [] });
        };
      `).byRouteLocation.values(),
    ][0];
    expect(contract.queryFields).toEqual([{ name: 'cursor', required: 'unknown' }]);
  });

  it('reads a pages/api default export — the Express shape behind a default', () => {
    const direct = [
      ...extract(`
        export default function handler(req, res) {
          const { city } = req.body;
          res.status(201).json({ city });
        }
      `).byRouteLocation.values(),
    ][0];
    expect(direct.bodyFields).toEqual([{ name: 'city', required: 'unknown' }]);
    expect(direct.produces).toEqual({ statuses: [201], bodyKeys: ['city'] });

    const byName = [
      ...extract(`
        function handler(req, res) {
          const { city } = req.body;
          res.status(201).json({ city });
        }
        export default handler;
      `).byRouteLocation.values(),
    ][0];
    expect(byName).toEqual(direct);
  });
});

describe('the NestJS contract — decorator-borne, read where the registration is built', () => {
  const nestRoutes = (code: string) =>
    extractRouteRegistrations(parseCode(code, 'typescript'), '/repo/src/bookings.controller.ts', 'typescript')
      .routes;

  it('names the DTO class a bare `@Body()` is typed as, and the key a `@Query(…)` names', () => {
    const [route] = nestRoutes(`
      @Controller({ path: '/v2/bookings' })
      export class BookingsController {
        @Post('/')
        async create(@Body() body: CreateBookingInput, @Query('day') day?: string) {
          return { id: 1 };
        }
      }
    `);
    expect(route.requestContract).toEqual({
      queryFields: [{ name: 'day', required: false }],
      bodyValidatorRefs: ['CreateBookingInput'],
      // No `@HttpCode`, so the framework's OWN default for a POST.
      produces: { statuses: [201], bodyKeys: ['id'] },
    });
  });

  it('takes the framework default per VERB, and an `@HttpCode` that overrides it', () => {
    const routes = nestRoutes(`
      @Controller('bookings')
      export class BookingsController {
        @Get('/:id') get(@Param('id') id: string) { return { id }; }
        @Delete('/:id') @HttpCode(HttpStatus.NO_CONTENT) remove(@Param('id') id: string) {}
      }
    `);
    expect(routes.map((r) => [r.httpMethod, r.requestContract?.produces])).toEqual([
      ['GET', { statuses: [200], bodyKeys: ['id'] }],
      ['DELETE', { statuses: [204] }],
    ]);
  });

  it('claims NO status when the `@HttpCode` argument is not statically readable', () => {
    // The author explicitly replaced the default, so falling back to it would
    // state a status the app does not answer with.
    const [route] = nestRoutes(`
      @Controller('bookings')
      export class BookingsController {
        @Post('/') @HttpCode(SOME_CONSTANT) create(@Body() body: CreateBookingInput) { return { id: 1 }; }
      }
    `);
    expect(route.requestContract?.produces).toEqual({ bodyKeys: ['id'] });
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

  it('harvests a class-validator DTO class — the shape behind a Nest `@Body()`', () => {
    const { validators } = extract(
      `
        export class CreateBookingInput {
          @IsString() eventTypeId!: string;
          @IsOptional() @IsString() notes?: string;
          @ApiPropertyOptional() reason?: string;
          internalNote!: string;
        }
      `,
      '/repo/src/bookings/inputs.ts',
    );
    // A property with no validation decorator is not a request field — the class
    // is a DTO only where it says so.
    expect(validators).toEqual([
      {
        name: 'CreateBookingInput',
        fields: [
          { name: 'eventTypeId', required: true },
          { name: 'notes', required: false },
          { name: 'reason', required: false },
        ],
        location: expect.objectContaining({ filePath: '/repo/src/bookings/inputs.ts' }),
      },
    ]);
  });

  it('harvests a top-level zod schema variable — the shape a Hono validator binds', () => {
    const { validators } = extract(
      `export const ZSignInSchema = z.object({ email: z.string(), totp: z.string().optional() });`,
      '/repo/src/auth/schema.ts',
    );
    expect(validators.map((v) => [v.name, v.fields])).toEqual([
      ['ZSignInSchema', [{ name: 'email', required: true }, { name: 'totp', required: false }]],
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
