
// Snippet: Promise.all with async map — standard async parallel processing
declare const orders: Array<{ id: string; amount: number }>;
declare function processOrder(order: { id: string; amount: number }): Promise<{ orderId: string; status: string }>;

export async function processAllOrders() {
  return await Promise.all(
    orders.map(async (order) => {
      const result = await processOrder(order);
      return result;
    }),
  );
}
