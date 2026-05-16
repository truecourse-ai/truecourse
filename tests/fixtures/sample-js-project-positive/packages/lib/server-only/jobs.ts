
// io.runTask with async callback — standard job task pattern, no type mismatch
declare const io: { runTask: (name: string, fn: () => Promise<void>) => Promise<void> };
declare const db: { $executeRaw: (query: any) => Promise<number> };
declare const claimId: string;

async function backportClaims() {
  await io.runTask('backport-claims', async () => {
    await db.$executeRaw`UPDATE claims SET active = true WHERE id = ${claimId}`;
  });
}



// --- no-void shape: module-level-or-non-react-async-init (void this.asyncScheduler() in constructor) ---
declare const Queue: new (name: string, opts: object) => { upsertJobScheduler: (id: string, opts: object) => Promise<void> };

class DocumentJobQueue {
  private _queue: InstanceType<typeof Queue>;

  constructor(redisUrl: string) {
    this._queue = new Queue('document-jobs', { connection: { url: redisUrl } });
    void this._queue.upsertJobScheduler('cleanup-expired', { every: 3_600_000 });
  }
}
