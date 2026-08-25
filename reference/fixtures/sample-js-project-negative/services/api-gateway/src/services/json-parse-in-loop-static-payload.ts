// True-bug case: parsing the SAME constant JSON string on every iteration
// of a loop is wasteful — the parse result is constant per iteration and
// can be hoisted out of the loop.

const DEFAULT_BUDGET = '{"timeout":30,"retries":3,"concurrency":4}';

export function applyDefaultBudget(jobs: Array<{ id: string }>): Array<{ id: string; cfg: unknown }> {
  const out: Array<{ id: string; cfg: unknown }> = [];
  for (const job of jobs) {
    // VIOLATION: performance/deterministic/json-parse-in-loop
    const cfg = JSON.parse(DEFAULT_BUDGET);
    out.push({ id: job.id, cfg });
  }
  return out;
}
