
// cf43399b95a1: io.runTask with async Prisma ORM query inside
declare const io: { runTask<T>(name: string, fn: () => Promise<T>): Promise<T> };
declare const db: { order: { findFirstOrThrow(args: { where: { id: string } }): Promise<{ id: string; status: string }> } };
declare const orderId: string;

async function processOrder() {
  const order = await io.runTask('fetch-order', async () => {
    return db.order.findFirstOrThrow({ where: { id: orderId } });
  });
  return order;
}
