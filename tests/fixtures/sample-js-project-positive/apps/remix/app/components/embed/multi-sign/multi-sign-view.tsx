declare function useQuery(opts: object): { data: unknown; isLoading: boolean };

export function MultiSignView({ envelopeId }: { envelopeId: string }) {
  // Non-route component rendered inside a Remix route that exports an ErrorBoundary.
  // Error boundary coverage comes from the parent layout route.
  const { data: envelope } = useQuery({ queryKey: ['envelope', envelopeId] });

  return null;
}
