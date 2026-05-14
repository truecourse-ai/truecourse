
// FP shape: Promise.all([prisma.X.findMany(), prisma.X.count()]) — standard Prisma paginated query pattern
declare const prisma: {
  document: {
    findMany: (opts: { where: unknown; skip: number; take: number }) => Promise<Array<{ id: string; title: string }>>;
    count: (opts: { where: unknown }) => Promise<number>;
  };
};
declare const whereClause: unknown;
declare const skip: number;
declare const take: number;

async function findDocumentsPaginated() {
  const [documents, total] = await Promise.all([
    prisma.document.findMany({ where: whereClause, skip, take }),
    prisma.document.count({ where: whereClause }),
  ]);

  return { documents, total };
}



// FP shape: prisma.$transaction(async (tx) => { await tx.X.delete({where}) }) — typed Prisma client in transaction
declare const prisma: {
  $transaction: <T>(fn: (tx: {
    workspace: { delete: (opts: { where: { id: string } }) => Promise<void> };
    member: { deleteMany: (opts: { where: { workspaceId: string } }) => Promise<void> };
  }) => Promise<T>) => Promise<T>;
};
declare const workspaceId: string;

async function deleteWorkspaceWithMembers() {
  return prisma.$transaction(async (tx) => {
    await tx.member.deleteMany({ where: { workspaceId } });
    await tx.workspace.delete({ where: { id: workspaceId } });
  });
}



// FP shape: Prisma Decimal .toNumber() — standard conversion from Decimal to number
declare const Decimal: { new(value: number | string): { toNumber: () => number } };
declare const layoutItem: {
  positionX: InstanceType<typeof Decimal>;
  positionY: InstanceType<typeof Decimal>;
  width: InstanceType<typeof Decimal>;
  height: InstanceType<typeof Decimal>;
};

function normalizeLayoutItem() {
  return {
    x: layoutItem.positionX.toNumber(),
    y: layoutItem.positionY.toNumber(),
    w: layoutItem.width.toNumber(),
    h: layoutItem.height.toNumber(),
  };
}



// FP shape: array.map() producing Prisma create data objects — standard transform for bulk insert
declare const uploads: Array<{ fileId: string; fileName: string; mimeType: string; size: number }>;
declare const prisma: {
  attachment: {
    createMany: (opts: { data: Array<{ fileId: string; fileName: string; mimeType: string; fileSize: number }> }) => Promise<{ count: number }>;
  };
};
declare const envelopeId: string;

async function saveAttachmentsToDatabase() {
  return prisma.attachment.createMany({
    data: uploads.map((upload) => ({
      fileId: upload.fileId,
      fileName: upload.fileName,
      mimeType: upload.mimeType,
      fileSize: upload.size,
    })),
  });
}
