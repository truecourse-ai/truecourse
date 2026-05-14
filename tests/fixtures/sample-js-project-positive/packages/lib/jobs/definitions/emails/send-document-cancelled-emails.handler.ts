declare const prisma: { document: { findFirstOrThrow: (args: unknown) => Promise<unknown> } };
declare const mailer: { sendEmail: (opts: { to: string; subject: string; body: string }) => Promise<void> };
declare const logger: { info: (msg: string, ctx?: unknown) => void; error: (msg: string, ctx?: unknown) => void };
declare const renderDocumentCancelledEmail: (opts: { recipientName: string; senderName: string; documentTitle: string }) => string;

import { z } from 'zod';

const SendCancelledEmailsPayloadSchema = z.object({
  documentId: z.string().cuid(),
  cancellationReason: z.string().optional(),
});

export async function sendDocumentCancelledEmailsHandler(
  payload: z.infer<typeof SendCancelledEmailsPayloadSchema>,
): Promise<void> {
  const { documentId, cancellationReason } = SendCancelledEmailsPayloadSchema.parse(payload);

  const document = await prisma.document.findFirstOrThrow({
    where: { id: documentId },
    select: {
      id: true,
      title: true,
      sender: { select: { name: true } },
      recipients: {
        select: { id: true, name: true, email: true, status: true },
      },
    },
  });

  const { title, sender, recipients } = document as {
    title: string;
    sender: { name: string };
    recipients: Array<{ id: string; name: string; email: string; status: string }>;
  };

  const eligibleRecipients = recipients.filter((r) => r.status !== 'declined');

  logger.info('Sending cancellation emails', {
    documentId,
    recipientCount: eligibleRecipients.length,
    reason: cancellationReason,
  });

  await Promise.allSettled(
    eligibleRecipients.map(async (recipient) => {
      try {
        const body = renderDocumentCancelledEmail({
          recipientName: recipient.name,
          senderName: sender.name,
          documentTitle: title,
        });
        await mailer.sendEmail({
          to: recipient.email,
          subject: `Document cancelled: ${title}`,
          body,
        });
      } catch (err) {
        logger.error('Failed to send cancellation email', { recipientId: recipient.id, err });
      }
    }),
  );
}
