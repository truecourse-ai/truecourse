// DateFieldForm — uses the monorepo's shared UI library for form primitives.
// @sample/ui is a public shared-ui package; importing its subpaths is NOT a
// cross-service internal import.
declare const useForm: <T>(opts: { defaultValues: T }) => { register: (name: keyof T) => object; handleSubmit: (fn: (v: T) => void) => (e: Event) => void };
declare const zodResolver: (schema: unknown) => unknown;
declare const ZDateFieldSchema: { pick: (mask: object) => unknown };
declare const DEFAULT_FONT_SIZE: number;
declare const DEFAULT_TEXT_ALIGN: string;
// This import from @sample/ui/primitives/form is the shape that triggers the rule.
// The package is a shared UI library (name ends in /ui), so the import is legitimate.
declare const Form: React.ComponentType<{ children: React.ReactNode; onSubmit: (e: Event) => void }>;
declare const FormField: React.ComponentType<{ label: string; children: React.ReactNode }>;
declare namespace React { type ComponentType<P = {}> = (props: P) => JSX.Element | null; type ReactNode = JSX.Element | string | null; }

type DateFieldFormValues = {
  fontSize: number;
  textAlign: string;
};

type DateFieldFormProps = {
  initialValues?: Partial<DateFieldFormValues>;
  onSubmit: (values: DateFieldFormValues) => void;
};

export function DateFieldForm({ initialValues, onSubmit }: DateFieldFormProps): JSX.Element {
  const form = useForm<DateFieldFormValues>({
    defaultValues: {
      fontSize: initialValues?.fontSize ?? DEFAULT_FONT_SIZE,
      textAlign: initialValues?.textAlign ?? DEFAULT_TEXT_ALIGN,
    },
  });

  return (
    <Form onSubmit={form.handleSubmit(onSubmit) as unknown as (e: Event) => void}>
      <FormField label="Font Size">
        <input type="number" {...form.register('fontSize')} />
      </FormField>
      <FormField label="Text Align">
        <input type="text" {...form.register('textAlign')} />
      </FormField>
    </Form>
  );
}



// Shape: validationErrors.filter(error => error.includes('keyword')) returning string[] — correct types
declare function validateAmountField(value: string, meta?: { min?: number; max?: number }): string[];

type AmountErrors = {
  isNumber: string[];
  required: string[];
  minValue: string[];
  maxValue: string[];
};

export function computeAmountErrors(value: string, meta?: { min?: number; max?: number }): AmountErrors {
  const validationErrors = validateAmountField(value, meta);
  return {
    isNumber: validationErrors.filter((error) => error.includes('valid number')),
    required: validationErrors.filter((error) => error.includes('required')),
    minValue: validationErrors.filter((error) => error.includes('minimum value')),
    maxValue: validationErrors.filter((error) => error.includes('maximum value')),
  };
}
