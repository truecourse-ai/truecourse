
declare function useState<T>(init: T): [T, (v: T) => void];
declare const useForm: (opts: any) => any;
declare const zodResolver: (schema: any) => any;
declare const z: any;
declare const useMutation: (opts: any) => { mutateAsync: (...a: any[]) => Promise<any>; isPending: boolean };
declare const useToast: () => { toast: (opts: any) => void };
declare const useNavigate: () => (path: string) => void;
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

const ZCreateOrganisationSchema = z.object({
  name: z.string().min(1, 'Organisation name is required').max(100),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens'),
});

type CreateOrganisationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const OrganisationCreateDialog = ({
  open,
  onOpenChange,
}: CreateOrganisationDialogProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const form = useForm({
    resolver: zodResolver(ZCreateOrganisationSchema),
    defaultValues: { name: '', slug: '' },
  });

  const { mutateAsync: createOrg, isPending } = useMutation({
    onSuccess: (org: any) => {
      toast({ title: `Organisation "${org.name}" created` });
      onOpenChange(false);
      navigate(`/orgs/${org.slug}`);
    },
    onError: () => {
      toast({ title: 'Failed to create organisation', variant: 'destructive' });
    },
  });

  const watchName = form.watch('name');

  const handleNameBlur = () => {
    const slug = watchName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    if (!form.getValues('slug')) {
      form.setValue('slug', slug, { shouldValidate: true });
    }
  };

  const handleSubmit = form.handleSubmit(async (values: { name: string; slug: string }) => {
    await createOrg(values);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create Organisation</DialogTitle>
          <DialogDescription>
            Organisations let you manage teams and shared settings.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }: { field: any }) => (
                <FormItem>
                  <FormLabel>Organisation name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Acme Corporation"
                      {...field}
                      onBlur={() => {
                        field.onBlur();
                        handleNameBlur();
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              render={({ field }: { field: any }) => (
                <FormItem>
                  <FormLabel>Slug</FormLabel>
                  <FormControl>
                    <Input placeholder="acme-corp" {...field} />
                  </FormControl>
                  <FormDescription>
                    Used in URLs — only lowercase letters, numbers, and hyphens.
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
                Create
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
