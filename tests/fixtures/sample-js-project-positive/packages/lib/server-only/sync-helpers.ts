
// FP shape: Promise.all with multiple async flush functions; no type mismatch
declare function syncFields(): Promise<void>;
declare function syncParticipants(): Promise<void>;
declare function syncMetadata(): Promise<void>;

async function flushAllChanges() {
  await Promise.all([syncFields(), syncParticipants(), syncMetadata()]);
}
