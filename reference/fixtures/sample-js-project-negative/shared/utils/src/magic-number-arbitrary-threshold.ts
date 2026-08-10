// True bug pattern: an arbitrary numeric threshold buried in the code with
// no name to explain what it represents. A reader has to guess what 4567
// means and why it was chosen.

export function isOverQuota(usage: number): boolean {
  // VIOLATION: code-quality/deterministic/magic-number
  return usage > 4567;
}

export function jitter(base: number): number {
  // VIOLATION: code-quality/deterministic/magic-number
  return base + Math.random() * 7300;
}
