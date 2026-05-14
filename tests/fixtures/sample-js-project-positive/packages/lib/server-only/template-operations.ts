
// FP: tx.envelope.create inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare function generateEnvelopeId(): string;
declare function generateSecondaryId(): string;

export async function createEnvelopeFromDirectTemplate(
  templateId: string,
  ownerId: number,
  title: string,
): Promise<{ envelopeId: string }> {
  return await db.$transaction(async (tx) => {
    const envelope = await tx.envelope.create({
      data: {
        id: generateEnvelopeId(),
        secondaryId: generateSecondaryId(),
        title,
        userId: ownerId,
        templateId,
        status: 'DRAFT',
      },
    });

    await tx.envelopeItem.createMany({
      data: [{ envelopeId: envelope.id, title, order: 0 }],
    });

    return { envelopeId: envelope.id };
  });
}



// FP: tx.recipient.update inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };

export async function finaliseDirectRecipientOnCompletion(
  envelopeId: string,
  recipientId: number,
  name: string,
  email: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.recipient.update({
      where: { id: recipientId },
      data: { name, email, signingStatus: 'SIGNED' },
    });

    await tx.documentAuditLog.createMany({
      data: [{ envelopeId, type: 'RECIPIENT_SIGNED', createdAt: new Date() }],
    });
  });
}



// FP: tx.documentAuditLog.createMany inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare function buildBulkAuditLogs(envelopeId: string, events: string[], meta: any): any[];

export async function createEnvelopeFromTemplateWithAuditLogs(
  envelopeId: string,
  eventTypes: string[],
  requestMetadata: any,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.envelope.update({
      where: { id: envelopeId },
      data: { status: 'PENDING' },
    });

    await tx.documentAuditLog.createMany({
      data: buildBulkAuditLogs(envelopeId, eventTypes, requestMetadata),
    });
  });
}
