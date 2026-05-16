
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useFieldArray(opts: any): { fields: any[]; append: (v: any) => void; remove: (i: number) => void };
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
declare const Trash2: any;
declare const UserPlus: any;

const ZPlaceholderRecipientSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  role: z.enum(['SIGNER', 'VIEWER', 'APPROVER']),
});

const ZPlaceholderRecipientsFormSchema = z.object({
  recipients: z.array(ZPlaceholderRecipientSchema).min(1, 'At least one recipient required'),
});

type PlaceholderRecipientsFormValues = z.infer<typeof ZPlaceholderRecipientsFormSchema>;

type AddTemplatePlaceholderRecipientsProps = {
  templateId: string;
  initialRecipients?: PlaceholderRecipientsFormValues['recipients'];
  onSubmit: (values: PlaceholderRecipientsFormValues) => Promise<void>;
  onBack?: () => void;
};

export const AddTemplatePlaceholderRecipients = ({
  templateId,
  initialRecipients,
  onSubmit,
  onBack,
}: AddTemplatePlaceholderRecipientsProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm({
    resolver: zodResolver(ZPlaceholderRecipientsFormSchema),
    defaultValues: {
      recipients: initialRecipients ?? [{ name: '', role: 'SIGNER' }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'recipients',
  });

  const handleSubmit = form.handleSubmit(async (values: PlaceholderRecipientsFormValues) => {
    setIsSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setIsSubmitting(false);
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4">
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-end"
            >
              <FormField
                control={form.control}
                name={`recipients.${index}.name`}
                render={({ field: inputField }: { field: any }) => (
                  <FormItem className="flex-1">
                    <FormLabel>Recipient name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Customer" {...inputField} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`recipients.${index}.role`}
                render={({ field: selectField }: { field: any }) => (
                  <FormItem className="w-40">
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
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn('shrink-0', { 'opacity-0 pointer-events-none': fields.length === 1 })}
                onClick={() => remove(index)}
                disabled={fields.length === 1}
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Remove recipient</span>
              </Button>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => append({ name: '', role: 'SIGNER' })}
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

          <Button type="submit" className="ml-auto" loading={isSubmitting}>
            Save Recipients
          </Button>
        </div>
      </form>
    </Form>
  );
};
