
// FP shape: new PaymentSDK(apiKey ?? '', {apiVersion, typescript}) — standard SDK constructor
declare class PaymentSDK {
  constructor(apiKey: string, opts: { apiVersion: string; typescript: boolean }): void;
}
declare const PAYMENT_API_KEY: string | undefined;
const API_VERSION = '2024-01-01';

const paymentClient = new PaymentSDK(PAYMENT_API_KEY ?? '', {
  apiVersion: API_VERSION,
  typescript: true,
});
