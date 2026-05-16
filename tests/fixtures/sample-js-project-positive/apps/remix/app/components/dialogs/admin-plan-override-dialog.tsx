declare function useQuery(opts: object): { data: unknown; isLoading: boolean };
declare function useMutation(opts: object): { mutateAsync: (data: object) => Promise<void> };
declare function useToast(): { toast: (opts: object) => void };

export function AdminPlanOverrideDialog({ userId, open, onOpenChange }: { userId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const { data: currentPlan } = useQuery({ queryKey: ['plan', userId] });
  const overrideMutation = useMutation({ mutationFn: async (d: object) => d });

  const handleOverride = async (planId: string) => {
    try {
      await overrideMutation.mutateAsync({ userId, planId });
      toast({ title: 'Plan override applied' });
      onOpenChange(false);
    } catch {
      toast({ title: 'Failed to apply override', variant: 'destructive' });
    }
  };

  return null;
}


// missing-error-boundary FP: Admin dialog sub-component — Remix root.tsx has global ErrorBoundary;
// dialog/form components correctly use try/catch+toast for async errors
declare function useQuery(opts: object): { data: unknown; isLoading: boolean };
declare function useMutation(opts: object): { mutateAsync: (data: object) => Promise<void> };
declare function useToast(): { toast: (opts: object) => void };

export function AdminWorkspacePlanOverrideDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const { data: currentPlan } = useQuery({ queryKey: ['workspace-plan', workspaceId] });
  const overrideMutation = useMutation({ mutationFn: async (d: object) => d });

  const handleOverride = async (planId: string) => {
    try {
      await overrideMutation.mutateAsync({ workspaceId, planId });
      toast({ title: 'Plan override applied' });
      onOpenChange(false);
    } catch {
      toast({ title: 'Failed to apply plan override', variant: 'destructive' });
    }
  };

  return null;
}

