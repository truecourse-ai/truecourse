
// Snippet: ORM $transaction with async callback — correct Prisma API usage
declare const db: { $transaction: <T>(fn: (tx: typeof db) => Promise<T>) => Promise<T> };
declare function auditLog(tx: typeof db, action: string): Promise<void>;

export async function deleteUserSession(sessionId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await (tx as any).session.delete({ where: { id: sessionId } });
    await auditLog(tx, 'SESSION_DELETED');
  });
}



// prisma.$transaction with async callback
declare interface DbClient {
  $transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  record: { create(data: { data: Record<string, unknown> }): Promise<{ id: string }> };
  auditLog: { create(data: { data: Record<string, unknown> }): Promise<void> };
}
declare const db: DbClient;

async function createRecordWithAudit(payload: Record<string, unknown>): Promise<{ id: string }> {
  return db.$transaction(async (tx) => {
    const record = await tx.record.create({ data: payload });
    await tx.auditLog.create({ data: { recordId: record.id, action: 'CREATE' } });
    return record;
  });
}
