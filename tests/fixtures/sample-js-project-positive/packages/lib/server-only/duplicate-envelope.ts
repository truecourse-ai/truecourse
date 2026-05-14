
declare const prisma: any;
declare const z: any;

const ZDuplicateEnvelopeSchema = z.object({
  envelopeId: z.string().uuid(),
  userId: z.string().uuid(),
  newTitle: z.string().min(1).max(200).optional(),
});

type DuplicateEnvelopeOptions = z.infer<typeof ZDuplicateEnvelopeSchema>;

export const duplicateEnvelope = async (input: DuplicateEnvelopeOptions) => {
  const { envelopeId, userId, newTitle } = ZDuplicateEnvelopeSchema.parse(input);

  const source = await prisma.envelope.findFirstOrThrow({
    where: { id: envelopeId, userId },
    include: {
      recipients: { include: { fields: true } },
    },
  });

  const duplicate = await prisma.envelope.create({
    data: {
      title: newTitle ?? `Copy of ${source.title}`,
      userId,
      status: 'DRAFT',
      documentData: source.documentData,
      recipients: {
        create: source.recipients.map((r: any) => ({
          name: r.name,
          email: r.email,
          role: r.role,
          fields: {
            create: r.fields.map((f: any) => ({
              type: f.type,
              page: f.page,
              positionX: f.positionX,
              positionY: f.positionY,
              width: f.width,
              height: f.height,
              required: f.required,
            })),
          },
        })),
      },
    },
    include: { recipients: { include: { fields: true } } },
  });

  return duplicate;
};


declare function cloneEnvelopeFields(sourceId: string, targetId: string): Promise<void>;
declare function cloneEnvelopeRecipients(sourceId: string, targetId: string): Promise<void>;
declare function cloneEnvelopeAttachments(sourceId: string, targetId: string): Promise<void>;

export async function duplicateEnvelope(sourceId: string, targetId: string) {
  await Promise.all([
    cloneEnvelopeFields(sourceId, targetId),
    cloneEnvelopeRecipients(sourceId, targetId),
    cloneEnvelopeAttachments(sourceId, targetId),
  ]);
}



declare function copyEnvelopeMetadata(sourceId: string, targetId: string): Promise<void>;
declare function copyEnvelopeSignatories(sourceId: string, targetId: string): Promise<void>;

export async function duplicateEnvelopeShallow(sourceId: string, targetId: string) {
  await Promise.all([
    copyEnvelopeMetadata(sourceId, targetId),
    copyEnvelopeSignatories(sourceId, targetId),
  ]);
}
