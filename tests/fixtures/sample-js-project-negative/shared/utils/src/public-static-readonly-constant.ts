// Paraphrased true-bug for code-quality/deterministic/public-static-readonly.
//
// A public static field initialized to a compile-time constant but left
// mutable. Anyone can reassign `RetryPolicy.maxAttempts` and silently change
// the behaviour for every caller; it should be `readonly`.

export class RetryPolicy {
  // VIOLATION: code-quality/deterministic/public-static-readonly
  static maxAttempts = 5;

  private attempts = 0;

  recordAttempt(): void {
    this.attempts = this.attempts + 1;
  }

  get used(): number {
    return this.attempts;
  }
}
