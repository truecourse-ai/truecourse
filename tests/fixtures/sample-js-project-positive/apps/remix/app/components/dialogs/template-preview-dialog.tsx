declare function useQuery(opts: object): { data: unknown; isLoading: boolean };

export function TemplatePreviewDialog({ templateId, open, onOpenChange }: { templateId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  // Dialog component (non-route) — boundary responsibility belongs at the route level.
  // root.tsx ErrorBoundary covers all unhandled errors in child components.
  const { data: template } = useQuery({ queryKey: ['template', templateId] });

  return null;
}
