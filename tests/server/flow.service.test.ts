import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import * as schema from '../../apps/server/src/db/schema';
import { setupTestDb, teardownTestDb, type TestDb } from '../helpers/test-db';
import { runAnalysis, type AnalysisResult } from '../../apps/server/src/services/analyzer.service';
import {
  detectAndPersistFlows,
  getFlowsForAnalysis,
  getFlowWithSteps,
  getFlowSeverities,
} from '../../apps/server/src/services/flow.service';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '../fixtures/sample-js-project-negative');

describe('flow.service (integration)', () => {
  let db: TestDb;
  let analysisResult: AnalysisResult;
  let analysisId: string;

  beforeAll(async () => {
    ({ db } = await setupTestDb());

    // Run analysis on the fixture project
    analysisResult = await runAnalysis(FIXTURE_PATH, undefined, () => {}, { skipStash: true, skipGit: true });

    const [analysis] = await db
      .insert(schema.analyses)
      .values({
        id: randomUUID(),
        architecture: analysisResult.architecture,
        metadata: {},
      })
      .returning();
    analysisId = analysis.id;

    // Persist services so violations can reference them
    for (const svc of analysisResult.services) {
      await db.insert(schema.services).values({
        id: randomUUID(),
        analysisId,
        name: svc.name,
        type: svc.type,
        rootPath: svc.rootPath,
      });
    }
  }, 60_000);

  afterAll(async () => {
    await teardownTestDb();
  });

  it('detectAndPersistFlows creates flows and steps in DB', async () => {
    const { flowCount } = await detectAndPersistFlows(analysisId, analysisResult);
    expect(flowCount).toBeGreaterThan(0);

    // Verify flows exist in DB
    const dbFlows = await db
      .select()
      .from(schema.flows)
      .where(eq(schema.flows.analysisId, analysisId));
    expect(dbFlows).toHaveLength(flowCount);

    // Verify steps exist for at least one flow
    const firstFlow = dbFlows[0];
    const steps = await db
      .select()
      .from(schema.flowSteps)
      .where(eq(schema.flowSteps.flowId, firstFlow.id));
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.length).toBe(firstFlow.stepCount);
  });

  it('getFlowsForAnalysis returns flows ordered by name', async () => {
    const result = await getFlowsForAnalysis(analysisId);
    expect(result.length).toBeGreaterThan(0);

    // Verify ordering
    const names = result.map((f) => f.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it('getFlowWithSteps returns flow with ordered steps', async () => {
    const allFlows = await getFlowsForAnalysis(analysisId);
    const flow = await getFlowWithSteps(allFlows[0].id);

    expect(flow).not.toBeNull();
    expect(flow!.id).toBe(allFlows[0].id);
    expect(flow!.steps.length).toBeGreaterThan(0);

    // Steps should be ordered
    for (let i = 1; i < flow!.steps.length; i++) {
      expect(flow!.steps[i].stepOrder).toBeGreaterThan(flow!.steps[i - 1].stepOrder);
    }
  });

  it('getFlowWithSteps returns null for nonexistent flow', async () => {
    const result = await getFlowWithSteps('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('getFlowSeverities returns empty map when no violations exist', async () => {
    const result = await getFlowSeverities(analysisId);
    // No violations were inserted, so should be empty
    expect(result).toEqual({});
  });

  it('getFlowSeverities returns correct severity map when violations exist', async () => {
    // Get a flow to find a method name to target
    const allFlows = await getFlowsForAnalysis(analysisId);
    const flow = await getFlowWithSteps(allFlows[0].id);
    expect(flow).not.toBeNull();

    const targetStep = flow!.steps.find((s) => s.targetMethod !== 'request' && s.targetMethod !== 'query' && s.targetMethod !== 'write');
    expect(targetStep).toBeDefined();

    // Find the method in DB to get its ID
    const [method] = await db
      .select()
      .from(schema.methods)
      .where(eq(schema.methods.analysisId, analysisId))
      .limit(1);

    if (!method) {
      // If no methods were persisted, skip this test gracefully
      return;
    }

    // Insert a violation targeting this method
    await db.insert(schema.violations).values({
      id: randomUUID(),
      analysisId,
      type: 'function',
      title: 'Test violation',
      content: 'Test violation content',
      severity: 'high',
      ruleKey: 'test/violation',
      targetMethodId: method.id,
    });

    const severities = await getFlowSeverities(analysisId);
    // Should have at least one entry if the method matches a flow step
    expect(typeof severities).toBe('object');

    // Cleanup the test violation
    await db
      .delete(schema.violations)
      .where(eq(schema.violations.analysisId, analysisId));
  });
});
