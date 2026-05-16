
// declare module with namespace augmentation — standard TypeScript module declaration merging
declare module 'payment-sdk' {
  namespace PaymentProvider {
    interface Plan {
      metadata?: Record<string, string>;
      trialDays?: number;
    }
  }
}
