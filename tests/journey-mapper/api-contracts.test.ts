/**
 * THE OPERATION-KEYED REQUEST CONTRACT JOIN (item 69).
 *
 * The contract is only useful if it survives to the generator keyed EXACTLY as the
 * journey it belongs to — same mount composition, same `canonicalRoutePath` — so
 * the per-journey prompt block can find it. These tests assert that identity, and
 * the cross-file validator resolution that is the whole reason the join exists.
 */

import { describe, it, expect } from 'vitest';
import { parseCode } from '../../packages/analyzer/src/parser';
import { extractRouteRegistrations } from '../../packages/analyzer/src/extractors/route-registrations';
import { extractRequestContracts } from '../../packages/analyzer/src/extractors/request-contracts';
import { collectApiRequestContracts } from '../../packages/journey-mapper/src/api-contracts';
import { deriveApiJourneysFromTree } from '../../packages/journey-mapper/src/api-tree';
import type { FileAnalysis, ImportStatement } from '../../packages/shared/src/types/analysis';

function analyzed(filePath: string, code: string, imports: ImportStatement[] = []): FileAnalysis {
  const tree = parseCode(code, 'typescript');
  const { routes, mounts } = extractRouteRegistrations(tree, filePath, 'typescript');
  const contracts = extractRequestContracts(tree, filePath, 'typescript');
  return {
    filePath,
    language: 'typescript',
    functions: [],
    classes: [],
    imports,
    exports: [],
    calls: [],
    httpCalls: [],
    routeRegistrations: routes.map((route) => {
      const contract = contracts.byRouteLocation.get(`${route.location.startLine}:${route.location.startColumn}`);
      return contract ? { ...route, requestContract: contract } : route;
    }),
    ...(mounts.length > 0 ? { routerMounts: mounts } : {}),
    ...(contracts.validators.length > 0 ? { requestValidators: contracts.validators } : {}),
  };
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
      },
      { method: 'GET', path: '/v1/weather', queryFields: [{ name: 'city', required: 'unknown' }] },
    ]);
  });

  it('keys contracts by the SAME operation identity the journeys carry', () => {
    const files = [analyzed('/repo/src/app.ts', APP), analyzed('/repo/src/routes/bodyValidation.ts', VALIDATION)];
    const journeys = deriveApiJourneysFromTree(files, []);
    const operations = new Set(journeys.map((j) => `${j.entry.method} ${j.entry.path}`));
    for (const contract of collectApiRequestContracts(files)) {
      expect(operations.has(`${contract.method} ${contract.path}`)).toBe(true);
    }
  });

  it('composes the mount prefix and canonicalizes the path, exactly as journeys do', () => {
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
    router.exports = [{ name: 'todosRouter', type: 'const', isDefault: false, location: router.routeRegistrations![0].location }];
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
  });

  it('skips ALL routes and operations whose handler said nothing', () => {
    const contracts = collectApiRequestContracts([
      analyzed('/repo/src/app.ts', `app.get('/healthz', (_req, res) => res.json({ ok: true }));`),
    ]);
    expect(contracts).toEqual([]);
  });

  it('merges two registrations of one operation, a KNOWN requiredness winning', () => {
    const contracts = collectApiRequestContracts([
      analyzed('/repo/src/a.ts', `app.post('/v1/x', (req, res) => res.json({ v: req.body.city }));`),
      analyzed('/repo/src/b.ts', `app.post('/v1/x', (req, res) => { if (!req.body.city) return res.status(400).end(); });`),
    ]);
    expect(contracts).toEqual([
      { method: 'POST', path: '/v1/x', bodyFields: [{ name: 'city', required: true }] },
    ]);
  });
});
