// FP-GUARD: enum/no-code-counterpart — FlowRunStatus must NOT report no-code-counterpart
// A module-scoped type alias `RunState` holds the two valid values; its name doesn't
// normalize to the contract name but the value-set is an exact match.
// Before the fix, the pure value-set path requires minLen >= 3, so a 2-value enum
// is never matched by value-set alone, yielding a spurious no-code-counterpart.
type RunState = 'active' | 'inactive';

export interface PipelineRun {
  id: string;
  state: RunState;
}
