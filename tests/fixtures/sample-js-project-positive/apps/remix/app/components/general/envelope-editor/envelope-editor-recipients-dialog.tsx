
// FP: React dialog form component — JSX structure and hooks inflate line count
declare const Tooltip: React.FC<{ children: React.ReactNode }>;
declare const TooltipTrigger: React.FC<{ asChild?: boolean; children: React.ReactNode }>;
declare const TooltipContent: React.FC<{ children: React.ReactNode }>;
declare const FormLabel: React.FC<{ children: React.ReactNode; className?: string }>;
declare const FormControl: React.FC<{ children: React.ReactNode }>;
declare const FormMessage: React.FC<{ children?: React.ReactNode }>;
declare const FormField: React.FC<{ control: unknown; name: string; render: (opts: { field: unknown }) => React.ReactNode }>;
declare const FormItem: React.FC<{ children: React.ReactNode }>;
declare const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement> & { className?: string }>;
declare const RecipientsEmailCheckboxes: React.FC<{ value: unknown; onChange: (v: unknown) => void }>;
declare const RecipientEmailMessageHelper: React.FC;
declare const matchTab: <T>(tab: string, matchers: Record<string, () => T>) => T;

type RecipientEmailTabProps = {
  form: { setValue: (name: string, value: unknown) => void; watch: (name: string) => unknown };
  activeTab: string;
  emailSettings: unknown;
};

function RecipientEmailTab({ form, activeTab, emailSettings }: RecipientEmailTabProps) {
  return (
    <>
      {matchTab(activeTab, {
        email: () => (
          <>
            <FormField
              control={form}
              name="meta.subject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Subject
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="ml-1 cursor-help text-muted-foreground">(?)</span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <RecipientEmailMessageHelper />
                      </TooltipContent>
                    </Tooltip>
                  </FormLabel>

                  <FormControl>
                    <Textarea className="h-16 resize-none bg-background" {...(field as object)} />
                  </FormControl>

                  <FormMessage />
                </FormItem>
              )}
            />

            <RecipientsEmailCheckboxes
              value={emailSettings}
              onChange={(value) => form.setValue('meta.emailSettings', value)}
            />
          </>
        ),
        default: () => null,
      })}
    </>
  );
}
