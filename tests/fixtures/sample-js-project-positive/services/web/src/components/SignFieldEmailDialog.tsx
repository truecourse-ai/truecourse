
declare function useState<T>(init: T): [T, (v: T) => void];
declare const useForm: (opts: any) => any;
declare const zodResolver: (schema: any) => any;
declare const z: any;
declare const Dialog: any;
declare const DialogContent: any;
declare const DialogHeader: any;
declare const DialogTitle: any;
declare const DialogFooter: any;
declare const Form: any;
declare const FormField: any;
declare const FormItem: any;
declare const FormLabel: any;
declare const FormControl: any;
declare const FormMessage: any;
declare const Input: any;
declare const Button: any;

const ZSignEmailFieldSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

type SignFieldEmailDialogProps = {
  open: boolean;
  fieldId: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (email: string, fieldId: string) => Promise<void>;
};

export const SignFieldEmailDialog = ({
  open,
  fieldId,
  onOpenChange,
  onSubmit,
}: SignFieldEmailDialogProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm({
    resolver: zodResolver(ZSignEmailFieldSchema),
    defaultValues: { email: '' },
  });

  const handleSubmit = form.handleSubmit(async (values: { email: string }) => {
    setIsSubmitting(true);

    try {
      await onSubmit(values.email, fieldId);
      form.reset();
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Enter Email Address</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }: { field: any }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="name@company.com"
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>

              <Button type="submit" loading={isSubmitting}>
                Confirm
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
