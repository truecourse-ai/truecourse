
// --- shape dc7229ca6b11: io.runTask(taskName, async callback) ---
declare const io: {
  runTask: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  logger: { info: (msg: string) => void };
};
declare const db: {
  auditLog: { create: (data: { data: Record<string, unknown> }) => Promise<void> };
};
declare const recipientId: number;

async function createAuditLogEntry(): Promise<void> {
  await io.runTask('create-audit-log', async () => {
    await db.auditLog.create({
      data: {
        type: 'RECIPIENT_EXPIRED',
        recipientId,
        timestamp: new Date().toISOString(),
      },
    });
  });
}
