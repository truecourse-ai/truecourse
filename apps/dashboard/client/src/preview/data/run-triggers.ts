/**
 * The command → start-it map.
 *
 * A run surface asks this whether the run in front of it can be started again;
 * a command with no entry simply has no button. Guard's remaining steps light
 * up by adding their call here, and nothing else changes.
 */

import { startContextScan, startGuardGenerate, startGuardSetup, type RunStart } from './scan';

export type RunTrigger = (repoId: string) => Promise<RunStart>;

const RUN_TRIGGERS: Record<string, RunTrigger> = {
  // The Document scan belongs to the workspace, not to a repository: whichever
  // run row offers it, it starts the one workspace scan.
  'spec-scan': () => startContextScan(),
  'guard-setup': startGuardSetup,
  'guard-generate': startGuardGenerate,
};

export const triggerFor = (command: string): RunTrigger | null =>
  RUN_TRIGGERS[command] ?? null;
