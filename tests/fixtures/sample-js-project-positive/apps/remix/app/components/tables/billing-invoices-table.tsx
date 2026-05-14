declare function useQuery(opts: object): { data: { invoices: object[] } | undefined; isLoading: boolean };

export function BillingInvoicesTable({ organisationId }: { organisationId: string }) {
  // Table UI component (non-route) rendered inside authenticated pages.
  // Root.tsx ErrorBoundary covers all unhandled errors in child components.
  const { data } = useQuery({ queryKey: ['invoices', organisationId] });
  const invoices = data?.invoices ?? [];

  return null;
}
