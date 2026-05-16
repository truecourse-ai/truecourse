declare function useQuery(opts: object): { data: unknown; isLoading: boolean };

export function AdminDomainDetailPage({ domainId }: { domainId: string }) {
  // Remix route module — errors bubble up to root.tsx ErrorBoundary.
  // No route-specific boundary required unless fine-grained recovery UX is needed.
  const { data: domain } = useQuery({ queryKey: ['domain', domainId] });

  return null;
}
