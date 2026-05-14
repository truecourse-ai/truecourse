declare const useState: <T>(initial: T) => [T, (next: T) => void];
declare const useEffect: (effect: () => void, deps: unknown[]) => void;
declare const useToast: () => { toast: (opts: { title: string; description: string; duration?: number; variant?: string }) => void };
declare const useForm: <T>(opts: { defaultValues: T; resolver?: unknown }) => {
  control: unknown;
  handleSubmit: (cb: (values: T) => Promise<void> | void) => (e?: unknown) => void;
  formState: { isSubmitting: boolean };
  reset: () => void;
};
declare const zodResolver: (schema: unknown) => unknown;
declare function confirmPayment(args: { paymentId: string; methodIds: number[] }): Promise<void>;

declare const Dialog: any;
declare const DialogTrigger: any;
declare const DialogContent: any;
declare const DialogHeader: any;
declare const DialogTitle: any;
declare const DialogDescription: any;
declare const DialogFooter: any;
declare const DialogClose: any;
declare const Form: any;
declare const FormField: any;
declare const FormItem: any;
declare const FormLabel: any;
declare const FormControl: any;
declare const Checkbox: any;
declare const Button: any;
declare const MethodAvatar: any;

declare const ZPaymentConfirmFormSchema: unknown;

type PaymentMethodLite = {
  id: number;
  label: string;
  status: 'PENDING' | 'CONFIRMED';
  brand: string;
};

type PaymentConfirmDialogProps = {
  payment: {
    id: string;
    status: 'OPEN' | 'PENDING' | 'COMPLETED';
    methods: PaymentMethodLite[];
  };
  trigger?: JSX.Element;
};

type TPaymentConfirmFormSchema = { methods: number[] };

export const PaymentConfirmDialog = ({ payment, trigger }: PaymentConfirmDialogProps) => {
  const methods = payment.methods;

  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);

  const form = useForm<TPaymentConfirmFormSchema>({
    defaultValues: {
      methods: [],
    },
    resolver: zodResolver(ZPaymentConfirmFormSchema),
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = form;

  const onFormSubmit = async ({ methods: selected }: TPaymentConfirmFormSchema) => {
    try {
      await confirmPayment({ paymentId: payment.id, methodIds: selected });

      toast({
        title: 'Payment confirmed',
        description: 'Your payment has been confirmed successfully.',
        duration: 5000,
      });

      setIsOpen(false);
    } catch (err) {
      toast({
        title: 'Something went wrong',
        description: 'This payment could not be confirmed at this time. Please try again.',
        variant: 'destructive',
        duration: 7500,
      });
    }
  };

  useEffect(() => {
    if (!isOpen) {
      form.reset();
    }
  }, [isOpen]);

  if (payment.status !== 'PENDING') {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="max-w-md" hideClose>
        <DialogHeader>
          <DialogTitle>Confirm payment</DialogTitle>

          <DialogDescription>
            Approve the following payment methods to release the funds.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit(onFormSubmit)}>
            <fieldset disabled={isSubmitting}>
              <FormField
                control={form.control}
                name="methods"
                render={({ field: { value, onChange } }: { field: { value: number[]; onChange: (next: number[]) => void } }) => (
                  <>
                    {methods
                      .filter((method) => method.status === 'PENDING')
                      .map((method) => (
                        <FormItem
                          key={method.id}
                          className="flex flex-row items-center justify-between gap-x-3 px-3"
                        >
                          <FormLabel
                            className={value.includes(method.id) ? 'my-2 flex items-center gap-2 font-normal' : 'my-2 flex items-center gap-2 font-normal opacity-50'}
                          >
                            <MethodAvatar
                              key={method.id}
                              brand={method.brand}
                              fallbackText={method.label.slice(0, 2)}
                            />
                            {method.label}
                          </FormLabel>

                          <FormControl>
                            <Checkbox
                              className="h-5 w-5 rounded-full"
                              value={method.id}
                              checked={value.includes(method.id)}
                              onCheckedChange={(checked: boolean) =>
                                checked
                                  ? onChange([...value, method.id])
                                  : onChange(value.filter((v) => v !== method.id))
                              }
                            />
                          </FormControl>
                        </FormItem>
                      ))}
                  </>
                )}
              />

              <DialogFooter className="mt-4">
                <DialogClose asChild>
                  <Button type="button" variant="secondary" disabled={isSubmitting}>
                    Cancel
                  </Button>
                </DialogClose>

                <Button loading={isSubmitting} type="submit">
                  Confirm
                </Button>
              </DialogFooter>
            </fieldset>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
