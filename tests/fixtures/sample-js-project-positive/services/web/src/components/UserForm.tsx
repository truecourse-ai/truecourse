export function UserForm(): JSX.Element {
  return <div><input readOnly /><input readOnly /></div>;
}



// --- cross-service-internal-import / shared-ui-library-subpath FP fixture ---
// Imports from @sample/ui/components/field are false positives: the package
// is a public shared UI library in the monorepo, not an internal service layer.
declare const FieldTooltip: React.ComponentType<{ fieldId: string; required?: boolean; children?: React.ReactNode }>;
declare const FormField: React.ComponentType<{ name: string; label: string; children?: React.ReactNode }>;
declare const TextInput: React.ComponentType<{ id: string; value: string; onChange: (val: string) => void; placeholder?: string }>;
declare const SelectInput: React.ComponentType<{ id: string; value: string; onChange: (val: string) => void; options: { value: string; label: string }[] }>;
declare const SubmitButton: React.ComponentType<{ disabled?: boolean; children?: React.ReactNode }>;

export type ContractSigningFormProps = {
  contractId: string;
  recipientEmail: string;
  fields: Array<{ id: string; type: string; required: boolean; label: string }>;
  isRecipientsTurn: boolean;
  onSubmit: (data: Record<string, string>) => Promise<void>;
  isSubmitting: boolean;
};

export function ContractSigningForm({
  contractId,
  recipientEmail,
  fields,
  isRecipientsTurn,
  onSubmit,
  isSubmitting,
}: ContractSigningFormProps): JSX.Element {
  const requiredFields = fields.filter((f) => f.required);
  const optionalFields = fields.filter((f) => !f.required);

  const handleSubmit = async (formData: Record<string, string>) => {
    const missingRequired = requiredFields.filter((f) => !formData[f.id]);
    if (missingRequired.length > 0) {
      return;
    }
    await onSubmit(formData);
  };

  return (
    <div className="contract-signing-form">
      {requiredFields.map((field) => (
        <FormField key={field.id} name={field.id} label={field.label}>
          <FieldTooltip fieldId={field.id} required>
            <TextInput
              id={field.id}
              value=""
              onChange={() => {}}
              placeholder={`Enter ${field.label}`}
            />
          </FieldTooltip>
        </FormField>
      ))}
      {optionalFields.map((field) => (
        <FormField key={field.id} name={field.id} label={field.label}>
          <FieldTooltip fieldId={field.id}>
            <TextInput
              id={field.id}
              value=""
              onChange={() => {}}
              placeholder={`Enter ${field.label} (optional)`}
            />
          </FieldTooltip>
        </FormField>
      ))}
      <SubmitButton disabled={!isRecipientsTurn || isSubmitting}>
        {isSubmitting ? 'Submitting...' : 'Sign Contract'}
      </SubmitButton>
    </div>
  );
}



// Shared UI library utility import — triggers cross-service-internal-import FP
// because @sample/ui/lib/utils is a public shared-ui package, not an internal service
import { cn } from '@sample/ui/lib/utils';

declare function cn(...classes: (string | undefined | null | false)[]): string;

export interface ProfileCardProps {
  className?: string;
  label: string;
  value: string;
  highlighted?: boolean;
}

export function ProfileCard({ className, label, value, highlighted }: ProfileCardProps): JSX.Element {
  return (
    <div className={cn('rounded border p-4', highlighted && 'border-blue-500 bg-blue-50', className)}>
      <span className={cn('block text-xs font-medium text-gray-500')}>{label}</span>
      <span className={cn('mt-1 block text-sm text-gray-900')}>{value}</span>
    </div>
  );
}



// FP shape fbe23406885a — import from shared UI library subpath (@scope/ui/lib/utils)
// The rule fires on the deep subpath import but this is a public shared-ui package, not an internal service.
import { cn } from '@acme/ui/lib/utils';
import { Button } from '@acme/ui/primitives/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@acme/ui/primitives/dialog';

declare const useState: <T>(init: T) => [T, (v: T) => void];
declare const useEffect: (fn: () => void, deps: unknown[]) => void;

interface TemplateField {
  id: string;
  label: string;
  value: string;
}

interface UseTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  onSubmit: (fields: TemplateField[]) => Promise<void>;
}

