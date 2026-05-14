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
