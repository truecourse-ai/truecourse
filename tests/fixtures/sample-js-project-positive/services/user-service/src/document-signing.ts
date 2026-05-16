// Prisma $transaction with async callback — valid ORM transaction pattern.
interface FieldRecord { id: string; signed: boolean; signedAt: Date | null; }
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  field: {
    update(args: { where: { id: string }; data: { signed: boolean; signedAt: Date } }): Promise<FieldRecord>;
  };
};

async function signField(fieldId: string): Promise<FieldRecord> {
  return prisma.$transaction(async (tx) => {
    const updatedField = await tx.field.update({
      where: { id: fieldId },
      data: { signed: true, signedAt: new Date() },
    });
    return updatedField;
  });
}
