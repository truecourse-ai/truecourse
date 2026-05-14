
declare const useState: <T>(init: T) => [T, (v: T) => void];
declare const useEffect: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useNavigate: () => (path: string) => void;
declare const useForm: <T>(opts: unknown) => { handleSubmit: (fn: (data: T) => Promise<void>) => (e: unknown) => void; control: unknown; formState: { isSubmitting: boolean } };
declare const zodResolver: (schema: unknown) => unknown;
declare const z: { object: (shape: unknown) => unknown; literal: (val: unknown, opts?: unknown) => unknown; string: () => { min: (n: number) => unknown } };
declare const trpc: { workspace: { remove: { useMutation: (opts?: unknown) => { mutateAsync: (data: unknown) => Promise<void> } } } };
declare const toast: (opts: { title: string; description?: string; variant?: string; duration?: number }) => void;
declare const useCurrentWorkspace: () => { id: string; name: string };
declare const Dialog: React.ComponentType<{ open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }>;
declare const DialogContent: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogHeader: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogTitle: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogDescription: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogFooter: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogTrigger: React.ComponentType<{ asChild?: boolean; children: React.ReactNode }>;
declare const Button: React.ComponentType<{ type?: string; variant?: string; loading?: boolean; onClick?: () => void; children: React.ReactNode }>;
declare const Input: React.ComponentType<{ id?: string; placeholder?: string; value?: string; onChange?: (e: { target: { value: string } }) => void }>;
declare const Form: React.ComponentType<{ form: unknown; onSubmit: (e: unknown) => void; children: React.ReactNode }>;
declare const FormField: React.ComponentType<{ control: unknown; name: string; render: (opts: { field: unknown }) => React.ReactNode }>;
declare const FormItem: React.ComponentType<{ children: React.ReactNode }>;
declare const FormLabel: React.ComponentType<{ children: React.ReactNode }>;
declare const FormControl: React.ComponentType<{ children: React.ReactNode }>;
declare const FormMessage: React.ComponentType;
declare const React: { ComponentType: unknown; ReactNode: unknown };

type WorkspaceRemoveDialogProps = {
  trigger?: React.ReactNode;
};

