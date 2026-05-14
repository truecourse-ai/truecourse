
declare const useLingui11: () => { t: (strings: TemplateStringsArray, ...vals: unknown[]) => string };
declare const useToast11: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const useEffect11: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useForm11: <T>(opts: unknown) => { handleSubmit: (fn: (data: T) => Promise<void>) => (e: unknown) => void; control: unknown; reset: (vals?: Partial<T>) => void; formState: { isSubmitting: boolean } };
declare const zodResolver11: (schema: unknown) => unknown;
declare const z11: { object: (shape: unknown) => unknown; literal: (val: unknown, opts?: unknown) => unknown };
declare const trpc11: { project: { archive: { useMutation: () => { mutateAsync: (data: { projectId: string }) => Promise<void> } } } };
declare const AppError11: { parseError: (err: unknown) => { code: string } };
declare const AppErrorCode11: { NOT_FOUND: string };
declare const Dialog11: React.ComponentType<{ open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }>;
declare const DialogContent11: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogHeader11: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogTitle11: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogDescription11: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogFooter11: React.ComponentType<{ children: React.ReactNode }>;
declare const Button11: React.ComponentType<{ type?: string; variant?: string; loading?: boolean; onClick?: () => void; children: React.ReactNode }>;
declare const Input11: React.ComponentType<{ placeholder?: string; [k: string]: unknown }>;
declare const Form11: React.ComponentType<{ form: unknown; onSubmit: (e: unknown) => void; children: React.ReactNode }>;
declare const FormField11: React.ComponentType<{ control: unknown; name: string; render: (opts: { field: unknown }) => React.ReactNode }>;
declare const FormItem11: React.ComponentType<{ children: React.ReactNode }>;
declare const FormLabel11: React.ComponentType<{ children: React.ReactNode }>;
declare const FormControl11: React.ComponentType<{ children: React.ReactNode }>;
declare const FormMessage11: React.ComponentType;
declare const Alert11: React.ComponentType<{ children: React.ReactNode }>;
declare const AlertDescription11: React.ComponentType<{ children: React.ReactNode }>;

