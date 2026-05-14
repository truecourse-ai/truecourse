
// FP: React dialog component with form, hooks, and JSX — standard React framework structure
declare const Dialog: React.FC<{ open?: boolean; onOpenChange?: (open: boolean) => void; children: React.ReactNode }>;
declare const DialogTrigger: React.FC<{ asChild?: boolean; children: React.ReactNode }>;
declare const DialogContent: React.FC<{ children: React.ReactNode }>;
declare const DialogHeader: React.FC<{ children: React.ReactNode }>;
declare const DialogTitle: React.FC<{ children: React.ReactNode }>;
declare const DialogDescription: React.FC<{ children: React.ReactNode }>;
declare const DialogFooter: React.FC<{ children: React.ReactNode }>;
declare const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; loading?: boolean }>;
declare const useToast: () => { toast: (opts: { title: string; variant?: string }) => void };
declare const trpc: { apiKey: { delete: { useMutation: (opts: { onSuccess: () => void; onError: (e: Error) => void }) => { mutateAsync: (args: unknown) => Promise<void>; isLoading: boolean } } } };
declare const Trans: React.FC<{ children: React.ReactNode }>;

export type ApiKeyDeleteDialogProps = {
  apiKey: { id: string; name: string };
  onDelete?: () => void;
  children?: React.ReactNode;
};

export default function ApiKeyDeleteDialog({ apiKey, onDelete, children }: ApiKeyDeleteDialogProps) {
  const [open, setOpen] = React.useState(false);
  const { toast } = useToast();

  const { mutateAsync: deleteApiKey, isLoading } = trpc.apiKey.delete.useMutation({
    onSuccess: () => {
      toast({ title: 'API key deleted successfully' });
      setOpen(false);
      onDelete?.();
    },
    onError: (err) => {
      toast({ title: err.message ?? 'Failed to delete API key', variant: 'destructive' });
    },
  });

  const handleDelete = async () => {
    await deleteApiKey({ id: apiKey.id }).catch(() => null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Delete API Key</Trans>
          </DialogTitle>

          <DialogDescription>
            <Trans>
              Are you sure you want to delete the API key{' '}
              <span className="font-semibold">{apiKey.name}</span>? This action cannot be undone.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isLoading}>
            <Trans>Cancel</Trans>
          </Button>

          <Button variant="destructive" onClick={handleDelete} loading={isLoading}>
            <Trans>Delete</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
