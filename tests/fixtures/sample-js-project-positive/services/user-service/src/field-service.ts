
// --- shape df6ebef35ba3: prisma.$transaction(async tx => ...) ---
declare const prisma: {
  $transaction: <T>(fn: (tx: { field: { deleteMany: (opts: unknown) => Promise<void> }; auditLog: { createMany: (opts: unknown) => Promise<void> } }) => Promise<T>) => Promise<T>;
};
declare const removedFields: Array<{ id: string; type: string; recipientId: number | null }>;
declare const envelopeId: string;

await prisma.$transaction(async (tx) => {
  await tx.field.deleteMany({
    where: {
      id: { in: removedFields.map((field) => field.id) },
    },
  });

  await tx.auditLog.createMany({
    data: removedFields.map((field) => ({
      type: 'FIELD_DELETED',
      envelopeId,
      fieldId: field.id,
      fieldType: field.type,
    })),
  });
});
