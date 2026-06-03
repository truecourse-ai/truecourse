import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BaseCLIProvider } from '../../packages/core/src/services/llm/cli-provider.js';
import { ServiceViolationOutputSchema } from '../../packages/core/src/services/llm/schemas.js';
import { config } from '../../packages/core/src/config/index.js';
// Import the bare specifier — the SAME @truecourse/llm module instance that
// the core provider resolves — so the transport singleton is shared.
import {
  setLlmTransport,
  resetLlmTransport,
  type LlmTransport,
} from '@truecourse/llm';

/**
 * Counting transport: bypasses real process spawning. Each `complete` call
 * resolves to a fixed result after a configurable delay, tracking in-flight
 * count so tests can assert peak concurrency. The concurrency cap under test
 * lives in `BaseCLIProvider.spawnAndParse`'s limiter, which wraps this call.
 */
class CountingTransport implements LlmTransport {
  public inFlight = 0;
  public peak = 0;
  public calls = 0;
  public delayMs = 20;

  async complete(): Promise<{ object: unknown; usage?: undefined }> {
    this.calls++;
    this.inFlight++;
    this.peak = Math.max(this.peak, this.inFlight);
    try {
      await new Promise((r) => setTimeout(r, this.delayMs));
      return { object: { violations: [], serviceDescriptions: [] } };
    } finally {
      this.inFlight--;
    }
  }

  async completeText(): Promise<{ text: string }> {
    return { text: '' };
  }
}

class TestProvider extends BaseCLIProvider {
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

let transport: CountingTransport;
let provider: TestProvider;

beforeEach(() => {
  transport = new CountingTransport();
  setLlmTransport(transport);
  provider = new TestProvider();
});

afterEach(() => {
  resetLlmTransport();
});

describe('BaseCLIProvider concurrency cap', () => {
  it('never exceeds config.claudeCodeMaxConcurrency across concurrent spawnAndParse calls', async () => {
    const cap = config.claudeCodeMaxConcurrency;
    const total = cap * 3 + 2;

    const results = await Promise.all(
      Array.from({ length: total }, () => provider.runTask()),
    );

    expect(results).toHaveLength(total);
    expect(transport.calls).toBe(total);
    expect(transport.peak).toBeLessThanOrEqual(cap);
    expect(transport.peak).toBe(cap); // saturates under load
  });

  it('queues tasks rather than dropping them when the cap is hit', async () => {
    transport.delayMs = 50;
    const cap = config.claudeCodeMaxConcurrency;
    const total = cap * 2;

    const t0 = Date.now();
    await Promise.all(
      Array.from({ length: total }, () => provider.runTask()),
    );
    const elapsed = Date.now() - t0;

    // With a hard cap, total runtime must be at least 2 waves.
    // Allow loose lower bound to stay robust under CI timing jitter.
    expect(elapsed).toBeGreaterThanOrEqual(transport.delayMs * 2 * 0.75);
    expect(transport.calls).toBe(total);
  });

  it('fires onStart only after the limiter grants a slot, not at submission', async () => {
    const cap = config.claudeCodeMaxConcurrency;
    transport.delayMs = 60;

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

  it('defers the transport call until a slot is acquired (timer starts after acquire)', async () => {
    // Core invariant: spawnAndParse must acquire the semaphore BEFORE calling
    // the transport, so a queued task's timeout (inside the transport) does not
    // start counting while it waits.
    const cap = config.claudeCodeMaxConcurrency;
    transport.delayMs = 80;

    // Fill every slot.
    const blockers = Array.from({ length: cap }, () => provider.runTask());

    // One more task — must be queued, not yet calling the transport.
    const queuedPromise = provider.runTask();
    await new Promise((r) => setImmediate(r));
    expect(transport.calls).toBe(cap); // N+1'th task has NOT called the transport yet

    await Promise.all([queuedPromise, ...blockers]);
    expect(transport.calls).toBe(cap + 1); // ran after a slot freed up
  });
});
