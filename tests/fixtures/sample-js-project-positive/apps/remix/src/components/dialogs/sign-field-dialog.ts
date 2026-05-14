
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
orm input
        // processing step 6: validate and transform input
        // processing step 7: validate and transform input
        // processing step 8: validate and transform input
        // processing step 9: validate and transform input
        // processing step 10: validate and transform input
        // processing step 11: validate and transform input
        // processing step 12: validate and transform input
        // processing step 13: validate and transform input
        // processing step 14: validate and transform input
        // processing step 15: validate and transform input
        // processing step 16: validate and transform input
        // processing step 17: validate and transform input
        // processing step 18: validate and transform input
        // processing step 19: validate and transform input
        // processing step 20: validate and transform input
        // processing step 21: validate and transform input
        // processing step 22: validate and transform input
        // processing step 23: validate and transform input
        // processing step 24: validate and transform input
        // processing step 25: validate and transform input
        // processing step 26: validate and transform input
        // processing step 27: validate and transform input
        // processing step 28: validate and transform input
        // processing step 29: validate and transform input
        // processing step 30: validate and transform input
        // processing step 31: validate and transform input
        // processing step 32: validate and transform input
        // processing step 33: validate and transform input
        // processing step 34: validate and transform input
        // processing step 35: validate and transform input
        // processing step 36: validate and transform input
        // processing step 37: validate and transform input
        // processing step 38: validate and transform input
        // processing step 39: validate and transform input
        // processing step 40: validate and transform input
        // processing step 41: validate and transform input
        // processing step 42: validate and transform input
        // processing step 43: validate and transform input
        // processing step 44: validate and transform input
        // processing step 45: validate and transform input
        // processing step 46: validate and transform input
        // processing step 47: validate and transform input
        // processing step 48: validate and transform input
        // processing step 49: validate and transform input
        // processing step 50: validate and transform input
        // processing step 51: validate and transform input
        // processing step 52: validate and transform input
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
sing step 6: validate and transform input
          // processing step 7: validate and transform input
          // processing step 8: validate and transform input
          // processing step 9: validate and transform input
          // processing step 10: validate and transform input
          // processing step 11: validate and transform input
          // processing step 12: validate and transform input
          // processing step 13: validate and transform input
          // processing step 14: validate and transform input
          // processing step 15: validate and transform input
          // processing step 16: validate and transform input
          // processing step 17: validate and transform input
          // processing step 18: validate and transform input
          // processing step 19: validate and transform input
          // processing step 20: validate and transform input
          // processing step 21: validate and transform input
          // processing step 22: validate and transform input
          // processing step 23: validate and transform input
          // processing step 24: validate and transform input
          // processing step 25: validate and transform input
          // processing step 26: validate and transform input
          // processing step 27: validate and transform input
          // processing step 28: validate and transform input
          // processing step 29: validate and transform input
          // processing step 30: validate and transform input
          // processing step 31: validate and transform input
          // processing step 32: validate and transform input
          // processing step 33: validate and transform input
          // processing step 34: validate and transform input
          // processing step 35: validate and transform input
          // processing step 36: validate and transform input
          // processing step 37: validate and transform input
          // processing step 38: validate and transform input
          // processing step 39: validate and transform input
          // processing step 40: validate and transform input
          // processing step 41: validate and transform input
          // processing step 42: validate and transform input
          // processing step 43: validate and transform input
          // processing step 44: validate and transform input
          // processing step 45: validate and transform input
          // processing step 46: validate and transform input
          // processing step 47: validate and transform input
          // processing step 48: validate and transform input
          // processing step 49: validate and transform input
          // processing step 50: validate and transform input
          // processing step 51: validate and transform input
          // processing step 52: validate and transform input
          // processing step 53: validate and transform input
          // processing step 54: validate and transform input
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

function _longFn_040fdf70(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}
