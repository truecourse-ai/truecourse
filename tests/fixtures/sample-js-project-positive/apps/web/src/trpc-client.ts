// FP shape: splitLink with condition callback checking context properties — no type mismatch
interface Operation { context: Record<string, unknown>; type: string }
declare function isNonJsonSerializable(op: Operation): boolean;
declare function splitLink(opts: {
  condition: (op: Operation) => boolean;
  true: unknown;
  false: unknown;
}): unknown;
declare const httpBatchLink: unknown;
declare const httpLink: unknown;

const trpcLink = splitLink({
  condition: (op) => op.context['skipBatch'] === true || isNonJsonSerializable(op),
  true: httpLink,
  false: httpBatchLink,
});


// FP shape: tRPC useQuery with typed named args object — no type mismatch
declare const trpc: {
  billing: {
    invoices: {
      list: {
        useQuery: (args: { organisationId: string; page?: number }) => {
          data: { invoices: Array<{ id: string; amount: number }> } | undefined;
          isLoading: boolean;
        };
      };
    };
  };
};

function useBillingInvoices(organisationId: string) {
  const { data, isLoading } = trpc.billing.invoices.list.useQuery({
    organisationId,
    page: 1,
  });
  return { invoices: data?.invoices ?? [], isLoading };
}


// FP shape: splitLink with condition checking skipBatch and non-JSON serializable — no type mismatch
interface TrpcOperation { context: Record<string, unknown>; type: 'query' | 'mutation' | 'subscription' }
declare function isNonJsonSerializableOp(op: TrpcOperation): boolean;
declare function splitLink(opts: {
  condition: (op: TrpcOperation) => boolean;
  true: unknown;
  false: unknown;
}): unknown;
declare const regularHttpLink: unknown;
declare const batchedHttpLink: unknown;

const routingLink = splitLink({
  condition: (op) =>
    op.context['skipBatch'] === true || isNonJsonSerializableOp(op),
  true: regularHttpLink,
  false: batchedHttpLink,
});
