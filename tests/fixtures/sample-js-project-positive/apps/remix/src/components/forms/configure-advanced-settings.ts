
declare const Select: React.FC<{ value?: string; onValueChange?: (v: string) => void; disabled?: boolean; children?: React.ReactNode }>;
declare const SelectTrigger: React.FC<{ className?: string; children?: React.ReactNode }>;
declare const SelectValue: React.FC<Record<string, never>>;
declare const SelectContent: React.FC<{ children?: React.ReactNode }>;
declare const SelectItem: React.FC<{ key?: string; value: string; children?: React.ReactNode }>;
declare const FormField: React.FC<{ control: unknown; name: string; render: (props: { field: { value?: string; onChange: (v: string) => void } }) => React.ReactNode }>;
declare const FormItem: React.FC<{ children?: React.ReactNode }>;
declare const FormLabel: React.FC<{ children?: React.ReactNode }>;
declare const FormControl: React.FC<{ children?: React.ReactNode }>;
declare const FormMessage: React.FC<Record<string, never>>;

const DATE_FORMATS = [
  { key: 'iso', value: 'YYYY-MM-DD', label: 'ISO (2024-01-15)' },
  { key: 'us', value: 'MM/DD/YYYY', label: 'US (01/15/2024)' },
  { key: 'eu', value: 'DD/MM/YYYY', label: 'EU (15/01/2024)' },
];

declare const control: unknown;
declare const isSubmitting: boolean;

const DateFormatField = () => (
  <FormField
    control={control}
    name="meta.dateFormat"
    render={({ field }) => (
      <FormItem>
        <FormLabel>Date Format</FormLabel>
        <FormControl>
          <Select {...field} onValueChange={field.onChange} disabled={isSubmitting}>
            <SelectTrigger className="bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_FORMATS.map((format) => (
                <SelectItem key={format.key} value={format.value}>
                  {format.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
);



declare function useState<T>(initial: T): [T, React.Dispatch<React.SetStateAction<T>>];
declare const Textarea: React.FC<{ id?: string; className?: string; disabled?: boolean; value?: string; onChange?: React.ChangeEventHandler<HTMLTextAreaElement> }>;
declare const FormField: React.FC<{ control: unknown; name: string; render: (props: { field: { value?: string; onChange: (v: string) => void } }) => React.ReactNode }>;
declare const FormItem: React.FC<{ children?: React.ReactNode }>;
declare const FormLabel: React.FC<{ children?: React.ReactNode }>;
declare const FormControl: React.FC<{ children?: React.ReactNode }>;

declare const control: unknown;
declare const isSubmitting: boolean;
declare function setValue(field: string, value: unknown): void;

type EmailSettings = { subject?: string; body?: string; cc?: string[] };

declare const emailSettings: EmailSettings | undefined;

const EmailBodyField = () => (
  <FormField
    control={control}
    name="meta.emailBody"
    render={({ field }) => (
      <FormItem>
        <FormLabel>Email Body</FormLabel>
        <FormControl>
          <Textarea
            id="body"
            className="mt-2 h-32 resize-none bg-background"
            disabled={isSubmitting}
            {...field}
          />
        </FormControl>
      </FormItem>
    )}
  />
);

function handleEmailSettingsChange(value: EmailSettings) {
  setValue('meta.emailSettings', value);
}
