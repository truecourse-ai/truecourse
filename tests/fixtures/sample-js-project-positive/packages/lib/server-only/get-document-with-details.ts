
declare const prisma: any;
declare const z: any;

const ZGetDocumentWithDetailsByIdSchema = z.object({
  documentId: z.string().uuid(),
  userId: z.string().uuid().optional(),
});

type GetDocumentWithDetailsByIdOptions = z.infer<typeof ZGetDocumentWithDetailsByIdSchema>;

export const getDocumentWithDetailsById = async (input: GetDocumentWithDetailsByIdOptions) => {
  const { documentId, userId } = ZGetDocumentWithDetailsByIdSchema.parse(input);

  const document = await prisma.document.findFirstOrThrow({
    where: {
      id: documentId,
      ...(userId ? { userId } : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      recipients: {
        include: {
          fields: {
            orderBy: [{ page: 'asc' }, { positionY: 'asc' }],
          },
        },
        orderBy: { signingOrder: 'asc' },
      },
      documentData: true,
      team: { select: { id: true, name: true, url: true } },
    },
  });

  return document;
};
