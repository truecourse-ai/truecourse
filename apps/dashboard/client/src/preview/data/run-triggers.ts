// PREVIEW: REAL — which agentic commands the shell can start for itself.

/**
 * The command → start-it map.
 *
 * A run surface asks this whether the run in front of it can be started again;
 * a command with no entry simply has no button. Guard's steps light up by
 * adding their call here, and nothing else changes.
 */

import { startSpecScan, type ScanStart } from './scan';

export type RunTrigger = (repoId: string) => Promise<ScanStart>;

const RUN_TRIGGERS: Record<string, RunTrigger> = {
  'spec-scan': startSpecScan,
};

export const triggerFor = (command: string): RunTrigger | null =>
  RUN_TRIGGERS[command] ?? null;

/** The command a repository with no runs at all starts with. */
export const FIRST_RUN_COMMAND = 'spec-scan';
