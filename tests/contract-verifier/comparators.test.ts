import { describe, it, expect } from 'vitest';
import {
  compareErrorEnvelope,
  comparePagination,
  compareAuthRequirement,
  compareIdempotency,
  compareAuthorizationRule,
  compareEffectGroup,
} from '../../packages/contract-verifier/src/comparator/index.js';
import { routeKey } from '../../packages/contract-verifier/src/extractor/idempotency-presence.js';
import type {
  ArtifactRef,
  AuthRequirementContract,
  AuthorizationRuleContract,
  EffectGroupContract,
  ErrorEnvelopeContract,
  IdempotencyContractC,
  OperationContract,
  PaginationContractC,
} from '../../packages/contract-verifier/src/types/index.js';
import type { ResolvedArtifact } from '../../packages/contract-verifier/src/resolver/index.js';
import type { ExtractedOperation } from '../../packages/contract-verifier/src/extractor/index.js';

/**
 * Layer-3 tests: targeted per-comparator coverage. Each test builds a
 * small spec-side contract + matching code-side contract by hand, runs
 * the comparator in isolation, and asserts which obligation keys fire.
 *
 * No fixture, no file walking — just structural inputs. These are the
 * tests that catch comparator regressions before they bubble up to the
 * end-to-end fixture.
 */

const refOp = (identity: string): ArtifactRef => ({ type: 'Operation', identity, quoted: true });

function specOpFromContract(ref: ArtifactRef, contract: OperationContract): ResolvedArtifact {
  return {
    ref,
    origin: null,
    declarationLoc: { filePath: '<spec>', lineStart: 1, lineEnd: 1 },
    body: { head: [], block: [], loc: { line: 1, col: 1 } } as any,
    contract,
  };
}

function codeOp(filePath: string, line: number, contract: OperationContract): ExtractedOperation {
  return {
    identity: `${contract.method} ${contract.path}`,
    contract,
    filePath,
    declarationLine: line,
    observed: { queryParams: [], numericClamps: [], hasClampCall: false },
  } as ExtractedOperation;
}

// ---------------------------------------------------------------------------
// ErrorEnvelope
// ---------------------------------------------------------------------------

