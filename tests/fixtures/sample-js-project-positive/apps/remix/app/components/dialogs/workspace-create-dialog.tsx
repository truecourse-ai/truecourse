declare function useQuery(opts: object): { data: unknown; isLoading: boolean };
declare function useMutation(opts: object): { mutateAsync: (data: object) => Promise<void> };
declare function useToast(): { toast: (opts: object) => void };

export function WorkspaceCreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const { data: plans } = useQuery({ queryKey: ['plans'] });
  const createMutation = useMutation({ mutationFn: async (d: object) => d });

  const handleCreate = async (data: { name: string }) => {
    try {
      await createMutation.mutateAsync(data);
      toast({ title: 'Workspace created' });
      onOpenChange(false);
    } catch {
      toast({ title: 'Failed to create workspace', variant: 'destructive' });
    }
  };

  return null;
}


// Single file sets form error on field 'workspaceSlug' — field name appears once
declare function useForm<T>(): {
  setError: (field: keyof T, error: { message: string }) => void;
  handleSubmit: (fn: (data: T) => Promise<void>) => (e: Event) => void;
};

interface WorkspaceCreateForm {
  workspaceName: string;
  workspaceSlug: string;
}

function WorkspaceCreateDialog() {
  const form = useForm<WorkspaceCreateForm>();

  const onSubmit = async (data: WorkspaceCreateForm) => {
    try {
      await createWorkspace(data);
    } catch (err) {
      if (isSlugConflict(err)) {
        form.setError('workspaceSlug', { message: 'This slug is already taken.' });
      }
    }
  };
}

declare function createWorkspace(data: WorkspaceCreateForm): Promise<void>;
declare function isSlugConflict(err: unknown): boolean;
