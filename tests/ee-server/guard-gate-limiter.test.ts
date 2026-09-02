/**
 * The guard gate's process-wide limiter: the `TRUECOURSE_GUARD_GATE_CONCURRENCY`
 * env knob (default 2) read at module load, and the singleton built over it. The
 * semaphore itself is generic and tested in tests/jobs/semaphore.test.ts.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

describe('GUARD_GATE_MAX_CONCURRENCY (env knob, module-load time)', () => {
  const ENV = 'TRUECOURSE_GUARD_GATE_CONCURRENCY';
  const saved = process.env[ENV];

  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
    vi.resetModules();
  });

  async function freshModule() {
    vi.resetModules();
    return import('../../ee/packages/server/src/jobs/guard-gate-limiter');
  }

  it('defaults to 2 when the env var is unset', async () => {
    delete process.env[ENV];
    const mod = await freshModule();
    expect(mod.GUARD_GATE_MAX_CONCURRENCY).toBe(2);
  });

  it('honors a numeric override', async () => {
    process.env[ENV] = '5';
    const mod = await freshModule();
    expect(mod.GUARD_GATE_MAX_CONCURRENCY).toBe(5);
  });

  it('falls back to 2 for a non-numeric or zero value', async () => {
    process.env[ENV] = 'lots';
    expect((await freshModule()).GUARD_GATE_MAX_CONCURRENCY).toBe(2);
    process.env[ENV] = '0';
    expect((await freshModule()).GUARD_GATE_MAX_CONCURRENCY).toBe(2);
  });

  it('falls back to 2 for a negative value (a non-positive permit count would deadlock)', async () => {
    process.env[ENV] = '-1';
    expect((await freshModule()).GUARD_GATE_MAX_CONCURRENCY).toBe(2);
  });

  it('floors a fractional override to a whole permit count', async () => {
    process.env[ENV] = '3.7';
    expect((await freshModule()).GUARD_GATE_MAX_CONCURRENCY).toBe(3);
    // Below 1 after flooring is not a usable permit count → default.
    process.env[ENV] = '0.9';
    expect((await freshModule()).GUARD_GATE_MAX_CONCURRENCY).toBe(2);
  });

  it('exports a process-wide limiter singleton', async () => {
    delete process.env[ENV];
    const mod = await freshModule();
    expect(typeof mod.guardGateLimiter.run).toBe('function');
    await expect(mod.guardGateLimiter.run(async () => 1)).resolves.toBe(1);
  });
});
