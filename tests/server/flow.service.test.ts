import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { randomUUID } from 'node:crypto';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';
import { runAnalysis, type AnalysisResult } from '../../apps/server/src/services/analyzer.service';
import {
  computeFlowSeverities,
  detectFlows,
  getFlowFromLatest,
  getFlowsFromLatest,
} from '../../apps/server/src/services/flow.service';
import { writeLatest } from '../../apps/server/src/lib/analysis-store';
import type { LatestSnapshot } from '../../apps/server/src/types/snapshot';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '../fixtures/sample-js-project-negative');

describe('flow.service', () => {
  let fixture: TestFixture;
  let analysisResult: AnalysisResult;

  beforeAll(async () => {
    fixture = await setupTestFixture(FIXTURE_PATH);
    analysisResult = await runAnalysis(FIXTURE_PATH, undefined, () => {}, {
      skipStash: true,
      skipGit: true,
    });
  }, 60_000);

  afterAll(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('detectFlows returns flows with nested steps', () => {
    const flows = detectFlows(analysisResult);
    expect(flows.length).toBeGreaterThan(0);

    // Each flow has at least one step and steps are monotonic (non-decreasing —
    // parallel branches in a flow legitimately reuse step orders).
    for (const flow of flows) {
      expect(flow.steps.length).toBeGreaterThan(0);
      expect(flow.stepCount).toBe(flow.steps.length);
      for (let i = 1; i < flow.steps.length; i++) {
        expect(flow.steps[i].stepOrder).toBeGreaterThanOrEqual(flow.steps[i - 1].stepOrder);
      }
    }
  });

  it('getFlowsFromLatest / getFlowFromLatest read from LATEST.json', () => {
    const flows = detectFlows(analysisResult);
    const snapshot = makeLatest(fixture.project.path, flows);
    writeLatest(fixture.project.path, snapshot);

    const read = getFlowsFromLatest(fixture.project.path);
    expect(read).toEqual(flows);

    const one = getFlowFromLatest(fixture.project.path, flows[0].id);
    expect(one?.id).toBe(flows[0].id);
    expect(getFlowFromLatest(fixture.project.path, 'not-a-real-id')).toBeNull();
  });

  it('computeFlowSeverities returns empty when no violations', () => {
    const flows = detectFlows(analysisResult);
    const snapshot = makeLatest(fixture.project.path, flows);
    expect(computeFlowSeverities(snapshot.graph, snapshot.violations)).toEqual({});
  });

  it('computeFlowSeverities picks up severity via targetMethod/targetModule names', () => {
    const flows = detectFlows(analysisResult);
    const step = flows[0].steps[0];
    const methodId = randomUUID();
    const moduleId = randomUUID();

    // Build a minimal LATEST that exposes the target method by id+name.
    const snapshot: LatestSnapshot = makeLatest(fixture.project.path, flows);
    snapshot.graph.methods.push({
      id: methodId,
      moduleId,
      name: step.targetMethod,
      signature: `${step.targetMethod}()`,
      paramCount: 0,
      returnType: null,
      isAsync: false,
      isExported: true,
      lineCount: null,
      statementCount: null,
      maxNestingDepth: null,
    });
    snapshot.violations.push({
      id: randomUUID(),
      type: 'function',
      title: 'Test',
      content: 'content',
      severity: 'high',
      status: 'new',
      targetServiceId: null,
      targetDatabaseId: null,
      targetModuleId: null,
      targetMethodId: methodId,
      targetTable: null,
      relatedServiceId: null,
      relatedModuleId: null,
      fixPrompt: null,
      ruleKey: 'test/violation',
      firstSeenAnalysisId: null,
      firstSeenAt: null,
      previousViolationId: null,
      resolvedAt: null,
      filePath: null,
      lineStart: null,
      lineEnd: null,
      columnStart: null,
      columnEnd: null,
      snippet: null,
      createdAt: new Date().toISOString(),
      targetServiceName: null,
      targetModuleName: null,
      targetMethodName: step.targetMethod,
      targetDatabaseName: null,
    });

    const severities = computeFlowSeverities(snapshot.graph, snapshot.violations);
    expect(severities[flows[0].id]).toBe('high');
  });
});

function makeLatest(
  _repoPath: string,
  flows: ReturnType<typeof detectFlows>,
): LatestSnapshot {
  return {
    head: 'test.json',
    analysis: {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      branch: null,
      commitHash: null,
      architecture: 'monolith',
      metadata: null,
      status: 'completed',
    },
    graph: {
      services: [],
      serviceDependencies: [],
      layers: [],
      modules: [],
      methods: [],
      moduleDeps: [],
      methodDeps: [],
      databases: [],
      databaseConnections: [],
      flows,
    },
    violations: [],
  };
}
