
declare function useState<T>(init: T): [T, (v: T) => void];
declare const useForm: (opts: any) => any;
declare const zodResolver: (schema: any) => any;
declare const z: any;
declare const Dialog: any;
declare const DialogContent: any;
declare const DialogHeader: any;
declare const DialogTitle: any;
declare const DialogDescription: any;
declare const DialogFooter: any;
declare const Form: any;
declare const FormField: any;
declare const FormItem: any;
declare const FormLabel: any;
declare const FormControl: any;
declare const FormMessage: any;
declare const Checkbox: any;
declare const Button: any;

const ZCheckboxFieldSchema = z.object({
  checked: z.boolean().refine((v) => v === true, {
    message: 'You must check this field to continue',
  }),
});

type SignFieldCheckboxDialogProps = {
  open: boolean;
  fieldLabel: string;
  fieldId: string;
  onOpenChange: (open: boolean) => void;
  onSign: (fieldId: string) => Promise<void>;
};

export const SignFieldCheckboxDialog = ({
  open,
  fieldLabel,
  fieldId,
  onOpenChange,
  onSign,
}: SignFieldCheckboxDialogProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm({
    resolver: zodResolver(ZCheckboxFieldSchema),
    defaultValues: { checked: false },
  });

  const handleSubmit = form.handleSubmit(async () => {
    setIsSubmitting(true);
    try {
      await onSign(fieldId);
      form.reset();
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Confirm Checkbox Field</DialogTitle>
          <DialogDescription>
            Check the box below to sign this field.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="checked"
              render={({ field }: { field: any }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>{fieldLabel || 'I agree'}</FormLabel>
                    <FormMessage />
                  </div>
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
                Sign
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
