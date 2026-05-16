
declare function useState<T>(init: T): [T, (v: T) => void];
declare const useForm: (opts: any) => any;
declare const zodResolver: (schema: any) => any;
declare const z: any;
declare const useMutation: (opts: any) => { mutateAsync: (...a: any[]) => Promise<any>; isPending: boolean };
declare const useToast: () => { toast: (opts: any) => void };
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
declare const Input: any;
declare const Button: any;

const ZCreateEmailDomainSchema = z.object({
  domain: z
    .string()
    .min(1, 'Domain is required')
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/, 'Enter a valid domain name'),
});

type CreateEmailDomainDialogProps = {
  open: boolean;
  organisationId: string;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
};

export const CreateEmailDomainDialog = ({
  open,
  organisationId,
  onOpenChange,
  onCreated,
}: CreateEmailDomainDialogProps) => {
  const { toast } = useToast();

  const form = useForm({
    resolver: zodResolver(ZCreateEmailDomainSchema),
    defaultValues: { domain: '' },
  });

  const { mutateAsync: createDomain, isPending } = useMutation({
    onSuccess: () => {
      toast({ title: 'Email domain added' });
      form.reset();
      onCreated?.();
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: 'Failed to add domain', variant: 'destructive' });
    },
  });

  const handleSubmit = form.handleSubmit(async (values: { domain: string }) => {
    await createDomain({ organisationId, domain: values.domain });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add Email Domain</DialogTitle>
          <DialogDescription>
            Add a verified domain to send emails from your own address.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="domain"
              render={({ field }: { field: any }) => (
                <FormItem>
                  <FormLabel>Domain</FormLabel>
                  <FormControl>
                    <Input placeholder="mail.example.com" {...field} />
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
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" loading={isPending}>
                Add Domain
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
