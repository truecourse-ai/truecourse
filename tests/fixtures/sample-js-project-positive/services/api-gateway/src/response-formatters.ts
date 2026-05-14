
// Data transformation - extracting nested properties from joined results
declare const fetchedOrders: Array<{
  orderId: string;
  status: string;
  lineItems: Array<{
    id: string;
    quantity: number;
    product: {
      id: string;
      name: string;
      sku: string;
    };
  }>;
  customerDetails: Array<{
    id: string;
    customer: {
      id: string;
      email: string;
      displayName: string;
      avatarUrl: string | null;
    };
  }>;
}>;

const normalizedOrders = fetchedOrders.map((order) => ({
  ...order,
  products: order.lineItems.map((lineItem) => ({
    id: lineItem.product.id,
    name: lineItem.product.name,
    sku: lineItem.product.sku,
    lineItemId: lineItem.id,
    quantity: lineItem.quantity,
  })),
  customers: order.customerDetails.map(({ customer }) => ({
    id: customer.id,
    userId: customer.id,
    name: customer.displayName || '',
    email: customer.email,
    avatarUrl: customer.avatarUrl,
  })),
}));
