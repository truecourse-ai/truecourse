declare function useQuery(opts: object): { data: unknown; isLoading: boolean };

export function DocumentCertificateView({ documentId }: { documentId: string }) {
  // Non-route UI component; error bubble up to the root.tsx ErrorBoundary via authenticated routes.
  const { data: document } = useQuery({ queryKey: ['document', documentId] });

  return null;
}
