// --- cross-service-internal-import / shared-ui-library-subpath FP fixture ---
// Imports from @sample/ui/primitives/* are false positives: the package is a
// public shared UI library whose primitives subpath is its public API, not a
// forbidden cross-service internal import.
declare const Alert: React.ComponentType<{ variant?: string; children?: React.ReactNode }>;
declare const AlertDescription: React.ComponentType<{ children?: React.ReactNode }>;
declare const AvatarWithName: React.ComponentType<{ name: string; email: string; className?: string }>;
declare const Dialog: React.ComponentType<{ open: boolean; onOpenChange: (open: boolean) => void; children?: React.ReactNode }>;
declare const DialogContent: React.ComponentType<{ children?: React.ReactNode }>;
declare const DialogDescription: React.ComponentType<{ children?: React.ReactNode }>;
declare const DialogFooter: React.ComponentType<{ children?: React.ReactNode }>;
declare const DialogHeader: React.ComponentType<{ children?: React.ReactNode }>;
declare const DialogTitle: React.ComponentType<{ children?: React.ReactNode }>;
declare const DialogTrigger: React.ComponentType<{ asChild?: boolean; children?: React.ReactNode }>;
declare const PrimaryButton: React.ComponentType<{ onClick?: () => void; variant?: string; disabled?: boolean; children?: React.ReactNode }>;
declare function useToastNotification(): { notify: (opts: { title: string; description?: string; variant?: string }) => void };
declare const useState: <T>(initial: T) => [T, (v: T) => void];

export type MemberRemoveDialogProps = {
  workspaceId: string;
  workspaceName: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  onRemoved?: () => void;
  trigger?: React.ReactNode;
};

export const MemberRemoveDialog = ({
  workspaceId,
  workspaceName,
  memberId,
  memberName,
  memberEmail,
  onRemoved,
  trigger,
}: MemberRemoveDialogProps): JSX.Element => {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { notify } = useToastNotification();

  const handleRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      // removal logic would invoke a mutation here
      notify({
        title: 'Member removed',
        description: `${memberName} has been removed from ${workspaceName}.`,
      });
      setOpen(false);
      onRemoved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove member from workspace?</DialogTitle>
          <DialogDescription>
            You are about to remove <strong>{memberName}</strong> from{' '}
            <strong>{workspaceName}</strong>. They will lose access immediately.
          </DialogDescription>
        </DialogHeader>

        <AvatarWithName name={memberName} email={memberEmail} className="my-4" />

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <PrimaryButton variant="outline" onClick={() => setOpen(false)} disabled={removing}>
            Cancel
          </PrimaryButton>
          <PrimaryButton variant="destructive" onClick={handleRemove} disabled={removing}>
            {removing ? 'Removing…' : 'Remove member'}
          </PrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