type ProjectArchiveDialogProps = {
  project: { id: string; name: string };
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export const ProjectArchiveDialog = ({ project, isOpen, onOpenChange }: ProjectArchiveDialogProps) => {
  const { t } = useLingui11();
  const { toast } = useToast11();
  const { mutateAsync: archiveProject } = trpc11.project.archive.useMutation();

  const confirmText = t`archive ${project.name}`;

  const ZArchiveSchema = z11.object({
    confirmText: z11.literal(confirmText, {
      errorMap: () => ({ message: t`You must type '${confirmText}' to confirm` }),
    }),
  });

  type TArchiveSchema = { confirmText: string };

  const form = useForm11<TArchiveSchema>({
    resolver: zodResolver11(ZArchiveSchema),
    defaultValues: { confirmText: '' },
  });

  const onSubmit = async () => {
    try {
      await archiveProject({ projectId: project.id });
      onOpenChange(false);
      toast({ title: t`Project archived successfully` });
    } catch (err) {
      const error = AppError11.parseError(err);

      if (error.code === AppErrorCode11.NOT_FOUND) {
        toast({
          title: t`Project not found`,
          description: t`The project you are trying to archive does not exist.`,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: t`Failed to archive project`,
        description: t`An unknown error occurred while archiving the project.`,
        variant: 'destructive',
      });
    }
  };

  useEffect11(() => {
    if (!isOpen) {
      form.reset();
    }
  }, [isOpen]);

  return (
    <Dialog11 open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent11>
        <DialogHeader11>
          <DialogTitle11>Archive project</DialogTitle11>
          <DialogDescription11>
            This will archive <strong>{project.name}</strong> and remove it from active views.
          </DialogDescription11>
        </DialogHeader11>

        <Alert11>
          <AlertDescription11>
            Archived projects can be restored later from the archive section.
          </AlertDescription11>
        </Alert11>

        <Form11 form={form} onSubmit={form.handleSubmit(onSubmit)}>
          <FormField11
            control={form.control}
            name="confirmText"
            render={({ field }) => (
              <FormItem11>
                <FormLabel11>Type to confirm</FormLabel11>
                <FormControl11>
                  <Input11 placeholder={confirmText} {...(field as object)} />
                </FormControl11>
                <FormMessage11 />
              </FormItem11>
            )}
          />

          <DialogFooter11 className="mt-4">
            <Button11 type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button11>
            <Button11 type="submit" variant="destructive" loading={form.formState.isSubmitting}>Archive</Button11>
          </DialogFooter11>
        </Form11>
      </DialogContent11>
    </Dialog11>
  );
};



declare const useNavigate13: () => (path: string) => void;
declare const useState13: <T>(init: T) => [T, (v: T) => void];
declare const useEffect13: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useLingui13: () => { _: (msg: unknown) => string };
declare const useToast13: () => { toast: (opts: { title: string; description?: string; duration?: number; variant?: string }) => void };
declare const useCurrentOrg13: () => { teams: Array<{ id: number; name: string }>; refreshSession: () => Promise<void> };
declare const useForm13: <T>(opts: unknown) => { handleSubmit: (fn: (data: T) => Promise<void>) => (e: unknown) => void; control: unknown; reset: (vals?: Partial<T>) => void; watch: (field: string) => unknown; formState: { isSubmitting: boolean } };
declare const zodResolver13: (schema: unknown) => unknown;
declare const z13: { object: (shape: unknown) => unknown; literal: (val: unknown, opts?: unknown) => unknown; string: () => { optional: () => unknown } };
declare const trpc13: { team: { delete: { useMutation: () => { mutateAsync: (data: { teamId: number; transferTeamId?: number }) => Promise<void> } } } };
declare const msg13: (strings: TemplateStringsArray, ...vals: unknown[]) => unknown;
declare const Dialog13: React.ComponentType<{ open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }>;
declare const DialogContent13: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogHeader13: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogTitle13: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogDescription13: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogFooter13: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogTrigger13: React.ComponentType<{ asChild?: boolean; children: React.ReactNode }>;
declare const Button13: React.ComponentType<{ type?: string; variant?: string; loading?: boolean; onClick?: () => void; children: React.ReactNode }>;
declare const Input13: React.ComponentType<{ placeholder?: string; [k: string]: unknown }>;
declare const Select13: React.ComponentType<{ value?: string; onValueChange?: (v: string) => void; children: React.ReactNode }>;
declare const SelectTrigger13: React.ComponentType<{ children: React.ReactNode }>;
declare const SelectValue13: React.ComponentType<{ placeholder?: string }>;
declare const SelectContent13: React.ComponentType<{ children: React.ReactNode }>;
declare const SelectItem13: React.ComponentType<{ value: string; children: React.ReactNode }>;
declare const Form13: React.ComponentType<{ form: unknown; onSubmit: (e: unknown) => void; children: React.ReactNode }>;
declare const FormField13: React.ComponentType<{ control: unknown; name: string; render: (opts: { field: unknown }) => React.ReactNode }>;
declare const FormItem13: React.ComponentType<{ children: React.ReactNode }>;
declare const FormLabel13: React.ComponentType<{ children: React.ReactNode }>;
declare const FormControl13: React.ComponentType<{ children: React.ReactNode }>;
declare const FormMessage13: React.ComponentType;

type WorkspaceDeleteDialogProps = {
  teamId: number;
  teamName: string;
  redirectTo?: string;
  trigger?: React.ReactNode;
};

export const WorkspaceDeleteDialog = ({ trigger, teamId, teamName, redirectTo }: WorkspaceDeleteDialogProps) => {
  const navigate = useNavigate13();
  const [open, setOpen] = useState13(false);

  const { _ } = useLingui13();
  const { toast } = useToast13();
  const { teams, refreshSession } = useCurrentOrg13();

  const deletePhrase = _(msg13`delete ${teamName}`);

  const siblingTeams = teams.filter((t) => t.id !== teamId);

  const ZDeleteSchema = z13.object({
    teamName: z13.literal(deletePhrase, {
      errorMap: () => ({ message: _(msg13`You must type '${deletePhrase}' to proceed`) }),
    }),
    transferTeamId: z13.string().optional(),
  });

  type TDeleteSchema = { teamName: string; transferTeamId?: string };

  const form = useForm13<TDeleteSchema>({
    resolver: zodResolver13(ZDeleteSchema),
    defaultValues: { teamName: '', transferTeamId: undefined },
  });

  const { mutateAsync: deleteTeam } = trpc13.team.delete.useMutation();

  const onSubmit = async (data: TDeleteSchema) => {
    try {
      const transferTeamId = data.transferTeamId ? parseInt(data.transferTeamId, 10) : undefined;
      await deleteTeam({ teamId, transferTeamId });
      await refreshSession();

      toast({
        title: _(msg13`Success`),
        description: _(msg13`The team has been successfully deleted.`),
        duration: 5000,
      });

      if (redirectTo) {
        navigate(redirectTo);
      }
    } catch {
      toast({
        title: _(msg13`An error occurred`),
        description: _(msg13`We could not delete this team. Please try again later.`),
        variant: 'destructive',
        duration: 10000,
      });
    }
  };

  useEffect13(() => {
    if (!open) form.reset();
  }, [open]);

  return (
    <Dialog13 open={open} onOpenChange={setOpen}>
      <DialogTrigger13 asChild>
        {trigger ?? <Button13 variant="destructive">Delete team</Button13>}
      </DialogTrigger13>

      <DialogContent13>
        <DialogHeader13>
          <DialogTitle13>Delete team</DialogTitle13>
          <DialogDescription13>
            Permanently delete <strong>{teamName}</strong>. Type <strong>{deletePhrase}</strong> to confirm.
          </DialogDescription13>
        </DialogHeader13>

        <Form13 form={form} onSubmit={form.handleSubmit(onSubmit)}>
          <FormField13
            control={form.control}
            name="teamName"
            render={({ field }) => (
              <FormItem13>
                <FormLabel13>Confirmation</FormLabel13>
                <FormControl13>
                  <Input13 placeholder={deletePhrase} {...(field as object)} />
                </FormControl13>
                <FormMessage13 />
              </FormItem13>
            )}
          />

          {siblingTeams.length > 0 && (
            <FormField13
              control={form.control}
              name="transferTeamId"
              render={({ field }) => (
                <FormItem13>
                  <FormLabel13>Transfer documents to (optional)</FormLabel13>
                  <FormControl13>
                    <Select13 value={(field as { value?: string }).value} onValueChange={(field as { onChange: (v: string) => void }).onChange}>
                      <SelectTrigger13><SelectValue13 placeholder="Select a team" /></SelectTrigger13>
                      <SelectContent13>
                        {siblingTeams.map((t) => (
                          <SelectItem13 key={t.id} value={String(t.id)}>{t.name}</SelectItem13>
                        ))}
                      </SelectContent13>
                    </Select13>
                  </FormControl13>
                </FormItem13>
              )}
            />
          )}

          <DialogFooter13 className="mt-4">
            <Button13 type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button13>
            <Button13 type="submit" variant="destructive" loading={form.formState.isSubmitting}>Delete team</Button13>
          </DialogFooter13>
        </Form13>
      </DialogContent13>
    </Dialog13>
  );
};



declare const useLingui33: () => { t: (strings: TemplateStringsArray, ...vals: unknown[]) => string };
declare const useForm33: <T>(opts: unknown) => { handleSubmit: (fn: (data: T) => Promise<void>) => (e: unknown) => void; control: unknown; formState: { isSubmitting: boolean } };
declare const zodResolver33: (schema: unknown) => unknown;
declare const z33: { object: (shape: unknown) => unknown; string: () => { superRefine: (fn: (val: string, ctx: { addIssue: (issue: unknown) => void }) => void) => unknown; refine: (fn: (val: string) => boolean, opts: { message: string }) => unknown } };
declare const numberFormatPatterns33: Array<{ value: string; regex: RegExp }>;
declare const createCallable33: <Props, Return>(component: (props: Props & { call: { end: (val: Return) => void } }) => React.ReactNode) => unknown;
declare const Dialog33: React.ComponentType<{ root?: unknown; open?: boolean; onOpenChange?: (v: boolean) => void; children: React.ReactNode }>;
declare const DialogContent33: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogHeader33: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogTitle33: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogDescription33: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogFooter33: React.ComponentType<{ children: React.ReactNode }>;
declare const Button33: React.ComponentType<{ type?: string; variant?: string; loading?: boolean; onClick?: () => void; children: React.ReactNode }>;
declare const Input33: React.ComponentType<{ type?: string; placeholder?: string; [k: string]: unknown }>;
declare const Form33: React.ComponentType<{ form: unknown; onSubmit: (e: unknown) => void; children: React.ReactNode }>;
declare const FormField33: React.ComponentType<{ control: unknown; name: string; render: (opts: { field: unknown }) => React.ReactNode }>;
declare const FormItem33: React.ComponentType<{ children: React.ReactNode }>;
declare const FormMessage33: React.ComponentType;
declare const FormControl33: React.ComponentType<{ children: React.ReactNode }>;
declare const cn33: (...classes: unknown[]) => string;

type CurrencyFieldMeta33 = { numberFormat?: string; minValue?: number; maxValue?: number };

type SignCurrencyFieldDialogProps33 = { fieldMeta: CurrencyFieldMeta33 };

export const SignCurrencyFieldDialog33 = createCallable33<SignCurrencyFieldDialogProps33, string | null>(
  ({ call, fieldMeta }: SignCurrencyFieldDialogProps33 & { call: { end: (val: string | null) => void } }) => {
    const { t } = useLingui33();

    const buildCurrencySchema = (meta: CurrencyFieldMeta33) => {
      const { numberFormat, minValue, maxValue } = meta;

      if (numberFormat) {
        const found = numberFormatPatterns33.find((p) => p.value === numberFormat);
        if (found) {
          return (z33.string() as unknown as { refine: (fn: (val: string) => boolean, opts: { message: string }) => unknown }).refine(
            (val) => found.regex.test(val),
            { message: t`Value must match format: ${numberFormat}` },
          );
        }
      }

      return (z33.string() as unknown as { superRefine: (fn: (val: string, ctx: { addIssue: (issue: unknown) => void }) => void) => unknown }).superRefine((val, ctx) => {
        const isValid = /^[0-9,.\s]+$/.test(val);
        if (!isValid) {
          (ctx as { addIssue: (issue: { code: string; message: string }) => void }).addIssue({ code: 'custom', message: t`Please enter a valid currency amount` });
          return;
        }

        const num = parseFloat(val.replace(/[,$\s]/g, ''));
        if (!Number.isFinite(num)) {
          (ctx as { addIssue: (issue: { code: string; message: string }) => void }).addIssue({ code: 'custom', message: t`Invalid number` });
          return;
        }

        if (minValue !== undefined && num < minValue) {
          (ctx as { addIssue: (issue: { code: string; message: string }) => void }).addIssue({ code: 'custom', message: t`Value must be at least ${minValue}` });
        }

        if (maxValue !== undefined && num > maxValue) {
          (ctx as { addIssue: (issue: { code: string; message: string }) => void }).addIssue({ code: 'custom', message: t`Value must be at most ${maxValue}` });
        }
      });
    };

    const ZCurrencySchema33 = (z33.object as unknown as (shape: unknown) => unknown)({ amount: buildCurrencySchema(fieldMeta) });

    type TCurrencySchema33 = { amount: string };

    const form = useForm33<TCurrencySchema33>({
      resolver: zodResolver33(ZCurrencySchema33),
      defaultValues: { amount: '' },
    });

    return (
      <Dialog33>
        <DialogContent33>
          <DialogHeader33>
            <DialogTitle33>Enter currency amount</DialogTitle33>
            <DialogDescription33>
              {fieldMeta.numberFormat ? t`Format: ${fieldMeta.numberFormat}` : t`Enter a valid currency amount.`}
            </DialogDescription33>
          </DialogHeader33>

          <Form33 form={form} onSubmit={form.handleSubmit(async ({ amount }) => call.end(amount))}>
            <FormField33
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem33>
                  <FormControl33>
                    <Input33 type="text" placeholder="0.00" {...(field as object)} />
                  </FormControl33>
                  <FormMessage33 />
                </FormItem33>
              )}
            />

            <DialogFooter33>
              <Button33 type="button" variant="secondary" onClick={() => call.end(null)}>Cancel</Button33>
              <Button33 type="submit" loading={form.formState.isSubmitting}>Confirm</Button33>
            </DialogFooter33>
          </Form33>
        </DialogContent33>
      </Dialog33>
    );
  },
);
