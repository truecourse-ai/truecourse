
// FP shape fb4768575c39: form.setValue call with nested key path — no type mismatch
declare function useFormContext<T>(): { setValue: (key: keyof T | string, value: unknown) => void; control: object };
declare function FormField(props: { control: object; name: string; render: (p: { field: object }) => JSX.Element }): JSX.Element;
declare function Textarea(props: { className?: string } & Record<string, unknown>): JSX.Element;
declare function FormControl(props: { children: React.ReactNode }): JSX.Element;
declare function FormMessage(): JSX.Element;
declare function DocumentEmailCheckboxes(props: { value: object; onChange: (v: object) => void }): JSX.Element;
declare const emailSettings: object;

type SettingsForm = { meta: { emailSettings: object; messageBody?: string } };

function EmailSettingsSection() {
  const form = useFormContext<SettingsForm>();

  return (
    <>
      <FormField
        control={form.control}
        name="meta.messageBody"
        render={({ field }) => (
          <>
            <FormControl>
              <Textarea className="h-16 resize-none bg-background" {...field} />
            </FormControl>
            <FormMessage />
          </>
        )}
      />
      <DocumentEmailCheckboxes
        value={emailSettings}
        onChange={(value) => form.setValue('meta.emailSettings', value)}
      />
    </>
  );
}
