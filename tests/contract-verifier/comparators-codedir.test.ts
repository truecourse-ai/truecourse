import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initParsers, parseFile } from '../../packages/analyzer/src/index.js';
import { compareEntity } from '../../packages/contract-verifier/src/comparator/entity.js';
import { extractEntityFacts } from '../../packages/contract-verifier/src/extractor/entity-facts/index.js';
import { compareStateMachine } from '../../packages/contract-verifier/src/comparator/state-machine.js';
import { extractStateMachineFacts } from '../../packages/contract-verifier/src/extractor/state-machine-facts/index.js';
import { compareFormula } from '../../packages/contract-verifier/src/comparator/formula.js';
import { extractFormulaFacts } from '../../packages/contract-verifier/src/extractor/formula-facts/index.js';
import { compareEffectGroup } from '../../packages/contract-verifier/src/comparator/effect-group.js';
import { extractEmissionFacts } from '../../packages/contract-verifier/src/extractor/effect/emission-facts.js';
import { extractOperationsFromFile } from '../../packages/contract-verifier/src/extractor/operation.js';
import type {
  ArtifactRef,
  EntityContract,
  EffectGroupContract,
  FormulaContract,
  StateMachineContract,
  OperationContract,
} from '../../packages/contract-verifier/src/types/index.js';
import type { ResolvedArtifact } from '../../packages/contract-verifier/src/resolver/index.js';
import type { ExtractedOperation } from '../../packages/contract-verifier/src/extractor/index.js';

/**
 * Layer-3 tests for the four comparators that walk a codeDir or handler
 * AST: Entity, StateMachine, Formula, and the handler-body half of
 * EffectGroup. Each test sets up a tmp source tree, runs the comparator
 * in isolation, and asserts the obligation keys it emits.
 *
 * The end-to-end fixture exercises all of these transitively; these
 * tests pin the per-comparator contract so a regression surfaces here
 * (with a focused failure) before it bubbles up to the fixture.
 */

let root: string;