export function UseTemplateDialog({ open, onOpenChange, templateId, onSubmit }: UseTemplateDialogProps): JSX.Element {
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setFields([{ id: 'recipient', label: 'Recipient Email', value: '' }]);
    }
  }, [open]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit(fields);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('max-w-lg', submitting && 'pointer-events-none')}>
        <DialogHeader>
          <DialogTitle>Use Template</DialogTitle>
        </DialogHeader>
        <div className={cn('space-y-4', 'py-2')}>
          {fields.map((field) => (
            <div key={field.id} className="flex flex-col gap-1">
              <label className="text-sm font-medium">{field.label}</label>
              <input
                className={cn('border rounded px-2 py-1', !field.value && 'border-red-400')}
                value={field.value}
                readOnly
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>Apply Template</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



// FP: Array.map() over typed array to render form fields — standard React pattern
declare const FormField: (props: { name: string; label: string; required?: boolean }) => JSX.Element;
declare const fieldDefinitions: Array<{ name: string; label: string; required: boolean }>;

function SettingsForm() {
  return (
    <div>
      {fieldDefinitions.map((def, index) => (
        <FormField key={index} name={def.name} label={def.label} required={def.required} />
      ))}
    </div>
  );
}



// FP: useState initialized with map() producing strings — valid expression
declare function useState<T>(initial: T): [T, (v: T) => void];
declare const options: Array<{ id: number; selected: boolean; label: string }>;

const [selectedLabels, setSelectedLabels] = useState(
  options
    .map((item) => (item.selected ? item.label : ''))
    .filter(Boolean),
);



// FP: SelectItem value with localized label — standard i18n usage
declare function SelectItem(props: { value: string; children: string }): JSX.Element;
declare function _(descriptor: unknown): string;
declare const VISIBILITY_OPTIONS: { EVERYONE: { value: string }; TEAM_ONLY: { value: string } };
declare enum DocumentVisibility { EVERYONE = 'EVERYONE', TEAM_ONLY = 'TEAM_ONLY' }

function VisibilitySelect() {
  return (
    <div>
      <SelectItem value={DocumentVisibility.EVERYONE}>{_(VISIBILITY_OPTIONS.EVERYONE.value)}</SelectItem>
      <SelectItem value={DocumentVisibility.TEAM_ONLY}>{_(VISIBILITY_OPTIONS.TEAM_ONLY.value)}</SelectItem>
    </div>
  );
}



// FP: React.forwardRef wrapping a div — standard forwardRef pattern
declare namespace React {
  function forwardRef<T, P>(render: (props: P, ref: unknown) => JSX.Element): (props: P & { ref?: unknown }) => JSX.Element;
  type ElementRef<T> = T extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[T] : never;
  type ComponentPropsWithoutRef<T> = Record<string, unknown>;
}

const PinSlot = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'> & { isActive?: boolean; char?: string }
>(({ isActive, char, ...props }, ref) => (
  <div ref={ref} {...props}>
    {char}
  </div>
));



// FP: SelectItem value with enum prop — standard enum usage
declare function SelectItem(props: { value: string; children: unknown }): JSX.Element;
declare enum TemplateType { PRIVATE = 'PRIVATE', PUBLIC = 'PUBLIC', SHARED = 'SHARED' }

function TemplateTypeSelect() {
  return (
    <div>
      <SelectItem value={TemplateType.PRIVATE}>Private</SelectItem>
      <SelectItem value={TemplateType.PUBLIC}>Public</SelectItem>
      <SelectItem value={TemplateType.SHARED}>Shared</SelectItem>
    </div>
  );
}



// FP: forwardRef with complex generic intersection type — standard shadcn/ui pattern
declare namespace React {
  function forwardRef<T, P>(render: (props: P, ref: unknown) => JSX.Element): unknown;
  type ElementRef<T> = HTMLElement;
  type ComponentPropsWithoutRef<T> = Record<string, unknown>;
}
declare const MenuPrimitive: {
  SubTrigger: unknown;
};

const MenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.SubTrigger> & { inset?: boolean }
>(({ inset, ...props }, ref) => (
  <div ref={ref} data-inset={inset} {...props} />
));



// FP: forwardRef with VariantProps intersection — standard shadcn/ui toast pattern
declare namespace React {
  function forwardRef<T, P>(render: (props: P, ref: unknown) => JSX.Element): unknown;
  type ElementRef<T> = HTMLElement;
  type ComponentPropsWithoutRef<T> = Record<string, unknown>;
}
declare const NotificationPrimitive: { Root: unknown };
declare type VariantProps<T> = { variant?: 'default' | 'error' | 'success' };
declare const cn: (...args: (string | undefined)[]) => string;
declare const notificationVariants: (opts: { variant?: string }) => string;

const Notification = React.forwardRef<
  React.ElementRef<typeof NotificationPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof NotificationPrimitive.Root> & VariantProps<typeof notificationVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} className={cn(notificationVariants({ variant }), className as string)} {...props} />
));



