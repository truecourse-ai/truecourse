
// [unknown-catch-variable] catch(err) — never used; generic toast in billing portal button
declare function redirectToBillingPortal(orgId: string): Promise<void>;
declare const orgId: string;
declare const billingToast: (opts: { title: string; description: string; variant?: string }) => void;

async function handleBillingPortalRedirect(): Promise<void> {
  try {
    await redirectToBillingPortal(orgId);
  } catch (err) {
    billingToast({
      title: 'Billing portal unavailable',
      description: 'We could not open the billing portal. Please try again later.',
      variant: 'destructive',
    });
  }
}
