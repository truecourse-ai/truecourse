
// Single write in function (prisma.recipient.updateMany); subsequent operations are reads only
declare const prisma: {
  recipient: {
    updateMany(args: { where: unknown; data: unknown }): Promise<{ count: number }>;
    findFirst(args: { where: unknown; select: unknown }): Promise<{ id: number; envelopeId: string } | null>;
  };
  envelope: { findFirst(args: { where: unknown }): Promise<{ id: string; title: string } | null> };
};

export async function claimAndProcessReminder(recipientId: number): Promise<void> {
  const now = new Date();

  const updatedCount = await prisma.recipient.updateMany({
    where: { id: recipientId, signingStatus: 'NOT_SIGNED', nextReminderAt: { lte: now } },
    data: { lastReminderSentAt: now, nextReminderAt: null },
  });

  if (updatedCount.count === 0) {
    return;
  }

  const recipient = await prisma.recipient.findFirst({
    where: { id: recipientId },
    select: { id: true, envelopeId: true },
  });

  if (!recipient) return;

  const envelope = await prisma.envelope.findFirst({
    where: { id: recipient.envelopeId },
  });

  if (!envelope) return;
  // send reminder email...
}
