declare function useMutation(opts: object): { mutateAsync: (data: object) => Promise<void> };
declare function useToast(): { toast: (opts: object) => void };
declare class AppError { static parseError(err: unknown): { code: string } }

interface FolderMoveDialogProps {
  folderId: string;
  targetFolderId: string;
  onSuccess?: () => void;
}

export function useFolderMove({ folderId, targetFolderId, onSuccess }: FolderMoveDialogProps) {
  const { toast } = useToast();
  const moveMutation = useMutation({ mutationFn: async (data: object) => data });

  const handleMove = async () => {
    try {
      await moveMutation.mutateAsync({ folderId, targetFolderId });

      toast({ title: 'Folder moved', variant: 'default' });
      onSuccess?.();
    } catch (err) {
      const error = AppError.parseError(err);
      toast({ title: 'Failed to move folder', description: error.code, variant: 'destructive' });
    }
  };

  return { handleMove };
}
