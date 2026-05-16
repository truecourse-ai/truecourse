
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

function _syntheticLongFunction() {
  const _step0 = 0 + 1; // processing step 0
  const _step1 = 1 + 1; // processing step 1
  const _step2 = 2 + 1; // processing step 2
  const _step3 = 3 + 1; // processing step 3
  const _step4 = 4 + 1; // processing step 4
  const _step5 = 5 + 1; // processing step 5
  const _step6 = 6 + 1; // processing step 6
  const _step7 = 7 + 1; // processing step 7
  const _step8 = 8 + 1; // processing step 8
  const _step9 = 9 + 1; // processing step 9
  const _step10 = 10 + 1; // processing step 10
  const _step11 = 11 + 1; // processing step 11
  const _step12 = 12 + 1; // processing step 12
  const _step13 = 13 + 1; // processing step 13
  const _step14 = 14 + 1; // processing step 14
  const _step15 = 15 + 1; // processing step 15
  const _step16 = 16 + 1; // processing step 16
  const _step17 = 17 + 1; // processing step 17
  const _step18 = 18 + 1; // processing step 18
  const _step19 = 19 + 1; // processing step 19
  const _step20 = 20 + 1; // processing step 20
  const _step21 = 21 + 1; // processing step 21
  const _step22 = 22 + 1; // processing step 22
  const _step23 = 23 + 1; // processing step 23
  const _step24 = 24 + 1; // processing step 24
  const _step25 = 25 + 1; // processing step 25
  const _step26 = 26 + 1; // processing step 26
  const _step27 = 27 + 1; // processing step 27
  const _step28 = 28 + 1; // processing step 28
  const _step29 = 29 + 1; // processing step 29
  const _step30 = 30 + 1; // processing step 30
  const _step31 = 31 + 1; // processing step 31
  const _step32 = 32 + 1; // processing step 32
  const _step33 = 33 + 1; // processing step 33
  const _step34 = 34 + 1; // processing step 34
  const _step35 = 35 + 1; // processing step 35
  const _step36 = 36 + 1; // processing step 36
  const _step37 = 37 + 1; // processing step 37
  const _step38 = 38 + 1; // processing step 38
  const _step39 = 39 + 1; // processing step 39
  const _step40 = 40 + 1; // processing step 40
  const _step41 = 41 + 1; // processing step 41
  const _step42 = 42 + 1; // processing step 42
  const _step43 = 43 + 1; // processing step 43
  const _step44 = 44 + 1; // processing step 44
  const _step45 = 45 + 1; // processing step 45
  const _step46 = 46 + 1; // processing step 46
  const _step47 = 47 + 1; // processing step 47
  const _step48 = 48 + 1; // processing step 48
  const _step49 = 49 + 1; // processing step 49
  const _step50 = 50 + 1; // processing step 50
  const _step51 = 51 + 1; // processing step 51
  const _step52 = 52 + 1; // processing step 52
  const _step53 = 53 + 1; // processing step 53
  const _step54 = 54 + 1; // processing step 54
}


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


// Destructuring value from SignaturePad onChange event object — correctly typed prop, no argument type mismatch
declare function useState<T>(init: T): [T, (v: T) => void];
declare function SignaturePadWidget(props: {
  onChange: (event: { value: string; isEmpty: boolean }) => void;
  placeholder?: string;
  className?: string;
}): JSX.Element;

function InitialsCapturePad() {
  const [capturedInitials, setCapturedInitials] = useState<string>('');

  return (
    <SignaturePadWidget
      onChange={({ value }) => setCapturedInitials(value)}
      placeholder="Draw your initials"
      className="w-full h-32 rounded-md border"
    />
  );
}

