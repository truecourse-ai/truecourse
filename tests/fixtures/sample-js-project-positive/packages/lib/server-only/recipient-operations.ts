
// FP: tx.recipient.upsert inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare function generateToken(): string;

export async function syncEnvelopeRecipients(
  envelopeId: string,
  recipients: Array<{ email: string; name: string; role: string; existingId?: number }>,
): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const recipient of recipients) {
      await tx.recipient.upsert({
        where: { id: recipient.existingId ?? -1 },
        create: {
          envelopeId,
          email: recipient.email,
          name: recipient.name,
          role: recipient.role,
          token: generateToken(),
        },
        update: {
          email: recipient.email,
          name: recipient.name,
          role: recipient.role,
        },
      });
    }
  });
}



// FP: tx.recipient.update inside prisma.$transaction — already in transaction (update envelope recipients)
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare const RecipientRole: { CC: string; VIEWER: string };

export async function updateEnvelopeRecipients(
  envelopeId: string,
  updates: Array<{ id: number; name: string; email: string; role: string; originalRole: string }>,
): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const updatedRecipient of updates) {
      await tx.recipient.update({
        where: { id: updatedRecipient.id },
        data: {
          name: updatedRecipient.name,
          email: updatedRecipient.email,
          role: updatedRecipient.role,
        },
      });

      if (
        updatedRecipient.originalRole !== updatedRecipient.role &&
        (updatedRecipient.role === RecipientRole.CC || updatedRecipient.role === RecipientRole.VIEWER)
      ) {
        await tx.field.deleteMany({
          where: { recipientId: updatedRecipient.id },
        });
      }
    }
  });
}
