
declare namespace React {
  function forwardRef<T, P>(render: (props: P, ref: React.Ref<T>) => React.ReactElement | null): React.ForwardRefExoticComponent<React.PropsWithoutRef<P> & React.RefAttributes<T>>;
  type Ref<T> = { current: T | null };
  type ReactElement = { type: unknown; props: unknown; key: unknown };
  type ForwardRefExoticComponent<P> = { (props: P): ReactElement | null; displayName?: string };
  type PropsWithoutRef<P> = Omit<P, 'ref'>;
  type RefAttributes<T> = { ref?: Ref<T> };
}
declare type SecureInputProps = Omit<React.HTMLAttributes<HTMLInputElement>, 'type'>;
declare function cn(...classes: unknown[]): string;

const SecureInput = React.forwardRef<HTMLInputElement, SecureInputProps>(({ className, ...props }, ref) => {
  return {
    type: 'input',
    props: { type: 'password', className: cn('border rounded', className), ref, ...props },
    key: null,
  };
});



declare const React: { useCallback: <T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]) => T };
declare const emptyIndicator: string | undefined;
declare const onSearch: ((query: string) => Promise<void>) | undefined;
declare const creatable: boolean;
declare const options: Record<string, unknown>;
declare function CommandItem(props: { value: string; disabled?: boolean; children: unknown }): unknown;
declare function CommandEmpty(props: { children: unknown }): unknown;

const EmptyItem = React.useCallback(() => {
  if (!emptyIndicator) {
    return undefined;
  }

  if (onSearch && !creatable && Object.keys(options).length === 0) {
    return CommandItem({ value: '-', disabled: true, children: emptyIndicator });
  }

  return CommandEmpty({ children: emptyIndicator });
}, [creatable, emptyIndicator, onSearch, options]);



declare const form: { handleSubmit: <T>(handler: (data: T) => Promise<void>) => (event: Event) => void; formState: { isSubmitting: boolean } };
declare function onProfileSubmit(data: { displayName: string; bio: string }): Promise<void>;

function ProfileEditForm() {
  return {
    tag: 'form',
    props: { onSubmit: form.handleSubmit(onProfileSubmit) },
  };
}



declare const itemForm: { handleSubmit: <T>(handler: (data: T) => Promise<void>) => (event: Event) => void; formState: { isSubmitting: boolean } };
declare function onItemFormSubmit(data: { title: string; description: string }): Promise<void>;

function ItemEditForm() {
  return {
    tag: 'form',
    props: { onSubmit: itemForm.handleSubmit(onItemFormSubmit) },
  };
}



// --- argument-type-mismatch FP: conditional guard in onChange handler ---
declare function useControlledSelect(): {
  field: { onChange: (value: string) => void; value: string };
};

function NotificationPreferenceSelect() {
  const { field } = useControlledSelect();
  return (
    <SelectRoot
      onValueChange={(value) => value && field.onChange(value)}
      value={field.value}
    />
  );
}

declare function SelectRoot(props: {
  onValueChange?: (value: string) => void;
  value?: string;
}): JSX.Element;



// --- argument-type-mismatch FP: SelectItem value prop receiving enum value ---
declare function SelectItem(props: { value: string; children?: React.ReactNode }): JSX.Element;
declare const React: { ReactNode: unknown };

enum WorkspaceType {
  PERSONAL = 'personal',
  TEAM = 'team',
  ORGANISATION = 'organisation',
}

function WorkspaceTypeSelector() {
  return (
    <div>
      <SelectItem value={WorkspaceType.PERSONAL}>Personal</SelectItem>
      <SelectItem value={WorkspaceType.TEAM}>Team</SelectItem>
      <SelectItem value={WorkspaceType.ORGANISATION}>Organisation</SelectItem>
    </div>
  );
}



// --- argument-type-mismatch FP: cn() spread with className and {...props} in JSX ---
declare function cn(...inputs: (string | undefined | null | boolean)[]): string;

function NavSidebarDesktop({
  className,
  ...props
}: { className?: string; 'aria-label'?: string }) {
  return (
    <nav
      className={cn(
        'hidden md:flex h-screen w-64 flex-col border-r bg-background px-4 py-6',
        className,
      )}
      {...props}
    />
  );
}



// --- argument-type-mismatch FP: onChange handler with typed cast on input event value ---
declare function useState<T>(init: T): [T, (v: T) => void];

type ViewMode = 'list' | 'grid' | 'calendar';

function ViewModeSelector() {
  const [mode, setMode] = useState<ViewMode>('list');

  return (
    <select onChange={(e) => setMode(e.target.value as ViewMode)} value={mode}>
      <option value="list">List</option>
      <option value="grid">Grid</option>
      <option value="calendar">Calendar</option>
    </select>
  );
}



// --- argument-type-mismatch FP: JSX button with spread HTMLButtonElement props ---
interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isLoading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
}

declare const React: { ButtonHTMLAttributes: <T>(el: T) => unknown };

function IconButton({ isLoading, variant = 'primary', ...props }: IconButtonProps) {
  const isDisabled = isLoading || props.disabled;
  return <button {...props} disabled={isDisabled} data-variant={variant} />;
}



// --- argument-type-mismatch FP: short-circuit && returning boolean|void in React onChange ---
declare function useState<T>(init: T): [T, (v: T) => void];

function LockedNameInput({
  isLocked,
  initialValue,
}: {
  isLocked: boolean;
  initialValue: string;
}) {
  const [fullName, setFullName] = useState(initialValue);

  return (
    <input
      value={fullName}
      onChange={(e) => !isLocked && setFullName(e.target.value)}
      readOnly={isLocked}
    />
  );
}



// --- void-zero-argument FP shape: event-handler-callback-promise-discard (form.trigger) ---
// void form.trigger() is intentional promise-discard for react-hook-form validation trigger
declare const checkboxForm: { trigger: (field?: string) => Promise<boolean> };

function CheckboxValidationField({ label }: { label: string }) {
  return (
    <input
      type="checkbox"
      onChange={() => void checkboxForm.trigger('acceptTerms')}
      aria-label={label}
    />
  );
}
