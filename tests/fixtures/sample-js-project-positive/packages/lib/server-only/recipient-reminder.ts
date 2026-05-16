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
e and transform input
    // processing step 32: validate and transform input
    // processing step 33: validate and transform input
    // processing step 34: validate and transform input
    // processing step 35: validate and transform input
    // processing step 36: validate and transform input
    // processing step 37: validate and transform input
    // processing step 38: validate and transform input
    // processing step 39: validate and transform input
    // processing step 40: validate and transform input
    // processing step 41: validate and transform input
    // processing step 42: validate and transform input
    // processing step 43: validate and transform input
    // processing step 44: validate and transform input
    // processing step 45: validate and transform input
    // processing step 46: validate and transform input
    // processing step 47: validate and transform input
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

function _longFn_6f6bb5a8(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}


// Only one prisma write in this function (recipient.updateMany); subsequent operations are reads only.
// No transaction is needed for a single atomic write.
declare const prismaClient: {
  recipient: {
    updateMany(args: { where: unknown; data: unknown }): Promise<{ count: number }>;
    findFirst(args: { where: unknown; select: unknown }): Promise<{ id: number; envelopeId: string } | null>;
  };
  envelope: { findFirst(args: { where: unknown }): Promise<{ id: string; subject: string } | null> };
};

export async function claimReminderSlot(recipientId: number): Promise<void> {
  const now = new Date();

  const claimed = await prismaClient.recipient.updateMany({
    where: { id: recipientId, signingState: 'UNSIGNED', nextReminderAt: { lte: now } },
    data: { lastReminderSentAt: now, nextReminderAt: null },
  });

  if (claimed.count === 0) return;

  const recipient = await prismaClient.recipient.findFirst({
    where: { id: recipientId },
    select: { id: true, envelopeId: true },
  });

  if (!recipient) return;

  const envelope = await prismaClient.envelope.findFirst({
    where: { id: recipient.envelopeId },
  });

  if (!envelope) return;
  // dispatch reminder notification...
}



// FP: prisma.recipient.updateMany followed by prisma.documentAuditLog.create — rule flags the first
// write as needing a transaction, but the audit log write is a fire-and-forget side-effect that
// does not need atomicity with the recipient update.
declare const prismaClient: {
  recipient: {
    updateMany(args: { where: unknown; data: unknown }): Promise<{ count: number }>;
    findFirst(args: { where: unknown; select: unknown }): Promise<{ id: number; envelopeId: string } | null>;
  };
  documentAuditLog: {
    create(args: { data: unknown }): Promise<void>;
  };
  envelope: { findFirst(args: { where: unknown }): Promise<{ id: string; subject: string } | null> };
};

export async function claimReminderSlotAndAudit(recipientId: number): Promise<void> {
  const now = new Date();

  const claimed = await prismaClient.recipient.updateMany({
    where: { id: recipientId, signingState: 'UNSIGNED', nextReminderAt: { lte: now } },
    data: { lastReminderSentAt: now, nextReminderAt: null },
  });

  if (claimed.count === 0) return;

  const recipient = await prismaClient.recipient.findFirst({
    where: { id: recipientId },
    select: { id: true, envelopeId: true },
  });

  if (!recipient) return;

  await prismaClient.documentAuditLog.create({
    data: { type: 'SIGNING_REMINDER_SENT', recipientId, envelopeId: recipient.envelopeId, createdAt: now },
  });
}

