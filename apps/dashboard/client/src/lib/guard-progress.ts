import type { GuardFlowProgress } from '@truecourse/shared';

export const GUARD_EXECUTION_LABELS: Record<GuardFlowProgress['execution'], string> = {
  passed: 'Passed', failed: 'Failed', error: 'Execution error', blocked: 'Blocked',
  'not-run': 'Not run', 'not-generated': 'Not generated',
};
export const GUARD_COVERAGE_LABELS: Record<GuardFlowProgress['coverage'], string> = {
  complete: 'Complete', partial: 'Partial', unverified: 'Unverified', unknown: 'Unknown',
};
export const GUARD_GENERATION_LABELS: Record<GuardFlowProgress['generation'], string> = {
  ready: 'Ready', incomplete: 'Incomplete generation', error: 'Generation error',
  unsupported: 'Unsupported capability', 'needs-setup': 'Needs setup',
};

export function guardCoverageText(progress: GuardFlowProgress): string {
  if (progress.coverage === 'unknown') return 'Coverage not recorded';
  return `${GUARD_COVERAGE_LABELS[progress.coverage]} · ${progress.verified}/${progress.total} ${progress.unit}`;
}
