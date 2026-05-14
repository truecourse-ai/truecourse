
declare const useNavigate2: () => (path: string) => Promise<void>;
declare const useCurrentOrganisation7: () => { id: number; name: string; url: string };
declare const useSession7: () => { refreshSession: () => Promise<void> };
declare const useLingui11: () => { _: (msg: unknown) => string };
declare const useToast2: () => { toast: (opts: { title: string; description?: string; duration?: number; variant?: string }) => void };
declare const useForm2: (opts: unknown) => { handleSubmit: (fn: (data: unknown) => void) => (e: unknown) => void; control: unknown; reset: (vals: unknown) => void; formState: { isSubmitting: boolean }; setError: (field: string, opts: unknown) => void };
declare const zodResolver2: (schema: unknown) => unknown;
declare const trpc7: { organisation: { update: { useMutation: () => { mutateAsync: (opts: unknown) => Promise<unknown> } } } };
declare const ZOrganisationUpdateFormSchema2: unknown;
declare const AppError4: { parseError: (err: unknown) => { code: string } };
declare const AppErrorCode4: { ALREADY_EXISTS: string };
declare const Form2: React.FC<{ form: unknown; children?: React.ReactNode }>;
declare const FormField2: React.FC<{ control: unknown; name: string; render: (opts: { field: unknown }) => React.ReactNode }>;
declare const FormItem2: React.FC<{ children?: React.ReactNode }>;
declare const FormLabel2: React.FC<{ children?: React.ReactNode }>;
declare const FormControl2: React.FC<{ children?: React.ReactNode }>;
declare const FormMessage2: React.FC<{}>;
declare const Input3: React.FC<{ placeholder?: string; disabled?: boolean; value?: string; onChange?: (e: { target: { value: string } }) => void }>;
declare const Button10: React.FC<{ type?: string; loading?: boolean; children?: React.ReactNode }>;
declare const msg7: (strings: TemplateStringsArray) => unknown;
declare const React: { FC: unknown; ReactNode: unknown };

export const OrganisationUpdateForm2 = () => {
  const navigate = useNavigate2();
  const organisation = useCurrentOrganisation7();
  const { refreshSession } = useSession7();
  const { _ } = useLingui11();
  const { toast } = useToast2();

  const form = useForm2({
    resolver: zodResolver2(ZOrganisationUpdateFormSchema2),
    defaultValues: {
      name: organisation.name,
      url: organisation.url,
    },
  });

  const { mutateAsync: updateOrganisation } = trpc7.organisation.update.useMutation();

  const onFormSubmit = async ({ name, url }: { name: string; url: string }) => {
    try {
      await updateOrganisation({
        data: { name, url },
        organisationId: organisation.id,
      });

      await refreshSession();

      if (url !== organisation.url) {
        await navigate(`/o/${url}/settings`);
      }

      toast({
        title: _(msg7`Success`),
        description: _(msg7`Your organisation has been successfully updated.`),
        duration: 5000,
      });

      form.reset({ name, url });
    } catch (err) {
      const error = AppError4.parseError(err);

      if (error.code === AppErrorCode4.ALREADY_EXISTS) {
        form.setError('url', {
          type: 'manual',
          message: _(msg7`This URL is already in use.`),
        });
        return;
      }

      toast({
        title: _(msg7`An unknown error occurred`),
        description: _(msg7`We encountered an unknown error while attempting to update your organisation. Please try again later.`),
        variant: 'destructive',
      });
    }
  };

  return (
    <Form2 form={form}>
      <form onSubmit={form.handleSubmit(onFormSubmit)}>
        <fieldset className="flex h-full flex-col" disabled={form.formState.isSubmitting}>
          <FormField2
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem2>
                <FormLabel2>Organisation Name</FormLabel2>
                <FormControl2>
                  <Input3 placeholder="Acme Inc." {...(field as object)} />
                </FormControl2>
                <FormMessage2 />
              </FormItem2>
            )}
          />

          <FormField2
            control={form.control}
            name="url"
            render={({ field }) => (
              <FormItem2>
                <FormLabel2>Organisation URL</FormLabel2>
                <FormControl2>
                  <Input3 placeholder="acme" {...(field as object)} />
                </FormControl2>
                <FormMessage2 />
              </FormItem2>
            )}
          />

          <Button10 type="submit" loading={form.formState.isSubmitting}>
            Save changes
          </Button10>
        </fieldset>
      </form>
    </Form2>
  );
};
