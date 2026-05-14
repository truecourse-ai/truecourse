// Thin server-only adapters for managing recipient reminder scheduling.
// Line count is inflated by type stubs and Zod schema boilerplate.

declare const db: {
  envelope: {
    findFirst(args: {
      where: { id: string };
      select: Record<string, unknown>;
    }): Promise<{
      documentMeta?: {
        reminderSettings?: unknown;
        deliveryMethod?: string;
      } | null;
    } | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  recipient: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<Array<{ id: number; sentAt: Date | null; lastReminderSentAt: Date | null }>>;
    update(args: { where: { id: number }; data: Record<string, unknown> }): Promise<unknown>;
  };
};

declare const ZReminderConfig: {
  parse(raw: unknown): { intervalDays: number; maxCount: number };
  safeParse(raw: unknown): { success: boolean; data?: { intervalDays: number; maxCount: number } };
};

declare function resolveNextReminderDate(opts: {
  config: { intervalDays: number; maxCount: number } | null;
  sentAt: Date;
  lastReminderSentAt: Date | null;
}): Date | null;

declare const DeliveryMethod: { NONE: string; EMAIL: string; SMS: string };
declare const RecipientStatus: { PENDING: string; SENT: string; COMPLETED: string };
declare const SigningState: { UNSIGNED: string; SIGNED: string; DECLINED: string };

/**
 * Compute and persist the next reminder date for a single recipient.
 * Accepts pre-resolved reminder config to avoid a redundant database query
 * when called from a batch context.
 */
export const scheduleRecipientReminder = async (options: {
  recipientId: number;
  envelopeId: string;
  sentAt: Date;
  lastReminderSentAt: Date | null;
  reminderConfig?: ReturnType<typeof ZReminderConfig.parse> | null;
}) => {
  const { recipientId, envelopeId, sentAt, lastReminderSentAt } = options;

  let config = options.reminderConfig;

  if (config === undefined) {
    const envelope = await db.envelope.findFirst({
      where: { id: envelopeId },
      select: { documentMeta: { select: { reminderSettings: true } } },
    });

    config = envelope?.documentMeta?.reminderSettings
      ? ZReminderConfig.parse(envelope.documentMeta.reminderSettings)
      : null;
  }

  const nextReminderAt = resolveNextReminderDate({
    config,
    sentAt,
    lastReminderSentAt,
  });

  await db.recipient.update({
    where: { id: recipientId },
    data: { nextReminderAt },
  });
};

/**
 * Recompute the next reminder date for all active, unsigned recipients
 * of a given envelope. Called when envelope-level reminder settings change.
 */
export const recomputeEnvelopeRecipientReminders = async (envelopeId: string) => {
  const envelope = await db.envelope.findFirst({
    where: { id: envelopeId },
    select: {
      documentMeta: {
        select: { reminderSettings: true, deliveryMethod: true },
      },
    },
  });

  const isEmailDelivery =
    envelope?.documentMeta?.deliveryMethod !== DeliveryMethod.NONE;

  const config =
    isEmailDelivery && envelope?.documentMeta?.reminderSettings
      ? ZReminderConfig.parse(envelope.documentMeta.reminderSettings)
      : null;

  const now = new Date();

  const recipients = await db.recipient.findMany({
    where: {
      envelopeId,
      signingState: SigningState.UNSIGNED,
      sendStatus: RecipientStatus.SENT,
      sentAt: { not: null },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true, sentAt: true, lastReminderSentAt: true },
  });

  await Promise.all(
    recipients.map(async (recipient) => {
      if (!recipient.sentAt) {
        return;
      }

      const nextReminderAt = resolveNextReminderDate({
        config,
        sentAt: recipient.sentAt,
        lastReminderSentAt: recipient.lastReminderSentAt,
      });

      await db.recipient.update({
        where: { id: recipient.id },
        data: { nextReminderAt },
      });
    }),
  );
};
