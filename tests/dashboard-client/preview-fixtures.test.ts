// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

/**
 * The preview's fake payloads ARE the shapes the vendored components consume.
 *
 * The components under `src/preview/vendor` are the current dashboard's, copied
 * from `origin/sm/agentic-pipeline-plan` with their imports retargeted, so the
 * fixtures behind them have to satisfy the same contracts the real server
 * satisfies. Where the shape has a Zod schema, that schema is the test: a
 * fixture that drifted from it fails here rather than in a component that
 * renders a hole.
 *
 * The second half is the JOIN. The tabs are one board seen five ways, so the
 * identities have to agree across them: a run's results name scenarios the flows
 * own, a section's flow rows name flows the flows view lists, an interface's
 * grounding names scenarios that exist, and a dependency a blocked test waits on
 * is a row on the dependencies page.
 */

import { describe, it, expect } from 'vitest';
import {
  GuardClaimsViewSchema,
  GuardDecisionsSchema,
  GuardFlowDetailSchema,
  GuardFlowsViewCoreSchema,
  GuardGenerateReportSchema,
  GuardHistorySchema,
  GuardInterfacesViewSchema,
  GuardLatestSchema,
} from '@/preview/vendor/shared';
import {
  claimsView,
  flowDetail,
  flowsView,
  generateReport,
  scenarioInventory,
} from '@/preview/data/flow-fixtures';
import { interfacesView } from '@/preview/data/interface-fixtures';
import { latestRun, runHistory, scenarioSource } from '@/preview/data/run-fixtures';
import { dependenciesView, saveDependency } from '@/preview/data/dependency-fixtures';
import { corpusResponse, docByRef, docCoverage, statusSummary } from '@/preview/data/corpus-fixtures';
import { artifactRaw } from '@/preview/data/artifact-fixtures';
import { REPO_GUARD } from '@/preview/data';

/** Every repo the preview offers a guard board for. */
const REPOS = Object.keys(REPO_GUARD);

/** The repo the preview's screenshots and deep links are written against. */
const MAIN = 'orders-api';

function parse<T>(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, value: T) {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(JSON.stringify(result.error, null, 2));
  expect(result.success).toBe(true);
}

describe('preview fixtures satisfy the payload schemas', () => {
  for (const repoId of REPOS) {
    it(`${repoId}: the flows view, every flow detail and the generate report`, () => {
      const view = flowsView(repoId);
      // `GuardFlowsView` is the Zod core plus the recipe card (no schema of its own).
      const { recipe, ...core } = view;
      parse(GuardFlowsViewCoreSchema, core);
      expect(recipe === null || typeof recipe.fingerprint === 'string').toBe(true);
      for (const flow of view.flows) parse(GuardFlowDetailSchema, flowDetail(repoId, flow.flowId));
      parse(GuardGenerateReportSchema, generateReport(repoId));
    });

    it(`${repoId}: the interface catalog and the claim ledger`, () => {
      parse(GuardInterfacesViewSchema, interfacesView(repoId));
      parse(GuardClaimsViewSchema, claimsView(repoId));
    });

    it(`${repoId}: the run store`, () => {
      const latest = latestRun(repoId);
      if (latest) {
        const { runFlows, ...run } = latest;
        parse(GuardLatestSchema, run);
        expect(Array.isArray(runFlows)).toBe(true);
      }
      parse(GuardHistorySchema, runHistory(repoId));
    });

    it(`${repoId}: the dependency catalog`, () => {
      const view = dependenciesView(repoId);
      for (const row of view.dependencies) {
        expect(row.name).not.toBe('');
        // A row with nothing to register says so with a null state, never with
        // an empty form: only a supplied dependency carries fields.
        expect(row.fields.length === 0).toBe(row.state === null);
        expect(row.class === 'supplied' || row.registration === undefined).toBe(true);
      }
    });
  }

  it('a secret comes back masked, never as its characters', () => {
    const before = dependenciesView(MAIN).dependencies.find((d) => d.class === 'supplied' && d.state !== 'provided');
    expect(before).toBeDefined();
    const secret = before!.fields.find((f) => f.secret);
    expect(secret).toBeDefined();
    const after = saveDependency(MAIN, before!.name, { env: { [secret!.field]: 'sk-live-not-a-real-key' } });
    const field = after.dependencies.find((d) => d.name === before!.name)!.fields.find((f) => f.secret)!;
    expect(field.resolved).toBe(true);
    expect(field.value).not.toContain('sk-live');
  });

  it('the dismissals are the shape the decisions endpoint speaks', () => {
    parse(GuardDecisionsSchema, {
      version: 1,
      dismissedClaims: [],
      dismissedFlows: [],
    });
  });
});

