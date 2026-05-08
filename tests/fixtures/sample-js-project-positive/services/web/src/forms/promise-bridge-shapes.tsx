/**
 * async-promise-function shape that should NOT fire:
 *
 * Non-async function that returns `new Promise(...)` to bridge
 * a callback API. There is no async equivalent — `setTimeout`,
 * `addEventListener`, MessageChannel, postMessage, etc. all
 * deliver values via callbacks. The Promise constructor IS the
 * idiomatic adapter.
 */

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
