/**
 * Streaming reads MUST be sequential by construction:
 *   - `for await (const chunk of stream)` is async iteration, sequential
 *     by the JS async-iterator protocol.
 *   - `while ((const r = await reader.read()).done) {...}` is the
 *     canonical ReadableStream consumption loop — each call's `done`
 *     bit drives the next iteration.
 *
 * The await-in-loop rule must skip the streaming `while ... await
 * reader.read()` pattern — there is no fixed iteration set to
 * parallelise with Promise.all.
 *
 * Mirrors documenso's
 *   apps/remix/server/api/ai/detect-fields.client.ts:115
 *   apps/remix/server/api/ai/detect-recipients.client.ts:114
 */

interface Reader<T> { read(): Promise<{ value: T | undefined; done: boolean }> }

export async function consumeStream<T>(reader: Reader<T>, sink: (chunk: T) => boolean): Promise<boolean> {
  // Canonical ReadableStream consumption loop — sequential by design.
  while (true) {
    const result = await reader.read();
    if (result.done) return true;
    if (result.value !== undefined && !sink(result.value)) return false;
  }
}
