
// No outer orderId — only introduced by destructuring the createOrder result inside onSubmit
declare function createOrder(data: { items: string[] }): Promise<{ orderId: string }>;
declare function navigateTo(path: string): Promise<void>;

export async function submitOrderForm(items: string[]): Promise<void> {
  try {
    const { orderId } = await createOrder({ items });
    await navigateTo(`/orders/${orderId}`);
  } catch (err) {
    console.error(err);
  }
}
