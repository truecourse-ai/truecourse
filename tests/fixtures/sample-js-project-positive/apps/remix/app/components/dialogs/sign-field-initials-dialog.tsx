
declare const Dialog4: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void; children?: React.ReactNode }>;
declare const DialogContent4: React.FC<{ children?: React.ReactNode }>;
declare const DialogHeader4: React.FC<{ children?: React.ReactNode }>;
declare const DialogTitle4: React.FC<{ children?: React.ReactNode }>;
declare const DialogDescription4: React.FC<{ children?: React.ReactNode }>;
declare const DialogFooter4: React.FC<{ children?: React.ReactNode }>;
declare const Form4: React.FC<{ children?: React.ReactNode }>;
declare const FormControl4: React.FC<{ children?: React.ReactNode }>;
declare const FormField4: React.FC<{ control: unknown; name: string; render: (opts: { field: unknown }) => React.ReactNode }>;
declare const FormItem4: React.FC<{ children?: React.ReactNode }>;
declare const FormLabel4: React.FC<{ children?: React.ReactNode }>;
declare const FormMessage4: React.FC<{ children?: React.ReactNode }>;
declare const Input4: React.FC<{ placeholder?: string; autoFocus?: boolean; [key: string]: unknown }>;
declare const Button4: React.FC<{ type?: string; variant?: string; children?: React.ReactNode }>;
declare const useForm4: <T>(opts: unknown) => { handleSubmit: (fn: (data: T) => void) => React.FormEventHandler; control: unknown; formState: { isSubmitting: boolean } };
declare const zodResolver4: (schema: unknown) => unknown;
declare const z4: { object: (s: Record<string, unknown>) => unknown; string: () => { min: (n: number, opts?: unknown) => unknown } };
declare const createCallable4: <P, R>(fn: (opts: { call: { end: (v: R) => void } } & P) => React.ReactNode) => unknown;
declare const React: { FC: unknown; ReactNode: unknown; FormEventHandler: unknown };

const ZSignaturePinFormSchema = z4.object({
  pin: z4.string().min(4, { message: 'PIN must be at least 4 characters' }),
});

type TSignaturePinFormSchema = { pin: string };

type SignaturePinDialogProps = {
  label?: string;
};

export const SignaturePinDialog = (createCallable4 as <P, R>(fn: (opts: { call: { end: (v: R) => void } } & P) => React.ReactNode) => unknown)<SignaturePinDialogProps, string | null>(({ call }) => {
  const form = useForm4<TSignaturePinFormSchema>({
    resolver: zodResolver4(ZSignaturePinFormSchema),
    defaultValues: { pin: '' },
  });

  return (
    <Dialog4 open={true} onOpenChange={(open) => (!open ? call.end(null) : undefined)}>
      <DialogContent4>
        <DialogHeader4>
          <DialogTitle4>Enter PIN</DialogTitle4>
          <DialogDescription4 className="mt-4">
            Please enter your signature PIN to proceed.
          </DialogDescription4>
        </DialogHeader4>

        <Form4>
          <form
            onSubmit={form.handleSubmit(({ pin }) => {
              call.end(pin);
            })}
          >
            <fieldset disabled={form.formState.isSubmitting} className="flex flex-col space-y-4">
              <FormField4
                control={form.control}
                name="pin"
                render={({ field }) => (
                  <FormItem4>
                    <FormLabel4>PIN</FormLabel4>
                    <FormControl4>
                      <Input4 placeholder="••••" autoFocus {...(field as object)} />
                    </FormControl4>
                    <FormMessage4 />
                  </FormItem4>
                )}
              />

              <DialogFooter4>
                <Button4 type="button" variant="secondary" onClick={() => call.end(null)}>Cancel</Button4>
                <Button4 type="submit">Confirm</Button4>
              </DialogFooter4>
            </fieldset>
          </form>
        </Form4>
      </DialogContent4>
    </Dialog4>
  );
}) as unknown;



// FP shape: newValues is a copy of values spread from state; index comes from a .map() callback index
// passed to an explicit handler for that element. The index always corresponds to a valid element of newValues.
declare function useState<T>(initial: T): [T, (v: T) => void];
declare function useCallback<T extends Function>(fn: T, deps: unknown[]): T;

function CheckboxOptionList({ initialValues }: { initialValues: Array<{ label: string; checked: boolean }> }) {
  const [values, setValues] = useState(initialValues);

  const handleToggle = useCallback(
    (index: number) => {
      const newValues = [...values];
      newValues[index] = { ...newValues[index], checked: !newValues[index].checked };
      setValues(newValues);
    },
    [values],
  );

  return values.map((item, index) => ({ item, onToggle: () => handleToggle(index) }));
}
