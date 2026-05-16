declare const useForm: (opts: unknown) => { register: (name: string, opts?: unknown) => unknown; handleSubmit: (fn: (data: unknown) => void) => (e: React.FormEvent) => void; watch: (name: string) => unknown; setValue: (name: string, value: unknown) => void; formState: { errors: Record<string, { message?: string }>; isSubmitting: boolean; isDirty: boolean } };
declare const Button: (props: { children: React.ReactNode; type?: string; disabled?: boolean; variant?: string }) => JSX.Element;
declare const Input: (props: { id?: string; type?: string; placeholder?: string; disabled?: boolean } & Record<string, unknown>) => JSX.Element;
declare const Label: (props: { htmlFor?: string; children: React.ReactNode }) => JSX.Element;
declare const ColorPicker: (props: { value?: string; onChange: (color: string) => void; disabled?: boolean }) => JSX.Element;
declare const ImageUpload: (props: { value?: string; onChange: (url: string) => void; disabled?: boolean; label?: string }) => JSX.Element;
declare const useToast: () => { toast: (opts: { title: string; variant?: string }) => void };
declare const saveBrandingPreferences: (data: unknown) => Promise<void>;

type BrandingPreferencesFormProps = {
  initialValues?: {
    primaryColor?: string;
    logoUrl?: string;
    companyName?: string;
    supportEmail?: string;
  };
};

export function BrandingPreferencesForm({ initialValues }: BrandingPreferencesFormProps) {
  const { toast } = useToast();
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting, isDirty } } = useForm({
    defaultValues: initialValues,
  });

  const primaryColor = watch('primaryColor') as string | undefined;
  const logoUrl = watch('logoUrl') as string | undefined;

  const onSubmit = handleSubmit(async (data) => {
    try {
      await saveBrandingPreferences(data);
      toast({ title: 'Branding preferences saved' });
    } catch {
      toast({ title: 'Failed to save preferences', variant: 'destructive' });
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="company-name">Company name</Label>
        <Input
          id="company-name"
          placeholder="Acme Corp"
          disabled={isSubmitting}
          {...register('companyName')}
        />
        {errors.companyName && (
          <p className="text-xs text-destructive">{errors.companyName.message}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="support-email">Support email</Label>
        <Input
          id="support-email"
          type="email"
          placeholder="support@acmecorp.com"
          disabled={isSubmitting}
          {...register('supportEmail')}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Brand color</Label>
        <ColorPicker
          value={primaryColor}
          onChange={(color) => setValue('primaryColor', color)}
          disabled={isSubmitting}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Company logo</Label>
        <ImageUpload
          value={logoUrl}
          onChange={(url) => setValue('logoUrl', url)}
          disabled={isSubmitting}
          label="Upload logo"
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? 'Saving...' : 'Save preferences'}
        </Button>
      </div>
    </form>
  );
}
