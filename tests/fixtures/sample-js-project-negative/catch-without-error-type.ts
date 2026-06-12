// A multi-statement catch block that branches on unrelated state (a retry
// counter) and never inspects the error's type. Different failures (a transient
// network error vs. a permanent validation error) need different handling, but
// here they are all treated the same — the discrimination gap the rule flags.

declare function attempt(): Promise<void>;
declare const log: { error: (msg: string, err: unknown) => void };

export async function withRetry(maxRetries: number): Promise<void> {
  let remaining = maxRetries;
  try {
    await attempt();
  } catch (error) {
    // VIOLATION: reliability/deterministic/catch-without-error-type
    if (remaining > 0) {
      remaining -= 1;
      await attempt();
    }
    log.error('giving up', error);
  }
}
