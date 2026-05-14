
// tx.envelope.update already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  envelope: { update(args: { where: { id: string }; data: unknown }): Promise<{ id: string }> };
  documentMeta: { update(args: { where: { envelopeId: string }; data: unknown }): Promise<{ id: string }> };
};

export async function updateEnvelopeSettings(
  envelopeId: string,
  title: string,
  metaData: unknown,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.envelope.update({
      where: { id: envelopeId },
      data: { title },
    });
    await tx.documentMeta.update({
      where: { envelopeId },
      data: metaData,
    });
  });
}
