declare function useQuery(opts: object): { data: { attachments: object[] } | undefined; isLoading: boolean };

export function DocumentSigningAttachmentsPanel({ documentId }: { documentId: string }) {
  // Popover UI component (non-route) — error boundary coverage comes from the
  // parent layout route that exports an ErrorBoundary. No per-component boundary needed.
  const { data } = useQuery({ queryKey: ['attachments', documentId] });
  const attachments = data?.attachments ?? [];

  return null;
}
