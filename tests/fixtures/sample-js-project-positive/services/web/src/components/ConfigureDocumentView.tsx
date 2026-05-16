
declare function useState<T>(init: T): [T, (v: T) => void];
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
declare const Switch: any;
declare const Button: any;
declare const DatePicker: any;
declare const Separator: any;

const ZConfigureDocumentSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  expiresAt: z.date().nullable(),
  sendReminders: z.boolean(),
  reminderDays: z.number().int().min(1).max(30).optional(),
  requireSigningOrder: z.boolean(),
  allowComments: z.boolean(),
});

type ConfigureDocumentValues = z.infer<typeof ZConfigureDocumentSchema>;

type ConfigureDocumentViewProps = {
  documentId: string;
  defaultValues: Partial<ConfigureDocumentValues>;
  onSave: (values: ConfigureDocumentValues) => Promise<void>;
};

export const ConfigureDocumentView = ({
  documentId,
  defaultValues,
  onSave,
}: ConfigureDocumentViewProps) => {
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm({
    resolver: zodResolver(ZConfigureDocumentSchema),
    defaultValues: {
      title: '',
      expiresAt: null,
      sendReminders: false,
      requireSigningOrder: false,
      allowComments: true,
      ...defaultValues,
    },
  });

  const sendReminders = form.watch('sendReminders');

  const handleSubmit = form.handleSubmit(async (values: ConfigureDocumentValues) => {
    setIsSaving(true);
    try {
      await onSave(values);
    } finally {
      setIsSaving(false);
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <FormField
          control={form.control}
          name="title"
          render={({ field }: { field: any }) => (
            <FormItem>
              <FormLabel>Document title</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Service Agreement" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="expiresAt"
          render={({ field }: { field: any }) => (
            <FormItem>
              <FormLabel>Expiry date</FormLabel>
              <FormControl>
                <DatePicker
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="No expiry"
                  clearable
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Separator />

        <div className="space-y-4">
          <FormField
            control={form.control}
            name="sendReminders"
            render={({ field }: { field: any }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div>
                  <FormLabel className="text-sm font-medium">Send reminders</FormLabel>
                  <p className="text-xs text-muted-foreground">
                    Automatically remind signers who haven\'t signed yet.
                  </p>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />

          {sendReminders && (
            <FormField
              control={form.control}
              name="reminderDays"
              render={({ field }: { field: any }) => (
                <FormItem className="ml-4">
                  <FormLabel>Reminder frequency (days)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={30}
                      {...field}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        field.onChange(Number(e.target.value))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="requireSigningOrder"
            render={({ field }: { field: any }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div>
                  <FormLabel className="text-sm font-medium">Enforce signing order</FormLabel>
                  <p className="text-xs text-muted-foreground">
                    Recipients must sign in the specified order.
                  </p>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end">
          <Button type="submit" loading={isSaving}>
            Save changes
          </Button>
        </div>
      </form>
    </Form>
  );
};


// --- argument-type-mismatch FP: tRPC useMutation with onSuccess callback ---
// trpc.report.update.useMutation({ onSuccess }) — standard tRPC React pattern; no type mismatch.
declare const trpcUtils: { report: { get: { setData(key: object, updater: (old: any) => any): void } } };
declare const trpc2: {
  report: {
    update: {
      useMutation(opts: {
        onSuccess(newData: { id: string; title: string; status: string }): void;
      }): { mutateAsync(input: { id: string; title: string }): Promise<{ id: string; title: string; status: string }> };
    };
  };
};
declare const initialReport: { id: string; title: string; status: string };

function useReportEditor() {
  const { mutateAsync: updateReport } = trpc2.report.update.useMutation({
    onSuccess(newData) {
      trpcUtils.report.get.setData(
        { reportId: initialReport.id },
        (oldData: any) => ({ ...(oldData || initialReport), ...newData }),
      );
    },
  });

  return { updateReport };
}

