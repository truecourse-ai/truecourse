
declare const useLingui12: () => { t: (msg: unknown) => string };
declare const useState15: <T>(v: T) => [T, (v: T) => void];
declare const useForm3: (opts: unknown) => { handleSubmit: (fn: (data: unknown) => void) => (e: unknown) => void; control: unknown; formState: { isSubmitting: boolean } };
declare const zodResolver3: (schema: unknown) => unknown;
declare const match6: (v: unknown) => { with: (pattern: unknown, fn: () => unknown) => unknown; otherwise: (fn: () => unknown) => unknown };
declare const Dialog2: React.FC<{ open?: boolean; onOpenChange?: (v: boolean) => void; children?: React.ReactNode }>;
declare const DialogContent2: React.FC<{ className?: string; children?: React.ReactNode }>;
declare const DialogHeader2: React.FC<{ children?: React.ReactNode }>;
declare const DialogTitle2: React.FC<{ children?: React.ReactNode }>;
declare const Tabs6: React.FC<{ value: string; onValueChange: (v: string) => void; className?: string; children?: React.ReactNode }>;
declare const TabsList6: React.FC<{ children?: React.ReactNode }>;
declare const TabsTrigger6: React.FC<{ value: string; children?: React.ReactNode }>;
declare const FormField3: React.FC<{ control: unknown; name: string; render: (opts: { field: unknown }) => React.ReactNode }>;
declare const FormItem3: React.FC<{ children?: React.ReactNode }>;
declare const FormLabel3: React.FC<{ className?: string; children?: React.ReactNode }>;
declare const FormControl3: React.FC<{ children?: React.ReactNode }>;
declare const FormMessage3: React.FC<{}>;
declare const Select2: React.FC<{ value?: string; disabled?: boolean; onValueChange?: (v: string) => void; children?: React.ReactNode }>;
declare const SelectTrigger2: React.FC<{ className?: string; children?: React.ReactNode }>;
declare const SelectValue2: React.FC<{}>;
declare const SelectContent2: React.FC<{ children?: React.ReactNode }>;
declare const SelectItem2: React.FC<{ value: string; children?: React.ReactNode }>;
declare const MultiSelectCombobox2: React.FC<{ options: Array<{ label: string; value: string }>; selectedValues: string[]; onChange: (v: string[]) => void; className?: string; emptySelectionPlaceholder?: string }>;
declare const SUPPORTED_LANGUAGES2: Record<string, { full: string }>;
declare const DOCUMENT_SIGNATURE_TYPES2: Record<string, { label: unknown; value: string }>;
declare const DocumentSignatureSettingsTooltip2: React.FC<{}>;
declare const InfoIcon2: React.FC<{ className?: string }>;
declare const Tooltip2: React.FC<{ children?: React.ReactNode }>;
declare const TooltipTrigger2: React.FC<{ children?: React.ReactNode }>;
declare const TooltipContent2: React.FC<{ className?: string; children?: React.ReactNode }>;
declare const Trans8: React.FC<{ children?: React.ReactNode }>;
declare const React: { FC: unknown; ReactNode: unknown };

type SettingsDialogSettings2 = {
  allowConfigureLanguage?: boolean;
  allowConfigureSignatureTypes?: boolean;
};

export const EnvelopeEditorSettingsDialog2 = ({
  open,
  onOpenChange,
  settings,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: SettingsDialogSettings2;
  onSubmit: (data: unknown) => Promise<void>;
}) => {
  const { t } = useLingui12();
  const [activeTab, setActiveTab] = useState15('general');

  const form = useForm3({
    resolver: zodResolver3({}),
    defaultValues: {
      meta: {
        language: 'en',
        signatureTypes: [] as string[],
      },
    },
  });

  const onFormSubmit = async (data: unknown) => {
    await onSubmit(data);
    onOpenChange(false);
  };

  return (
    <Dialog2 open={open} onOpenChange={onOpenChange}>
      <DialogContent2 className="max-w-2xl">
        <DialogHeader2>
          <DialogTitle2>
            <Trans8>Document Settings</Trans8>
          </DialogTitle2>
        </DialogHeader2>

        <Tabs6 value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList6>
            <TabsTrigger6 value="general">
              <Trans8>General</Trans8>
            </TabsTrigger6>
            <TabsTrigger6 value="advanced">
              <Trans8>Advanced</Trans8>
            </TabsTrigger6>
          </TabsList6>

          <form onSubmit={form.handleSubmit(onFormSubmit)}>
            <fieldset
              className="flex h-[45rem] max-h-[calc(100vh-14rem)] w-full flex-col space-y-6 overflow-y-auto px-6 py-6"
              disabled={form.formState.isSubmitting}
              key={activeTab}
            >
              {match6({ activeTab, settings })
                .with({ activeTab: 'general' }, () => (
                  <>
                    {settings.allowConfigureLanguage && (
                      <FormField3
                        control={form.control}
                        name="meta.language"
                        render={({ field }) => (
                          <FormItem3>
                            <FormLabel3 className="inline-flex items-center">
                              <Trans8>Language</Trans8>
                              <Tooltip2>
                                <TooltipTrigger2>
                                  <InfoIcon2 className="mx-2 h-4 w-4" />
                                </TooltipTrigger2>
                                <TooltipContent2 className="max-w-md space-y-2 p-4 text-foreground">
                                  <Trans8>Controls the language for the document.</Trans8>
                                </TooltipContent2>
                              </Tooltip2>
                            </FormLabel3>
                            <FormControl3>
                              <Select2
                                value={(field as { value?: string }).value}
                                disabled={(field as { disabled?: boolean }).disabled}
                                onValueChange={(field as { onChange: (v: string) => void }).onChange}
                              >
                                <SelectTrigger2 className="bg-background">
                                  <SelectValue2 />
                                </SelectTrigger2>
                                <SelectContent2>
                                  {Object.entries(SUPPORTED_LANGUAGES2).map(([code, language]) => (
                                    <SelectItem2 key={code} value={code}>
                                      {t(language.full)}
                                    </SelectItem2>
                                  ))}
                                </SelectContent2>
                              </Select2>
                            </FormControl3>
                            <FormMessage3 />
                          </FormItem3>
                        )}
                      />
                    )}

                    {settings.allowConfigureSignatureTypes && (
                      <FormField3
                        control={form.control}
                        name="meta.signatureTypes"
                        render={({ field }) => (
                          <FormItem3>
                            <FormLabel3 className="flex flex-row items-center">
                              <Trans8>Allowed Signature Types</Trans8>
                              <DocumentSignatureSettingsTooltip2 />
                            </FormLabel3>
                            <FormControl3>
                              <MultiSelectCombobox2
                                options={Object.values(DOCUMENT_SIGNATURE_TYPES2).map((option) => ({
                                  label: t(option.label),
                                  value: option.value,
                                }))}
                                selectedValues={(field as { value: string[] }).value}
                                onChange={(field as { onChange: (v: string[]) => void }).onChange}
                                className="w-full bg-background"
                                emptySelectionPlaceholder="Select signature types"
                              />
                            </FormControl3>
                            <FormMessage3 />
                          </FormItem3>
                        )}
                      />
                    )}
                  </>
                ))
                .otherwise(() => null) as React.ReactNode}
            </fieldset>
          </form>
        </Tabs6>
      </DialogContent2>
    </Dialog2>
  );
};
