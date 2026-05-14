// archive-document.ts — thin server adapter: validates input, calls service
// Line count inflated by type imports and schema boilerplate.

declare const z: {
  object: (shape: Record<string, unknown>) => ZodObjB;
  string: () => ZodStrB;
  number: () => ZodNumB;
  boolean: () => ZodBoolB;
  optional: (s: unknown) => ZodOptB;
};
declare class ZodObjB { parse(v: unknown): unknown; }
declare class ZodStrB { parse(v: unknown): string; }
declare class ZodNumB { parse(v: unknown): number; }
declare class ZodBoolB { parse(v: unknown): boolean; }
declare class ZodOptB { parse(v: unknown): unknown; }

declare const prisma: {
  document: {
    findFirst: (opts: { where: Record<string, unknown> }) => Promise<DocumentRecord | null>;
    update: (opts: { where: { id: number }; data: Partial<DocumentRecord> }) => Promise<DocumentRecord>;
  };
  auditLog: {
    create: (opts: { data: Record<string, unknown> }) => Promise<void>;
  };
};

type DocumentRecord = {
  id: number;
  title: string;
  status: string;
  ownerId: number;
  archivedAt?: Date;
};

type ArchiveDocumentInput = {
  documentId: number;
  userId: number;
  reason?: string;
  hardDelete?: boolean;
};

type ArchiveDocumentOutput = {
  document: DocumentRecord;
  archivedAt: Date;
};

const ZArchiveDocumentInputSchema = z.object({
  documentId: z.number(),
  userId: z.number(),
  reason: z.optional(z.string()),
  hardDelete: z.optional(z.boolean()),
});

export async function archiveDocument(rawInput: unknown): Promise<ArchiveDocumentOutput> {
  const { documentId, userId, reason, hardDelete } =
    ZArchiveDocumentInputSchema.parse(rawInput) as ArchiveDocumentInput;

  const document = await prisma.document.findFirst({
    where: { id: documentId, ownerId: userId },
  });

  if (!document) {
    throw new Error(`Document ${documentId} not found or access denied.`);
  }

  if (document.status === 'COMPLETED' && !hardDelete) {
    throw new Error('Completed documents cannot be archived without explicit confirmation.');
  }

  const archivedAt = new Date();

  const updated = await prisma.document.update({
    where: { id: documentId },
    data: { status: 'ARCHIVED', archivedAt },
  });

  await prisma.auditLog.create({
    data: {
      action: 'document.archived',
      resourceId: String(documentId),
      userId,
      metadata: { reason, hardDelete },
    },
  });

  return { document: updated, archivedAt };
}
