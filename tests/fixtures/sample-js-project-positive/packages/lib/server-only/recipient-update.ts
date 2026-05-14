
// tx.recipient.upsert already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  recipient: {
    upsert(args: { where: unknown; update: unknown; create: unknown }): Promise<{ id: number }>;
  };
  documentAuditLog: { createMany(args: { data: unknown[] }): Promise<{ count: number }> };
};

export async function upsertEnvelopeRecipients(
  envelopeId: string,
  recipients: Array<{ email: string; name: string; role: string; token: string }>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const results = await Promise.all(
      recipients.map((r) =>
        tx.recipient.upsert({
          where: { envelopeId_email: { envelopeId, email: r.email } },
          update: { name: r.name, role: r.role },
          create: { envelopeId, ...r },
        }),
      ),
    );
    await tx.documentAuditLog.createMany({
      data: results.map((r) => ({ envelopeId, type: 'RECIPIENT_UPSERTED', data: { recipientId: r.id } })),
    });
  });
}
