import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { verify } from '../../packages/contract-verifier/src/verify.js';

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/sample-js-project-il');

describe('Contract verifier — end-to-end on fixture (Operation slice only)', () => {
  it('runs without resolver errors', async () => {
    const result = await verify({
      contractsDir: path.join(FIXTURE_ROOT, '.truecourse/contracts'),
      codeDir: path.join(FIXTURE_ROOT, 'code'),
    });
    expect(result.resolverErrors).toEqual([]);
    expect(result.artifactCount).toBeGreaterThanOrEqual(25);
    expect(result.extractedOperationCount).toBeGreaterThan(0);
  });

  it('catches Operation drifts from the planted bug catalog', async () => {
    const result = await verify({
      contractsDir: path.join(FIXTURE_ROOT, '.truecourse/contracts'),
      codeDir: path.join(FIXTURE_ROOT, 'code'),
    });

    // Helper to pluck (operationIdentity, obligationKey) tuples for matching.
    const driftKeys = result.drifts.map(
      (d) => `${d.artifactRef.type}:${d.artifactRef.identity} / ${d.obligationKey}`,
    );

    // Bug #1 — POST /api/orders returns 200 instead of 201.
    // The status declared as 201 is missing on the code side.
    expect(driftKeys).toContain('Operation:POST /api/orders / response.201');

    // Bug #2 — POST /api/orders missing Location header on 201.
    // (Won't fire since 201 itself is missing on the code side — bug #1
    //  hides it. Subsumed.)
    // After bug #1 is fixed the 201 path materializes and the missing
    // Location header drift becomes visible. Documented expectation:
    // intentionally not asserted as a separate drift in this end-to-end
    // pass; verified via a unit test on the comparator with a synthesized
    // input below.

    // Bug #3 — GET /api/orders returns bare array.
    expect(driftKeys).toContain('Operation:GET /api/orders / response.200.body.shape');

    // Bug #4 — GET /api/orders/{id} returns 200 + null body when missing.
    // The 404 path is missing on the code side AND the spec's
    // `forbid status 200 when resource-missing` clause fires because 200
    // is emitted indiscriminately.
    expect(driftKeys).toContain('Operation:GET /api/orders/{id} / response.404');
    expect(driftKeys).toContain(
      'Operation:GET /api/orders/{id} / response.404.forbid.status-200-when-resource-missing',
    );

    // Bug #18 — POST /api/orders is tagged `idempotent` in spec but the
    // route registers no idempotency middleware and never reads the
    // Idempotency-Key header. Repeat requests duplicate the order.
    expect(driftKeys).toContain(
      'IdempotencyContract:idempotency.key.standard / POST /api/orders/missing-idempotency-key-handling',
    );
  });

  it('emits ZERO false-positive drifts beyond the planted bugs', async () => {
    // Hard 0% FP gate. Every drift in the result must be one of the
    // expected planted-bug keys. Anything else is a false positive and
    // the test must fail until we make it true.
    const result = await verify({
      contractsDir: path.join(FIXTURE_ROOT, '.truecourse/contracts'),
      codeDir: path.join(FIXTURE_ROOT, 'code'),
    });
    const expected = new Set([
      // Phase 1 — Operation drifts
      'Operation:POST /api/orders / response.201',                                                  // bug #1
      'Operation:GET /api/orders / response.200.body.shape',                                       // bug #3
      'Operation:GET /api/orders/{id} / response.404',                                              // bug #4a
      'Operation:GET /api/orders/{id} / response.404.forbid.status-200-when-resource-missing',     // bug #4b
      // Phase 2 — cross-cutting
      'ErrorEnvelope:error.envelope.standard / POST /api/orders/response.400.shape',                // bug #12
      'PaginationContract:pagination.cursor.standard / GET /api/orders/forbid.query-param-offset', // bug #5a
      'PaginationContract:pagination.cursor.standard / GET /api/orders/forbid.query-param-page',   // bug #5b
      'PaginationContract:pagination.cursor.standard / GET /api/orders/limit.max-50-not-clamped',  // bug #6
      // Bug #11 cascade — customers router has no auth middleware, so all
      // three customer endpoints are unprotected, and the admin-role check
      // targeting POST /api/customers also doesn't apply.
      'AuthRequirement:auth.bearer.api / POST /api/customers/unprotected',                          // bug #11
      'AuthRequirement:auth.bearer.api / GET /api/customers/unprotected',                          // #11 cascade
      'AuthRequirement:auth.bearer.api / GET /api/customers/{id}/unprotected',                     // #11 cascade
      'AuthRequirement:auth.role.admin / POST /api/customers/unprotected',                          // #11 cascade
      // Phase 3 — Entity + StateMachine
      'Entity:Order / field.placedAt.mutability',                                                   // bug #9
      'Entity:Customer / field.email.normalize',                                                    // bug #10
      'StateMachine:Order.status / transition.illegal.shipped-to-cancelled',                        // bug #7
      'StateMachine:Order.status / transition.unguarded-terminal-regression.to-paid',               // bug #8
      // Phase 4 — Effect / AuthorizationRule / Formula
      'AuthorizationRule:order.owner-only / GET /api/orders/{id} / missing-ownership-check',        // bug #15
      'EffectGroup:order.lifecycle.events / Effect:order.cancelled / missing-emission',             // bug #13
      'EffectGroup:order.lifecycle.events / Effect:order.placed / forbidden-emission-on-failure',   // bug #14
      'Formula:order.discount-cents / expression.threshold-operator.10000',                         // bug #16
      'Formula:order.tax-cents / inputs.discountCents.unused',                                       // bug #17
      // Phase 5 — IdempotencyContract
      'IdempotencyContract:idempotency.key.standard / POST /api/orders/missing-idempotency-key-handling', // bug #18
    ]);
    const unexpected = result.drifts
      .map((d) => `${d.artifactRef.type}:${d.artifactRef.identity} / ${d.obligationKey}`)
      .filter((k) => !expected.has(k));
    expect(unexpected, `unexpected drifts:\n  ${unexpected.join('\n  ')}`).toEqual([]);
  });

  it('traces single-file delegation handlers (no implementation.missing FPs)', async () => {
    // The transition routes (POST /api/orders/{id}/pay, /ship, /cancel)
    // are registered as `(req, res, next) => transitionEndpoint(...)`.
    // The extractor must follow the call into `transitionEndpoint` and
    // attribute its responses back to the route — otherwise we'd emit
    // false-positive `implementation.missing` drifts for each.
    const result = await verify({
      contractsDir: path.join(FIXTURE_ROOT, '.truecourse/contracts'),
      codeDir: path.join(FIXTURE_ROOT, 'code'),
    });
    const missing = result.drifts.filter((d) => d.obligationKey === 'implementation.missing');
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Synthesized comparator test for the "Location header missing" drift —
// proves the comparator catches it when the 201 path itself isn't missing.
// ---------------------------------------------------------------------------

import { compareOperation } from '../../packages/contract-verifier/src/comparator/index.js';
import type { OperationContract } from '../../packages/contract-verifier/src/types/index.js';

describe('Operation comparator — header-presence drift', () => {
  it('flags missing Location header when 201 is emitted but header is not', () => {
    const spec: OperationContract = {
      protocol: 'http',
      method: 'POST',
      path: '/api/orders',
      tags: [],
      responses: [
        {
          status: '201',
          condition: { kind: 'success' },
          headers: [{ name: 'location', required: true }],
        },
      ],
    };
    const code: OperationContract = {
      protocol: 'http',
      method: 'POST',
      path: '/api/orders',
      tags: [],
      responses: [
        {
          status: '201',
          headers: [], // no location header
        },
      ],
    };
    const drifts = compareOperation({
      spec,
      code,
      specRef: { type: 'Operation', identity: 'POST /api/orders', quoted: true },
      codeFilePath: '/fake/orders.controller.ts',
      codeDeclarationLine: 1,
    });
    expect(drifts.map((d) => d.obligationKey)).toContain('response.201.headers.location');
  });
});
