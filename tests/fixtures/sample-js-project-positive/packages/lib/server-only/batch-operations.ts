
// Shape: pMap(iterable, async mapper) — pMap takes iterable and async mapper function
declare function pMap<T, R>(iterable: T[], mapper: (item: T, index: number) => Promise<R>, opts?: { concurrency?: number }): Promise<R[]>;
interface WorkItem { id: string; type: string; ownerId: string; }
declare function processWorkItem(opts: { id: string; ownerId: string }): Promise<void>;
declare const workItems: WorkItem[];

async function processBatchItems(workItems: WorkItem[], ownerId: string) {
  const results = await pMap(
    workItems,
    async (item) => {
      await processWorkItem({
        id: item.id,
        ownerId,
      });
    },
    { concurrency: 3 },
  );
  return results;
}



// Shape: Promise.all with destructuring of parallel async queries — no type mismatch
declare function fetchUserPlan(opts: { accountId: string; userId: string }): Promise<{ id: string; name: string }>;
declare function fetchAvailableTiers(): Promise<Array<{ id: string; label: string }>>;

export async function getAccountPlanDetails(accountId: string, userId: string) {
  const [plan, tiers] = await Promise.all([
    fetchUserPlan({
      accountId,
      userId,
    }),
    fetchAvailableTiers(),
  ]);

  return {
    plan,
    tiers,
  };
}



// Shape: Promise.all with multiple parallel DB queries and destructured results — no type mismatch
declare const db: {
  folder: {
    findMany: (opts: unknown) => Promise<Array<{ id: string; name: string }>>;
    count: (opts: unknown) => Promise<number>;
  };
};
declare const folderId: string;
declare const teamId: string;

export async function getFolderStats(parentId: string) {
  const [subfolders, documentCount, templateCount, archivedCount] = await Promise.all([
    db.folder.findMany({ where: { parentId } }),
    db.folder.count({ where: { type: 'DOCUMENT', parentId } }),
    db.folder.count({ where: { type: 'TEMPLATE', parentId } }),
    db.folder.count({ where: { type: 'ARCHIVED', parentId } }),
  ]);

  return { subfolders, documentCount, templateCount, archivedCount };
}



// Shape: Promise.all(array.map(async (item) => fn({id: item.id}))) — correct Promise.all usage, no type mismatch
declare function archiveWorkspaceData(opts: { workspaceId: string }): Promise<void>;
declare const organisation: { workspaces: Array<{ id: string; name: string }> };

export async function archiveAllWorkspaces(): Promise<void> {
  await Promise.all(organisation.workspaces.map(async (workspace) => archiveWorkspaceData({ workspaceId: workspace.id })));
}



// --- FP shape: await-in-loop inside a prisma.$transaction callback (must be sequential) ---
declare const db: {
  $transaction<T>(fn: (tx: {
    signatureRecord: { create(opts: { data: object }): Promise<{ id: string }> }
  }) => Promise<T>): Promise<T>
};
declare const signaturePayloads: Array<{ fieldId: string; value: string; certId: string }>;

async function commitSignatures(): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const payload of signaturePayloads) {
      await tx.signatureRecord.create({
        data: { fieldId: payload.fieldId, value: payload.value, certId: payload.certId },
      });
    }
  });
}



// --- FP shape: do-while loop where deleted count is the termination condition for next iteration ---
declare const db: { rateLimitEntry: { deleteMany(opts: { where: object; take: number }): Promise<{ count: number }> } };
declare const BATCH_SIZE2 = 500;

async function purgeExpiredRateLimits(cutoffDate: Date): Promise<void> {
  let deleted: number;
  do {
    const result = await db.rateLimitEntry.deleteMany({
      where: { createdAt: { lt: cutoffDate } },
      take: BATCH_SIZE2,
    });
    deleted = result.count;
  } while (deleted > 0);
}
