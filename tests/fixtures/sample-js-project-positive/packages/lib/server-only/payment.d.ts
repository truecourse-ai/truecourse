
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
