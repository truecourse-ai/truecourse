
declare const prisma: {
  emailDomain: {
    findMany: (opts: unknown) => Promise<Array<{ id: string; domain: string; createdAt: Date; lastCheckedAt: Date | null }>>;
  };
};
declare const verifyDomainRecord: (id: string) => Promise<{ isActive: boolean }>;
declare const reactivateDomainRecord: (id: string) => Promise<void>;
declare const DateTime2: { now: () => { minus: (opts: { hours: number }) => { toJSDate: () => Date } } };

const SYNC_BATCH_SIZE = 10;
const AUTO_REACTIVATE_AFTER_HOURS = 48;

type JobRunContext = {
  logger: { info: (msg: string) => void; error: (msg: string) => void };
  runTask: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
};

type SyncDomainRecordsPayload = {
  since?: Date;
};

export const runSyncDomainRecords = async ({
  payload,
  ctx,
}: {
  payload: SyncDomainRecordsPayload;
  ctx: JobRunContext;
}) => {
  const pendingDomains = await prisma.emailDomain.findMany({
    where: {
      status: 'PENDING',
    } as unknown,
    select: {
      id: true,
      domain: true,
      createdAt: true,
      lastCheckedAt: true,
    } as unknown,
    orderBy: {
      lastCheckedAt: { sort: 'asc', nulls: 'first' },
    } as unknown,
  });

  if (pendingDomains.length === 0) {
    ctx.logger.info('No pending domain records to sync');
    return;
  }

  ctx.logger.info(`Found ${pendingDomains.length} pending domain records`);

  let activatedCount = 0;
  let reactivatedCount = 0;
  let failCount = 0;

  const reactivateCutoff = DateTime2.now().minus({ hours: AUTO_REACTIVATE_AFTER_HOURS }).toJSDate();

  for (let i = 0; i < pendingDomains.length; i += SYNC_BATCH_SIZE) {
    const batch = pendingDomains.slice(i, i + SYNC_BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (domain) => {
        const shouldReactivate = domain.createdAt < reactivateCutoff;

        const { isActive } = await verifyDomainRecord(domain.id);

        if (isActive) {
          ctx.logger.info(`Domain "${domain.domain}" is now active`);
          activatedCount++;
          return 'activated' as const;
        }

        if (shouldReactivate) {
          ctx.logger.info(`Domain "${domain.domain}" pending too long, re-activating`);
          await reactivateDomainRecord(domain.id);
          reactivatedCount++;
          return 'reactivated' as const;
        }

        failCount++;
        return 'pending' as const;
      }),
    );

    const errors = results.filter((r) => r.status === 'rejected');
    for (const error of errors) {
      if (error.status === 'rejected') {
        ctx.logger.error(`Batch error: ${error.reason}`);
      }
    }
  }

  ctx.logger.info(
    `Sync complete: ${activatedCount} activated, ${reactivatedCount} reactivated, ${failCount} still pending`,
  );
};



declare const prisma15: {
  recipient: {
    updateMany: (opts: unknown) => Promise<{ count: number }>;
    findUniqueOrThrow: (opts: unknown) => Promise<{
      id: number;
      email: string;
      name: string;
      envelopeId: string;
      expirationNotifiedAt: Date | null;
      envelope: { id: string; userId: number; teamId: number; recipients: unknown[]; documentMeta: unknown };
    }>;
  };
  documentAuditLog: {
    create: (opts: unknown) => Promise<void>;
  };
};
declare const triggerWebhook15: (opts: { event: string; data: unknown; userId: number; teamId: number }) => Promise<void>;
declare const jobs15: { triggerJob: (opts: { name: string; payload: unknown }) => Promise<void> };
declare const createAuditLogData15: (opts: unknown) => unknown;
declare const AUDIT_LOG_TYPE15: { RECIPIENT_SUBSCRIPTION_EXPIRED: string };
declare const mapToWebhookPayload15: (envelope: unknown) => unknown;
declare const ZWebhookSchema15: { parse: (data: unknown) => unknown };
declare const WebhookEvents15: { RECIPIENT_SUBSCRIPTION_EXPIRED: string };
declare const SigningStatus15: { SIGNED: string; REJECTED: string };

type RecipientSubscriptionExpiredPayload = { recipientId: number };
type JobRunIO15 = {
  logger: { info: (msg: string) => void };
  runTask: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
};

export const runProcessRecipientSubscriptionExpired = async ({
  payload,
  io,
}: {
  payload: RecipientSubscriptionExpiredPayload;
  io: JobRunIO15;
}) => {
  const { recipientId } = payload;

  const claimedCount = await io.runTask('claim-recipient', async () => {
    const result = await prisma15.recipient.updateMany({
      where: {
        id: recipientId,
        expirationNotifiedAt: null,
        signingStatus: { notIn: [SigningStatus15.SIGNED, SigningStatus15.REJECTED] } as unknown,
      } as unknown,
      data: { expirationNotifiedAt: new Date() } as unknown,
    });
    return result.count;
  });

  if (claimedCount === 0) {
    io.logger.info(`Recipient ${recipientId} already processed or ineligible, skipping`);
    return;
  }

  const recipient = await prisma15.recipient.findUniqueOrThrow({
    where: { id: recipientId },
    include: {
      envelope: { include: { recipients: true, documentMeta: true } },
    } as unknown,
  });

  const { envelope } = recipient;

  io.logger.info(`Recipient ${recipientId} (${recipient.email}) subscription expired on envelope ${recipient.envelopeId}`);

  await io.runTask('create-audit-log', async () => {
    await prisma15.documentAuditLog.create({
      data: createAuditLogData15({
        type: AUDIT_LOG_TYPE15.RECIPIENT_SUBSCRIPTION_EXPIRED,
        envelopeId: recipient.envelopeId,
        data: {
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          recipientId: recipient.id,
        },
      }),
    });
  });

  await triggerWebhook15({
    event: WebhookEvents15.RECIPIENT_SUBSCRIPTION_EXPIRED,
    data: ZWebhookSchema15.parse(mapToWebhookPayload15(envelope)),
    userId: (envelope as { userId: number }).userId,
    teamId: (envelope as { teamId: number }).teamId,
  });

  await jobs15.triggerJob({
    name: 'send.owner.recipient.subscription-expired.email',
    payload: {
      recipientId: recipient.id,
      envelopeId: recipient.envelopeId,
    },
  });
};
