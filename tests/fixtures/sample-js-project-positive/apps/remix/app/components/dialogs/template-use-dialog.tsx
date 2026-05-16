declare const Dialog: (props: { open?: boolean; onOpenChange?: (open: boolean) => void; children: React.ReactNode }) => JSX.Element;
declare const DialogContent: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const DialogHeader: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogFooter: (props: { children: React.ReactNode }) => JSX.Element;
declare const Button: (props: { children: React.ReactNode; onClick?: () => void; variant?: string; disabled?: boolean; type?: string }) => JSX.Element;
declare const useToast: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const startTemplateSession: (templateId: string) => Promise<{ sessionUrl: string }>;

type TemplateStartDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  templateName: string;
};

export function TemplateStartDialog({
  open,
  onOpenChange,
  templateId,
  templateName,
}: TemplateStartDialogProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = React.useState(false);

  const handleStart = async () => {
    setIsLoading(true);
    try {
      const { sessionUrl } = await startTemplateSession(templateId);
      onOpenChange(false);
      window.location.href = sessionUrl;
    } catch {
      toast({
        title: 'Failed to start',
        description: 'Could not begin the template session. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Use template</DialogTitle>
          <DialogDescription>
            You are about to start a new signing session using <strong>{templateName}</strong>. Proceed?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={isLoading}>
            {isLoading ? 'Starting...' : 'Start signing'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



declare const useLingui37: () => { _: (msg: unknown) => string };
declare const useToast37: () => { toast: (opts: { title: string; description?: string; variant?: string; duration?: number }) => void };
declare const useNavigate37: () => (path: string) => void;
declare const useState37: <T>(init: T) => [T, (v: T) => void];
declare const useEffect37: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useForm37: <T>(opts: unknown) => { handleSubmit: (fn: (data: T) => Promise<void>) => (e: unknown) => void; control: unknown; watch: (field: string) => unknown; reset: (vals?: Partial<T>) => void; formState: { isSubmitting: boolean }; register: (name: string) => unknown };
declare const useFieldArray37: (opts: { control: unknown; name: string }) => { fields: Array<{ id: string }>; append: (val: unknown) => void; remove: (idx: number) => void };
declare const zodResolver37: (schema: unknown) => unknown;
declare const z37: { object: (shape: unknown) => unknown; string: () => { email: (opts?: unknown) => unknown; min: (n: number, opts?: unknown) => unknown }; array: (schema: unknown) => { optional: () => unknown }; boolean: () => unknown; number: () => { optional: () => unknown } };
declare const trpc37: { project: { useTemplate: { useMutation: () => { mutateAsync: (data: unknown) => Promise<{ id: string }> } } } };
declare const putFile37: (file: File) => Promise<{ key: string }>;
declare const msg37: (strings: TemplateStringsArray, ...vals: unknown[]) => unknown;
declare const Dialog37: React.ComponentType<{ open?: boolean; onOpenChange?: (v: boolean) => void; children: React.ReactNode }>;
declare const DialogContent37: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogHeader37: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogTitle37: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogDescription37: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogFooter37: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogTrigger37: React.ComponentType<{ asChild?: boolean; children: React.ReactNode }>;
declare const DialogClose37: React.ComponentType<{ asChild?: boolean; children: React.ReactNode }>;
declare const Button37: React.ComponentType<{ type?: string; variant?: string; loading?: boolean; size?: string; asChild?: boolean; onClick?: () => void; children: React.ReactNode }>;
declare const Input37: React.ComponentType<{ placeholder?: string; type?: string; [k: string]: unknown }>;
declare const Checkbox37: React.ComponentType<{ checked?: boolean; onCheckedChange?: (v: boolean) => void; id?: string }>;
declare const Form37: React.ComponentType<{ form: unknown; onSubmit: (e: unknown) => void; children: React.ReactNode }>;
declare const FormField37: React.ComponentType<{ control: unknown; name: string; render: (opts: { field: unknown }) => React.ReactNode }>;
declare const FormItem37: React.ComponentType<{ children: React.ReactNode }>;
declare const FormLabel37: React.ComponentType<{ children: React.ReactNode }>;
declare const FormControl37: React.ComponentType<{ children: React.ReactNode }>;
declare const FormMessage37: React.ComponentType;
declare const Tooltip37: React.ComponentType<{ children: React.ReactNode }>;
declare const TooltipTrigger37: React.ComponentType<{ asChild?: boolean; children: React.ReactNode }>;
declare const TooltipContent37: React.ComponentType<{ children: React.ReactNode }>;
declare const SpinnerBox37: React.ComponentType;
declare const PlusIcon37: React.ComponentType<{ className?: string }>;
declare const XIcon37: React.ComponentType<{ className?: string }>;
declare const InfoIcon37: React.ComponentType<{ className?: string }>;
declare const UploadCloudIcon37: React.ComponentType<{ className?: string }>;
declare const FileTextIcon37: React.ComponentType<{ className?: string }>;
declare const cn37: (...classes: unknown[]) => string;
declare const DocumentSigningOrder37: { PARALLEL: string; SEQUENTIAL: string };
declare const DocumentDistributionMethod37: { EMAIL: string; DIRECT: string };
declare const TEMPLATE_EMAIL_REGEX37: RegExp;
declare const TEMPLATE_NAME_REGEX37: RegExp;
declare const APP_UPLOAD_SIZE_LIMIT37: number;

type UseProjectTemplateDialogProps37 = {
  projectId: string;
  templateId: number;
  signingOrder?: string | null;
  recipients: Array<{ id: number; email: string; name: string; signingOrder?: number }>;
  distributionMethod?: string;
  projectRootPath: string;
  trigger?: React.ReactNode;
};

const ZUseTemplateSchema37 = (z37.object as unknown as (s: unknown) => unknown)({
  distributeProject: z37.boolean(),
  recipients: (z37.array as unknown as (s: unknown) => { optional: () => unknown })((z37.object as unknown as (s: unknown) => unknown)({
    id: (z37.number as unknown as () => { optional: () => unknown })().optional(),
    email: (z37.string() as unknown as { email: (opts?: unknown) => unknown }).email({ message: 'Invalid email' }),
    name: z37.string(),
  })),
});

type TUseTemplateSchema37 = {
  distributeProject: boolean;
  recipients: Array<{ id?: number; email: string; name: string }>;
};

export function UseProjectTemplateDialog37({
  recipients,
  distributionMethod = DocumentDistributionMethod37.EMAIL,
  projectRootPath,
  projectId,
  templateId,
  signingOrder,
  trigger,
}: UseProjectTemplateDialogProps37) {
  const [open, setOpen] = useState37(false);
  const { _ } = useLingui37();
  const { toast } = useToast37();
  const navigate = useNavigate37();

  const form = useForm37<TUseTemplateSchema37>({
    resolver: zodResolver37(ZUseTemplateSchema37),
    defaultValues: {
      distributeProject: distributionMethod === DocumentDistributionMethod37.EMAIL,
      recipients: recipients.map((r) => ({ id: r.id, email: r.email, name: r.name })),
    },
  });

  const { fields, append, remove } = useFieldArray37({ control: form.control, name: 'recipients' });

  const { mutateAsync: useTemplate } = trpc37.project.useTemplate.useMutation();

  const onSubmit = async (data: TUseTemplateSchema37) => {
    try {
      const result = await useTemplate({ templateId, projectId, recipients: data.recipients, distribute: data.distributeProject });
      toast({ title: _(msg37`Project created`), duration: 5000 });
      setOpen(false);
      navigate(`${projectRootPath}/${result.id}`);
    } catch {
      toast({
        title: _(msg37`Failed to create project`),
        description: _(msg37`An error occurred. Please try again.`),
        variant: 'destructive',
        duration: 10000,
      });
    }
  };

  return (
    <Dialog37 open={open} onOpenChange={setOpen}>
      <DialogTrigger37 asChild>
        {trigger ?? <Button37 variant="outline">Use template</Button37>}
      </DialogTrigger37>

      <DialogContent37>
        <DialogHeader37>
          <DialogTitle37>Use template</DialogTitle37>
          <DialogDescription37>Fill in recipient details to create a new project from this template.</DialogDescription37>
        </DialogHeader37>

        <Form37 form={form} onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-4">
            {fields.map((field, idx) => (
              <div key={field.id} className="flex items-start gap-2">
                <FormField37
                  control={form.control}
                  name={`recipients.${idx}.email`}
                  render={({ field: f }) => (
                    <FormItem37>
                      <FormLabel37>Email</FormLabel37>
                      <FormControl37><Input37 type="email" placeholder="recipient@example.com" {...(f as object)} /></FormControl37>
                      <FormMessage37 />
                    </FormItem37>
                  )}
                />
                <Button37 type="button" variant="ghost" size="sm" onClick={() => remove(idx)}>
                  <XIcon37 className="h-4 w-4" />
                </Button37>
              </div>
            ))}

            <Button37
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ email: '', name: '' })}
            >
              <PlusIcon37 className="mr-1 h-4 w-4" />
              Add recipient
            </Button37>
          </div>

          <FormField37
            control={form.control}
            name="distributeProject"
            render={({ field: f }) => (
              <FormItem37>
                <div className="flex items-center gap-2">
                  <Checkbox37 id="distribute" checked={(f as { value: boolean }).value} onCheckedChange={(f as { onChange: (v: boolean) => void }).onChange} />
                  <FormLabel37>Send emails to recipients</FormLabel37>
                </div>
              </FormItem37>
            )}
          />

          <DialogFooter37>
            <DialogClose37 asChild><Button37 variant="secondary">Cancel</Button37></DialogClose37>
            <Button37 type="submit" loading={form.formState.isSubmitting}>Create project</Button37>
          </DialogFooter37>
        </Form37>
      </DialogContent37>
    </Dialog37>
  );
}



declare const useLingui39: () => { _: (msg: unknown) => string };
declare const useToast39: () => { toast: (opts: { title: string; description?: string; variant?: string; duration?: number }) => void };
declare const useNavigate39: () => (path: string) => void;
declare const useState39: <T>(init: T) => [T, (v: T) => void];
declare const useEffect39: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useForm39: <T>(opts: unknown) => { handleSubmit: (fn: (data: T) => Promise<void>) => (e: unknown) => void; control: unknown; reset: () => void; formState: { isSubmitting: boolean } };
declare const useFieldArray39: (opts: { control: unknown; name: string }) => { fields: Array<{ id: string }>; append: (val: unknown) => void; remove: (idx: number) => void };
declare const zodResolver39: (schema: unknown) => unknown;
declare const z39: { object: (shape: unknown) => unknown; string: () => { email: (opts?: unknown) => unknown; min: (n: number) => unknown }; array: (schema: unknown) => unknown; boolean: () => unknown; number: () => { optional: () => unknown } };
declare const trpc39: { contract: { useTemplate: { useMutation: () => { mutateAsync: (data: unknown) => Promise<{ id: string }> } } } };
declare const msg39: (strings: TemplateStringsArray, ...vals: unknown[]) => unknown;
declare const Dialog39: React.ComponentType<{ open?: boolean; onOpenChange?: (v: boolean) => void; children: React.ReactNode }>;
declare const DialogContent39: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogHeader39: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogTitle39: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogDescription39: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogFooter39: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogTrigger39: React.ComponentType<{ asChild?: boolean; children: React.ReactNode }>;
declare const DialogClose39: React.ComponentType<{ asChild?: boolean; children: React.ReactNode }>;
declare const Button39: React.ComponentType<{ type?: string; variant?: string; loading?: boolean; size?: string; asChild?: boolean; onClick?: () => void; children: React.ReactNode }>;
declare const Input39: React.ComponentType<{ type?: string; placeholder?: string; [k: string]: unknown }>;
declare const Form39: React.ComponentType<{ form: unknown; onSubmit: (e: unknown) => void; children: React.ReactNode }>;
declare const FormField39: React.ComponentType<{ control: unknown; name: string; render: (opts: { field: unknown }) => React.ReactNode }>;
declare const FormItem39: React.ComponentType<{ children: React.ReactNode }>;
declare const FormLabel39: React.ComponentType<{ children: React.ReactNode }>;
declare const FormControl39: React.ComponentType<{ children: React.ReactNode }>;
declare const FormMessage39: React.ComponentType;
declare const PlusIcon39: React.ComponentType<{ className?: string }>;
declare const XIcon39: React.ComponentType<{ className?: string }>;

type UseContractTemplateDialogProps39 = {
  contractId: string;
  templateId: number;
  recipients: Array<{ id: number; email: string; name: string }>;
  contractRootPath: string;
  trigger?: React.ReactNode;
};

type TContractFromTemplateSchema39 = {
  recipients: Array<{ id?: number; email: string; name: string }>;
};

export function UseContractTemplateDialog39({
  recipients,
  contractRootPath,
  contractId,
  templateId,
  trigger,
}: UseContractTemplateDialogProps39) {
  const [open, setOpen] = useState39(false);
  const { _ } = useLingui39();
  const { toast } = useToast39();
  const navigate = useNavigate39();

  const ZContractTemplateSchema39 = (z39.object as unknown as (s: unknown) => unknown)({
    recipients: (z39.array as unknown as (s: unknown) => unknown)(
      (z39.object as unknown as (s: unknown) => unknown)({
        id: (z39.number() as unknown as { optional: () => unknown }).optional(),
        email: (z39.string() as unknown as { email: (opts?: unknown) => unknown }).email({ message: 'Invalid email' }),
        name: z39.string(),
      }),
    ),
  });

  const form = useForm39<TContractFromTemplateSchema39>({
    resolver: zodResolver39(ZContractTemplateSchema39),
    defaultValues: {
      recipients: recipients.map((r) => ({ id: r.id, email: r.email, name: r.name })),
    },
  });

  const { fields, append, remove } = useFieldArray39({ control: form.control, name: 'recipients' });

  const { mutateAsync: useTemplate } = trpc39.contract.useTemplate.useMutation();

  const onSubmit = async (data: TContractFromTemplateSchema39) => {
    try {
      const result = await useTemplate({ templateId, contractId, recipients: data.recipients });
      toast({ title: _(msg39`Contract created`), duration: 5000 });
      setOpen(false);
      navigate(`${contractRootPath}/${result.id}`);
    } catch {
      toast({
        title: _(msg39`Failed to create contract`),
        description: _(msg39`An error occurred. Please try again.`),
        variant: 'destructive',
        duration: 10000,
      });
    }
  };

  useEffect39(() => {
    if (!open) form.reset();
  }, [open]);

  return (
    <Dialog39 open={open} onOpenChange={setOpen}>
      <DialogTrigger39 asChild>
        {trigger ?? <Button39>Use template</Button39>}
      </DialogTrigger39>

      <DialogContent39>
        <DialogHeader39>
          <DialogTitle39>Use contract template</DialogTitle39>
          <DialogDescription39>Enter recipient details to create a contract from this template.</DialogDescription39>
        </DialogHeader39>

        <Form39 form={form} onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-3">
            {fields.map((field, idx) => (
              <div key={field.id} className="flex gap-2">
                <FormField39
                  control={form.control}
                  name={`recipients.${idx}.email`}
                  render={({ field: f }) => (
                    <FormItem39>
                      <FormLabel39>Email</FormLabel39>
                      <FormControl39><Input39 type="email" placeholder="signer@example.com" {...(f as object)} /></FormControl39>
                      <FormMessage39 />
                    </FormItem39>
                  )}
                />
                <FormField39
                  control={form.control}
                  name={`recipients.${idx}.name`}
                  render={({ field: f }) => (
                    <FormItem39>
                      <FormLabel39>Name</FormLabel39>
                      <FormControl39><Input39 placeholder="Full name" {...(f as object)} /></FormControl39>
                      <FormMessage39 />
                    </FormItem39>
                  )}
                />
                <Button39 type="button" variant="ghost" size="sm" onClick={() => remove(idx)}>
                  <XIcon39 className="h-4 w-4" />
                </Button39>
              </div>
            ))}

            <Button39 type="button" variant="outline" size="sm" onClick={() => append({ email: '', name: '' })}>
              <PlusIcon39 className="mr-1 h-4 w-4" />
              Add signer
            </Button39>
          </div>

          <DialogFooter39 className="mt-4">
            <DialogClose39 asChild><Button39 variant="secondary">Cancel</Button39></DialogClose39>
            <Button39 type="submit" loading={form.formState.isSubmitting}>Create contract</Button39>
          </DialogFooter39>
        </Form39>
      </DialogContent39>
    </Dialog39>
  );
}



// FP shape: documentFlow is a locally-defined Record<EditStep, ...> with all enum keys present;
// step is typed EditStep. Enum-exhaustive Record, no missing key possible.
declare const enum EditStep { UPLOAD = 'UPLOAD', CONFIGURE = 'CONFIGURE', SIGN = 'SIGN', DONE = 'DONE' }

interface StepConfig { title: string; description: string; canSkip: boolean }

const documentStepFlow: Record<EditStep, StepConfig> = {
  [EditStep.UPLOAD]: { title: 'Upload Document', description: 'Add your PDF', canSkip: false },
  [EditStep.CONFIGURE]: { title: 'Configure Fields', description: 'Place signature fields', canSkip: false },
  [EditStep.SIGN]: { title: 'Review & Sign', description: 'Review before sending', canSkip: false },
  [EditStep.DONE]: { title: 'Complete', description: 'Document sent', canSkip: true },
};

function getCurrentStepConfig(step: EditStep): StepConfig {
  return documentStepFlow[step];
}


// Positive sample: missing-error-boundary fires on this file.
// The file uses trpc .useQuery() but has no ErrorBoundary.

