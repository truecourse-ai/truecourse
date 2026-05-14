
// tx.model.create already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  recipient: { create(args: { data: unknown }): Promise<{ id: string }> };
  documentAuditLog: { createMany(args: { data: unknown[] }): Promise<{ count: number }> };
};

export async function addRecipientsInTransaction(envelopeId: string, emails: string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const email of emails) {
      await tx.recipient.create({
        data: { envelopeId, email, token: Math.random().toString(36) },
      });
    }
    await tx.documentAuditLog.createMany({
      data: emails.map((email) => ({ envelopeId, type: 'RECIPIENT_ADDED', data: { email } })),
    });
  });
}


// generateAuditLogPdf({envelope, recipients: envelope.recipients, ...}) FP — generateAuditLogPdf undefined → TS2304 → rule fires
export async function exportAuditLogPdf_06d170cd(locale: string): Promise<Buffer> {
  return generateAuditLogPdf({
    envelope: currentEnvelope,
    recipients: currentEnvelope.recipients,
    fields: currentEnvelope.fields,
    locale,
    pageWidth: PDF_DIMENSIONS.width,
    pageHeight: PDF_DIMENSIONS.height,
  });
}

