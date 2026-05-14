
declare const authClient: { account: { delete: (id: string) => Promise<void> } };
declare const useToast: () => { toast: (opts: { title: string }) => void };
declare const Dialog: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void; children?: React.ReactNode }>;
declare const DialogContent: React.FC<{ children?: React.ReactNode }>;
declare const DialogHeader: React.FC<{ children?: React.ReactNode }>;
declare const DialogTitle: React.FC<{ children?: React.ReactNode }>;
declare const DialogFooter: React.FC<{ children?: React.ReactNode }>;
declare const DialogDescription: React.FC<{ children?: React.ReactNode }>;
declare const Button: React.FC<{ variant?: string; disabled?: boolean; onClick?: () => void; children?: React.ReactNode }>;
declare const useState: <T>(v: T) => [T, (v: T) => void];
declare const React: { FC: unknown; ReactNode: unknown };

type SsoUnlinkDialogProps = {
  accountId: string;
  provider: string;
  onSuccess: () => Promise<unknown>;
};

export const SsoUnlinkDialog = ({ accountId, onSuccess, provider }: SsoUnlinkDialogProps) => {
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleRevoke = async () => {
    setIsLoading(true);

    try {
      await authClient.account.delete(accountId);

      await onSuccess();

      toast({ title: `${provider} account unlinked` });
    } catch (error) {
      console.error(error);
      toast({ title: 'Failed to unlink account' });
    } finally {
      setIsLoading(false);
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Unlink {provider}
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unlink {provider} account?</DialogTitle>
          <DialogDescription>
            This will remove the {provider} connection from your account.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={isLoading} onClick={handleRevoke}>
            {isLoading ? 'Unlinking...' : 'Unlink'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
