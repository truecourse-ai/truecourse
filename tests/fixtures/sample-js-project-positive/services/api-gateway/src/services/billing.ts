/// <reference types="./billing-augment.d.ts" />
declare class PaymentGateway {
  constructor(apiKey: string, options: { apiVersion: string; typescript: boolean });
  charge(amount: number, currency: string): Promise<{ id: string }>;
}
declare function readEnv(key: string): string | undefined;

export const billing = new PaymentGateway(readEnv('BILLING_API_KEY') ?? '', {
  apiVersion: '2024-01-15',
  typescript: true,
});

export { PaymentGateway };
