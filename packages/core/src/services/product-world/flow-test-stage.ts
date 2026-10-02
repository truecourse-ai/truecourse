/**
 * THE FLOW-TEST STAGE — what generate does after flows are synthesized when
 * the product runs from its world scripts: bring the product up ONCE, bare,
 * run one flow-test session per flow against it, record what each one proved,
 * and take the product down.
 *
 * Nothing is seeded ahead of the sessions. Each one writes its flow's seed
 * beside its spec, so the data a test starts from is decided by the flow it
 * proves, is created under names of its own each time it runs, and is shared
 * with no other test. That is what lets the sessions, and later the tests,
 * run side by side against the one product.
 *
 * A flow whose test was written against the flow as it still is keeps that
 * test: only new and changed flows get a session. A session that ends without
 * an accepted outcome leaves no spec and no seed behind, so every one in the
 * tests directory is one the engine saw behave the way its record says.
 *
 * The record of the stage is `tests/tests.json`; the specs and seeds beside it
 * are the tests. Storing them is the caller's.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SessionDriver, SessionEvent, SessionPersistence } from '@truecourse/agent-loop';
import {
  bootProductWorld,
  buildProductWorld,
  extractSectionTexts,
  prepareFlowTestsDir,
  readGuardClaimsCorpus,
  readGuardFlowsCorpus,
  releaseWorldSlot,
  reserveWorldSlot,
  type WorldBootFailure,
} from '@truecourse/guard-runner';
import {
  FlowTestsFileSchema,
  type FlowTestOutcome,
  type FlowTestRecord,
  type FlowTestsFile,
  type GuardClaim,
  type GuardFlow,
} from '@truecourse/shared';
import {
  flowSeedFileName,
  flowSeedPath,
  flowTestFileName,
  flowTestPath,
  flowTestsDir,
  flowTestsIndexPath,
} from '@truecourse/shared/work-tree';
import { runSessionPool } from '../agent/session-pool.js';
import { describeSessionFailure } from '../guard-setup/session-context.js';
import {
  FLOW_TEST_SESSION_TIMEOUT_MS,
  flowTestBriefing,
  flowTestSessionDef,
  type FlowTestStep,
} from './flow-test-session.js';

export interface FlowTestStageInput {
  repoRoot: string;
  /** The world's identity on this host (the compose project name). */
  worldId: string;
  /** The run's driver and transcript store, built on first use. */
  acquire: () => Promise<{ driver: SessionDriver; persistence: SessionPersistence }>;
  signal?: AbortSignal;
  concurrency?: number;
  /** Before the sessions: the checkout is being built, then the product brought up. */
  onPhase?: (phase: 'build' | 'up' | 'tests') => void;
  onProgress?: (progress: FlowTestStageProgress) => void;
  onSessionEvent?: (workItem: string, event: SessionEvent) => void;
}

export interface FlowTestStageProgress {
  done: number;
  total: number;
  passing: number;
  failing: number;
  blocked: number;
  /** Sessions that ended without an accepted outcome. */
  unsettled: number;
}

export type FlowTestStageResult =
  | {
      status: 'ok';
      /** Every flow's record: the ones kept from before and the ones this run wrote. */
      tests: FlowTestRecord[];
      /** Flows whose test this run wrote or tried to. */
      authored: number;
      /** Flows whose session ended without an accepted outcome, with why. */
      unsettled: Array<{ flowId: string; reason: string }>;
      spent: { sessions: number; turns: number; tokens: number; costUsd: number };
    }
  | { status: 'no-flows' }
  | { status: 'world-failed'; stage: 'build' | WorldBootFailure['stage']; reason: string };

/** The flow → test map of a tree, or an empty one when it has none. */
export function readFlowTests(repoRoot: string): FlowTestsFile {
  try {
    return FlowTestsFileSchema.parse(JSON.parse(fs.readFileSync(flowTestsIndexPath(repoRoot), 'utf-8')));
  } catch {
    return { version: 1, generatedAt: new Date(0).toISOString(), tests: [] };
  }
}

