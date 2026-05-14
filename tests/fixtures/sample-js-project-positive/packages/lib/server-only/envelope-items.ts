
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; envelopeItem: { createMany: (args: any) => Promise<any> }; auditLog: { createMany: (args: any) => Promise<any> }; };
declare function buildItemAuditEntry(itemId: number, envelopeId: number): object;

export async function addEnvelopeItems(
  envelopeId: number,
  items: Array<{ name: string; url: string; size: number }>,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const created = await tx.envelopeItem.createMany({
      data: items.map((item) => ({ ...item, envelopeId })),
    });

    await tx.auditLog.createMany({
      data: items.map((_, i) => buildItemAuditEntry(i, envelopeId)),
    });

    return created;
  });
}