describe('preview fixtures agree on identities across the tabs', () => {
  const flows = flowsView(MAIN);
  const flowIds = new Set(flows.flows.map((f) => f.flowId));
  const scenarioIds = new Set(
    flows.flows.flatMap((f) => flowDetail(MAIN, f.flowId)!.surfaces.map((s) => s.scenarioId)).filter(Boolean),
  );

  it('the board is not empty (an empty board would pass every join)', () => {
    expect(flowIds.size).toBeGreaterThan(3);
    expect(scenarioIds.size).toBeGreaterThan(3);
  });

  it("a run's results name scenarios the flows own", () => {
    const latest = latestRun(MAIN)!;
    expect(latest.scenarios.length).toBeGreaterThan(0);
    for (const result of latest.scenarios) {
      expect(scenarioIds.has(result.id)).toBe(true);
      expect(flowIds.has(result.flowId!)).toBe(true);
      // The run's own flow join carries every flow its results reference.
      expect(latest.runFlows?.some((f) => f.flowId === result.flowId)).toBe(true);
      // A result's scenario has a committed source the detail can open.
      expect(scenarioSource(MAIN, result.id)).not.toBeNull();
    }
  });

  it("a section's flow rows name flows the flows view lists", () => {
    for (const doc of corpusResponse(MAIN)!.corpus.docs) {
      const spec = docByRef(MAIN, doc.ref);
      if (!spec) continue;
      for (const section of docCoverage(MAIN, spec).sections) {
        for (const flow of section.flows) expect(flowIds.has(flow.flowId)).toBe(true);
        for (const id of section.scenarioIds) expect(scenarioIds.has(id)).toBe(true);
      }
    }
  });

  it('an interface grounds on flows and scenarios that exist', () => {
    const view = interfacesView(MAIN);
    expect(view.interfaces.length).toBeGreaterThan(0);
    for (const iface of view.interfaces) {
      for (const flow of iface.flows) expect(flowIds.has(flow.flowId)).toBe(true);
      for (const id of iface.scenarioIds) expect(scenarioIds.has(id)).toBe(true);
      // Every row's place resolves in the registry that rides the same view.
      if (iface.resource) {
        expect(view.resources?.[iface.type]?.some((r) => r.id === iface.resource)).toBe(true);
      }
    }
  });

  it('a claim traces to a flow and to a scenario that exist', () => {
    const view = claimsView(MAIN);
    expect(view.claims.length).toBeGreaterThan(0);
    for (const claim of view.claims) {
      for (const flow of claim.flows) expect(flowIds.has(flow.flowId)).toBe(true);
      for (const scenario of claim.scenarios) expect(scenarioIds.has(scenario.scenarioId)).toBe(true);
    }
  });

  it('a dependency a blocked flow waits on is a row on the dependencies page', () => {
    const names = new Set(dependenciesView(MAIN).dependencies.map((d) => d.name));
    for (const row of dependenciesView(MAIN).dependencies) {
      for (const need of row.needs) expect(flowIds.has(need.flowId)).toBe(true);
      for (const blocked of row.blocks) expect(flowIds.has(blocked.flowId!)).toBe(true);
      expect(names.has(row.name)).toBe(true);
    }
  });

  it('the committed inventory binds every test to a flow and a doc section', () => {
    const inventory = scenarioInventory(MAIN);
    expect(inventory.scenarios.length).toBeGreaterThan(0);
    for (const row of inventory.scenarios) {
      expect(scenarioIds.has(row.id)).toBe(true);
      expect(flowIds.has(row.flowId)).toBe(true);
      expect(docByRef(MAIN, row.doc)).toBeDefined();
    }
  });

  it('the status summary counts the same board the tabs render', () => {
    const status = statusSummary(MAIN)!;
    expect(status.coverage!.flows.total).toBe(flows.totals.total);
    expect(status.lastRun!.ranAt).toBe(latestRun(MAIN)!.run.ranAt);
  });

  it('every artifact-backed entity has a raw reading', () => {
    expect(artifactRaw(MAIN, 'flow', [...flowIds][0]!)).not.toBeNull();
    expect(artifactRaw(MAIN, 'interface', interfacesView(MAIN).interfaces[0]!.id)).not.toBeNull();
    expect(artifactRaw(MAIN, 'dependency', dependenciesView(MAIN).dependencies[0]!.name)).not.toBeNull();
    expect(artifactRaw(MAIN, 'recipe', '')).not.toBeNull();
    expect(artifactRaw(MAIN, 'flow', 'no-such-flow')).toBeNull();
  });
});
