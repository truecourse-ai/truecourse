// ContactForm — uses shared UI primitives from the monorepo UI library
declare const useForm: <T>(opts: { resolver: unknown; mode: string; defaultValues: Partial<T> }) => { handleSubmit: (fn: (data: T) => void) => (e: unknown) => void; register: (name: keyof T) => object; formState: { errors: Partial<Record<keyof T, { message?: string }>> } };
declare const zodResolver: (schema: unknown) => unknown;
declare const z: { object: (shape: object) => { parse: (v: unknown) => unknown }; string: () => { email: () => unknown; optional: () => unknown }; infer: <T>(schema: T) => T };
declare const Form: React.FC<{ form: ReturnType<typeof useForm<ContactFormValues>>; onSubmit: (data: ContactFormValues) => void; children: React.ReactNode }>;
declare const FormField: React.FC<{ name: string; label: string; registration: object; error?: string }>;

const ZContactFormSchema = {
  email: true as unknown,
  fullName: true as unknown,
};

type ContactFormValues = {
  email: string;
  fullName: string;
};

type ContactFormProps = {
  defaultEmail?: string;
  onSubmit: (values: ContactFormValues) => void;
};

export const ContactForm = ({ defaultEmail = '', onSubmit }: ContactFormProps) => {
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(ZContactFormSchema),
    mode: 'onChange',
    defaultValues: {
      email: defaultEmail,
      fullName: '',
    },
  });

  return (
    <Form form={form} onSubmit={onSubmit}>
      <FormField
        name="fullName"
        label="Full Name"
        registration={form.register('fullName')}
        error={form.formState.errors.fullName?.message}
      />
      <FormField
        name="email"
        label="Email Address"
        registration={form.register('email')}
        error={form.formState.errors.email?.message}
      />
    </Form>
  );
};
