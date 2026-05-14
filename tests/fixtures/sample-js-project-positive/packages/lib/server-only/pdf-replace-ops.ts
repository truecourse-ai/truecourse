
// tx.field.deleteMany already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  field: {
    findMany(args: { where: unknown; select: unknown }): Promise<{ id: number }[]>;
    deleteMany(args: { where: { id: { in: number[] } } }): Promise<{ count: number }>;
  };
  envelopeItem: { update(args: { where: { id: string }; data: unknown }): Promise<{ id: string }> };
};

export async function replacePdfAndPruneFields(
  envelopeId: string,
  envelopeItemId: string,
  newPageCount: number,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const outOfBoundsFields = await tx.field.findMany({
      where: { envelopeId, envelopeItemId, page: { gt: newPageCount } },
      select: { id: true },
    });
    const ids = outOfBoundsFields.map((f) => f.id);
    if (ids.length > 0) {
      await tx.field.deleteMany({ where: { id: { in: ids } } });
    }
    await tx.envelopeItem.update({
      where: { id: envelopeItemId },
      data: { pageCount: newPageCount },
    });
  });
}
