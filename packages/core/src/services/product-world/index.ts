/**
 * THE PRODUCT-WORLD PIPELINE — setup and test writing done by sessions that
 * have a shell in the checkout and the product running in front of them.
 *
 *   world-setup.ts        setup: three scripts that bring the product up
 *   world-session.ts      the session that writes them
 *   flow-test-stage.ts    generate: one Playwright test per flow, kept true at every commit
 *   flow-test-session.ts  the session that writes one, or repairs it
 *   flow-test-fidelity.ts the judge that reads a test against its claims
 *   flow-test-steps.ts    a flow's steps as both of them are shown them
 *   flow-test-run.ts      run: every stored test against the product, brought up once
 *
 * The deterministic half (running the scripts, running the tests) is
 * `@truecourse/guard-runner`'s `product-world.ts` and `flow-tests.ts`.
 */

export { runWorldSetup, type WorldSetupInput, type WorldSetupResult } from './world-setup.js';
export { WORLD_SESSION_KIND } from './world-session.js';
export {
  readFlowTests,
  runFlowTestStage,
  type FlowTestMoved,
  type FlowTestStageInput,
  type FlowTestStageProgress,
  type FlowTestStageResult,
} from './flow-test-stage.js';
export { FLOW_TEST_SESSION_KIND } from './flow-test-session.js';
export { FLOW_TEST_FIDELITY_SESSION_KIND } from './flow-test-fidelity.js';
export { flowTestRunLatest, runStoredFlowTests, type FlowTestRunInput, type FlowTestRunOutcome } from './flow-test-run.js';
