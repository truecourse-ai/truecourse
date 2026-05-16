// SelectionForm — uses shared UI primitives from the @sample/ui library
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@sample/ui/primitives/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@sample/ui/primitives/select';
import { Input } from '@sample/ui/primitives/input';

declare const useSelectionForm: () => {
  control: unknown;
  handleSubmit: (cb: (data: { label: string; optionId: string }) => void) => (e: unknown) => void;
  formState: { errors: Record<string, { message?: string }> };
};

declare const options: Array<{ id: string; label: string }>;

export function SelectionForm({ onSubmit }: { onSubmit: (data: { label: string; optionId: string }) => void }): JSX.Element {
  const form = useSelectionForm();

  return (
    <Form {...(form as any)}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control as any}
          name="label"
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>Label</FormLabel>
              <FormControl>
                <Input placeholder="Enter label" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control as any}
          name="optionId"
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>Option</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an option" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {options.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}
