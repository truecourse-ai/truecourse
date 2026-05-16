
declare function useState<T>(init: T): [T, (v: T) => void];
declare const useForm: (opts: any) => any;
declare const zodResolver: (schema: any) => any;
declare const z: any;
declare const cn: (...args: any[]) => string;
declare const Form: any;
declare const FormField: any;
declare const FormItem: any;
declare const FormLabel: any;
declare const FormControl: any;
declare const FormMessage: any;
declare const FormDescription: any;
declare const Input: any;
declare const Switch: any;
declare const Textarea: any;
declare const Select: any;
declare const SelectContent: any;
declare const SelectItem: any;
declare const SelectTrigger: any;
declare const SelectValue: any;
declare const Button: any;
declare const Separator: any;

const ZFieldAdvancedSettingsSchema = z.object({
  label: z.string().max(200).optional(),
  placeholder: z.string().max(200).optional(),
  tooltip: z.string().max(500).optional(),
  required: z.boolean(),
  readOnly: z.boolean(),
  defaultValue: z.string().max(500).optional(),
  validationRegex: z.string().optional(),
  dateFormat: z.string().optional(),
  fontSize: z.enum(['sm', 'md', 'lg']).optional(),
});

type FieldAdvancedSettingsValues = z.infer<typeof ZFieldAdvancedSettingsSchema>;

type FieldItemAdvancedSettingsProps = {
  fieldId: string;
  fieldType: string;
  defaultValues?: Partial<FieldAdvancedSettingsValues>;
  onSave: (values: FieldAdvancedSettingsValues) => Promise<void>;
  onClose: () => void;
};

