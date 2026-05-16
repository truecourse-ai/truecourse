
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useFieldArray(opts: any): { fields: any[]; append: (v: any) => void; remove: (i: number) => void; move: (from: number, to: number) => void };
declare const useForm: (opts: any) => any;
declare const zodResolver: (schema: any) => any;
declare const z: any;
declare const cn: (...args: any[]) => string;
declare const Form: any;
declare const FormField: any;
declare const FormItem: any;
declare const FormLabel: any;
declare const FormControl: any;
declare const FormMessage: any;
declare const Input: any;
declare const Button: any;
declare const Select: any;
declare const SelectContent: any;
declare const SelectItem: any;
declare const SelectTrigger: any;
declare const SelectValue: any;
declare const GripVertical: any;
declare const Trash2: any;
declare const UserPlus: any;

const ZRecipientSchema = z.object({
  name: z.string().min(1, 'Name required').max(100),
  email: z.string().email('Valid email required'),
  role: z.enum(['SIGNER', 'VIEWER', 'APPROVER', 'CC']),
  signingOrder: z.number().int().min(1).optional(),
});

const ZEnvelopeRecipientsSchema = z.object({
  recipients: z.array(ZRecipientSchema).min(1, 'At least one recipient is required'),
  enforceSigningOrder: z.boolean(),
});

type EnvelopeRecipientsFormValues = z.infer<typeof ZEnvelopeRecipientsSchema>;

type EnvelopeEditorRecipientFormProps = {
  envelopeId: string;
  defaultValues?: Partial<EnvelopeRecipientsFormValues>;
  onSubmit: (values: EnvelopeRecipientsFormValues) => Promise<void>;
  onBack?: () => void;
};

export const EnvelopeEditorRecipientForm = ({
  envelopeId,
  defaultValues,
  onSubmit,
  onBack,
}: EnvelopeEditorRecipientFormProps) => {
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm({
    resolver: zodResolver(ZEnvelopeRecipientsSchema),
    defaultValues: {
      recipients: [{ name: '', email: '', role: 'SIGNER' }],
      enforceSigningOrder: false,
      ...defaultValues,
    },
  });

  const { fields, append, remove, move } = useFieldArray({
    control: form.control,
    name: 'recipients',
  });

  const enforceSigningOrder = form.watch('enforceSigningOrder');

  const handleSubmit = form.handleSubmit(async (values: EnvelopeRecipientsFormValues) => {
    setIsSaving(true);
    try {
      await onSubmit(values);
    } finally {
      setIsSaving(false);
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-3">
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="group flex items-start gap-2 rounded-lg border p-4"
            >
              {enforceSigningOrder && (
                <div className="flex flex-col items-center gap-1 pt-6">
                  <button
                    type="button"
                    onClick={() => move(index, Math.max(0, index - 1))}
                    className="cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="Move up"
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                </div>
              )}

              <div className="flex-1 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name={`recipients.${index}.name`}
                  render={({ field: inputField }: { field: any }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Full name" {...inputField} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name={`recipients.${index}.email`}
                  render={({ field: inputField }: { field: any }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="name@company.com" {...inputField} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name={`recipients.${index}.role`}
                  render={({ field: selectField }: { field: any }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select
                        value={selectField.value}
                        onValueChange={selectField.onChange}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="SIGNER">Signer</SelectItem>
                          <SelectItem value="VIEWER">Viewer</SelectItem>
                          <SelectItem value="APPROVER">Approver</SelectItem>
                          <SelectItem value="CC">CC</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn('mt-6 shrink-0', { 'opacity-0 pointer-events-none': fields.length === 1 })}
                onClick={() => remove(index)}
                disabled={fields.length === 1}
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Remove</span>
              </Button>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => append({ name: '', email: '', role: 'SIGNER' })}
        >
          <UserPlus className="mr-2 h-4 w-4" />
          Add Recipient
        </Button>

        <div className="flex justify-between pt-2">
          {onBack && (
            <Button type="button" variant="ghost" onClick={onBack}>
              Back
            </Button>
          )}
          <Button type="submit" className="ml-auto" loading={isSaving}>
            Continue
          </Button>
        </div>
      </form>
    </Form>
  );
};


// fields.map(field => ({nativeId: field.id, formId: `${field.id}-...`, ...})) — typed object map, no type mismatch
interface SignatureField {
  id: number;
  recipientItemId: string;
  page: number;
  type: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  recipientId: number;
  fieldConfig?: unknown;
}

interface EnvelopeRecipient { id: number; email: string; }

declare function parseFieldConfig(config: unknown): unknown;

export function buildFieldFormDefaults(
  fields: SignatureField[],
  recipients: EnvelopeRecipient[],
) {
  return fields.map((field) => ({
    nativeId: field.id,
    formId: `${field.id}-${field.recipientItemId}`,
    pageNumber: field.page,
    type: field.type,
    pageX: Number(field.positionX),
    pageY: Number(field.positionY),
    pageWidth: Number(field.width),
    pageHeight: Number(field.height),
    signerEmail: recipients.find((r) => r.id === field.recipientId)?.email ?? '',
    recipientId: field.recipientId,
    fieldConfig: field.fieldConfig ? parseFieldConfig(field.fieldConfig) : undefined,
  }));
}

