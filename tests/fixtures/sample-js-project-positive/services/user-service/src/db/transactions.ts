/**
 * missing-transaction rule edge cases:
 *   1. Bare camelCase receivers (`loadedPdf.destroy()`) are non-DB cleanup,
 *      not ORM writes — must not be counted.
 *   2. Calls under a transaction client (`tx.<table>.<method>()`) are
 *      already inside a transaction and must not trigger the rule.
 */

interface PdfDocument {
  destroy: () => Promise<void>;
}

interface FieldClient {
  create: (data: { name: string }) => Promise<{ id: string }>;
}
interface UserClient {
  update: (args: { where: { id: string }; data: { lastSeen: Date } }) => Promise<void>;
}
interface TxClient {
  field: FieldClient;
  user: UserClient;
}

interface PrismaLike {
  $transaction: <T>(fn: (tx: TxClient) => Promise<T>) => Promise<T>;
}

declare const prisma: PrismaLike;

// Case 1: two `destroy()` calls on PDF documents — not ORM writes.
export async function reloadPdf(loadedPdf: PdfDocument, previous: PdfDocument | null): Promise<void> {
  await loadedPdf.destroy();
  if (previous) {
    await previous.destroy();
  }
}

// Case 2: writes are inside a `$transaction` callback — already atomic.
export async function syncUserField(userId: string, fieldName: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.field.create({ name: fieldName });
    await tx.user.update({ where: { id: userId }, data: { lastSeen: new Date() } });
  });
}
