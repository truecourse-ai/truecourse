/**
 * The guard-gate concurrency limiter: a plain counting semaphore whose permits
 * gate only the executor call (clone/LLM/Check-post run outside it), plus the
 * `TRUECOURSE_GUARD_GATE_CONCURRENCY` env knob (default 2) behind the
 * process-wide singleton.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createSemaphore } from '../../ee/packages/server/src/jobs/guard-gate-limiter';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let all currently-runnable microtasks settle. */
const flush = () => new Promise<void>((res) => setImmediate(res));

describe('createSemaphore', () => {
  it('returns the wrapped function value', async () => {
    const sem = createSemaphore(1);
    await expect(sem.run(async () => 'verdict')).resolves.toBe('verdict');
  });

  it('runs at most `max` functions concurrently; the next starts when a permit frees', async () => {
    const sem = createSemaphore(2);
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const started: number[] = [];

    const runs = gates.map((gate, i) =>
      sem.run(() => {
        started.push(i);
        return gate.promise;
      }),
    );

    await flush();
    expect(started).toEqual([0, 1]); // third holds until a permit frees

    gates[0]!.resolve('a');
    await flush();
    expect(started).toEqual([0, 1, 2]);

    gates[1]!.resolve('b');
    gates[2]!.resolve('c');
    await expect(Promise.all(runs)).resolves.toEqual(['a', 'b', 'c']);
  });

  it('a rejecting function releases its permit and propagates the error', async () => {
    const sem = createSemaphore(1);
    const gate = deferred<never>();
    const first = sem.run(() => gate.promise);

    let secondStarted = false;
    const second = sem.run(async () => {
      secondStarted = true;
      return 'ok';
    });

    await flush();
    expect(secondStarted).toBe(false);

    gate.reject(new Error('build timed out'));
    await expect(first).rejects.toThrow('build timed out');

    await expect(second).resolves.toBe('ok');
    expect(secondStarted).toBe(true);
  });
});

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
