
declare const trpc4: { admin: { team: { create: { useMutation: () => { mutateAsync: (opts: unknown) => Promise<{ teamId: string }> } } } } };
declare const useNavigate4: () => (path: string) => void;
declare const useToast5: () => { toast: (opts: { title: string; variant?: string }) => void };
declare const Dialog6: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void; children?: React.ReactNode }>;
declare const DialogContent6: React.FC<{ children?: React.ReactNode }>;
declare const DialogHeader6: React.FC<{ children?: React.ReactNode }>;
declare const DialogTitle6: React.FC<{ children?: React.ReactNode }>;
declare const DialogDescription6: React.FC<{ children?: React.ReactNode }>;
declare const DialogFooter6: React.FC<{ children?: React.ReactNode }>;
declare const Form6: React.FC<{ children?: React.ReactNode }>;
declare const FormField6: React.FC<{ control: unknown; name: string; render: (opts: { field: unknown }) => React.ReactNode }>;
declare const FormItem6: React.FC<{ children?: React.ReactNode }>;
declare const FormLabel6: React.FC<{ children?: React.ReactNode }>;
declare const FormControl6: React.FC<{ children?: React.ReactNode }>;
declare const FormMessage6: React.FC<{ children?: React.ReactNode }>;
declare const Input6: React.FC<{ placeholder?: string; [key: string]: unknown }>;
declare const Button6: React.FC<{ type?: string; variant?: string; disabled?: boolean; onClick?: () => void; children?: React.ReactNode }>;
declare const useForm6: <T>(opts: unknown) => { handleSubmit: (fn: (data: T) => void) => (e: unknown) => void; control: unknown; formState: { isSubmitting: boolean } };
declare const zodResolver6: (schema: unknown) => unknown;
declare const z6: { object: (s: Record<string, unknown>) => { shape: { data: { pick: (keys: Record<string, true>) => unknown } } }; string: () => { min: (n: number) => unknown } };
declare const useState6: <T>(v: T) => [T, (v: T) => void];
declare const useEffect6: (fn: () => void, deps: unknown[]) => void;
declare const React: { FC: unknown; ReactNode: unknown };

type AdminTeamCreateDialogProps = {
  trigger?: React.ReactNode;
  ownerUserId: number;
};

const ZCreateAdminTeamFormSchema = { name: z6.string().min(2) };
type TCreateAdminTeamFormSchema = { name: string };

export const AdminTeamCreateDialog = ({ trigger, ownerUserId, ...props }: AdminTeamCreateDialogProps & { open?: boolean; onOpenChange?: (v: boolean) => void }) => {
  const navigate = useNavigate4();
  const { toast } = useToast5();

  const [open, setOpen] = useState6(false);

  const form = useForm6<TCreateAdminTeamFormSchema>({
    resolver: zodResolver6(ZCreateAdminTeamFormSchema),
    defaultValues: { name: '' },
  });

  const { mutateAsync: createTeam } = trpc4.admin.team.create.useMutation();

  const onFormSubmit = async ({ name }: TCreateAdminTeamFormSchema) => {
    try {
      const { teamId } = await createTeam({ ownerUserId, data: { name } });
      toast({ title: 'Team created' });
      navigate(`/admin/teams/${teamId}`);
      setOpen(false);
    } catch {
      toast({ title: 'Failed to create team', variant: 'destructive' });
    }
  };

  return (
    <Dialog6 open={open} onOpenChange={setOpen}>
      {trigger ? <span onClick={() => setOpen(true)}>{trigger}</span> : null}

      <DialogContent6>
        <DialogHeader6>
          <DialogTitle6>Create team</DialogTitle6>
          <DialogDescription6>Create a new team for the selected owner.</DialogDescription6>
        </DialogHeader6>

        <Form6>
          <form onSubmit={form.handleSubmit(onFormSubmit)}>
            <fieldset disabled={form.formState.isSubmitting} className="flex flex-col space-y-4">
              <FormField6
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem6>
                    <FormLabel6>Team name</FormLabel6>
                    <FormControl6>
                      <Input6 placeholder="Engineering" {...(field as object)} />
                    </FormControl6>
                    <FormMessage6 />
                  </FormItem6>
                )}
              />

              <DialogFooter6>
                <Button6 type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button6>
                <Button6 type="submit" disabled={form.formState.isSubmitting}>Create</Button6>
              </DialogFooter6>
            </fieldset>
          </form>
        </Form6>
      </DialogContent6>
    </Dialog6>
  );
};