describe('compareErrorEnvelope', () => {
  const envelopeRef: ArtifactRef = { type: 'ErrorEnvelope', identity: 'error.envelope.standard', quoted: false };
  const contract: ErrorEnvelopeContract = {
    appliesTo: { statusClass: ['4xx'] },
    shape: {},
    knownCodes: ['validation_failed'],
  };

  it('flags an error response that uses a bare body (no `error` envelope)', () => {
    const op: OperationContract = {
      protocol: 'http',
      method: 'POST',
      path: '/api/orders',
      tags: [],
      responses: [
        // Code returns 400 with a body whose top-level keys don't include `error`.
        { status: '400', body: { kind: 'inline', fields: { message: 'string' } } },
      ],
    };
    const drifts = compareErrorEnvelope({
      envelopeRef,
      contract,
      extractedOps: [codeOp('/code/orders.ts', 10, op)],
    });
    expect(drifts.some((d) => d.obligationKey.includes('shape'))).toBe(true);
  });

  it('passes when the error response wraps the body in `{ error: { … } }`', () => {
    const op: OperationContract = {
      protocol: 'http',
      method: 'POST',
      path: '/api/orders',
      tags: [],
      responses: [
        { status: '400', body: { kind: 'inline', fields: { error: 'object' } } },
      ],
    };
    const drifts = compareErrorEnvelope({
      envelopeRef,
      contract,
      extractedOps: [codeOp('/code/orders.ts', 10, op)],
    });
    expect(drifts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe('comparePagination', () => {
  const paginationRef: ArtifactRef = {
    type: 'PaginationContract',
    identity: 'pagination.cursor.standard',
    quoted: false,
  };
  const contract: PaginationContractC = {
    scheme: 'cursor',
    query: [
      { name: 'cursor', type: 'string', required: false },
      { name: 'limit', type: 'integer', required: false, max: 50 },
    ],
    responseShape: {},
    forbids: [
      { kind: 'query-param', value: 'offset' },
      { kind: 'query-param', value: 'page' },
    ],
    selector: { kind: 'tag', tag: 'list' },
  };

  it('flags forbidden query-params the handler reads', () => {
    const code: OperationContract = {
      protocol: 'http',
      method: 'GET',
      path: '/api/orders',
      tags: ['list'],
      responses: [{ status: '200' }],
    };
    const op = codeOp('/code/orders.ts', 10, code);
    op.observed = { queryParams: ['cursor', 'offset', 'page'], numericClamps: [], hasClampCall: false };

    const specOp = specOpFromContract(refOp('GET /api/orders'), { ...code, tags: ['list'] });
    const drifts = comparePagination({
      paginationRef,
      contract,
      specOps: new Map([['GET /api/orders', specOp]]),
      recognizedOps: [op],
    });
    const keys = drifts.map((d) => d.obligationKey);
    expect(keys.some((k) => k.includes('query-param-offset'))).toBe(true);
    expect(keys.some((k) => k.includes('query-param-page'))).toBe(true);
  });

  it('flags missing limit clamp', () => {
    const code: OperationContract = {
      protocol: 'http',
      method: 'GET',
      path: '/api/orders',
      tags: ['list'],
      responses: [{ status: '200' }],
    };
    const op = codeOp('/code/orders.ts', 10, code);
    op.observed = { queryParams: ['cursor', 'limit'], numericClamps: [], hasClampCall: false };

    const specOp = specOpFromContract(refOp('GET /api/orders'), code);
    const drifts = comparePagination({
      paginationRef,
      contract,
      specOps: new Map([['GET /api/orders', specOp]]),
      recognizedOps: [op],
    });
    expect(drifts.some((d) => d.obligationKey.includes('limit.max-50-not-clamped'))).toBe(true);
  });

  it('emits no drift when the handler honours the contract', () => {
    const code: OperationContract = {
      protocol: 'http',
      method: 'GET',
      path: '/api/orders',
      tags: ['list'],
      responses: [{ status: '200' }],
    };
    const op = codeOp('/code/orders.ts', 10, code);
    op.observed = { queryParams: ['cursor', 'limit'], numericClamps: [50], hasClampCall: true };

    const specOp = specOpFromContract(refOp('GET /api/orders'), code);
    const drifts = comparePagination({
      paginationRef,
      contract,
      specOps: new Map([['GET /api/orders', specOp]]),
      recognizedOps: [op],
    });
    expect(drifts.filter((d) => d.obligationKey.includes('forbid'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AuthRequirement
// ---------------------------------------------------------------------------

describe('compareAuthRequirement', () => {
  const authRef: ArtifactRef = { type: 'AuthRequirement', identity: 'auth.bearer.api', quoted: false };
  const contract: AuthRequirementContract = {
    scheme: 'Bearer',
    selector: { kind: 'path-glob', pattern: '/api/**' },
    onViolation: { status: 401, errorCode: 'unauthenticated' },
  };

  it('flags a route matching the selector when its file is not in protectedFiles', () => {
    const code: OperationContract = {
      protocol: 'http',
      method: 'GET',
      path: '/api/customers',
      tags: [],
      responses: [{ status: '200' }],
    };
    const op = codeOp('/code/customers.ts', 7, code);
    const specOp = specOpFromContract(refOp('GET /api/customers'), code);
    const drifts = compareAuthRequirement({
      authRef,
      contract,
      specOps: new Map([['GET /api/customers', specOp]]),
      recognizedOps: [op],
      protectedFiles: new Set(),
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toContain('unprotected');
  });

  it('emits no drift when the route\'s file is auth-protected', () => {
    const code: OperationContract = {
      protocol: 'http',
      method: 'GET',
      path: '/api/orders',
      tags: [],
      responses: [{ status: '200' }],
    };
    const op = codeOp('/code/orders.ts', 7, code);
    const specOp = specOpFromContract(refOp('GET /api/orders'), code);
    const drifts = compareAuthRequirement({
      authRef,
      contract,
      specOps: new Map([['GET /api/orders', specOp]]),
      recognizedOps: [op],
      protectedFiles: new Set(['/code/orders.ts']),
    });
    expect(drifts).toEqual([]);
  });

  it('skips routes that don\'t match the selector', () => {
    const code: OperationContract = {
      protocol: 'http',
      method: 'GET',
      path: '/health',          // outside `/api/**` glob
      tags: [],
      responses: [{ status: '200' }],
    };
    const op = codeOp('/code/health.ts', 1, code);
    const specOp = specOpFromContract(refOp('GET /health'), code);
    const drifts = compareAuthRequirement({
      authRef,
      contract,
      specOps: new Map([['GET /health', specOp]]),
      recognizedOps: [op],
      protectedFiles: new Set(),
    });
    expect(drifts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// IdempotencyContract
// ---------------------------------------------------------------------------

describe('compareIdempotency', () => {
  const idempotencyRef: ArtifactRef = { type: 'IdempotencyContract', identity: 'idempotency.key.standard', quoted: false };
  const contract: IdempotencyContractC = {
    requestHeader: 'Idempotency-Key',
    semantics: 'short-circuit-on-repeat',
    selector: { kind: 'tag', tag: 'idempotent' },
  };

  it('flags an idempotent-tagged route whose declaration is not in protectedRoutes', () => {
    const code: OperationContract = {
      protocol: 'http',
      method: 'POST',
      path: '/api/orders',
      tags: ['idempotent'],
      responses: [{ status: '201' }],
    };
    const op = codeOp('/code/orders.ts', 18, code);
    const specOp = specOpFromContract(refOp('POST /api/orders'), code);
    const drifts = compareIdempotency({
      idempotencyRef,
      contract,
      specOps: new Map([['POST /api/orders', specOp]]),
      recognizedOps: [op],
      protectedRoutes: new Set(),
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toContain('missing-idempotency-key-handling');
  });

  it('emits no drift when the route IS in protectedRoutes', () => {
    const code: OperationContract = {
      protocol: 'http',
      method: 'POST',
      path: '/api/orders',
      tags: ['idempotent'],
      responses: [{ status: '201' }],
    };
    const op = codeOp('/code/orders.ts', 18, code);
    const specOp = specOpFromContract(refOp('POST /api/orders'), code);
    const drifts = compareIdempotency({
      idempotencyRef,
      contract,
      specOps: new Map([['POST /api/orders', specOp]]),
      recognizedOps: [op],
      protectedRoutes: new Set([routeKey('/code/orders.ts', 18)]),
    });
    expect(drifts).toEqual([]);
  });

  it('skips routes that don\'t carry the idempotent tag', () => {
    const code: OperationContract = {
      protocol: 'http',
      method: 'POST',
      path: '/api/customers',
      tags: [],
      responses: [{ status: '201' }],
    };
    const op = codeOp('/code/customers.ts', 5, code);
    const specOp = specOpFromContract(refOp('POST /api/customers'), code);
    const drifts = compareIdempotency({
      idempotencyRef,
      contract,
      specOps: new Map([['POST /api/customers', specOp]]),
      recognizedOps: [op],
      protectedRoutes: new Set(),
    });
    expect(drifts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AuthorizationRule (predicate signature shape only — needs handlerBody for
// real verification, which the end-to-end fixture covers).
// ---------------------------------------------------------------------------

describe('compareAuthorizationRule (selector targeting)', () => {
  const authzRef: ArtifactRef = { type: 'AuthorizationRule', identity: 'order.owner-only', quoted: false };
  const contract: AuthorizationRuleContract = {
    appliesTo: { operations: [refOp('GET /api/orders/{id}')] },
    predicate: 'order.customerId === req.auth.userId',
    onViolation: { status: 403, errorCode: 'forbidden' },
  };

  it('targets only operations listed in appliesTo.operations', () => {
    const target: OperationContract = {
      protocol: 'http',
      method: 'GET',
      path: '/api/orders/{id}',
      tags: [],
      responses: [{ status: '200' }],
    };
    const unrelated: OperationContract = {
      protocol: 'http',
      method: 'GET',
      path: '/api/customers/{id}',
      tags: [],
      responses: [{ status: '200' }],
    };
    const op1 = codeOp('/code/orders.ts', 92, target);
    const op2 = codeOp('/code/customers.ts', 7, unrelated);

    const drifts = compareAuthorizationRule({
      authzRef,
      contract,
      recognizedOps: [op1, op2],
    });
    // Both ops are missing the predicate (handlerBody is undefined), but
    // only the targeted one should appear in drift output.
    expect(drifts.every((d) => d.filePath === '/code/orders.ts')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EffectGroup (structural — full coverage in end-to-end since detection
// requires walking handler bodies).
// ---------------------------------------------------------------------------

describe('compareEffectGroup (operation-target resolution)', () => {
  const groupRef: ArtifactRef = { type: 'EffectGroup', identity: 'order.lifecycle.events', quoted: false };
  const contract: EffectGroupContract = {
    channel: 'orders',
    payloadShape: {},
    effects: [
      {
        identity: 'order.placed',
        emitWhen: { operationRef: refOp('POST /api/orders'), onStatus: '201' },
      },
    ],
    forbids: [],
  };

  it('emits no drift when emitWhen targets an operation that is not in the recognized set', () => {
    // Defensive: a stale Effect referencing an Operation the code no
    // longer ships should not crash the comparator.
    const drifts = compareEffectGroup({
      effectGroupRef: groupRef,
      contract,
      specOps: new Map(),
      recognizedOps: [],
    });
    expect(drifts).toEqual([]);
  });
});
