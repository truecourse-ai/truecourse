
declare const prisma: any;
declare const z: any;

const ZGetTemplateByDirectLinkTokenSchema = z.object({
  token: z.string().min(1),
});

type GetTemplateByDirectLinkTokenOptions = z.infer<typeof ZGetTemplateByDirectLinkTokenSchema>;

export const getTemplateByDirectLinkToken = async (input: GetTemplateByDirectLinkTokenOptions) => {
  const { token } = ZGetTemplateByDirectLinkTokenSchema.parse(input);

  const directLink = await prisma.templateDirectLink.findFirstOrThrow({
    where: { token, enabled: true },
    include: {
      template: {
        include: {
          user: { select: { name: true, email: true } },
          placeholderRecipients: true,
          fields: true,
        },
      },
    },
  });

  return directLink.template;
};
