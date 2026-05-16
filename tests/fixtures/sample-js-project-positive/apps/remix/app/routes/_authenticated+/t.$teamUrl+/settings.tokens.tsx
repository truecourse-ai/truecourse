declare function useQuery(opts: object): { data: object[] | undefined; isLoading: boolean };

export function TeamApiTokensPage({ teamId }: { teamId: string }) {
  // Remix route module covered by root.tsx global ErrorBoundary.
  // No local ErrorBoundary needed — Remix error cascade model handles this.
  const { data: tokens } = useQuery({ queryKey: ['api-tokens', teamId] });

  return null;
}
