import { describe, it, expect } from 'vitest';
import { BaseCLIProvider } from '../../apps/server/src/services/llm/cli-provider.js';
import { ServiceViolationOutputSchema } from '../../apps/server/src/services/llm/schemas.js';
import { config } from '../../apps/server/src/config/index.js';

/**
 * Test subclass: bypasses real process spawning. Each spawnCLI call
 * resolves to a fixed JSON envelope after a configurable delay, while
 * tracking in-flight count so tests can assert peak concurrency.
 */
class CountingProvider extends BaseCLIProvider {
  get binaryName() { return 'test-binary'; }
  get baseArgs() { return []; }
  get modelFlag() { return []; }

  public inFlight = 0;
  public peak = 0;
  public calls = 0;
  public delayMs = 20;

  protected async spawnCLI(): Promise<string> {
    this.calls++;
    this.inFlight++;
    this.peak = Math.max(this.peak, this.inFlight);
    try {
      await new Promise((r) => setTimeout(r, this.delayMs));
      return JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        structured_output: { violations: [], serviceDescriptions: [] },
      });
    } finally {
      this.inFlight--;
    }
  }

  async runTask(onStart?: () => void) {
    return (this as unknown as {
      spawnAndParse: (
        p: string,
        s: typeof ServiceViolationOutputSchema,
        opts?: { onStart?: () => void },
      ) => Promise<unknown>;
    }).spawnAndParse('prompt', ServiceViolationOutputSchema, { onStart });
  }
}

describe('BaseCLIProvider concurrency cap', () => {
  it('never exceeds config.claudeCodeMaxConcurrency across concurrent spawnAndParse calls', async () => {
    const provider = new CountingProvider();
    const cap = config.claudeCodeMaxConcurrency;
    const total = cap * 3 + 2;

    const results = await Promise.all(
      Array.from({ length: total }, () => provider.runTask()),
    );

    expect(results).toHaveLength(total);
    expect(provider.calls).toBe(total);
    expect(provider.peak).toBeLessThanOrEqual(cap);
    expect(provider.peak).toBe(cap); // saturates under load
  });

  it('queues tasks rather than dropping them when the cap is hit', async () => {
    const provider = new CountingProvider();
    provider.delayMs = 50;
    const cap = config.claudeCodeMaxConcurrency;
    const total = cap * 2;

    const t0 = Date.now();
    await Promise.all(
      Array.from({ length: total }, () => provider.runTask()),
    );
    const elapsed = Date.now() - t0;

    // With a hard cap, total runtime must be at least 2 waves.
    // Allow loose lower bound to stay robust under CI timing jitter.
    expect(elapsed).toBeGreaterThanOrEqual(provider.delayMs * 2 * 0.75);
    expect(provider.calls).toBe(total);
  });

  it('fires onStart only after the limiter grants a slot, not at submission', async () => {
    const provider = new CountingProvider();
    const cap = config.claudeCodeMaxConcurrency;
    provider.delayMs = 60;

    // Fill every slot with blockers; none carry an onStart callback.
    const blockers = Array.from({ length: cap }, () => provider.runTask());

    let queuedStarted = false;
    const queued = provider.runTask(() => { queuedStarted = true; });

    // Immediately after submission the onStart for the queued task
    // must NOT have fired — it's still waiting behind the blockers.
    await new Promise((r) => setImmediate(r));
    expect(queuedStarted).toBe(false);

    await Promise.all([queued, ...blockers]);
    expect(queuedStarted).toBe(true);
  });

  it('defers spawnCLI until a slot is acquired (timer starts after acquire)', async () => {
    // Core invariant: spawnAndParse must acquire the semaphore BEFORE calling
    // spawnCLI, so a queued task's timeout timer (which lives inside spawnCLI)
    // does not start counting while it waits.
    const provider = new CountingProvider();
    const cap = config.claudeCodeMaxConcurrency;
    provider.delayMs = 80;

    // Fill every slot.
    const blockers = Array.from({ length: cap }, () => provider.runTask());

    // One more task — must be queued, not yet in spawnCLI.
    const queuedPromise = provider.runTask();
    await new Promise((r) => setImmediate(r));
    expect(provider.calls).toBe(cap); // N+1'th task has NOT spawned yet

    await Promise.all([queuedPromise, ...blockers]);
    expect(provider.calls).toBe(cap + 1); // ran after a slot freed up
  });
});
