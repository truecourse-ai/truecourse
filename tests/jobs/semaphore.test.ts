/**
 * The counting semaphore a job uses to cap how many instances of one expensive
 * phase run at once: permits gate only the wrapped call, and are released on
 * both settle paths.
 */
import { describe, it, expect } from 'vitest';
import { createSemaphore } from '@truecourse/jobs';

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