export const FieldItemAdvancedSettings = ({
  fieldId,
  fieldType,
  defaultValues,
  onSave,
  onClose,
}: FieldItemAdvancedSettingsProps) => {
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm({
    resolver: zodResolver(ZFieldAdvancedSettingsSchema),
    defaultValues: {
      required: true,
      readOnly: false,
      fontSize: 'md',
      ...defaultValues,
    },
  });

  const handleSubmit = form.handleSubmit(async (values: FieldAdvancedSettingsValues) => {
    setIsSaving(true);
    try {
      await onSave(values);
      onClose();
    } finally {
      setIsSaving(false);
    }
  });

  const showDateFormat = fieldType === 'DATE';
  const showValidation = ['TEXT', 'EMAIL', 'PHONE'].includes(fieldType);

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="space-y-4 p-4">
        <FormField
          control={form.control}
          name="label"
          render={({ field }: { field: any }) => (
            <FormItem>
              <FormLabel>Field label</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Full legal name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="placeholder"
          render={({ field }: { field: any }) => (
            <FormItem>
              <FormLabel>Placeholder text</FormLabel>
              <FormControl>
                <Input placeholder="Shown when field is empty" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="tooltip"
          render={({ field }: { field: any }) => (
            <FormItem>
              <FormLabel>Tooltip</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Instruction shown on hover"
                  rows={2}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Separator />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="required"
            render={({ field }: { field: any }) => (
              <FormItem className="flex items-center justify-between rounded border p-3">
                <div>
                  <FormLabel className="text-sm">Required</FormLabel>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="readOnly"
            render={({ field }: { field: any }) => (
              <FormItem className="flex items-center justify-between rounded border p-3">
                <div>
                  <FormLabel className="text-sm">Read-only</FormLabel>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        {showDateFormat && (
          <FormField
            control={form.control}
            name="dateFormat"
            render={({ field }: { field: any }) => (
              <FormItem>
                <FormLabel>Date format</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                    <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                    <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={isSaving}>
            Save
          </Button>
        </div>
      </form>
    </Form>
  );
};


// --- argument-type-mismatch FP: field.value.find() with optional chaining and fallback ---
// selectedGroups.find((v) => v.groupId === groupId)?.role — type-safe optional chain, no type mismatch.
declare const groupRoleField: { value: Array<{ groupId: string; role: string }> };
type GroupRole = 'ADMIN' | 'MEMBER' | 'VIEWER';

export function getSelectedGroupRole(groupId: string): GroupRole {
  return (groupRoleField.value.find((v) => v.groupId === groupId)?.role as GroupRole) || 'MEMBER';
}



// --- argument-type-mismatch FP: Array.includes() checking config key string against literal array ---
// ['characterLimit', 'minLength'].includes(key) — valid includes() call with a string literal, no type mismatch.
type FieldSettingKey = 'characterLimit' | 'minLength' | 'pattern' | 'placeholder' | 'defaultValue';

export function extractNumericSetting(
  key: FieldSettingKey,
  value: string | number | boolean,
): number | undefined {
  if (['characterLimit', 'minLength'].includes(key)) {
    const parsed = Number(value);
    return isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}



// --- argument-type-mismatch FP: string[].filter((msg) => msg.includes('character limit')) ---
// validationErrors is string[]; .filter(msg => msg.includes(...)) is correct string array usage.
declare function validateSignatureField(
  text: string,
  rules: { minLength?: number; maxLength?: number },
  strict: boolean
): string[];
declare const signatureText: string;
declare const signatureRules: { minLength?: number; maxLength?: number };

export function categorizeSignatureErrors(): { required: string[]; tooLong: string[] } {
  const errors = validateSignatureField(signatureText, signatureRules, true);
  return {
    required: errors.filter((msg) => msg.includes('required')),
    tooLong: errors.filter((msg) => msg.includes('character limit')),
  };
}



// --- unchecked-array-access FP: enum-exhaustive Record lookup via Object.values() iteration ---
// FIELD_AUTH_TYPES is a Record keyed by FieldAccessAuth enum; authType comes from
// Object.values(FieldAccessAuth) — enum-exhaustive, so [authType] is always valid.
enum FieldAccessAuth { NONE = 'NONE', REQUIRE_ACCOUNT = 'REQUIRE_ACCOUNT', REQUIRE_2FA = 'REQUIRE_2FA', PASSKEY = 'PASSKEY' }

interface FieldAuthConfig { label: string; description: string; requiresSetup: boolean }

const FIELD_AUTH_TYPES = {
  [FieldAccessAuth.NONE]: { label: 'No authentication', description: 'Anyone can sign', requiresSetup: false },
  [FieldAccessAuth.REQUIRE_ACCOUNT]: { label: 'Require account', description: 'Must be signed in', requiresSetup: false },
  [FieldAccessAuth.REQUIRE_2FA]: { label: 'Two-factor auth', description: 'Must verify via 2FA', requiresSetup: true },
  [FieldAccessAuth.PASSKEY]: { label: 'Passkey', description: 'Must use a passkey', requiresSetup: true },
} satisfies Record<FieldAccessAuth, FieldAuthConfig>;

export function getFieldAuthOptions(excludeSetupRequired: boolean): Array<{ value: FieldAccessAuth; label: string }> {
  return (Object.values(FieldAccessAuth) as FieldAccessAuth[])
    .filter((authType) => !excludeSetupRequired || !FIELD_AUTH_TYPES[authType].requiresSetup)
    .map((authType) => ({ value: authType, label: FIELD_AUTH_TYPES[authType].label }));
}



// --- magic-string FP: textAlign: 'left' in CSS default state object ---
// textAlign: 'left' is a CSS text-alignment value in a typed default state — not a magic string.
type TextAlignValue = 'left' | 'center' | 'right';
type AnnotationType = 'text' | 'initials' | 'name' | 'email' | 'date';

interface AnnotationMeta {
  type: AnnotationType;
  fontSize: number;
  textAlign: TextAlignValue;
}

function getAnnotationDefaultState(annotationType: AnnotationType): AnnotationMeta {
  switch (annotationType) {
    case 'initials':
      return { type: 'initials', fontSize: 14, textAlign: 'left' };
    case 'name':
      return { type: 'name', fontSize: 14, textAlign: 'left' };
    case 'email':
      return { type: 'email', fontSize: 12, textAlign: 'left' };
    default:
      return { type: 'text', fontSize: 14, textAlign: 'left' };
  }
}

