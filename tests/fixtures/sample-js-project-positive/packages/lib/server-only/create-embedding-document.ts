
declare const prisma: any;
declare const z: any;
declare const generateEmbedding: (text: string) => Promise<number[]>;

const ZCreateEmbeddingDocumentSchema = z.object({
  documentId: z.string().uuid(),
  content: z.string().min(1),
  chunkIndex: z.number().int().min(0).optional().default(0),
});

type CreateEmbeddingDocumentOptions = z.infer<typeof ZCreateEmbeddingDocumentSchema>;

export const createEmbeddingDocument = async (input: CreateEmbeddingDocumentOptions) => {
  const { documentId, content, chunkIndex } = ZCreateEmbeddingDocumentSchema.parse(input);

  const embedding = await generateEmbedding(content);

  const record = await prisma.documentEmbedding.upsert({
    where: { documentId_chunkIndex: { documentId, chunkIndex } },
    create: {
      documentId,
      chunkIndex,
      content,
      embedding,
    },
    update: {
      content,
      embedding,
      updatedAt: new Date(),
    },
  });

  return record;
};
