// guarded-or-preinitialized-object-access: bracket access guarded by if(result) before use
type BillingCycle = 'monthlyRate' | 'annualRate';

type PricingTier = {
  monthlyRate?: { amount: number; isActive: boolean };
  annualRate?: { amount: number; isActive: boolean };
  seats: number;
  id: string;
};

declare const pricingCatalog: Record<string, PricingTier>;

function getActivePrices(cycle: BillingCycle) {
  const prices = [];

  for (const tier of Object.values(pricingCatalog)) {
    if (tier[cycle] && tier[cycle].isActive) {
      prices.push({
        ...tier[cycle],
        seats: tier.seats,
        tierId: tier.id,
      });
    }
  }

  return prices;
}