beforeAll(async () => {
  await initParsers();
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cmp-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function place(rel: string, body: string): string {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  return full;
}

const ref = (type: ArtifactRef['type'], identity: string): ArtifactRef => ({
  type,
  identity,
  quoted: false,
});

// ---------------------------------------------------------------------------
// Entity — immutable field reassignment + missing normalize
// ---------------------------------------------------------------------------

describe('compareEntity', () => {
  it('flags a direct assignment to an immutable field', async () => {
    place(
      'src/orders.ts',
      `
        export function backdate(order: any) {
          order.placedAt = new Date('2020-01-01').toISOString();
        }
      `,
    );

    const contract: EntityContract = {
      fields: {
        placedAt: { type: 'string', mutability: 'immutable' },
      },
    };
    const drifts = compareEntity({
      entityRef: ref('Entity', 'Order'),
      contract,
      facts: await extractEntityFacts(root),
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toBe('field.placedAt.mutability');
    expect(drifts[0].filePath).toMatch(/orders\.ts$/);
  });

  it('does not flag object-literal initialization (creation, not mutation)', async () => {
    place(
      'src/orders.ts',
      `
        export function create() {
          const order = { placedAt: new Date().toISOString(), customerId: 'x' };
          return order;
        }
      `,
    );
    const contract: EntityContract = {
      fields: { placedAt: { type: 'string', mutability: 'immutable' } },
    };
    const drifts = compareEntity({
      entityRef: ref('Entity', 'Order'),
      contract,
      facts: await extractEntityFacts(root),
    });
    expect(drifts).toEqual([]);
  });

  it('flags missing normalize-lowercase when the constructing file omits .toLowerCase()', async () => {
    place(
      'src/customers.ts',
      `
        export function makeCustomer(input: { email: string }): Customer {
          const c = { email: input.email };
          return new Customer(c);
        }
        class Customer { constructor(public data: any) {} }
      `,
    );

    const contract: EntityContract = {
      fields: {
        email: { type: 'string', normalize: 'lowercase' },
      },
    };
    const drifts = compareEntity({
      entityRef: ref('Entity', 'Customer'),
      contract,
      facts: await extractEntityFacts(root),
    });
    expect(drifts.some((d) => d.obligationKey === 'field.email.normalize')).toBe(true);
  });

  it('passes when .toLowerCase() appears in the constructing file', async () => {
    place(
      'src/customers.ts',
      `
        export function makeCustomer(input: { email: string }) {
          const normalized = input.email.toLowerCase();
          return new Customer({ email: normalized });
        }
        class Customer { constructor(public data: any) {} }
      `,
    );
    const contract: EntityContract = {
      fields: { email: { type: 'string', normalize: 'lowercase' } },
    };
    const drifts = compareEntity({
      entityRef: ref('Entity', 'Customer'),
      contract,
      facts: await extractEntityFacts(root),
    });
    expect(drifts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// StateMachine — illegal transition map entry + unguarded terminal regression
// ---------------------------------------------------------------------------

describe('compareStateMachine', () => {
  const orderEntityRef = ref('Entity', 'Order');
  const machineRef = ref('StateMachine', 'Order.status');

  const baseContract: StateMachineContract = {
    scope: { entityRef: orderEntityRef, field: 'status' },
    statesRef: ref('Enum', 'OrderStatus'),
    initial: ['placed'],
    terminal: ['cancelled', 'delivered'],
    transitions: [
      { from: 'placed', to: 'paid' },
      { from: 'paid', to: 'shipped' },
      { from: 'shipped', to: 'delivered' },
      { from: 'placed', to: 'cancelled' },
      { from: 'paid', to: 'cancelled' },
    ],
  };

  it('flags a transition map that allows an illegal edge', async () => {
    // The map permits shipped → cancelled, which the spec forbids.
    place(
      'src/lifecycle.ts',
      `
        export const ORDER_TRANSITIONS: Record<string, string[]> = {
          placed: ['paid', 'cancelled'],
          paid: ['shipped', 'cancelled'],
          shipped: ['delivered', 'cancelled'],
          cancelled: [],
          delivered: [],
        };
      `,
    );

    const drifts = compareStateMachine({
      machineRef,
      contract: baseContract,
      facts: await extractStateMachineFacts(root),
    });
    expect(drifts.some((d) => d.obligationKey === 'transition.illegal.shipped-to-cancelled')).toBe(true);
  });

  it('flags an unguarded write that could regress out of a terminal state', async () => {
    // `order.status = 'paid'` runs unconditionally — could fire even when
    // the order is already in the terminal `cancelled` state.
    place(
      'src/orders.ts',
      `
        export function refundAndPay(order: any) {
          order.status = 'paid';
        }
      `,
    );

    const drifts = compareStateMachine({
      machineRef,
      contract: baseContract,
      facts: await extractStateMachineFacts(root),
    });
    expect(drifts.some((d) => d.obligationKey === 'transition.unguarded-terminal-regression.to-paid')).toBe(true);
  });

  it('emits no drift for a well-formed transition map', async () => {
    place(
      'src/lifecycle.ts',
      `
        export const ORDER_TRANSITIONS: Record<string, string[]> = {
          placed: ['paid', 'cancelled'],
          paid: ['shipped', 'cancelled'],
          shipped: ['delivered'],
          cancelled: [],
          delivered: [],
        };
      `,
    );
    const drifts = compareStateMachine({
      machineRef,
      contract: baseContract,
      facts: await extractStateMachineFacts(root),
    });
    expect(drifts.filter((d) => d.obligationKey.startsWith('transition.illegal'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Formula — operator-on-numeric-threshold + unused input
// ---------------------------------------------------------------------------

describe('compareFormula', () => {
  const orderRef = ref('Entity', 'Order');
  const discountRef = ref('Formula', 'order.discount-cents');

  it('flags an off-by-one operator on a numeric threshold', async () => {
    // Spec: discount applies when subtotalCents >= 10000.
    // Code: implements `> 10000` instead. The 10000 boundary case flips.
    place(
      'src/pricing.ts',
      `
        export function discountCents(subtotalCents: number): number {
          if (subtotalCents > 10000) return Math.round(subtotalCents * 0.1);
          return 0;
        }
      `,
    );

    const contract: FormulaContract = {
      output: { entityRef: orderRef, field: 'discountCents' },
      inputs: [{ entityRef: orderRef, field: 'subtotalCents' }],
      expression: { kind: 'simple', raw: 'subtotalCents >= 10000 ? round(subtotalCents * 0.1) : 0' },
      computedAt: 'order-creation',
      immutableAfterCreation: true,
      dependsOn: [],
    };
    const drifts = compareFormula({
      formulaRef: discountRef,
      contract,
      facts: await extractFormulaFacts(root, contract.output.field),
    });
    expect(drifts.some((d) => d.obligationKey === 'expression.threshold-operator.10000')).toBe(true);
  });

  it('flags a declared input the implementation never reads', async () => {
    // Spec says tax depends on (subtotalCents - discountCents).
    // Code ignores discountCents entirely — wrong base.
    place(
      'src/pricing.ts',
      `
        export function taxCents(subtotalCents: number, _discountCents: number): number {
          return Math.round(subtotalCents * 0.08);
        }
      `,
    );

    const taxRef = ref('Formula', 'order.tax-cents');
    const contract: FormulaContract = {
      output: { entityRef: orderRef, field: 'taxCents' },
      inputs: [
        { entityRef: orderRef, field: 'subtotalCents' },
        { entityRef: orderRef, field: 'discountCents' },
      ],
      expression: { kind: 'simple', raw: 'round((subtotalCents - discountCents) * 0.08)' },
      computedAt: 'order-creation',
      immutableAfterCreation: true,
      dependsOn: [],
    };
    const drifts = compareFormula({
      formulaRef: taxRef,
      contract,
      facts: await extractFormulaFacts(root, contract.output.field),
    });
    expect(drifts.some((d) => d.obligationKey === 'inputs.discountCents.unused')).toBe(true);
  });

  it('emits no drift when operator + inputs match the spec', async () => {
    place(
      'src/pricing.ts',
      `
        export function discountCents(subtotalCents: number): number {
          if (subtotalCents >= 10000) return Math.round(subtotalCents * 0.1);
          return 0;
        }
      `,
    );
    const contract: FormulaContract = {
      output: { entityRef: orderRef, field: 'discountCents' },
      inputs: [{ entityRef: orderRef, field: 'subtotalCents' }],
      expression: { kind: 'simple', raw: 'subtotalCents >= 10000 ? round(subtotalCents * 0.1) : 0' },
      computedAt: 'order-creation',
      immutableAfterCreation: true,
      dependsOn: [],
    };
    const drifts = compareFormula({
      formulaRef: discountRef,
      contract,
      facts: await extractFormulaFacts(root, contract.output.field),
    });
    expect(drifts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// EffectGroup — missing emission + forbidden-emission-on-failure
//
// These checks need ExtractedOperation.handlerBody / handlerSource, which
// the operation extractor produces. We feed real source through it so
// the AST shape matches what the comparator expects.
// ---------------------------------------------------------------------------

describe('compareEffectGroup', () => {
  function extractOps(filePath: string, source: string): ExtractedOperation[] {
    const tree = parseFile(filePath, source, 'typescript');
    return extractOperationsFromFile(filePath, source, tree);
  }

  function specOpFor(method: string, urlPath: string): ResolvedArtifact {
    const opContract: OperationContract = {
      protocol: 'http',
      method,
      path: urlPath,
      tags: [],
      responses: [],
    };
    return {
      ref: ref('Operation', `${method} ${urlPath}`),
      origin: null,
      provenance: 'authored',
      declarationLoc: { filePath: '<spec>', lineStart: 1, lineEnd: 1 },
      body: { head: [], block: [], loc: { line: 1, col: 1 } } as any,
      contract: opContract,
    };
  }

  const groupRef = ref('EffectGroup', 'order.lifecycle.events');

  it('flags missing emission when the success-path code never calls emit*', async () => {
    const filePath = '/code/orders.ts';
    const source = `
      import express from 'express';
      const router = express.Router();
      router.post('/api/orders/:id/cancel', (req, res) => {
        res.status(200).json({ status: 'cancelled' });
      });
    `;
    const ops = extractOps(filePath, source).map((o) => ({ ...o, identity: 'POST /api/orders/{id}/cancel' }));

    const contract: EffectGroupContract = {
      channel: 'orders',
      payloadShape: {},
      effects: [
        {
          identity: 'order.cancelled',
          emitWhen: {
            operationRef: ref('Operation', 'POST /api/orders/{id}/cancel'),
            onStatus: '200',
          },
        },
      ],
      forbids: [],
    };

    const drifts = compareEffectGroup({
      effectGroupRef: groupRef,
      contract,
      emission: extractEmissionFacts(ops),
    });
    expect(drifts.some((d) => d.obligationKey === 'Effect:order.cancelled / missing-emission')).toBe(true);
  });

  it('emits no drift when the success-path code does call emit*', async () => {
    const filePath = '/code/orders.ts';
    const source = `
      import express from 'express';
      function emitOrderEvent(name: string, payload: any) {}
      const router = express.Router();
      router.post('/api/orders/:id/cancel', (req, res) => {
        emitOrderEvent('order.cancelled', { id: req.params.id });
        res.status(200).json({ status: 'cancelled' });
      });
    `;
    const ops = extractOps(filePath, source).map((o) => ({ ...o, identity: 'POST /api/orders/{id}/cancel' }));

    const contract: EffectGroupContract = {
      channel: 'orders',
      payloadShape: {},
      effects: [
        {
          identity: 'order.cancelled',
          emitWhen: {
            operationRef: ref('Operation', 'POST /api/orders/{id}/cancel'),
            onStatus: '200',
          },
        },
      ],
      forbids: [],
    };
    const drifts = compareEffectGroup({
      effectGroupRef: groupRef,
      contract,
      emission: extractEmissionFacts(ops),
    });
    expect(drifts.filter((d) => d.obligationKey.endsWith('missing-emission'))).toEqual([]);
  });
});
