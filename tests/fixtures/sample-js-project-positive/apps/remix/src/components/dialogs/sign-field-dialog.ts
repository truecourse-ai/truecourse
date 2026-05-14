
declare const z: { object: (s: Record<string, unknown>) => { superRefine: (fn: unknown) => unknown }; array: (s: unknown) => unknown; boolean: () => unknown; string: () => unknown; enum: (values: string[]) => unknown };
declare function useForm<T>(opts: { resolver: unknown; defaultValues: T }): { handleSubmit: (fn: (data: T) => void) => React.FormEventHandler; control: unknown };
declare function zodResolver(schema: unknown): unknown;

type CheckboxValue = { checked: boolean; value: string };
type SignFieldCheckboxFormValues = { values: CheckboxValue[] };

declare const fieldMeta: { values?: Array<{ value: string }>; required?: boolean };
declare const preselectedIndices: number[];

const ZSignFieldCheckboxFormSchema = z.object({
  values: z.array(
    z.object({ checked: z.boolean(), value: z.string() }),
  ),
}).superRefine((data: SignFieldCheckboxFormValues, ctx: unknown) => {
  const selected = data.values.filter((v) => v.checked).length;
  if (fieldMeta.required && selected === 0) {
    // validation error
  }
});

const form = useForm<SignFieldCheckboxFormValues>({
  resolver: zodResolver(ZSignFieldCheckboxFormSchema),
  defaultValues: {
    values: (fieldMeta.values || []).map((v, index) => ({
      checked: preselectedIndices.includes(index) || false,
      value: v.value,
    })),
  },
});



declare const z: {
  object: (shape: object) => any;
  string: () => any;
  boolean: () => any;
  nativeEnum: (e: object) => any;
  infer: never;
};
declare const zodResolver: (schema: unknown) => unknown;
declare function useForm<T>(opts: { defaultValues: Partial<T>; resolver: unknown }): {
  handleSubmit: (fn: (data: T) => Promise<void>) => (e?: unknown) => void;
  control: unknown;
  formState: { isSubmitting: boolean; errors: Record<string, unknown> };
  watch: (field: keyof T) => unknown;
  reset: (values?: Partial<T>) => void;
};
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useCurrentDocumentEditor(): {
  document: { meta?: { subject?: string; message?: string; replyTo?: string } };
  syncDocument: () => Promise<void>;
};
declare function useToast2(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useI18nT(): { t: (msg: string) => string };
declare function useNav(): (path: string) => void;
declare const DocumentSendMethod: { EMAIL: string; LINK: string };

const ZDocumentSendFormSchema = z.object({
  meta: z.object({
    templateId: z.string(),
    replyTo: z.string(),
    subject: z.string(),
    message: z.string(),
    sendMethod: z.nativeEnum(DocumentSendMethod),
  }),
});

type TDocumentSendFormSchema = { meta: { templateId: string; replyTo: string; subject: string; message: string; sendMethod: string } };

export const DocumentSendDialog = ({
  trigger,
  documentRootPath,
  onSend,
}: {
  trigger?: unknown;
  documentRootPath: string;
  onSend?: () => Promise<void>;
}) => {
  const { document: doc, syncDocument } = useCurrentDocumentEditor();

  const { toast } = useToast2();
  const { t } = useI18nT();
  const navigate = useNav();

  const [isOpen, setIsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const form = useForm<TDocumentSendFormSchema>({
    defaultValues: {
      meta: {
        templateId: '',
        replyTo: doc.meta?.replyTo ?? '',
        subject: doc.meta?.subject ?? '',
        message: doc.meta?.message ?? '',
        sendMethod: DocumentSendMethod.EMAIL,
      },
    },
    resolver: zodResolver(ZDocumentSendFormSchema),
  });

  const { isSubmitting } = form.formState;

  const onFormSubmit = async (values: TDocumentSendFormSchema) => {
    try {
      setIsSyncing(true);

      await syncDocument();

      setIsSyncing(false);

      if (onSend) {
        await onSend();
      } else {
        navigate(documentRootPath);
      }
    } catch (err) {
      setIsSyncing(false);
      toast({
        title: t('Error'),
        description: t('Failed to send the document'),
        variant: 'destructive',
      });
    }
  };

  return { isOpen, setIsOpen, form, isSubmitting, isSyncing, onFormSubmit };
};



declare const z2: {
  object: (shape: object) => { min: (n: number, opts?: { message?: string }) => any };
  string: () => { min: (n: number, opts?: { message?: string }) => any };
  infer: never;
};
declare const zodResolver2: (schema: unknown) => unknown;
declare function useForm2<T>(opts: { resolver: unknown; defaultValues: Partial<T> }): {
  handleSubmit: (fn: (data: T) => void) => (e?: unknown) => void;
  control: unknown;
  formState: { isSubmitting: boolean; errors: Record<string, unknown> };
};
declare function createModal<TProps, TResult>(fn: (ctx: { call: { end: (v: TResult) => void } } & TProps) => unknown): unknown;
declare const cn2: (...classes: (string | undefined | false | null)[]) => string;

type SignatureFieldMeta = {
  label?: string;
  placeholder?: string;
  required?: boolean;
};

const ZSignatureTextSchema = { text: { min: (n: number) => ({ id: 'text_required', message: 'Text is required' }) } };
type TSignatureTextInput = { text: string };

export const SignatureInputDialog = createModal<{ fieldMeta?: SignatureFieldMeta }, string | null>(
  ({ call, fieldMeta }) => {
    const form = useForm2<TSignatureTextInput>({
      resolver: zodResolver2(ZSignatureTextSchema),
      defaultValues: {
        text: '',
      },
    });

    const onSubmit = (data: TSignatureTextInput) => {
      call.end(data.text);
    };

    return {
      isOpen: true,
      onOpenChange: (value: boolean) => {
        if (!value) {
          call.end(null);
        }
      },
      title: fieldMeta?.label ?? 'Enter Signature Text',
      description: 'Please enter a value for this field.',
      form,
      onSubmit: form.handleSubmit(onSubmit),
      placeholder: fieldMeta?.placeholder ?? 'Enter your text here',
      isRequired: fieldMeta?.required ?? false,
    };
  },
);
