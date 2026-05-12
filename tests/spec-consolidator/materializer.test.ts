import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  detectModules,
  materializeSpec,
  mergeClaims,
  candidateFingerprint,
  SHARED_MODULE,
  type Claim,
  type DecisionsFile,
  type SectionRunner,
} from '../../packages/spec-consolidator/src/index.js';

/**
 * Materializer tests use a stub section-runner that echoes the
 * claim subjects back as a fake markdown body. That lets us pin the
 * file-system layout, manifest serialization, and decision-handling
 * without LLM calls.
 *
 * Acceptance shape:
 *   - modules/<name>/module.yaml present, valid YAML, scope captured
 *   - modules/<name>/<topic>.md present per topic that has claims
 *   - shared/<topic>.md for _shared (no module.yaml)
 *   - decisions.json written when present
 *   - failures preserved per-section without aborting the batch
 *   - claims attributed via decisions (pick + custom) are included
 */

let specRoot: string;

beforeEach(() => {
  specRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-mat-'));
});

afterEach(() => {
  fs.rmSync(specRoot, { recursive: true, force: true });
});

function endpoint(modulePath: string, opts: Partial<Claim> = {}): Claim {
  return {
    id: opts.id ?? `id-${modulePath}`,
    topic: 'endpoints',
    subject: `GET ${modulePath}`,
    content: { method: 'GET', path: modulePath },
    provenance: { file: 'docs/x.md', line: 1, quote: 'q' },
    metadata: { docKind: 'prd', lastTouched: '2026-01-01T00:00:00Z' },
    ...opts,
  };
}

function stubRunner(): SectionRunner {
  return async (sections) =>
    sections.map((s) => ({
      module: s.module,
      topic: s.topic,
      fileName: s.fileName,
      markdown: `# ${s.topic} (${s.module})\n\n${s.claims.map((c) => `- ${c.subject}`).join('\n')}\n`,
      durationMs: 1,
    }));
}

const emptyDecisions: DecisionsFile = { version: 1, decisions: [] };