// FP: cn() with CVA variants and className — idiomatic cn() usage
declare const cn: (...args: (string | undefined | null | boolean)[]) => string;
declare const alertVariants: (opts: { variant?: string }) => string;

interface AlertProps { className?: string; variant?: 'default' | 'destructive'; children?: unknown }

function Alert({ className, variant, ...props }: AlertProps) {
  return <div className={cn(alertVariants({ variant }), className)} {...props} />;
}



// FP: form.handleSubmit(onSubmit) — react-hook-form pattern; handleSubmit returns SubmitHandler
declare const form: {
  handleSubmit: (handler: (data: { label: string; url: string }) => Promise<void>) => (e: Event) => void;
  control: unknown;
};

async function onSubmit(data: { label: string; url: string }) {
  console.log(data.label, data.url);
}

function AttachmentForm() {
  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <button type="submit">Save</button>
    </form>
  );
}



declare function useState<T>(initial: T): [T, (value: T) => void];

export function ConfirmDeleteDialog(): JSX.Element {
  const [reason, setReason] = useState('');

  return (
    <div>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </div>
  );
}



declare const useFormController: <T>(opts: { defaults: T; onSubmit: (values: T) => Promise<void> }) => {
  values: T;
  errors: Record<string, string | undefined>;
  isSubmitting: boolean;
  handleChange: (field: keyof T) => (event: { target: { value: string } }) => void;
  handleSubmit: (event: { preventDefault: () => void }) => void;
  reset: () => void;
};
declare const useFlashMessage: () => { success: (text: string) => void; error: (text: string) => void };
declare const useRouterNavigate: () => (path: string) => Promise<void>;
declare const accountApi: { changeEmail(input: { token: string; nextEmail: string; repeatedEmail: string }): Promise<void> };
declare const classNames: (...parts: (string | undefined | false)[]) => string;

export type ChangeEmailFormValues = {
  nextEmail: string;
  repeatedEmail: string;
};

export type ChangeEmailFormProps = {
  className?: string;
  confirmationToken: string;
};

export const ChangeEmailForm = ({ className, confirmationToken }: ChangeEmailFormProps): JSX.Element => {
  const navigate = useRouterNavigate();
  const flash = useFlashMessage();

  const controller = useFormController<ChangeEmailFormValues>({
    defaults: {
      nextEmail: '',
      repeatedEmail: '',
    },
    onSubmit: async ({ nextEmail, repeatedEmail }) => {
      try {
        if (nextEmail !== repeatedEmail) {
          flash.error('The two email addresses do not match.');
          return;
        }

        await accountApi.changeEmail({
          token: confirmationToken,
          nextEmail,
          repeatedEmail,
        });

        await navigate('/account/settings');

        controller.reset();

        flash.success('Your email address has been updated.');
      } catch (caught) {
        const description =
          caught instanceof Error && caught.message
            ? caught.message
            : 'We could not update your email address right now. Please try again later.';

        flash.error(description);
      }
    },
  });

  const isSubmitting = controller.isSubmitting;
  const nextEmailError = controller.errors.nextEmail;
  const repeatedEmailError = controller.errors.repeatedEmail;

  return (
    <form
      className={classNames('flex w-full flex-col gap-y-4', className)}
      onSubmit={controller.handleSubmit}
    >
      <fieldset className="flex w-full flex-col gap-y-4" disabled={isSubmitting}>
        <div className="flex flex-col gap-y-1">
          <label htmlFor="next-email" className="text-sm font-medium">
            <span>New email address</span>
          </label>
          <input
            id="next-email"
            type="email"
            autoComplete="email"
            value={controller.values.nextEmail}
            onChange={controller.handleChange('nextEmail')}
            className="rounded border px-3 py-2"
          />
          {nextEmailError ? (
            <p className="text-destructive text-xs">{nextEmailError}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-y-1">
          <label htmlFor="repeated-email" className="text-sm font-medium">
            <span>Confirm new email address</span>
          </label>
          <input
            id="repeated-email"
            type="email"
            autoComplete="email"
            value={controller.values.repeatedEmail}
            onChange={controller.handleChange('repeatedEmail')}
            className="rounded border px-3 py-2"
          />
          {repeatedEmailError ? (
            <p className="text-destructive text-xs">{repeatedEmailError}</p>
          ) : null}
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={isSubmitting}
        className="bg-primary text-primary-foreground rounded-md px-4 py-2"
      >
        {isSubmitting ? <span>Updating email...</span> : <span>Update email</span>}
      </button>
    </form>
  );
};
