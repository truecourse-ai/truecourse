import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  diffContractDirs,
  formatCorpusDiff,
} from '../../packages/contract-extractor/src/corpus-diff.js';

let leftDir: string;
let rightDir: string;

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-diff-'));
  leftDir = path.join(root, 'left');
  rightDir = path.join(root, 'right');
  fs.mkdirSync(leftDir, { recursive: true });
  fs.mkdirSync(rightDir, { recursive: true });
});

afterEach(() => {
  // Tmp roots cleaned per beforeEach.
});

function place(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

describe('corpus-diff (structural contract comparison)', () => {
  it('reports zero differences for identical corpora', () => {
    const tc = `
      operation POST "/api/orders" {
        response 201 on success {
          body Entity:Order
          header location required
        }
        tags []
      }
      entity Order {
        field id: string {
          immutable
        }
      }
    `;
    place(leftDir, 'a.tc', tc);
    place(rightDir, 'a.tc', tc);

    const diff = diffContractDirs(leftDir, rightDir);
    expect(diff.artifactDiffs).toEqual([]);
    expect(diff.obligationDiffs).toEqual([]);
    expect(diff.obligationCoverage).toBe(1);
  });

  it('flags an artifact that exists only on the left', () => {
    place(
      leftDir,
      'a.tc',
      `
      operation POST "/api/orders" {
        response 201 on success {}
        tags []
      }
      entity Order {
        field id: string { immutable }
      }
    `,
    );
    place(
      rightDir,
      'a.tc',
      `
      operation POST "/api/orders" {
        response 201 on success {}
        tags []
      }
    `,
    );

    const diff = diffContractDirs(leftDir, rightDir);
    expect(diff.artifactDiffs).toHaveLength(1);
    expect(diff.artifactDiffs[0]).toMatchObject({
      ref: { type: 'Entity', identity: 'Order' },
      side: 'missing-on-right',
    });
  });

  it('flags an artifact that exists only on the right', () => {
    place(
      leftDir,
      'a.tc',
      `
      operation POST "/api/orders" {
        response 201 on success {}
        tags []
      }
    `,
    );
    place(
      rightDir,
      'a.tc',
      `
      operation POST "/api/orders" {
        response 201 on success {}
        tags []
      }
      entity ExtraThing {
        field id: string { immutable }
      }
    `,
    );

    const diff = diffContractDirs(leftDir, rightDir);
    expect(diff.artifactDiffs).toHaveLength(1);
    expect(diff.artifactDiffs[0]).toMatchObject({
      ref: { type: 'Entity', identity: 'ExtraThing' },
      side: 'missing-on-left',
    });
  });

  it('flags missing obligations within an artifact', () => {
    // Left has 200 + 201 + 400; right only has 200. Same identity, same
    // method/path — but the response set differs.
    place(
      leftDir,
      'a.tc',
      `
      operation POST "/api/orders" {
        response 200 on success {}
        response 201 on success { header location required }
        response 400 on validation_failure {}
        tags []
      }
    `,
    );
    place(
      rightDir,
      'a.tc',
      `
      operation POST "/api/orders" {
        response 200 on success {}
        tags []
      }
    `,
    );

    const diff = diffContractDirs(leftDir, rightDir);
    const opDiff = diff.obligationDiffs.find(
      (d) => d.ref.identity === 'POST /api/orders',
    );
    expect(opDiff).toBeDefined();
    expect(opDiff!.missing).toContain('response.201');
    expect(opDiff!.missing).toContain('response.400');
    expect(opDiff!.missing).toContain('response.201.headers.location.required');
    // Coverage: 4 of 7 obligations matched (method, path, response.200, … x4)
    expect(diff.obligationCoverage).toBeLessThan(1);
    expect(diff.obligationCoverage).toBeGreaterThan(0);
  });

  it('treats reorderings and whitespace as equivalent', () => {
    // Same artifact, different ordering of responses + extra blank lines.
    // Diff should still report zero differences.
    place(
      leftDir,
      'a.tc',
      `
      operation POST "/api/orders" {
        response 201 on success {}
        response 400 on validation_failure {}
        tags []
      }
    `,
    );
    place(
      rightDir,
      'a.tc',
      `

      operation POST "/api/orders" {
        response 400 on validation_failure {}


        response 201 on success {}
        tags []
      }
    `,
    );

    const diff = diffContractDirs(leftDir, rightDir);
    expect(diff.artifactDiffs).toEqual([]);
    expect(diff.obligationDiffs).toEqual([]);
  });

  it('compares state-machine transitions, not transition syntax', () => {
    // Left: long-form `transition placed -> paid`. Right: list form
    // `placed -> [paid, cancelled]`. Same logical transitions; should
    // diff only on the missing `placed -> cancelled` edge.
    place(
      leftDir,
      'a.tc',
      `
      state-machine Order.status {
        scope { entity Entity:Order  field status }
        states Enum:OrderStatus
        initial [placed]
        terminal [delivered, cancelled]
        transitions {
          placed -> paid
          placed -> cancelled
          paid -> shipped
          shipped -> delivered
        }
      }
    `,
    );
    place(
      rightDir,
      'a.tc',
      `
      state-machine Order.status {
        scope { entity Entity:Order  field status }
        states Enum:OrderStatus
        initial [placed]
        terminal [delivered, cancelled]
        transitions {
          placed -> [paid, cancelled]
          paid -> shipped
          shipped -> delivered
        }
      }
    `,
    );

    const diff = diffContractDirs(leftDir, rightDir);
    expect(diff.obligationDiffs.filter((d) => d.ref.type === 'StateMachine')).toEqual([]);
  });

  it('formats a human-readable summary including coverage and per-artifact diffs', () => {
    place(
      leftDir,
      'a.tc',
      `
      operation POST "/api/orders" {
        response 201 on success {}
        response 400 on validation_failure {}
        tags []
      }
    `,
    );
    place(
      rightDir,
      'a.tc',
      `
      operation POST "/api/orders" {
        response 201 on success {}
        tags []
      }
    `,
    );

    const diff = diffContractDirs(leftDir, rightDir);
    const text = formatCorpusDiff(diff);
    expect(text).toMatch(/obligation coverage/);
    expect(text).toMatch(/Operation:POST \/api\/orders/);
    expect(text).toMatch(/missing on right.*response\.400/);
  });
});