export const WorkspaceRemoveDialog = ({ trigger }: WorkspaceRemoveDialogProps) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const workspace = useCurrentWorkspace();

  const confirmPhrase = `remove ${workspace.name}`;

  const ZRemoveWorkspaceSchema = z.object({
    workspaceName: z.literal(confirmPhrase, {
      errorMap: () => ({ message: `You must type '${confirmPhrase}' to continue` }),
    }),
  });

  const form = useForm({
    resolver: zodResolver(ZRemoveWorkspaceSchema),
    defaultValues: { workspaceName: '' },
  });

  const { mutateAsync: removeWorkspace } = trpc.workspace.remove.useMutation();

  const onSubmit = async () => {
    try {
      await removeWorkspace({ workspaceId: workspace.id });

      toast({
        title: 'Workspace removed',
        description: `${workspace.name} has been permanently deleted.`,
        duration: 5000,
      });

      navigate('/dashboard');
    } catch {
      toast({
        title: 'Failed to remove workspace',
        variant: 'destructive',
        duration: 10000,
      });
    }
  };

  useEffect(() => {
    if (!open) {
      form.handleSubmit(async () => {});
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button variant="destructive">Remove workspace</Button>}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove workspace</DialogTitle>
          <DialogDescription>
            This action cannot be undone. Type <strong>{confirmPhrase}</strong> to confirm.
          </DialogDescription>
        </DialogHeader>

        <Form form={form} onSubmit={form.handleSubmit(onSubmit)}>
          <FormField
            control={form.control}
            name="workspaceName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirmation</FormLabel>
                <FormControl>
                  <Input placeholder={confirmPhrase} {...(field as object)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <DialogFooter className="mt-4">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" loading={form.formState.isSubmitting}>Remove</Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
};



declare const useCurrentWorkspace2: () => { id: string; name: string };
declare const trpc2: { workspace: { removeEmail: { useMutation: (opts: { onSuccess: () => void; onError: () => void }) => { mutateAsync: (data: { emailId: string; workspaceId: string }) => Promise<void>; isPending: boolean } } } };
declare const useState2: <T>(init: T) => [T, (v: T) => void];
declare const useToast2: () => { toast: (opts: { title: string; description?: string; variant?: string; duration?: number }) => void };
declare const useLingui2: () => { t: (s: TemplateStringsArray, ...vals: unknown[]) => string };
declare const Dialog2: React.ComponentType<{ open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }>;
declare const DialogContent2: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogHeader2: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogTitle2: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogDescription2: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogFooter2: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogTrigger2: React.ComponentType<{ asChild?: boolean; children: React.ReactNode }>;
declare const Button2: React.ComponentType<{ variant?: string; loading?: boolean; onClick?: () => void; children: React.ReactNode }>;
declare const Alert2: React.ComponentType<{ variant?: string; children: React.ReactNode }>;
declare const AlertDescription2: React.ComponentType<{ children: React.ReactNode }>;

type WorkspaceEmailRemoveDialogProps = {
  emailId: string;
  email: string;
  trigger?: React.ReactNode;
};

export const WorkspaceEmailRemoveDialog = ({ trigger, emailId, email }: WorkspaceEmailRemoveDialogProps) => {
  const [open, setOpen] = useState2(false);
  const { toast } = useToast2();
  const { t } = useLingui2();
  const workspace = useCurrentWorkspace2();

  const { mutateAsync: removeEmail, isPending: isRemoving } = trpc2.workspace.removeEmail.useMutation({
    onSuccess: () => {
      toast({
        title: t`Success`,
        description: t`The email address has been removed from the workspace.`,
        duration: 5000,
      });
      setOpen(false);
    },
    onError: () => {
      toast({
        title: t`An error occurred`,
        description: t`We could not remove this email address. Please try again.`,
        variant: 'destructive',
        duration: 10000,
      });
    },
  });

  return (
    <Dialog2 open={open} onOpenChange={(v) => !isRemoving && setOpen(v)}>
      <DialogTrigger2 asChild>
        {trigger ?? <Button2 variant="secondary">Remove email</Button2>}
      </DialogTrigger2>

      <DialogContent2>
        <DialogHeader2>
          <DialogTitle2>Remove email address</DialogTitle2>
          <DialogDescription2>
            You are about to remove <strong>{email}</strong> from the workspace.
          </DialogDescription2>
        </DialogHeader2>

        <Alert2 variant="warning">
          <AlertDescription2>
            Documents sent to and from this address will no longer be visible to workspace members.
          </AlertDescription2>
        </Alert2>

        <DialogFooter2>
          <Button2 variant="secondary" onClick={() => setOpen(false)}>Cancel</Button2>
          <Button2
            variant="destructive"
            loading={isRemoving}
            onClick={async () => {
              await removeEmail({ emailId, workspaceId: workspace.id });
            }}
          >
            Remove
          </Button2>
        </DialogFooter2>
      </DialogContent2>
    </Dialog2>
  );
};



declare const useSession5: () => { user: { id: string; email: string; twoFactorEnabled: boolean } };
declare const useLingui5: () => { _: (msg: unknown) => string };
declare const useToast5: () => { toast: (opts: { title: string; description?: string; variant?: string; duration?: number }) => void };
declare const useState5: <T>(init: T) => [T, (v: T) => void];
declare const trpc5: { account: { close: { useMutation: () => { mutateAsync: () => Promise<void>; isPending: boolean } } } };
declare const authClient5: { signOut: () => Promise<void> };
declare const msg5: (strings: TemplateStringsArray, ...vals: unknown[]) => unknown;
declare const Dialog5: React.ComponentType<{ open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }>;
declare const DialogContent5: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogHeader5: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogTitle5: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogDescription5: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogFooter5: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogTrigger5: React.ComponentType<{ asChild?: boolean; children: React.ReactNode }>;
declare const Button5: React.ComponentType<{ type?: string; variant?: string; loading?: boolean; disabled?: boolean; onClick?: () => void; children: React.ReactNode }>;
declare const Input5: React.ComponentType<{ id?: string; type?: string; placeholder?: string; value?: string; onChange?: (e: { target: { value: string } }) => void }>;
declare const Label5: React.ComponentType<{ htmlFor?: string; children: React.ReactNode }>;
declare const Alert5: React.ComponentType<{ variant?: string; children: React.ReactNode }>;
declare const AlertTitle5: React.ComponentType<{ children: React.ReactNode }>;
declare const AlertDescription5: React.ComponentType<{ children: React.ReactNode }>;

type CloseAccountDialogProps = {
  className?: string;
};

export const CloseAccountDialog = ({ className }: CloseAccountDialogProps) => {
  const { user } = useSession5();
  const { _ } = useLingui5();
  const { toast } = useToast5();

  const [enteredEmail, setEnteredEmail] = useState5<string>('');

  const { mutateAsync: closeAccount, isPending: isClosing } = trpc5.account.close.useMutation();

  const onCloseAccount = async () => {
    try {
      await closeAccount();

      toast({
        title: _(msg5`Account closed`),
        description: _(msg5`Your account has been closed successfully.`),
        duration: 5000,
      });

      return await authClient5.signOut();
    } catch {
      toast({
        title: _(msg5`An unknown error occurred`),
        variant: 'destructive',
        description: _(msg5`We encountered an error while attempting to close your account. Please try again later.`),
      });
    }
  };

  const isConfirmed = enteredEmail === user.email;

  return (
    <Dialog5 open={false} onOpenChange={() => {}}>
      <DialogTrigger5 asChild>
        <Button5 variant="destructive" className={className}>Close account</Button5>
      </DialogTrigger5>

      <DialogContent5>
        <DialogHeader5>
          <DialogTitle5>Close account</DialogTitle5>
          <DialogDescription5>
            This will permanently close your account and delete all associated data.
          </DialogDescription5>
        </DialogHeader5>

        {user.twoFactorEnabled && (
          <Alert5 variant="warning">
            <AlertTitle5>Two-factor authentication is enabled</AlertTitle5>
            <AlertDescription5>
              Closing your account will disable two-factor authentication.
            </AlertDescription5>
          </Alert5>
        )}

        <div className="space-y-2">
          <Label5 htmlFor="confirm-email">Type your email address to confirm</Label5>
          <Input5
            id="confirm-email"
            type="email"
            placeholder={user.email}
            value={enteredEmail}
            onChange={(e) => setEnteredEmail(e.target.value)}
          />
        </div>

        <DialogFooter5>
          <Button5 variant="secondary">Cancel</Button5>
          <Button5
            variant="destructive"
            disabled={!isConfirmed}
            loading={isClosing}
            onClick={onCloseAccount}
          >
            Close account
          </Button5>
        </DialogFooter5>
      </DialogContent5>
    </Dialog5>
  );
};
