
declare module 'payment-provider' {
  namespace Webhooks {
    interface PaymentEvent {
      id: string;
      type: 'payment.succeeded' | 'payment.failed';
      data: { object: { id: string; amount: number; currency: string } };
    }
    function constructEvent(payload: string | Buffer, sig: string, secret: string): PaymentEvent;
  }
  export { Webhooks };
}


// new PaymentProvider(apiKey ?? '', { apiVersion, typescript }) — standard SDK constructor call, no type mismatch
declare class PaymentProvider {
  constructor(apiKey: string, opts: { apiVersion: string; typescript: boolean }): void;
  customers: { create(data: { email: string; name?: string }): Promise<{ id: string }> };
  subscriptions: { create(data: { customer: string; items: { price: string }[] }): Promise<{ id: string }> };
}

declare const PAYMENT_PROVIDER_API_KEY: string | undefined;
const PAYMENT_API_VERSION = '2024-06-20';

export const paymentProvider = new PaymentProvider(PAYMENT_PROVIDER_API_KEY ?? '', {
  apiVersion: PAYMENT_API_VERSION,
  typescript: true,
});