describe('materializeSpec — directory layout', () => {
  it('writes modules/<name>/module.yaml + endpoints.md per detected module', async () => {
    const claims = [
      endpoint('/api/v1/orders'),
      endpoint('/api/v1/orders/{id}'),
      endpoint('/health'),
    ];
    const merge = mergeClaims(claims);
    const modules = detectModules([...merge.resolvedClaims]);
    const result = await materializeSpec(specRoot, merge, modules.modules, emptyDecisions, { runner: stubRunner() });

    expect(result.failures).toEqual([]);
    expect(fs.existsSync(path.join(specRoot, 'modules/orders/module.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(specRoot, 'modules/orders/endpoints.md'))).toBe(true);
    expect(fs.existsSync(path.join(specRoot, 'modules/health/module.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(specRoot, 'modules/health/endpoints.md'))).toBe(true);
  });

  it('writes _shared content under shared/ — no module.yaml for _shared', async () => {
    const sharedAuth: Claim = {
      id: 'auth-claim',
      topic: 'auth',
      subject: 'auth scheme',
      content: { scheme: 'Bearer JWT' },
      provenance: { file: 'docs/x.md', line: 1, quote: 'q' },
      metadata: { docKind: 'prd', lastTouched: '2026-01-01T00:00:00Z' },
    };
    const merge = mergeClaims([sharedAuth]);
    const modules = detectModules([...merge.resolvedClaims]);
    await materializeSpec(specRoot, merge, modules.modules, emptyDecisions, { runner: stubRunner() });

    expect(fs.existsSync(path.join(specRoot, 'shared/auth.md'))).toBe(true);
    expect(fs.existsSync(path.join(specRoot, 'modules/_shared/module.yaml'))).toBe(false);
  });

  it('emits a section file per (module, topic) pair', async () => {
    const claims: Claim[] = [
      endpoint('/api/v1/orders'),
      {
        id: 'data-claim',
        topic: 'data',
        subject: 'Order entity',
        content: { fields: { id: 'uuid' } },
        provenance: { file: 'docs/x.md', line: 1, quote: 'q' },
        metadata: { docKind: 'prd', lastTouched: '2026-01-01T00:00:00Z' },
      },
    ];
    // Force the data claim to attribute to "orders" via path-shaped subject.
    claims[1].subject = '/api/v1/orders entity';
    claims[1].content = { ...(claims[1].content as object), path: '/api/v1/orders' };

    const merge = mergeClaims(claims);
    const modules = detectModules([...merge.resolvedClaims]);
    await materializeSpec(specRoot, merge, modules.modules, emptyDecisions, { runner: stubRunner() });

    expect(fs.existsSync(path.join(specRoot, 'modules/orders/endpoints.md'))).toBe(true);
    // The data claim attributed to orders → modules/orders/data.md
    expect(fs.existsSync(path.join(specRoot, 'modules/orders/data.md'))).toBe(true);
  });
});

describe('materializeSpec — manifest contents', () => {
  it('writes a valid YAML manifest with name, status, sourceDocs, scope', async () => {
    const claims = [
      endpoint('/api/v1/orders', { provenance: { file: 'docs/PRD-v1.md', line: 1, quote: 'q' } }),
      endpoint('/api/v1/orders/{id}', { provenance: { file: 'docs/PRD-v2.md', line: 1, quote: 'q' } }),
    ];
    const merge = mergeClaims(claims);
    const modules = detectModules([...merge.resolvedClaims]);
    await materializeSpec(specRoot, merge, modules.modules, emptyDecisions, { runner: stubRunner() });

    const raw = fs.readFileSync(path.join(specRoot, 'modules/orders/module.yaml'), 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown>;
    expect(parsed.name).toBe('orders');
    expect(parsed.status).toBe('shipped');
    expect(parsed.sourceDocs).toEqual(['docs/PRD-v1.md', 'docs/PRD-v2.md']);
    expect((parsed.scope as { paths: string[] }).paths[0]).toMatch(/orders\/\*\*$/);
  });

  it('lifts a uniform out-of-scope status to the module manifest', async () => {
    const claims = [
      { ...endpoint('/api/v1/infractions/foo'), metadata: { docKind: 'prd' as const, lastTouched: 't', status: 'out-of-scope' as const } },
      { ...endpoint('/api/v1/infractions/bar'), metadata: { docKind: 'prd' as const, lastTouched: 't', status: 'out-of-scope' as const } },
    ];
    const merge = mergeClaims(claims);
    const modules = detectModules([...merge.resolvedClaims]);
    await materializeSpec(specRoot, merge, modules.modules, emptyDecisions, { runner: stubRunner() });

    const raw = fs.readFileSync(path.join(specRoot, 'modules/infractions/module.yaml'), 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown>;
    expect(parsed.status).toBe('out-of-scope');
  });
});

describe('materializeSpec — decisions.json', () => {
  it('writes decisions.json by default', async () => {
    const decisions: DecisionsFile = {
      version: 1,
      decisions: [
        {
          conflictId: 'fake-id',
          resolution: { kind: 'pick', candidateIndex: 0 },
          resolvedAt: '2026-05-01T00:00:00Z',
          candidateFingerprint: 'fp',
        },
      ],
    };
    const claims = [endpoint('/api/v1/orders')];
    const merge = mergeClaims(claims);
    const modules = detectModules([...merge.resolvedClaims]);
    await materializeSpec(specRoot, merge, modules.modules, decisions, { runner: stubRunner() });

    const raw = fs.readFileSync(path.join(specRoot, 'decisions.json'), 'utf-8');
    expect(JSON.parse(raw)).toEqual(decisions);
  });

  it('skips writing decisions.json when skipDecisions=true (caller-managed)', async () => {
    const claims = [endpoint('/api/v1/orders')];
    const merge = mergeClaims(claims);
    const modules = detectModules([...merge.resolvedClaims]);
    await materializeSpec(specRoot, merge, modules.modules, emptyDecisions, {
      runner: stubRunner(),
      skipDecisions: true,
    });
    expect(fs.existsSync(path.join(specRoot, 'decisions.json'))).toBe(false);
  });
});

describe('materializeSpec — claim attribution via decisions', () => {
  function makePair() {
    // Two claims with truly disjoint success codes — neither side's
    // responses keys is a subset of the other's, so the merger leaves
    // this as a real user-resolvable conflict.
    const a = {
      ...endpoint('/api/v1/orders', { id: 'id-a', metadata: { docKind: 'prd', lastTouched: '2025-01-01T00:00:00Z' } }),
      content: { method: 'GET', path: '/api/v1/orders', responses: { '200': {} } },
    };
    const b = {
      ...endpoint('/api/v1/orders', { id: 'id-b', metadata: { docKind: 'prd', lastTouched: '2026-01-01T00:00:00Z' } }),
      content: { method: 'GET', path: '/api/v1/orders', responses: { '201': {} } },
    };
    return [a, b];
  }

  it('includes the picked candidate in the rendered section (pick decision)', async () => {
    const [a, b] = makePair();
    const initial = mergeClaims([a, b]);
    const conflict = initial.openConflicts[0];
    const decisions: DecisionsFile = {
      version: 1,
      decisions: [{
        conflictId: conflict.id,
        resolution: { kind: 'pick', candidateIndex: 0 }, // user picked the older one
        resolvedAt: '2026-05-01T00:00:00Z',
        candidateFingerprint: candidateFingerprint(conflict),
      }],
    };
    const merge = mergeClaims([a, b], decisions);
    expect(merge.openConflicts).toEqual([]);
    const modules = detectModules([...merge.resolvedClaims, ...(merge.decidedConflicts.flatMap((d) => d.resolvedClaim ? [d.resolvedClaim] : []))]);
    await materializeSpec(specRoot, merge, modules.modules, decisions, { runner: stubRunner() });

    const md = fs.readFileSync(path.join(specRoot, 'modules/orders/endpoints.md'), 'utf-8');
    expect(md).toContain('GET /api/v1/orders');
  });

  it('synthesizes a custom claim into the rendered section', async () => {
    const [a, b] = makePair();
    const initial = mergeClaims([a, b]);
    const conflict = initial.openConflicts[0];
    const decisions: DecisionsFile = {
      version: 1,
      decisions: [{
        conflictId: conflict.id,
        resolution: { kind: 'custom', content: 'returns 200 with { items: Order[] }' },
        resolvedAt: '2026-05-01T00:00:00Z',
        candidateFingerprint: candidateFingerprint(conflict),
      }],
    };
    const merge = mergeClaims([a, b], decisions);
    // Custom claims aren't in detectedModules — they fall to _shared by default.
    const modules = detectModules(merge.resolvedClaims);
    await materializeSpec(specRoot, merge, modules.modules, decisions, { runner: stubRunner() });
    // Custom claim → _shared → shared/endpoints.md
    expect(fs.existsSync(path.join(specRoot, 'shared/endpoints.md'))).toBe(true);
    const md = fs.readFileSync(path.join(specRoot, 'shared/endpoints.md'), 'utf-8');
    expect(md).toContain('GET /api/v1/orders');
  });
});

describe('materializeSpec — failure handling', () => {
  it('preserves section failures without aborting the batch', async () => {
    const claims = [endpoint('/api/v1/orders'), endpoint('/health')];
    const merge = mergeClaims(claims);
    const modules = detectModules([...merge.resolvedClaims]);
    const failingRunner: SectionRunner = async (sections) =>
      sections.map((s) =>
        s.module === 'health'
          ? { module: s.module, topic: s.topic, fileName: s.fileName, error: 'boom', durationMs: 1 }
          : { module: s.module, topic: s.topic, fileName: s.fileName, markdown: `ok ${s.module}\n`, durationMs: 1 },
      );
    const result = await materializeSpec(specRoot, merge, modules.modules, emptyDecisions, { runner: failingRunner });

    expect(fs.existsSync(path.join(specRoot, 'modules/orders/endpoints.md'))).toBe(true);
    expect(fs.existsSync(path.join(specRoot, 'modules/health/endpoints.md'))).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].error).toBe('boom');
  });

  it('still writes the manifest even when a section render fails', async () => {
    const claims = [endpoint('/api/v1/orders')];
    const merge = mergeClaims(claims);
    const modules = detectModules([...merge.resolvedClaims]);
    const allFailRunner: SectionRunner = async (sections) =>
      sections.map((s) => ({ module: s.module, topic: s.topic, fileName: s.fileName, error: 'failure', durationMs: 1 }));
    await materializeSpec(specRoot, merge, modules.modules, emptyDecisions, { runner: allFailRunner });
    expect(fs.existsSync(path.join(specRoot, 'modules/orders/module.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(specRoot, 'modules/orders/endpoints.md'))).toBe(false);
  });
});
