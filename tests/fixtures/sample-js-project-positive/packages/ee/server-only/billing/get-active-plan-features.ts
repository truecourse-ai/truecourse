// Single function checks Stripe metadata boolean string — standalone usage
declare const stripe: {
  products: {
    list(opts: { active: boolean }): Promise<{ data: Array<{ metadata: Record<string, string> }> }>;
  };
};

async function getActivePlanFeatures(): Promise<string[]> {
  const products = await stripe.products.list({ active: true });
  return products.data
    .filter((p) => p.metadata['visibleInApp'] === 'true')
    .flatMap((p) => (p.metadata['features'] ?? '').split(','))
    .filter(Boolean);
}
