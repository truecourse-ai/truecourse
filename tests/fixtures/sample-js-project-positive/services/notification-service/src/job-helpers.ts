
// --- argument-type-mismatch shape: Promise.allSettled with async map ---
// Promise.allSettled(items.map(async (item) => await jobs.triggerJob({...}))) — valid async map.
interface ExpiredEntry { id: string }
declare const jobs: { triggerJob: (opts: { name: string; payload: object }) => Promise<void> };
async function processExpiredEntries(entries: ExpiredEntry[]): Promise<void> {
  await Promise.allSettled(
    entries.map(async (entry) => {
      await jobs.triggerJob({
        name: 'internal.process-entry-expired',
        payload: { entryId: entry.id },
      });
    }),
  );
}
