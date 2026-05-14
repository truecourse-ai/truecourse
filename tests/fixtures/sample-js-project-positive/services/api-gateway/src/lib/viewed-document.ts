
declare const AUDIT_LOG_TYPE24: { DOCUMENT_VIEWED: string };
declare const createAuditLog24: (opts: unknown) => unknown;
declare const prisma24: {
  recipient: { findFirst: (opts: unknown) => Promise<{ id: number; email: string; name: string; envelopeId: string; readStatus: string; role: string } | null>; update: (opts: unknown) => Promise<void> };
  documentAuditLog: { create: (opts: unknown) => Promise<void> };
  $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
};
declare const triggerWebhook24: (opts: unknown) => Promise<void>;
declare const mapToWebhookPayload24: (envelope: unknown) => unknown;
declare const ZWebhookSchema24: { parse: (data: unknown) => unknown };
declare const ReadStatus24: { OPENED: string };
declare const SendStatus24: { SENT: string };
declare const WebhookEvents24: { DOCUMENT_VIEWED: string };
declare const EnvelopeType24: { DOCUMENT: string };
declare const RequestMetadata24: unknown;

type ViewedTemplateOptions = {
  token: string;
  recipientAccessAuth?: string[];
  requestMetadata?: typeof RequestMetadata24;
};

export const viewedTemplate = async ({ token, recipientAccessAuth, requestMetadata }: ViewedTemplateOptions) => {
  const recipient = await prisma24.recipient.findFirst({
    where: {
      token,
      envelope: { type: EnvelopeType24.DOCUMENT } as unknown,
    } as unknown,
  });

  if (!recipient) {
    return;
  }

  await prisma24.documentAuditLog.create({
    data: createAuditLog24({
      type: AUDIT_LOG_TYPE24.DOCUMENT_VIEWED,
      envelopeId: recipient.envelopeId,
      user: { name: recipient.name, email: recipient.email },
      requestMetadata,
      data: {
        recipientEmail: recipient.email,
        recipientId: recipient.id,
        recipientName: recipient.name,
        recipientRole: recipient.role,
        accessAuth: recipientAccessAuth ?? [],
      },
    }),
  });

  if (recipient.readStatus === ReadStatus24.OPENED) {
    return;
  }

  await prisma24.$transaction(async (tx) => {
    await (tx as typeof prisma24).recipient.update({
      where: { id: recipient.id } as unknown,
      data: {
        readStatus: ReadStatus24.OPENED,
        sendStatus: SendStatus24.SENT,
        readAt: new Date(),
      } as unknown,
    });
  });

  await triggerWebhook24({
    event: WebhookEvents24.DOCUMENT_VIEWED,
    data: ZWebhookSchema24.parse(mapToWebhookPayload24({})),
  });
};
