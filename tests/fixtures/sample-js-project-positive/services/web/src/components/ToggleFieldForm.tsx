// ToggleFieldForm — shared UI primitives imported from the monorepo UI library
// @sample/ui is a shared library package, not a bounded service
declare const useFieldForm: (schema: unknown) => { control: unknown; handleSubmit: (cb: (v: unknown) => void) => (e: unknown) => void };
declare const zodResolver: (schema: unknown) => unknown;
declare const ZToggleFieldMeta: { pick: (keys: Record<string, boolean>) => unknown };
declare const DEFAULT_FIELD_SIZE: number;
declare type TToggleFieldMeta = { label: string; required: boolean; readOnly: boolean; fontSize: number };

// Imports from @sample/ui/primitives/* — shared UI library subpath (not a bounded service)
declare const Alert: (props: { children: unknown }) => JSX.Element;
declare const AlertDescription: (props: { children: unknown }) => JSX.Element;
declare const Toggle: (props: { checked: boolean; onChange: () => void; label?: string }) => JSX.Element;
declare const Form: (props: { children: unknown; onSubmit?: (e: unknown) => void }) => JSX.Element;
declare const FormControl: (props: { children: unknown }) => JSX.Element;
declare const FormField: (props: { name: string; control: unknown; render: (args: { field: unknown }) => JSX.Element }) => JSX.Element;
declare const FormItem: (props: { children: unknown }) => JSX.Element;
declare const FormLabel: (props: { children: unknown }) => JSX.Element;
declare const FormMessage: (props?: Record<string, unknown>) => JSX.Element;
declare const Input: (props: { placeholder?: string; value?: string; onChange?: () => void }) => JSX.Element;
declare const Select: (props: { children: unknown; onValueChange?: (v: string) => void }) => JSX.Element;
declare const SelectContent: (props: { children: unknown }) => JSX.Element;
declare const SelectItem: (props: { value: string; children: unknown }) => JSX.Element;
declare const SelectTrigger: (props: { children: unknown }) => JSX.Element;
declare const SelectValue: (props?: { placeholder?: string }) => JSX.Element;
declare const Separator: (props?: Record<string, unknown>) => JSX.Element;

// The following named imports from @sample/ui/primitives/form mirror the
// @app/ui/primitives/form pattern — shared UI library subpath
const { Form: FormComponent, FormControl: FC, FormField: FF, FormItem: FI, FormLabel: FL, FormMessage: FM } = {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
};

export function ToggleFieldForm({ onSave }: { onSave: (meta: TToggleFieldMeta) => void }): JSX.Element {
  const form = useFieldForm(zodResolver(ZToggleFieldMeta.pick({ label: true, required: true, readOnly: true, fontSize: true })));

  const handleSubmit = form.handleSubmit((values: unknown) => {
    onSave(values as TToggleFieldMeta);
  });

  return (
    <FormComponent onSubmit={handleSubmit}>
      <FF
        name="label"
        control={form.control}
        render={({ field }) => (
          <FI>
            <FL>Label</FL>
            <FC>
              <Input {...(field as Record<string, unknown>)} placeholder="Toggle label" />
            </FC>
            <FM />
          </FI>
        )}
      />
      <FF
        name="fontSize"
        control={form.control}
        render={({ field }) => (
          <FI>
            <FL>Font size</FL>
            <FC>
              <Select onValueChange={(v: string) => { void v; }}>
                <SelectTrigger>
                  <SelectValue placeholder={String(DEFAULT_FIELD_SIZE)} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="12">12</SelectItem>
                  <SelectItem value="14">14</SelectItem>
                  <SelectItem value="16">16</SelectItem>
                </SelectContent>
              </Select>
            </FC>
            <FM />
          </FI>
        )}
      />
      <Separator />
      <Alert>
        <AlertDescription>Shared UI primitives from @sample/ui monorepo package.</AlertDescription>
      </Alert>
    </FormComponent>
  );
}
