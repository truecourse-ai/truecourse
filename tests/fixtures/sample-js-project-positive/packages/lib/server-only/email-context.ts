
declare const prisma: any;
declare const z: any;

const ZGetEmailContextSchema = z.object({
  recipientId: z.string().uuid(),
  documentId: z.string().uuid(),
});

type GetEmailContextOptions = z.infer<typeof ZGetEmailContextSchema>;

type EmailContext = {
  recipientEmail: string;
  recipientName: string;
  documentTitle: string;
  senderName: string;
  senderEmail: string;
  organisationName: string | null;
  brandLogoUrl: string | null;
  primaryColor: string | null;
};

export const getEmailContext = async (input: GetEmailContextOptions): Promise<EmailContext> => {
  const { recipientId, documentId } = ZGetEmailContextSchema.parse(input);

  const recipient = await prisma.recipient.findFirstOrThrow({
    where: { id: recipientId, documentId },
    include: {
      document: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
          team: {
            include: {
              teamGlobalSettings: true,
            },
          },
        },
      },
    },
  });

  const { document } = recipient;

  const organisationName = document.team?.name ?? null;
  const brandLogoUrl = document.team?.teamGlobalSettings?.brandLogoUrl ?? null;
  const primaryColor = document.team?.teamGlobalSettings?.primaryColor ?? null;

  return {
    recipientEmail: recipient.email,
    recipientName: recipient.name,
    documentTitle: document.title,
    senderName: document.user.name ?? document.user.email,
    senderEmail: document.user.email,
    organisationName,
    brandLogoUrl,
    primaryColor,
  };
};
