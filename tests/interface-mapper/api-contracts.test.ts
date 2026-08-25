/**
 * THE OPERATION-KEYED REQUEST CONTRACT JOIN.
 *
 * The contract is only useful if it survives to the generator keyed EXACTLY as the
 * interface it belongs to — same mount composition, same `canonicalRoutePath` — so
 * the per-interface prompt block can find it. These tests assert that identity, and
 * the cross-file validator resolution that is the whole reason the join exists.
 */

import { describe, it, expect } from 'vitest';
import { analyzeFileContent } from '../../packages/analyzer/src/file-analyzer';
import { collectApiRequestContracts } from '../../packages/interface-mapper/src/api-contracts';
import { deriveApiInterfacesFromTree } from '../../packages/interface-mapper/src/api-tree';
import type { FileAnalysis, ImportStatement } from '../../packages/shared/src/types/analysis';

/**
 * The real producer/consumer pair: `analyzeFileContent` is what joins a
 * registration to its contract, by the FOUR-coordinate location key. Building
 * that key by hand here is how the join was vacuously green while every real
 * repo derived nothing.
 */
function analyzed(filePath: string, code: string, imports: ImportStatement[] = []): FileAnalysis {
  const analysis = analyzeFileContent(filePath, code, 'typescript');
  return imports.length > 0 ? { ...analysis, imports: [...analysis.imports, ...imports] } : analysis;
}

const APP = `
  app.post('/v1/auth/signup', async (req, res) => {
    const body = parseSignupBody(req.body);
    res.status(201).json(body);
  });
  app.get('/v1/weather', (req, res) => {
    res.json({ city: req.query.city });
  });
  app.all('/v1/auth/signup', methodNotAllowed('POST'));
`;

const VALIDATION = `
  export interface SignupBody { email: string; name: string; password: string }
  export function parseSignupBody(body: unknown): SignupBody {
    const record = asRecord(body);
    const details: string[] = [];
    const email = readString(record, 'email', details);
    const name = readString(record, 'name', details);
    const password = readString(record, 'password', details);
    return { email, name, password } as SignupBody;
  }
`;

