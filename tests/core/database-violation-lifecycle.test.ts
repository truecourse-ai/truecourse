import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AnalysisRule, FileAnalysis } from '@truecourse/shared';

vi.mock('../../packages/core/src/services/rules.service.js', () => ({
  getEnabledRules: vi.fn(),
}));

import type { AnalysisResult } from '../../packages/core/src/services/analyzer.service.js';
import type { DatabaseViolationContext } from '../../packages/core/src/services/llm/provider.js';
import { ClaudeCodeProvider } from '../../packages/core/src/services/llm/cli-provider.js';
import { getEnabledRules } from '../../packages/core/src/services/rules.service.js';
import type { ActiveViolation } from '../../packages/core/src/services/violation-lifecycle.service.js';
import { runViolationPipeline } from '../../packages/core/src/services/violation-pipeline.service.js';
import {
  StepTracker,
  type AnalysisProgressPayload,
} from '../../packages/core/src/progress.js';

const DATABASE_RULE_KEY = 'database/llm/schema-review';

const databaseRule: AnalysisRule = {
  key: DATABASE_RULE_KEY,
  category: 'database',
  domain: 'database',
  name: 'Database schema review',
  description: 'Review database schemas.',
  prompt: 'Review database schemas.',
  enabled: true,
  severity: 'high',
  type: 'llm',
};

const databaseCodeRule: AnalysisRule = {
  key: 'database/llm/query-review',
  category: 'code',
  domain: 'database',
  name: 'Database query review',
  description: 'Review database query code.',
  prompt: 'Review database query code.',
  enabled: true,
  severity: 'high',
  type: 'llm',
  contextRequirement: { tier: 'metadata' },
};

function databaseContext(): DatabaseViolationContext {
  return {
    databases: [{
      id: 'current-database-runtime-id',
      name: 'orders-db',
      type: 'postgres',
      driver: 'pg',
      tableCount: 1,
      connectedServices: ['orders-service'],
      tables: [{
        name: 'orders',
        columns: [{ name: 'id', type: 'uuid', isPrimaryKey: true }],
      }],
      relations: [],
    }],
    llmRules: [{
      key: DATABASE_RULE_KEY,
      name: 'Database schema review',
      severity: 'high',
      prompt: 'Review database schemas.',
    }],
    existingViolations: [{
      id: 'previous-database-review',
      type: 'database',
      title: 'Previous database review',
      content: 'Previously detected database problem.',
      severity: 'high',
    }],
  };
}

type DatabaseLifecycleMode =
  | 'resolved'
  | 'unchanged'
  | 'overlap'
  | 'outsider'
  | 'unchanged-duplicate'
  | 'resolved-duplicate'
  | 'targets'
  | 'failed';

class DatabaseLifecycleProvider extends ClaudeCodeProvider {
  normalDatabaseCalls = 0;
  lifecycleDatabaseCalls = 0;

  constructor(private readonly mode: DatabaseLifecycleMode) {
    super();
  }

  protected override async spawnCLI(
    _prompt: string,
    _schemaJson: string,
    opts?: { label?: string },
  ): Promise<string> {
    const label = opts?.label ?? 'call';
    if (label === 'database') {
      this.normalDatabaseCalls++;
      return JSON.stringify({ result: JSON.stringify({ violations: [] }) });
    }
    if (label === 'code') {
      return JSON.stringify({ result: JSON.stringify({ violations: [] }) });
    }
    if (label !== 'database-lifecycle') {
      throw new Error(`Unexpected LLM call: ${label}`);
    }

    this.lifecycleDatabaseCalls++;
    if (this.mode === 'failed') {
      throw new Error('database lifecycle transport failed');
    }

    const resolvedViolationIds = ['resolved', 'overlap', 'resolved-duplicate'].includes(this.mode)
      ? ['prev-0']
      : [];
    const unchangedViolationIds = this.mode === 'outsider'
      ? ['prev-99']
      : ['unchanged', 'overlap', 'targets', 'unchanged-duplicate'].includes(this.mode)
        ? ['prev-0']
        : [];
    const newViolations = this.mode === 'targets'
      ? [{
          type: 'database',
          title: 'Orders need an index',
          content: 'The `orders` table lacks a required index.',
          severity: 'high',
          targetDatabaseId: 'db-0',
          targetTable: 'orders',
          fixPrompt: 'Add the index to `orders`.',
          ruleKey: DATABASE_RULE_KEY,
        }, {
          type: 'database',
          title: 'Unknown database target',
          content: 'This target was not present in the prompt.',
          severity: 'medium',
          targetDatabaseId: 'db-99',
          targetTable: 'unknown_table',
          fixPrompt: null,
          ruleKey: DATABASE_RULE_KEY,
        }, {
          type: 'database',
          title: 'Wrong alias namespace',
          content: 'A previous-finding alias is not a database target.',
          severity: 'medium',
          targetDatabaseId: 'prev-0',
          targetTable: 'orders',
          fixPrompt: null,
          ruleKey: DATABASE_RULE_KEY,
        }]
      : ['unchanged-duplicate', 'resolved-duplicate'].includes(this.mode)
        ? [{
            type: 'database',
            title: 'Previous database review',
            content: 'This recreates an explicitly unchanged finding.',
            severity: 'high',
            targetDatabaseId: 'db-0',
            targetTable: 'orders',
            fixPrompt: null,
            ruleKey: DATABASE_RULE_KEY,
          }]
        : [];

    return JSON.stringify({
      result: JSON.stringify({ resolvedViolationIds, unchangedViolationIds, newViolations }),
    });
  }
}

