
// tx.envelopeItem.delete already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  envelopeItem: { delete(args: { where: { id: string; envelopeId: string } }): Promise<{ id: string; title: string }> };
  documentAuditLog: { create(args: { data: unknown }): Promise<{ id: string }> };
};

export async function deleteAttachment(
  envelopeId: string,
  attachmentId: string,
  userId: number,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.envelopeItem.delete({
      where: { id: attachmentId, envelopeId },
    });
    await tx.documentAuditLog.create({
      data: { envelopeId, type: 'ATTACHMENT_DELETED', data: { title: deleted.title, userId } },
    });
  });
}