export async function runFlowTestStage(input: FlowTestStageInput): Promise<FlowTestStageResult> {
  const { repoRoot } = input;
  const flows = readGuardFlowsCorpus(repoRoot)?.flows ?? [];
  if (flows.length === 0) return { status: 'no-flows' };

  // A record stands while the flow it was written for is unchanged and, for a
  // flow that has a test, the spec and its seed are still there.
  const prior = new Map(readFlowTests(repoRoot).tests.map((t) => [t.flowId, t]));
  const kept = new Map<string, FlowTestRecord>();
  for (const flow of flows) {
    const record = prior.get(flow.id);
    if (!record || record.flowFingerprint !== flow.fingerprint) continue;
    const files = [record.file, record.seed].flatMap((file) => (file ? [file] : []));
    if (files.some((file) => !fs.existsSync(path.join(flowTestsDir(repoRoot), file)))) continue;
    kept.set(flow.id, record);
  }
  const work = flows.filter((flow) => !kept.has(flow.id));

  const written = new Map<string, FlowTestRecord>();
  const unsettled: Array<{ flowId: string; reason: string }> = [];
  const spent = { sessions: 0, turns: 0, tokens: 0, costUsd: 0 };

  if (work.length > 0) {
    const prepared = prepareFlowTestsDir(repoRoot);
    if (!prepared.ok) return { status: 'world-failed', stage: 'scripts', reason: prepared.reason };

    const slot = await reserveWorldSlot(input.worldId);
    try {
      input.onPhase?.('build');
      const build = await buildProductWorld(repoRoot, { slot, ...(input.signal ? { signal: input.signal } : {}) });
      if (!build.ok) {
        const how = build.timedOut ? 'did not finish in time' : `exited ${build.exitCode ?? 'without a code'}`;
        return { status: 'world-failed', stage: 'build', reason: `world/build.sh ${how}:\n${build.output}` };
      }
      input.onPhase?.('up');
      const boot = await bootProductWorld(repoRoot, { slot, ...(input.signal ? { signal: input.signal } : {}) });
      if (!boot.ok) return { status: 'world-failed', stage: boot.stage, reason: boot.reason };

      try {
        input.onPhase?.('tests');
        const world = { id: slot.id, world: boot.running.world };
        const steps = flowStepReader(repoRoot);
        const tally = (): FlowTestStageProgress => {
          const records = [...written.values()];
          return {
            done: records.length + unsettled.length,
            total: work.length,
            passing: records.filter((r) => r.status === 'passing').length,
            failing: records.filter((r) => r.status === 'failing').length,
            blocked: records.filter((r) => r.status === 'blocked').length,
            unsettled: unsettled.length,
          };
        };
        input.onProgress?.(tally());

        const { driver, persistence } = await input.acquire();
        await runSessionPool<GuardFlow, FlowTestOutcome>({
          items: work,
          workItem: (flow) => `flow:${flow.id}`,
          session: (flow) =>
            flowTestSessionDef({
              repoRoot,
              flow,
              steps: steps(flow),
              world,
              ...(input.signal ? { signal: input.signal } : {}),
            }).def,
          briefing: (flow) => [flowTestBriefing({ repoRoot, flow, steps: steps(flow), world })],
          driver,
          persistence,
          timeoutMs: FLOW_TEST_SESSION_TIMEOUT_MS,
          ...(input.concurrency ? { concurrency: input.concurrency } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
          ...(input.onSessionEvent ? { onSessionEvent: input.onSessionEvent } : {}),
          fold: (flow, outcome) => {
            spent.sessions += 1;
            spent.turns += outcome.spent.turns;
            spent.tokens += outcome.spent.tokens;
            spent.costUsd += outcome.spent.costUsd;
            const specPath = flowTestPath(repoRoot, flow.id);
            const seedPath = flowSeedPath(repoRoot, flow.id);
            if (outcome.status === 'completed') {
              const { status, summary, disagreement, blockedBy } = outcome.output;
              written.set(flow.id, {
                flowId: flow.id,
                flowFingerprint: flow.fingerprint,
                status,
                ...(status === 'blocked' ? {} : { file: flowTestFileName(flow.id) }),
                ...(status !== 'blocked' && fs.existsSync(seedPath) ? { seed: flowSeedFileName(flow.id) } : {}),
                summary,
                ...(disagreement ? { disagreement } : {}),
                ...(blockedBy ? { blockedBy } : {}),
              });
            } else {
              // Nobody accepted this spec or its seed: whatever is on disk is unproven.
              fs.rmSync(specPath, { force: true });
              fs.rmSync(seedPath, { force: true });
              unsettled.push({ flowId: flow.id, reason: describeSessionFailure(outcome.failure) });
            }
            input.onProgress?.(tally());
          },
        });
      } finally {
        await boot.running.down();
      }
    } finally {
      releaseWorldSlot(slot);
    }
  }

  const tests = flows.flatMap((flow) => {
    const record = written.get(flow.id) ?? kept.get(flow.id);
    return record ? [record] : [];
  });
  writeFlowTests(repoRoot, tests);
  return { status: 'ok', tests, authored: work.length, unsettled, spent };
}

/** Write the flow → test map, and drop every spec and seed it does not name. */
function writeFlowTests(repoRoot: string, tests: readonly FlowTestRecord[]): void {
  const dir = flowTestsDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  const named = new Set(tests.flatMap((t) => [t.file, t.seed].flatMap((file) => (file ? [file] : []))));
  for (const entry of fs.readdirSync(dir)) {
    if (/\.(?:spec|seed)\.ts$/.test(entry) && !named.has(entry)) fs.rmSync(path.join(dir, entry), { force: true });
  }
  fs.rmSync(path.join(dir, 'scratch'), { recursive: true, force: true });
  const file: FlowTestsFile = { version: 1, generatedAt: new Date().toISOString(), tests: [...tests] };
  fs.writeFileSync(flowTestsIndexPath(repoRoot), `${JSON.stringify(file, null, 2)}\n`);
}

/**
 * A flow's steps as its briefing shows them: each milestone with the claim it
 * names and the document section that claim was read from. Documents are read
 * once each, however many flows cite them.
 */
function flowStepReader(repoRoot: string): (flow: GuardFlow) => FlowTestStep[] {
  const claims = new Map<string, GuardClaim>();
  for (const claim of readGuardClaimsCorpus(repoRoot)?.claims ?? []) {
    claims.set(claimKey(claim.doc, claim.anchor, claim.title), claim);
  }
  const sections = new Map<string, ReturnType<typeof extractSectionTexts> | null>();
  const sectionsOf = (doc: string): ReturnType<typeof extractSectionTexts> | null => {
    let texts = sections.get(doc);
    if (texts === undefined) {
      try {
        texts = extractSectionTexts(doc, fs.readFileSync(path.resolve(repoRoot, doc), 'utf-8'));
      } catch {
        texts = null;
      }
      sections.set(doc, texts);
    }
    return texts;
  };
  return (flow) =>
    flow.milestones.map((milestone) => {
      const claim = claims.get(claimKey(milestone.doc, milestone.anchor, milestone.claimTitle));
      const section = sectionsOf(milestone.doc)?.get(milestone.anchor);
      return {
        order: milestone.order,
        claimTitle: milestone.claimTitle,
        ...(claim ? { claim: claim.claim } : {}),
        doc: milestone.doc,
        anchor: milestone.anchor,
        ...(section ? { sectionText: section.ownText } : {}),
      };
    });
}

function claimKey(doc: string, anchor: string, title: string): string {
  return `${doc}\0${anchor}\0${title}`;
}
