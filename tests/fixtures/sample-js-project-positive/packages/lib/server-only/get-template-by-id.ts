
declare const prisma: any;
declare const z: any;

const ZGetTemplateByIdSchema = z.object({
  templateId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  organisationId: z.string().uuid().optional(),
});

type GetTemplateByIdOptions = z.infer<typeof ZGetTemplateByIdSchema>;

export const getTemplateById = async (input: GetTemplateByIdOptions) => {
  const { templateId, userId, organisationId } = ZGetTemplateByIdSchema.parse(input);

  const template = await prisma.template.findFirstOrThrow({
    where: {
      id: templateId,
      ...(userId ? { userId } : {}),
      ...(organisationId ? { organisationId } : {}),
    },
    include: {
      user: { select: { name: true, email: true } },
      placeholderRecipients: { orderBy: { signingOrder: 'asc' } },
      fields: { orderBy: [{ page: 'asc' }, { positionY: 'asc' }] },
      directLink: true,
    },
  });

  return template;
};
