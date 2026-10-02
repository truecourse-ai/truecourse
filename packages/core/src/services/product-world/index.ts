/**
 * THE PRODUCT-WORLD PIPELINE — setup and test writing done by sessions that
 * have a shell in the checkout and the product running in front of them.
 *
 *   world-setup.ts        setup: three scripts that bring the product up
 *   world-session.ts      the session that writes them
 *   flow-test-stage.ts    generate: one Playwright test per flow
 *   flow-test-session.ts  the session that writes one
 *
 * The deterministic half (running the scripts, running the tests) is
 * `@truecourse/guard-runner`'s `product-world.ts` and `flow-tests.ts`.
 */

export { runWorldSetup, type WorldSetupInput, type WorldSetupResult } from './world-setup.js';
export { WORLD_SESSION_KIND } from './world-session.js';
export {
  readFlowTests,
  runFlowTestStage,
  type FlowTestStageInput,
  type FlowTestStageProgress,
  type FlowTestStageResult,
} from './flow-test-stage.js';
export { FLOW_TEST_SESSION_KIND } from './flow-test-session.js';
