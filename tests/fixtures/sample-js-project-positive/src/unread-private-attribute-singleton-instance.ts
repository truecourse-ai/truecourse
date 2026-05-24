/**
 * Positive fixture for code-quality/deterministic/unread-private-attribute.
 *
 * A method can hold an instance of its own class in a local variable
 * and read a private field through that local rather than through
 * `this`. The rule walks the class body looking for reads, so a read
 * of the form `inst.heartbeatInterval` still counts as an internal
 * use of the field. Writes can happen through `this`; the FP arises
 * when reads only happen through a non-`this` reference.
 *
 * Paraphrased from a singleton heartbeat client where `start()` writes
 * through `this.heartbeatInterval` but `stop()` reads through the
 * stashed instance reference.
 */

declare const setIntervalShim: (cb: () => void, ms: number) => number;
declare const clearIntervalShim: (handle: number) => void;
declare function getStashedInstance(): HeartbeatScheduler | null;
declare function stashInstance(inst: HeartbeatScheduler): void;

declare function tick(): void;

export class HeartbeatScheduler {
  // Written through `this` (so `unused-private-member` sees access),
  // but read only through a non-`this` reference (`inst`). The FP for
  // `unread-private-attribute` is that the rule misses the non-`this`
  // read and reports this field as "written but never read".
  private heartbeatInterval: number | null = null;

  public start(intervalMs: number): void {
    this.heartbeatInterval = setIntervalShim(tick, intervalMs);
    stashInstance(this);
  }

  public static stop(): void {
    const inst = getStashedInstance();
    if (inst && inst.heartbeatInterval !== null) {
      clearIntervalShim(inst.heartbeatInterval);
      inst.heartbeatInterval = null;
    }
  }
}
