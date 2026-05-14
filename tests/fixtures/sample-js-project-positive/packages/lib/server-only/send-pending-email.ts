
declare const prisma: any;
declare const z: any;
declare const sendEmail: (opts: any) => Promise<void>;
declare const renderPendingSignatureEmail: (opts: any) => string;

const ZSendPendingEmailSchema = z.object({
  envelopeId: z.string().uuid(),
  recipientId: z.string().uuid(),
});

type SendPendingEmailOptions = z.infer<typeof ZSendPendingEmailSchema>;

export const sendPendingEmail = async (input: SendPendingEmailOptions) => {
  const { envelopeId, recipientId } = ZSendPendingEmailSchema.parse(input);

  const recipient = await prisma.recipient.findFirstOrThrow({
    where: { id: recipientId, envelopeId },
    include: {
      envelope: {
        include: {
          user: { select: { name: true, email: true } },
        },
      },
    },
  });

  const { envelope } = recipient;

  const html = renderPendingSignatureEmail({
    recipientName: recipient.name,
    senderName: envelope.user.name ?? envelope.user.email,
    documentTitle: envelope.title,
    signingUrl: `${process.env.NEXT_PUBLIC_APP_URL}/sign/${recipient.token}`,
  });

  await sendEmail({
    to: recipient.email,
    subject: `You have been asked to sign: ${envelope.title}`,
    html,
  });

  await prisma.recipient.update({
    where: { id: recipientId },
    data: { lastEmailSentAt: new Date() },
  });
};
