
// --- FP shape: while (!done) streaming reader loop — sequential by protocol design ---
declare const streamReader: { read(): Promise<{ done: boolean; value: Uint8Array | undefined }> };
declare function processStreamChunk(chunk: Uint8Array): void;

async function consumeResponseStream(): Promise<void> {
  let done = false;
  while (!done) {
    const { done: isDone, value } = await streamReader.read();
    done = isDone;
    if (value) processStreamChunk(value);
  }
}
