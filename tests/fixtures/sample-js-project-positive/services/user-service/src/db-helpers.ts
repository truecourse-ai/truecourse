
// --- argument-type-mismatch shape: prisma.$transaction with async callback ---
// prisma.$transaction(async (tx) => tx.record.update({...})) — valid Prisma transaction, no type mismatch.
interface PrismaClient {
  $transaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T>;
  record: { update: (args: { where: { id: number }; data: object }) => Promise<{ id: number; value: string }> };
}
declare const prisma: PrismaClient;
async function updateRecordInTransaction(id: number, data: object): Promise<{ id: number; value: string }> {
  return await prisma.$transaction(async (tx) => {
    return await tx.record.update({
      where: { id },
      data,
    });
  });
}



// --- argument-type-mismatch shape: prisma.create inside pMap async callback ---
// pMap(items, async (item) => prisma.record.create({data: {...}})) — valid Prisma create call.
declare function pMap<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]>;
interface RecipientData { email: string; name: string; role: string; signingOrder?: number }
interface PrismaRecipientClient {
  create: (args: { data: object }) => Promise<{ id: number }>
}
declare const prismaRecipient: PrismaRecipientClient;
declare function nanoid(): string;
async function duplicateRecipients(recipients: RecipientData[], envelopeId: string): Promise<Array<{ id: number }>> {
  return pMap(recipients, async (recipient) =>
    prismaRecipient.create({
      data: {
        envelopeId,
        email: recipient.email,
        name: recipient.name,
        role: recipient.role,
        signingOrder: recipient.signingOrder,
        token: nanoid(),
      },
    }),
  );
}



// --- argument-type-mismatch shape: ternary with Promise.resolve fallback in Promise.all ---
// inboxQuery ? cappedCount(inboxQuery) : Promise.resolve(0) — both branches are Promise<number>.
declare function cappedCount(query: unknown): Promise<number>;
declare const inboxQuery: unknown | null;
declare const draftQuery: unknown;
declare const pendingQuery: unknown;
async function getDocumentStats(): Promise<Record<string, number>> {
  const [draft, pending, inbox] = await Promise.all([
    cappedCount(draftQuery),
    cappedCount(pendingQuery),
    inboxQuery ? cappedCount(inboxQuery) : Promise.resolve(0),
  ]);
  return { draft, pending, inbox };
}