describe('collectApiRequestContracts', () => {
  it('resolves a validator declared in ANOTHER file — the whole point of the join', () => {
    const contracts = collectApiRequestContracts([
      analyzed('/repo/src/app.ts', APP),
      analyzed('/repo/src/routes/bodyValidation.ts', VALIDATION),
    ]);
    expect(contracts).toEqual([
      {
        method: 'POST',
        path: '/v1/auth/signup',
        bodyFields: [
          { name: 'email', required: true },
          { name: 'name', required: true },
          { name: 'password', required: true },
        ],
        produces: { statuses: [201] },
      },
      {
        method: 'GET',
        path: '/v1/weather',
        queryFields: [{ name: 'city', required: 'unknown' }],
        produces: { statuses: [200], bodyKeys: ['city'] },
      },
    ]);
  });

  it('keys contracts by the SAME operation identity the interfaces carry', () => {
    const files = [analyzed('/repo/src/app.ts', APP), analyzed('/repo/src/routes/bodyValidation.ts', VALIDATION)];
    const interfaces = deriveApiInterfacesFromTree(files, []);
    const operations = new Set(interfaces.map((j) => `${j.entry.method} ${j.entry.path}`));
    for (const contract of collectApiRequestContracts(files)) {
      expect(operations.has(`${contract.method} ${contract.path}`)).toBe(true);
    }
  });

  it('composes the mount prefix and canonicalizes the path, exactly as interfaces do', () => {
    const router = analyzed(
      '/repo/src/routes/todos.ts',
      `
        export const todosRouter = express.Router();
        todosRouter.patch('/:id', (req, res) => {
          if (!req.body.title) return res.status(400).end();
          res.json({});
        });
      `,
    );
    const app = analyzed('/repo/src/app.ts', `app.use('/api/todos', todosRouter);`, [
      {
        source: './routes/todos.js',
        specifiers: [{ name: 'todosRouter', isDefault: false, isNamespace: false }],
        isTypeOnly: false,
      },
    ]);
    const [contract] = collectApiRequestContracts([app, router]);
    expect(contract.path).toBe('/api/todos/{id}');
    expect(contract.bodyFields).toEqual([{ name: 'title', required: true }]);
    expect(contract.produces).toEqual({ statuses: [400] });
  });

  it('skips ALL routes, and an operation the walks established NOTHING about', () => {
    const contracts = collectApiRequestContracts([
      analyzed(
        '/repo/src/app.ts',
        `
          app.get('/healthz', healthz);
          app.all('/healthz', methodNotAllowed('GET'));
        `,
      ),
    ]);
    expect(contracts).toEqual([]);
  });

  it('merges two registrations of one operation — request and response side alike', () => {
    const contracts = collectApiRequestContracts([
      analyzed('/repo/src/a.ts', `app.post('/v1/x', (req, res) => res.json({ v: req.body.city }));`),
      analyzed('/repo/src/b.ts', `app.post('/v1/x', (req, res) => { if (!req.body.city) return res.status(400).end(); });`),
    ]);
    expect(contracts).toEqual([
      {
        method: 'POST',
        path: '/v1/x',
        bodyFields: [{ name: 'city', required: true }],
        produces: { statuses: [200, 400], bodyKeys: ['v'] },
      },
    ]);
  });

  it('keeps each link of a chained registration on ITS OWN operation', () => {
    // The four-coordinate key, end to end: a chain's links share a start position,
    // so a start-only join gave every link the last handler's contract.
    const contracts = collectApiRequestContracts([
      analyzed(
        '/repo/src/routes.ts',
        `
          const app = new Hono()
            .post('/alpha', (c) => { const { a } = c.req.valid('json'); return c.json({ ok: 1 }, 201) })
            .post('/beta', (c) => { const { b } = c.req.valid('json'); return c.json({ ok: 1 }, 202) })
        `,
      ),
    ]);
    expect(contracts).toEqual([
      {
        method: 'POST',
        path: '/alpha',
        bodyFields: [{ name: 'a', required: 'unknown' }],
        produces: { statuses: [201], bodyKeys: ['ok'] },
      },
      {
        method: 'POST',
        path: '/beta',
        bodyFields: [{ name: 'b', required: 'unknown' }],
        produces: { statuses: [202], bodyKeys: ['ok'] },
      },
    ]);
  });

  it('resolves a Hono validator middleware’s schema against the file that declares it', () => {
    const contracts = collectApiRequestContracts([
      analyzed(
        '/repo/src/routes/auth.ts',
        `
          const app = new Hono()
          app.post('/auth/sign-in', sValidator('json', ZSignInSchema), async (c) => {
            const { email } = c.req.valid('json');
            return c.json({ token: 't' });
          });
        `,
      ),
      analyzed(
        '/repo/src/schemas/auth.ts',
        `export const ZSignInSchema = z.object({ email: z.string(), totp: z.string().optional() });`,
      ),
    ]);
    // Requiredness travels with the resolution: the destructure alone said
    // `unknown`, the schema says which of the two the app refuses without.
    expect(contracts[0].bodyFields).toEqual([
      { name: 'email', required: true },
      { name: 'totp', required: false },
    ]);
  });

  it('resolves a Nest `@Body()` DTO class against the file that declares it', () => {
    const contracts = collectApiRequestContracts([
      analyzed(
        '/repo/src/bookings/bookings.controller.ts',
        `
          @Controller({ path: '/v2/bookings' })
          export class BookingsController {
            @Post('/')
            async create(@Body() body: CreateBookingInput) { return { id: 1 }; }
          }
        `,
      ),
      analyzed(
        '/repo/src/bookings/inputs.ts',
        `
          export class CreateBookingInput {
            @IsString() eventTypeId!: string;
            @IsOptional() @IsString() notes?: string;
          }
        `,
      ),
    ]);
    expect(contracts).toEqual([
      {
        method: 'POST',
        path: '/v2/bookings',
        bodyFields: [
          { name: 'eventTypeId', required: true },
          { name: 'notes', required: false },
        ],
        produces: { statuses: [201], bodyKeys: ['id'] },
      },
    ]);
  });
});
