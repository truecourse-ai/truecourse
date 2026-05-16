// UserDeleteDialog — uses shared UI library primitives across package boundary.
// @sample/ui is a workspace-level shared UI library (name matches /ui$/),
// so @sample/ui/primitives/* are public exports, not internal service paths.
declare const useState: <T>(initial: T) => [T, (v: T) => void];
declare function useNavigate(): (path: string) => void;
declare function useToast(): { toast: (opts: { title: string; variant?: string }) => void };
declare const Button: (props: { disabled?: boolean; variant?: string; onClick?: () => void; children?: unknown }) => JSX.Element;
declare const Input: (props: { value: string; onChange: (e: { target: { value: string } }) => void; placeholder?: string }) => JSX.Element;
declare const Alert: (props: { variant?: string; children?: unknown }) => JSX.Element;
declare const AlertTitle: (props: { children?: unknown }) => JSX.Element;
declare const AlertDescription: (props: { children?: unknown }) => JSX.Element;
declare const Dialog: (props: { open?: boolean; onOpenChange?: (v: boolean) => void; children?: unknown }) => JSX.Element;
declare const DialogContent: (props: { children?: unknown }) => JSX.Element;
declare const DialogHeader: (props: { children?: unknown }) => JSX.Element;
declare const DialogTitle: (props: { children?: unknown }) => JSX.Element;
declare const DialogDescription: (props: { children?: unknown }) => JSX.Element;
declare const DialogFooter: (props: { children?: unknown }) => JSX.Element;
declare const DialogTrigger: (props: { asChild?: boolean; children?: unknown }) => JSX.Element;

export type UserDeleteDialogProps = {
  className?: string;
  userId: string;
  userEmail: string;
};

export const UserDeleteDialog = ({ className, userId, userEmail }: UserDeleteDialogProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [confirmEmail, setConfirmEmail] = useState('');
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const handleDelete = async () => {
    if (confirmEmail !== userEmail) {
      toast({ title: 'Email does not match', variant: 'destructive' });
      return;
    }
    setIsPending(true);
    try {
      // deletion call omitted — stub
      toast({ title: 'User deleted' });
      navigate('/admin/users');
    } catch {
      toast({ title: 'Failed to delete user', variant: 'destructive' });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive">Delete user</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete account</DialogTitle>
          <DialogDescription>
            This action is permanent. Type <strong>{userEmail}</strong> to confirm.
          </DialogDescription>
        </DialogHeader>
        <Alert variant="destructive">
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>All data for this user will be permanently removed.</AlertDescription>
        </Alert>
        <Input
          value={confirmEmail}
          onChange={(e) => setConfirmEmail(e.target.value)}
          placeholder={userEmail}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={isPending || confirmEmail !== userEmail}
            onClick={handleDelete}
          >
            {isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
