// Paraphrased FP for bugs/deterministic/missing-error-boundary.
//
// Member-expression query calls like `trpc.x.y.useQuery(...)` go through
// abstractions (tRPC, generated SDKs) where TanStack Query is configured
// to surface errors via the returned `error`/`isError` state rather than
// throw during render. An ErrorBoundary further up the tree is not
// required to keep the UI from crashing. The fix narrows the trigger to
// bare `useQuery(...)` / `useSWR(...)` calls and the Suspense variants.

interface InviteRow {
  readonly id: number;
  readonly email: string;
}

interface TrpcInviteApi {
  readonly find: {
    useQuery(input: { organisationId: number }): {
      data: ReadonlyArray<InviteRow> | undefined;
      isLoading: boolean;
      isLoadingError: boolean;
    };
  };
}

declare const inviteApi: TrpcInviteApi;

export function InvitesPanel({ organisationId }: { organisationId: number }): JSX.Element {
  const { data, isLoading, isLoadingError } = inviteApi.find.useQuery({ organisationId });
  if (isLoadingError) return <span>error</span>;
  if (isLoading) return <span>loading</span>;
  return <ul>{data?.map((row) => <li key={row.id}>{row.email}</li>)}</ul>;
}
