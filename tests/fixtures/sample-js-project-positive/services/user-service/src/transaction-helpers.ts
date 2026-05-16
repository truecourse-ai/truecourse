
// --- FP shape: ORM $transaction() with async callback ---
declare const prisma2: {
  $transaction<T>(fn: (tx: typeof prisma2) => Promise<T>): Promise<T>;
  user: { create(args: { data: { email: string; name: string } }): Promise<{ id: number }> };
};

const newUser = await prisma2.$transaction(async (tx) => {
  return tx.user.create({ data: { email: 'user@example.com', name: 'Test User' } });
});


// --- argument-type-mismatch FP: $transaction() with for...of loop inside async callback ---
// prisma.$transaction(async (tx) => { for (const item of items) { await tx.X.update(...) } }) — standard Prisma pattern.
declare const prisma3: {
  $transaction<T>(fn: (tx: {
    attachment: {
      update(args: { where: { reportId: string; dataId: string }; data: { dataId: string } }): Promise<void>;
    };
  }) => Promise<T>): Promise<T>;
};

interface AttachmentMigration { reportId: string; oldDataId: string; newDataId: string }

export async function migrateAttachmentData(migrations: AttachmentMigration[]): Promise<void> {
  await prisma3.$transaction(async (tx) => {
    for (const { reportId, oldDataId, newDataId } of migrations) {
      await tx.attachment.update({
        where: { reportId, dataId: oldDataId },
        data: { dataId: newDataId },
      });
    }
  });
}

