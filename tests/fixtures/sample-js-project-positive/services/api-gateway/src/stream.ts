
declare const stream: { writeln: (line: string) => Promise<void> };

async function* processAiDetection(items: string[]) {
  for (const item of items) {
    void stream.writeln(`processing: ${item}`);
    yield item;
  }
}

async function* processBatch(batches: string[][]) {
  for (const batch of batches) {
    void stream.writeln(`batch size: ${batch.length}`);
    yield* batch;
  }
}
