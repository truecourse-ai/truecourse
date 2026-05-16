declare function useQuery(opts: object): { data: { invoices: object[] } | undefined; isLoading: boolean };

export function BillingInvoicesTable({ organisationId }: { organisationId: string }) {
  // Table UI component (non-route) rendered inside authenticated pages.
  // Root.tsx ErrorBoundary covers all unhandled errors in child components.
  const { data } = useQuery({ queryKey: ['invoices', organisationId] });
  const invoices = data?.invoices ?? [];

  return null;
}


// Non-route table component: covered by root-level ErrorBoundary; no per-component boundary needed.
declare function useTrpcQuery<T>(key: string[], opts?: { enabled?: boolean }): { data: T | undefined; isLoading: boolean };

type InvoiceEntry = { id: string; amount: number; status: string; date: string };

export function PlanInvoicesTable({ planId }: { planId: string }) {
  const { data, isLoading } = useTrpcQuery<{ items: InvoiceEntry[] }>(
    ['billing', 'plan-invoices', planId],
    { enabled: Boolean(planId) },
  );

  const items = data?.items ?? [];

  if (isLoading) return null;

  return (
    <table>
      <tbody>
        {items.map((inv) => (
          <tr key={inv.id}>
            <td>{inv.date}</td>
            <td>{inv.amount}</td>
            <td>{inv.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

