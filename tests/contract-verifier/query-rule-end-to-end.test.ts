/**
 * End-to-end test for the QueryRule pipeline: `.tc` rule files → parser →
 * resolver → comparator → drifts, matched against real JS/TS source via
 * the Knex / Prisma / raw-SQL extractors.
 *
 * Each test writes a tiny contracts dir + code dir to a temp location,
 * runs `verify()`, and inspects the drift output. The fixtures mirror
 * the audit findings in `audit-findings-by-engine-gap.json`
 * (`sql-where-filter` bucket) — primarily the DISCOVERY date-anchor
 * cluster shape.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { verify } from '../../packages/contract-verifier/src/verify.js';
import { initParsers } from '../../packages/analyzer/src/index.js';

beforeAll(async () => {
  await initParsers();
});

function makeFixture(name: string, contracts: Record<string, string>, code: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `truecourse-qr-e2e-${name}-`));
  const contractsDir = path.join(root, 'contracts');
  const codeDir = path.join(root, 'code');
  fs.mkdirSync(contractsDir, { recursive: true });
  fs.mkdirSync(codeDir, { recursive: true });
  for (const [rel, content] of Object.entries(contracts)) {
    const full = path.join(contractsDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  for (const [rel, content] of Object.entries(code)) {
    const full = path.join(codeDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return { root, contractsDir, codeDir };
}

describe('QueryRule end-to-end (verify pipeline)', () => {
  it('fires date-binding.column-mismatch when raw SQL uses the wrong date anchor', async () => {
    // Mirrors the DISCOVERY audit's date-anchor cluster: spec says
    // invoices.createdon, code uses jobs.completedon.
    const { contractsDir, codeDir } = makeFixture(
      'date-anchor',
      {
        'jobs.tc': `query-rule noPaymentCollected.date-anchor {
  origin SPEC.md "Date scoping" 70..72
  entity Entity:core.jobs
  date-range-binding column invoices.createdon
}
`,
      },
      {
        'noPaymentCollected.ts': `
import type { Knex } from 'knex';

const ROWS_SQL = \`SELECT j.id FROM core.jobs j
  WHERE j.completedon >= ?::date
    AND j.completedon < ?::date
\`;

export async function rows(db: Knex) {
  return db.raw(ROWS_SQL);
}
`,
      },
    );

    const result = await verify({ contractsDir, codeDir });
    const qDrifts = result.drifts.filter((d) => d.obligationKey.startsWith('query.'));
    const keys = qDrifts.map((d) => d.obligationKey);
    expect(keys).toContain('query.date-binding.column-mismatch');
    const drift = qDrifts.find((d) => d.obligationKey === 'query.date-binding.column-mismatch')!;
    expect(drift.specSide).toBe('invoices.createdon');
    expect(drift.codeSide).toContain('completedon');
    expect(drift.severity).toBe('medium');
  });

  it('fires forbidden-present when code excludes warranty jobs the spec wants flagged', async () => {
    const { contractsDir, codeDir } = makeFixture(
      'warranty',
      {
        'jobs.tc': `query-rule noPaymentCollected.warranty-must-flag {
  origin SPEC.md "Q4: warranty handling" 35..40
  entity Entity:core.jobs
  forbidden {
    is-null jobs.warranty_id
  }
}
`,
      },
      {
        'noPaymentCollected.ts': `
import type { Knex } from 'knex';
export async function rows(db: Knex) {
  return db.raw("SELECT * FROM core.jobs j WHERE j.warranty_id IS NULL");
}
`,
      },
    );

    const result = await verify({ contractsDir, codeDir });
    const keys = result.drifts.map((d) => d.obligationKey);
    expect(keys).toContain('query.predicate.forbidden-present.warranty_id.is-null');
  });

  it('fires predicate.missing when required predicate is absent from all code queries', async () => {
    const { contractsDir, codeDir } = makeFixture(
      'missing-req',
      {
        'jobs.tc': `query-rule jobs.status-must-be-completed {
  origin SPEC.md "Status filter" 10..12
  entity Entity:core.jobs
  required {
    eq jobs.status "Completed"
  }
}
`,
      },
      {
        'jobs.ts': `
import type { Knex } from 'knex';
export async function f(db: Knex) {
  return db.raw("SELECT * FROM core.jobs j WHERE j.archived = false");
}
`,
      },
    );

    const result = await verify({ contractsDir, codeDir });
    const keys = result.drifts.map((d) => d.obligationKey);
    expect(keys).toContain('query.predicate.missing.status.eq');
  });

  it('fires value-mismatch when same column has wrong value', async () => {
    const { contractsDir, codeDir } = makeFixture(
      'value-mismatch',
      {
        'jobs.tc': `query-rule jobs.status-completed {
  origin SPEC.md "Status filter" 10..12
  entity Entity:core.jobs
  required {
    eq jobs.status "Completed"
  }
}
`,
      },
      {
        'jobs.ts': `
import type { Knex } from 'knex';
export async function f(db: Knex) {
  return db.raw("SELECT * FROM core.jobs j WHERE j.status = 'Cancelled'");
}
`,
      },
    );

    const result = await verify({ contractsDir, codeDir });
    const keys = result.drifts.map((d) => d.obligationKey);
    expect(keys).toContain('query.predicate.value-mismatch.status.eq');
  });

  it('emits NO drifts when code satisfies the rule (sanity)', async () => {
    const { contractsDir, codeDir } = makeFixture(
      'green',
      {
        'jobs.tc': `query-rule jobs.green {
  origin SPEC.md "OK" 1..2
  entity Entity:core.jobs
  required {
    is-not-null jobs.invoice_id
    eq jobs.status "Completed"
  }
  forbidden {
    is-null jobs.warranty_id
  }
}
`,
      },
      {
        'jobs.ts': `
import type { Knex } from 'knex';
export async function f(db: Knex) {
  return db.raw("SELECT * FROM core.jobs j WHERE j.invoice_id IS NOT NULL AND j.status = 'Completed' AND j.warranty_id IS NOT NULL");
}
`,
      },
    );

    const result = await verify({ contractsDir, codeDir });
    const qDrifts = result.drifts.filter((d) => d.obligationKey.startsWith('query.'));
    expect(qDrifts).toEqual([]);
  });

  it('works across all three adapters: knex chained, prisma, raw-sql', async () => {
    // One rule, three different code styles satisfying it. Should emit
    // ZERO query drifts.
    const { contractsDir, codeDir } = makeFixture(
      'multi-adapter',
      {
        'users.tc': `query-rule users.status-required {
  origin SPEC.md "Active filter" 1..2
  entity Entity:user
  required {
    eq status "active"
  }
}
query-rule users-jobs.status-required {
  origin SPEC.md "Active filter" 1..2
  entity Entity:users
  required {
    eq status "active"
  }
}
`,
      },
      {
        'a-knex.ts':   `import type { Knex } from 'knex'; export async function f(db: Knex) { return db('users').where('status', 'active'); }`,
        'b-prisma.ts': `import type { PrismaClient } from '@prisma/client'; export async function f(prisma: PrismaClient) { return prisma.user.findMany({where: {status: 'active'}}); }`,
        'c-raw.ts':    `import type { Knex } from 'knex'; export async function f(db: Knex) { return db.raw("SELECT * FROM users WHERE status = 'active'"); }`,
      },
    );

    const result = await verify({ contractsDir, codeDir });
    const qDrifts = result.drifts.filter((d) => d.obligationKey.startsWith('query.'));
    // No drifts — all three queries satisfy the rule for their entity.
    expect(qDrifts).toEqual([]);
  });
});