function createDatabaseAnalysis(repoPath: string, includeCodeFile = false): AnalysisResult {
  const filePath = path.join(repoPath, 'src', 'orders.ts');
  if (includeCodeFile) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'export const orders = [] as const;\n');
  }
  return {
    architecture: 'monolith',
    services: [],
    dependencies: [],
    layerDetails: [],
    databaseResult: {
      databases: [{
        name: 'orders-db',
        type: 'postgres',
        driver: 'pg',
        tables: [{
          name: 'orders',
          columns: [{ name: 'id', type: 'uuid', isPrimaryKey: true }],
        }],
        relations: [],
        connectedServices: ['orders-service'],
      }],
      connections: [],
    },
    modules: [],
    methods: [],
    moduleLevelDependencies: [],
    methodLevelDependencies: [],
    fileAnalyses: includeCodeFile
      ? [{
          filePath,
          language: 'typescript',
          functions: [],
          classes: [],
          imports: [],
          exports: [],
          calls: [],
          httpCalls: [],
          routeRegistrations: [],
        } as unknown as FileAnalysis]
      : [],
    moduleDependencies: [],
    entryPointFiles: new Set(),
    metadata: {},
  };
}

function previousDatabaseViolation(): ActiveViolation {
  return {
    id: 'previous-database-review',
    type: 'database',
    category: 'rule',
    subcategory: null,
    title: 'Previous database review',
    content: 'Previously detected database problem.',
    severity: 'high',
    status: 'unchanged',
    targetServiceId: null,
    targetDatabaseId: 'previous-database-runtime-id',
    targetModuleId: null,
    targetMethodId: null,
    targetTable: 'orders',
    relatedServiceId: null,
    relatedModuleId: null,
    fixPrompt: null,
    ruleKey: DATABASE_RULE_KEY,
    firstSeenAnalysisId: 'previous-analysis',
    firstSeenAt: '2026-07-01T00:00:00.000Z',
    previousViolationId: null,
    resolvedAt: null,
    filePath: null,
    lineStart: null,
    lineEnd: null,
    columnStart: null,
    columnEnd: null,
    snippet: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    targetServiceName: null,
    targetModuleName: null,
    targetMethodName: null,
    targetDatabaseName: 'orders-db',
  };
}

async function runDatabasePipeline(
  repoPath: string,
  provider: DatabaseLifecycleProvider,
  proceedWithLlm = true,
  tracker?: StepTracker,
  includeCodeFile = false,
) {
  return runViolationPipeline({
    repoPath,
    analysisId: 'current-analysis',
    now: '2026-07-18T00:00:00.000Z',
    result: createDatabaseAnalysis(repoPath, includeCodeFile),
    serviceIdMap: new Map(),
    moduleIdMap: new Map(),
    methodIdMap: new Map(),
    dbIdMap: new Map([['orders-db', 'current-database-runtime-id']]),
    previousActiveViolations: [previousDatabaseViolation()],
    enableLlmRules: true,
    provider,
    tracker,
    onLlmEstimate: async () => proceedWithLlm,
  });
}

let repoPath: string;

beforeEach(() => {
  repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-database-lifecycle-'));
  vi.mocked(getEnabledRules).mockResolvedValue([databaseRule]);
});

