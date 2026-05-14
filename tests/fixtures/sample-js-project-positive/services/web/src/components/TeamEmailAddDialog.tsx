
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
declare const FormDescription: any;
declare const Input: any;
declare const Button: any;

const ZAddTeamEmailSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  displayName: z.string().min(1, 'Display name is required').max(80),
});

type TeamEmailAddDialogProps = {
  open: boolean;
  teamId: string;
  onOpenChange: (open: boolean) => void;
  onAdded?: () => void;
};

export const TeamEmailAddDialog = ({
  open,
  teamId,
  onOpenChange,
  onAdded,
}: TeamEmailAddDialogProps) => {
  const { toast } = useToast();

  const form = useForm({
    resolver: zodResolver(ZAddTeamEmailSchema),
    defaultValues: { email: '', displayName: '' },
  });

  const { mutateAsync: addEmail, isPending } = useMutation({
    onSuccess: () => {
      toast({ title: 'Team email added' });
      form.reset();
      onAdded?.();
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: 'Failed to add email', variant: 'destructive' });
    },
  });

  const handleSubmit = form.handleSubmit(async (values: { email: string; displayName: string }) => {
    await addEmail({ teamId, ...values });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add Team Email</DialogTitle>
          <DialogDescription>
            Add an email address that team members can send documents from.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }: { field: any }) => (
                <FormItem>
                  <FormLabel>Email address</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="team@company.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="displayName"
              render={({ field }: { field: any }) => (
                <FormItem>
                  <FormLabel>Display name</FormLabel>
                  <FormControl>
                    <Input placeholder="Acme Legal Team" {...field} />
                  </FormControl>
                  <FormDescription>
                    This name appears in the sender field of outgoing emails.
                  </FormDescription>
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
                Add Email
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