afterEach(() => {
  fs.rmSync(repoPath, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('database violation lifecycle', () => {
  it('rebinds current database aliases and rejects unknown alias namespaces', async () => {
    const provider = new DatabaseLifecycleProvider('targets');

    const result = await provider.generateDatabaseViolationsWithLifecycle(databaseContext());

    expect(result.newViolations.map((violation) => ({
      targetDatabaseId: violation.targetDatabaseId,
      targetTable: violation.targetTable,
    }))).toEqual([
      { targetDatabaseId: 'current-database-runtime-id', targetTable: 'orders' },
      { targetDatabaseId: null, targetTable: 'unknown_table' },
      { targetDatabaseId: null, targetTable: 'orders' },
    ]);
  });

  it('surfaces an ordinary database lifecycle transport failure', async () => {
    const provider = new DatabaseLifecycleProvider('failed');

    await expect(provider.generateDatabaseViolationsWithLifecycle(
      databaseContext(),
    )).rejects.toThrow('database lifecycle transport failed');
  });

  it('routes a prior database finding through lifecycle exactly once', async () => {
    const provider = new DatabaseLifecycleProvider('resolved');

    const result = await runDatabasePipeline(repoPath, provider);

    expect(provider.normalDatabaseCalls).toBe(0);
    expect(provider.lifecycleDatabaseCalls).toBe(1);
    expect(result.added.filter((violation) => violation.type === 'database')).toEqual([]);
    expect(result.unchanged.filter((violation) => violation.type === 'database')).toEqual([]);
    expect(result.resolved.filter((violation) => violation.type === 'database')).toEqual([
      expect.objectContaining({
        previousViolationId: 'previous-database-review',
        status: 'resolved',
        targetDatabaseId: 'current-database-runtime-id',
        targetTable: 'orders',
      }),
    ]);
  });

  it.each(['overlap', 'outsider'] as const)(
    'fails closed when database lifecycle returns an invalid %s partition',
    async (mode) => {
      const result = await runDatabasePipeline(repoPath, new DatabaseLifecycleProvider(mode));

      expect(result.added.filter((violation) => violation.type === 'database')).toEqual([]);
      expect(result.resolved.filter((violation) => violation.type === 'database')).toEqual([]);
      expect(result.unchanged.filter((violation) => violation.type === 'database')).toEqual([
        expect.objectContaining({
          previousViolationId: 'previous-database-review',
          status: 'unchanged',
        }),
      ]);
    },
  );

  it.each(['unchanged-duplicate', 'resolved-duplicate'] as const)(
    'fails closed when a %s prior is recreated under the same title',
    async (mode) => {
      const result = await runDatabasePipeline(
        repoPath,
        new DatabaseLifecycleProvider(mode),
      );

      expect(result.added.filter((violation) => violation.type === 'database')).toEqual([]);
      expect(result.resolved.filter((violation) => violation.type === 'database')).toEqual([]);
      expect(result.unchanged.filter((violation) => violation.type === 'database')).toEqual([
        expect.objectContaining({ previousViolationId: 'previous-database-review' }),
      ]);
    },
  );

  it('persists new lifecycle targets while retaining an explicitly unchanged prior', async () => {
    const result = await runDatabasePipeline(
      repoPath,
      new DatabaseLifecycleProvider('targets'),
    );

    expect(result.unchanged.filter((violation) => violation.type === 'database')).toHaveLength(1);
    expect(result.added.filter((violation) => violation.type === 'database')).toEqual([
      expect.objectContaining({
        targetDatabaseId: 'current-database-runtime-id',
        targetTable: 'orders',
      }),
      expect.objectContaining({ targetDatabaseId: null, targetTable: 'unknown_table' }),
      expect.objectContaining({ targetDatabaseId: null, targetTable: 'orders' }),
    ]);
  });

  it('reports unchanged active database findings instead of calling the step clean', async () => {
    const payloads: AnalysisProgressPayload[] = [];
    const tracker = new StepTracker(
      (payload) => payloads.push(payload),
      [{ key: 'database', label: 'Database checks' }, { key: 'persist', label: 'Saving' }],
    );

    await runDatabasePipeline(repoPath, new DatabaseLifecycleProvider('unchanged'), true, tracker);

    const databaseStep = payloads.at(-1)?.steps?.find((step) => step.key === 'database');
    expect(databaseStep).toEqual(expect.objectContaining({
      status: 'done',
      detail: '1 violations',
    }));
  });

  it('carries the prior database finding when the user skips LLM checks', async () => {
    const provider = new DatabaseLifecycleProvider('unchanged');

    const result = await runDatabasePipeline(repoPath, provider, false);

    expect(provider.normalDatabaseCalls).toBe(0);
    expect(provider.lifecycleDatabaseCalls).toBe(0);
    expect(result.unchanged.filter((violation) => violation.type === 'database')).toEqual([
      expect.objectContaining({
        previousViolationId: 'previous-database-review',
        targetDatabaseId: 'current-database-runtime-id',
        targetTable: 'orders',
      }),
    ]);
  });

  it('carries the prior database finding when lifecycle execution fails', async () => {
    const result = await runDatabasePipeline(
      repoPath,
      new DatabaseLifecycleProvider('failed'),
    );

    expect(result.resolved.filter((violation) => violation.type === 'database')).toEqual([]);
    expect(result.unchanged.filter((violation) => violation.type === 'database')).toEqual([
      expect.objectContaining({
        previousViolationId: 'previous-database-review',
        status: 'unchanged',
      }),
    ]);
  });

  it('keeps a schema lifecycle failure visible when database code batches also finish', async () => {
    vi.mocked(getEnabledRules).mockResolvedValue([databaseRule, databaseCodeRule]);
    const payloads: AnalysisProgressPayload[] = [];
    const tracker = new StepTracker(
      (payload) => payloads.push(payload),
      [{ key: 'database', label: 'Database checks' }, { key: 'persist', label: 'Saving' }],
    );

    await runDatabasePipeline(
      repoPath,
      new DatabaseLifecycleProvider('failed'),
      true,
      tracker,
      true,
    );

    const databaseStep = payloads.at(-1)?.steps?.find((step) => step.key === 'database');
    expect(databaseStep).toEqual(expect.objectContaining({
      status: 'error',
      detail: 'Schema LLM failed',
    }));
  });
});
