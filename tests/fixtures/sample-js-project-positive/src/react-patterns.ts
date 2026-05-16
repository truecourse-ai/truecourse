
// Form field pattern: Select with sentinel-to-null conversion
declare const React: any;

declare const FormField: React.FC<{
  control: any;
  name: string;
  render: (props: { field: { value: string | null; onChange: (value: string | null) => void } }) => React.ReactElement;
}>;

declare const Select: React.FC<{
  value: string;
  onValueChange: (value: string) => void;
  children?: React.ReactNode;
}>;

declare const SelectTrigger: React.FC<{ children?: React.ReactNode }>;
declare const SelectValue: React.FC;
declare const SelectContent: React.FC<{ children?: React.ReactNode }>;
declare const SelectItem: React.FC<{ value: string; children?: React.ReactNode }>;

function ThemePreferencesForm() {
  const form = { control: {} as any };
  const themes = ['light', 'dark', 'auto'];

  return (
    <FormField
      control={form.control}
      name="themeId"
      render={({ field }) => (
        <Select
          value={field.value === null ? 'inherit' : field.value}
          onValueChange={(value) => field.onChange(value === 'inherit' ? null : value)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {themes.map((theme) => (
              <SelectItem key={theme} value={theme}>
                {theme}
              </SelectItem>
            ))}
            <SelectItem value="inherit">Inherit from workspace</SelectItem>
          </SelectContent>
        </Select>
      )}
    />
  );
}



// Color styling utility accepting union type
declare function getStyleClass(mode: 'readOnly' | 'active' | number): string;

interface FieldMetadata {
  readOnly?: boolean;
  priority?: number;
}

interface FormField {
  fieldMeta?: FieldMetadata;
  id: string;
}

function applyFieldStyling(field: FormField) {
  // False positive: ternary correctly returns 'readOnly' | 0, both valid for union type
  const styleClass = getStyleClass(field.fieldMeta?.readOnly ? 'readOnly' : 0);
  
  return styleClass;
}



import { forwardRef } from 'react';
import type { SelectProps } from '@radix-ui/react-select';

declare const SelectTrigger: React.FC<{ ref?: React.Ref<HTMLButtonElement>; className?: string; children?: React.ReactNode }>;
declare const SelectContent: React.FC<{ children?: React.ReactNode }>;
declare const SelectItem: React.FC<{ value: string; children?: React.ReactNode }>;

export type RoleSelectorProps = SelectProps & {
  hideAdminRole?: boolean;
  hideViewerRole?: boolean;
};

export const RoleSelector = forwardRef<HTMLButtonElement, RoleSelectorProps>(
  ({ hideAdminRole, hideViewerRole, ...props }, ref) => (
    <SelectTrigger ref={ref} className="w-[50px] bg-background p-2">
      <SelectContent>
        {!hideAdminRole && <SelectItem value="admin">Admin</SelectItem>}
        {!hideViewerRole && <SelectItem value="viewer">Viewer</SelectItem>}
        <SelectItem value="editor">Editor</SelectItem>
      </SelectContent>
    </SelectTrigger>
  ),
);

RoleSelector.displayName = 'RoleSelector';



import { forwardRef } from 'react';

declare const icons: Record<string, React.ReactNode>;

export const CheckIcon = forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>(
  ({ className, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <polyline points="20 6 9 12 4 9" />
    </svg>
  ),
);

CheckIcon.displayName = 'CheckIcon';

export const CloseIcon = forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>(
  ({ className, ...props }, ref) => (
    <svg ref={ref} viewBox="0 0 24 24" className={className} {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
);

CloseIcon.displayName = 'CloseIcon';



import { createPortal } from 'react-dom';
import { useRef } from 'react';

declare const Tooltip: React.FC<{ content: string; children: React.ReactNode }>;

type FieldOverlayProps = {
  label: string;
  containerRef: React.RefObject<HTMLElement>;
  children: React.ReactNode;
};

function FieldOverlay({ label, containerRef, children }: FieldOverlayProps) {
  if (!containerRef.current) {
    return null;
  }

  return createPortal(
    <div className="absolute inset-0 flex items-center justify-center">
      <Tooltip content={label}>
        <div className="pointer-events-auto">{children}</div>
      </Tooltip>
    </div>,
    containerRef.current,
  );
}



declare const Select: React.FC<{ value?: string; onValueChange?: (v: string) => void; children?: React.ReactNode }>;
declare const SelectTrigger: React.FC<{ className?: string; children?: React.ReactNode }>;
declare const SelectValue: React.FC<{ placeholder?: string }>;
declare const SelectContent: React.FC<{ position?: string; children?: React.ReactNode }>;
declare const SelectItem: React.FC<{ key?: string; value: string; children?: React.ReactNode }>;

type SecurityKey = { id: string; name: string; createdAt: Date };

type SecurityKeySelectorProps = {
  securityKeys: SecurityKey[];
  selectedKeyId?: string;
  onKeySelect: (keyId: string) => void;
};

function SecurityKeySelector({ securityKeys, selectedKeyId, onKeySelect }: SecurityKeySelectorProps) {
  return (
    <Select value={selectedKeyId} onValueChange={onKeySelect}>
      <SelectTrigger className="bg-background text-muted-foreground">
        <SelectValue placeholder="Select security key" />
      </SelectTrigger>
      <SelectContent position="popper">
        {securityKeys.map((key) => (
          <SelectItem key={key.id} value={key.id}>
            {key.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}



declare function cn(...classes: (string | undefined | false | null)[]): string;

type FileSelectorProps = {
  className?: string;
  isActive?: boolean;
  isError?: boolean;
  children?: React.ReactNode;
};

function FileSelector({ className, isActive, isError, children }: FileSelectorProps) {
  return (
    <div
      className={cn(
        'flex h-fit flex-shrink-0 space-x-2 overflow-x-auto p-4',
        isActive && 'border-primary',
        isError && 'border-destructive',
        className,
      )}
    >
      {children}
    </div>
  );
}



import * as React from 'react';
declare function cn(...args: (string | undefined | false | null)[]): string;

type PanelProps = React.HTMLAttributes<HTMLDivElement> & {
  elevated?: boolean;
  bordered?: boolean;
};

const Panel = React.forwardRef<HTMLDivElement, PanelProps>(
  ({ className, children, elevated = false, bordered = true, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-lg bg-background text-foreground',
        elevated && 'shadow-md',
        bordered && 'border border-border',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);

Panel.displayName = 'Panel';

const PanelHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  ),
);

PanelHeader.displayName = 'PanelHeader';



declare function getRecipientColorStyles(index: number): { comboBoxTrigger: string; badge: string };
declare function cn(...args: (string | undefined | false | null)[]): string;
declare const Button: React.FC<{ type?: string; variant?: string; role?: string; className?: string; children?: React.ReactNode }>;
declare const ChevronsUpDown: React.FC<{ className?: string }>;

type Assignee = { id: number; email: string; name?: string };

type AssigneeSelectorProps = {
  assignees: Assignee[];
  selectedAssignee?: Assignee;
  className?: string;
};

function AssigneeSelector({ assignees, selectedAssignee, className }: AssigneeSelectorProps) {
  return (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      className={cn(
        'justify-between bg-background font-normal text-muted-foreground hover:text-foreground',
        getRecipientColorStyles(assignees.findIndex((a) => a.id === selectedAssignee?.id)).comboBoxTrigger,
        className,
      )}
    >
      {selectedAssignee && (
        <span className="flex-1 truncate text-left">{selectedAssignee.name ?? selectedAssignee.email}</span>
      )}
      <ChevronsUpDown className="ml-2 h-4 w-4" />
    </Button>
  );
}



declare const Link: React.FC<{ to: string; className?: string; onClick?: () => void; children?: React.ReactNode }>;
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare function useCurrentWorkspace(): { url: string } | null;
declare const unreadCount: { count: number } | undefined;

type NavLink = { href: string; text: string };

function MobileNav({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const workspace = useCurrentWorkspace();

  const navLinks = useMemo<NavLink[]>(() => {
    if (!workspace) {
      return [{ href: '/dashboard', text: 'Dashboard' }, { href: '/settings', text: 'Settings' }];
    }
    return [
      { href: `/w/${workspace.url}`, text: 'Workspace' },
      { href: '/inbox', text: 'Inbox' },
      { href: '/settings/profile', text: 'Settings' },
    ];
  }, [workspace]);

  return (
    <nav>
      {navLinks.map(({ href, text }) => (
        <Link
          key={href}
          className="flex items-center gap-2 font-semibold text-foreground"
          to={href}
          onClick={() => onClose()}
        >
          {text}
          {href === '/inbox' && unreadCount && unreadCount.count > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-primary-foreground text-xs">
              {unreadCount.count > 99 ? '99+' : unreadCount.count}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}



// RHF render prop callbacks inside Draggable/fieldset JSX; visual indentation is JSX nesting, not function nesting
declare const useFieldArray: (opts: any) => { fields: any[]; append: (v: any) => void; remove: (i: number) => void };
declare const useFormContext: () => { control: any; formState: { errors: any; isSubmitting: boolean } };
declare const FormField: any;
declare const FormItem: any;
declare const FormControl: any;
declare const Input: any;
declare const Draggable: any;
declare const React: any;

function RecipientOrderList() {
  const { control, formState: { errors, isSubmitting } } = useFormContext();
  const { fields } = useFieldArray({ control, name: 'recipients' });

  return fields.map((recipient: any, index: number) =>
    React.createElement(Draggable, { key: recipient.id, draggableId: recipient.id, index },
      (provided: any, snapshot: any) =>
        React.createElement('fieldset', { ref: provided.innerRef, ...provided.draggableProps, disabled: isSubmitting },
          React.createElement(FormField, {
            control,
            name: `recipients.${index}.signingOrder`,
            render: ({ field }: any) =>
              React.createElement(FormItem, null,
                React.createElement(FormControl, null,
                  React.createElement(Input, { type: 'number', ...field }),
                ),
              ),
          }),
        ),
    ),
  );
}



// defensive-in-guard-narrowing: errors['assignees__root'] — defensive bracket access alongside 'in' guard for synthetic array-root error key
declare const FormErrorMessage: any;
declare const errors: Record<string, any>;

function AssigneeFormErrors() {
  return FormErrorMessage({
    className: 'mt-2',
    // Dirty hack to handle errors when .root is populated for an array type
    error: 'assignees__root' in errors && errors['assignees__root'],
  });
}



// defensive-in-guard-narrowing: errors['recipients__root'] is a synthetic form-state error key; bracket used with 'in' guard as defensive narrowing idiom
declare const FormRootError: any;
declare const recipientErrors: Record<string, any>;

function RecipientFormErrors() {
  return FormRootError({
    className: 'mt-2',
    // Defensive idiom for array-root errors populated by react-hook-form
    error: 'recipients__root' in recipientErrors && recipientErrors['recipients__root'],
  });
}



// Admin claims page search with debounce
declare function useDebouncedValue<T>(value: T, delay: number): T;
declare function useState<T>(v: T): [T, (v: T) => void];

function AdminClaimsSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 500);
  return { searchQuery, setSearchQuery, debouncedSearch };
}



// Organisation member settings search with debounce
declare function useDebouncedValue<T>(value: T, delay: number): T;
declare function useState<T>(v: T): [T, (v: T) => void];

function OrgMembersSearch() {
  const [memberQuery, setMemberQuery] = useState('');
  const debouncedMemberQuery = useDebouncedValue(memberQuery, 500);
  return { memberQuery, setMemberQuery, debouncedMemberQuery };
}



// Local time copy-to-clipboard with 1500ms feedback clear
declare function useState<T>(v: T): [T, (v: T) => void];

function useClipboardFeedback(): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const copyToClipboard = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return [copied, copyToClipboard];
}



// AI field detection dialog - 4000ms retry delay after detection attempt
declare function useState<T>(v: T): [T, (v: T) => void];
declare function detectFieldsWithAI(): Promise<void>;

function useAiDetectionWithRetry() {
  const [isDetecting, setIsDetecting] = useState(false);
  const startDetection = async () => {
    setIsDetecting(true);
    try {
      await detectFieldsWithAI();
    } finally {
      setTimeout(() => setIsDetecting(false), 4000);
    }
  };
  return { isDetecting, startDetection };
}



// Embed template client - throttle submit button at 500ms to prevent double-clicks
declare function useThrottleFn<T extends (...args: any[]) => any>(fn: T, ms: number): T;
declare function submitTemplateForm(data: object): Promise<void>;

const throttledSubmit = useThrottleFn(submitTemplateForm, 500);



// Team webhook settings - 500ms debounce on event filter search
declare function useDebouncedValue<T>(value: T, delay: number): T;
declare function useState<T>(v: T): [T, (v: T) => void];

function WebhookEventSearch() {
  const [eventFilter, setEventFilter] = useState('');
  const debouncedFilter = useDebouncedValue(eventFilter, 500);
  return { eventFilter, setEventFilter, debouncedFilter };
}



// PDF viewer scroll-to-page using MutationObserver on data attributes
declare function useEffect(fn: () => (() => void) | void, deps: any[]): void;
declare function useRef<T>(v: T): { current: T };

function useScrollToPage(containerRef: { current: HTMLElement | null }) {
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'data-scroll-to-page'
        ) {
          const target = mutation.target as HTMLElement;
          const pageNum = target.getAttribute('data-scroll-to-page');
          if (pageNum) {
            target.scrollIntoView({ behavior: 'smooth' });
          }
        }
      }
    });
    if (containerRef.current) {
      observer.observe(containerRef.current, { attributes: true, subtree: true });
    }
    return () => observer.disconnect();
  }, [containerRef]);
}



// Billing status display with Lingui i18n context strings
declare function msg(strings: TemplateStringsArray): string;
declare function useLingui(): { _: (id: string, opts?: { context?: string }) => string };

function getSubscriptionStatusLabel(status: string): string {
  const { _ } = useLingui();
  if (status === 'active') {
    return _('Active', { context: 'Subscription status' });
  }
  if (status === 'canceled') {
    return _('Canceled', { context: 'Subscription status' });
  }
  return _('Unknown', { context: 'Subscription status' });
}



// Team creation dialog - 'teamUrl' is a typed form field key passed to setError
declare function useForm<T>(): {
  setError(field: keyof T, error: { message: string }): void;
  handleSubmit(fn: (data: T) => Promise<void>): (e: Event) => void;
};

interface TeamCreateForm {
  teamName: string;
  teamUrl: string;
}

function useTeamCreateForm() {
  const form = useForm<TeamCreateForm>();
  const onSubmit = async (data: TeamCreateForm) => {
    const isUrlTaken = await checkTeamUrlAvailability(data.teamUrl);
    if (!isUrlTaken) {
      form.setError('teamUrl', { message: 'This URL is already taken' });
    }
  };
  return { form, onSubmit };
}

declare function checkTeamUrlAvailability(url: string): Promise<boolean>;



// Typed discriminant union state initialized to a type-defined literal value
declare function useState<S>(init: S): [S, (s: S) => void];

type DialogState = 'PROMPT' | 'PROCESSING' | 'COMPLETE' | 'ERROR';

function useAiDetectionDialogState() {
  const [state, setState] = useState<DialogState>('PROMPT');
  return { state, setState };
}



// Typed discriminant union state initialized conditionally from existing data
declare function useState<S>(init: S): [S, (s: S) => void];

type ShareLinkStep = 'ONBOARD' | 'MANAGE' | 'DISABLED';

function useShareLinkStep(existingToken: string | null) {
  const [currentStep, setCurrentStep] = useState<ShareLinkStep>(existingToken ? 'MANAGE' : 'ONBOARD');
  return { currentStep, setCurrentStep };
}



// Typed position prop with union type default — standard React component prop pattern
declare function cn(...args: unknown[]): string;

type PanelPosition = 'start' | 'end' | 'center';

interface SlideoverPanelProps {
  children: unknown;
  position?: PanelPosition;
}

function SlideoverPanel({ children, position = 'start' }: SlideoverPanelProps) {
  return cn('fixed inset-0 z-50 flex justify-center', {
    'items-start': position === 'start',
    'items-end': position === 'end',
    'items-center': position === 'center',
  });
}



// variant: 'destructive' in a toast call — UI component enum prop value
declare const toast: (opts: { title: string; description: string; variant?: string }) => void;
declare function useLingui(): { t: (s: TemplateStringsArray, ...args: unknown[]) => string };

function useDeleteMutationCallbacks() {
  const { t } = useLingui();

  return {
    onError: () => {
      toast({
        title: 'Error',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    },
  };
}



// Constant step object with a string id field — editor wizard step config pattern
type StepConfig = {
  id: string;
  title: string;
  description: string;
};

const UPLOAD_STEP: StepConfig = {
  id: 'upload',
  title: 'Document & Recipients',
  description: 'Upload documents and add recipients',
};

const REVIEW_STEP: StepConfig = {
  id: 'review',
  title: 'Review',
  description: 'Review and confirm before sending',
};



// i18n message string — internationalized label used as a field option default value
declare function useLingui(): { _: (msg: unknown) => string };
declare function msg(strings: TemplateStringsArray, ...args: unknown[]): unknown;
declare function useState<T>(init: T): [T, (v: T) => void];

function useDropdownFieldState(initialDefault: string | undefined) {
  const { _ } = useLingui();
  const [defaultValue, setDefaultValue] = useState(initialDefault ?? _(msg`Option 1`));
  return { defaultValue, setDefaultValue };
}



// handleFieldChange('values', ...) — calling a handler with a typed field key string
declare function handleFieldChange(key: string, value: unknown): void;
declare function useState<T>(init: T): [T, (v: T) => void];

function addRadioOption(values: Array<{ id: number; checked: boolean; value: string }>) {
  const newId = values.length > 0 ? Math.max(...values.map((v) => v.id)) + 1 : 1;
  const newValue = { id: newId, checked: false, value: '' };
  const updated = [...values, newValue];
  handleFieldChange('values', updated);
  return updated;
}



// variant: 'destructive' in a mutation error toast — UI component variant prop
declare const toast: (opts: { title: string; description: string; duration?: number; variant?: string }) => void;

function onFileDropRejected() {
  toast({
    title: 'Upload failed',
    description: 'The file was rejected. Please check the format and size.',
    duration: 5000,
    variant: 'destructive',
  });
}



// Constant tab config array with string id fields — settings dialog tab definitions
type SettingsTab = {
  id: string;
  title: string;
  description: string;
};

const SETTINGS_TABS: SettingsTab[] = [
  { id: 'general', title: 'General', description: 'Configure general document settings.' },
  { id: 'reminders', title: 'Reminders', description: 'Configure signing reminder settings.' },
  { id: 'email', title: 'Email', description: 'Configure email notification settings.' },
  { id: 'security', title: 'Security', description: 'Configure access control settings.' },
];



// useState<'vertical' | 'horizontal'>('vertical') — typed discriminant union state with literal default
declare function useState<S>(init: S): [S, (s: S) => void];

function useLayoutDirectionState(initial: 'vertical' | 'horizontal' = 'vertical') {
  const [direction, setDirection] = useState<'vertical' | 'horizontal'>(initial);
  return { direction, setDirection };
}



// useState<FormStep>('method-selection') — typed discriminant union state initialized to a type-defined literal
declare function useState<S>(init: S): [S, (s: S) => void];

type AuthStep = 'method-selection' | 'code-input' | 'success';

function useTwoFactorAuthFlow() {
  const [step, setStep] = useState<AuthStep>('method-selection');
  return { step, setStep };
}



declare function loadDocument(url: string): Promise<{ numPages: number }>;
declare function setPdfPages(pages: number): void;
declare function useEffect(cb: () => () => void, deps: unknown[]): void;

function usePdfLoader(url: string): void {
  useEffect(() => {
    let isCancelled = false;

    const run = async () => {
      const doc = await loadDocument(url);

      if (isCancelled) {
        return;
      }

      setPdfPages(doc.numPages);
    };

    void run();

    return () => {
      isCancelled = true;
    };
  }, [url]);
}



declare function getDocument(opts: { url: string }): Promise<{ numPages: number; destroy(): Promise<void> }>;
declare function setPages(count: number): void;
declare function useEffect(cb: () => () => void, deps: unknown[]): void;

function usePdfDocument(url: string): void {
  useEffect(() => {
    let isCancelled = false;

    const run = async () => {
      const loadedPdf = await getDocument({ url });

      if (isCancelled) {
        await loadedPdf.destroy();
        return;
      }

      setPages(loadedPdf.numPages);
    };

    void run();

    return () => {
      isCancelled = true;
    };
  }, [url]);
}



declare function processPages(items: unknown[]): Promise<{ width: number; height: number }[]>;
declare function setRenderedPages(pages: { width: number; height: number }[]): void;
declare function useEffect(cb: () => () => void, deps: unknown[]): void;

function usePdfPageRenderer(numPages: number): void {
  useEffect(() => {
    let isCancelled = false;

    const run = async () => {
      const pages = await processPages(Array.from({ length: numPages }));

      if (isCancelled) {
        return;
      }

      setRenderedPages(pages);
    };

    void run();

    return () => {
      isCancelled = true;
    };
  }, [numPages]);
}



declare function getPage(pageNumber: number): Promise<{ getViewport(opts: { scale: number }): { width: number; height: number } }>;
declare function renderPage(canvas: HTMLCanvasElement, viewport: { width: number; height: number }): Promise<void>;

async function renderAtResolution(
  pageNumber: number,
  scale: number,
  isCancelledRef: { current: boolean },
): Promise<void> {
  let isCancelled = false;

  const page = await getPage(pageNumber);

  if (isCancelled) {
    return;
  }

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await renderPage(canvas, viewport);
}



declare interface Table<TData> { getPageCount(): number; getState(): { pagination: { pageIndex: number; pageSize: number } } }

declare interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  showSelectedCount?: boolean;
}

export function DataTablePagination<TData>({ table, showSelectedCount }: DataTablePaginationProps<TData>): string {
  const { pageIndex, pageSize } = table.getState().pagination;
  return `Page ${pageIndex + 1} of ${table.getPageCount()} (${pageSize} per page)`;
}



declare type FieldValues = Record<string, unknown>;
declare type FieldPath<T extends FieldValues> = keyof T & string;
declare interface ControllerProps<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>> {
  name: TName;
  control: unknown;
}
declare function Controller<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>(props: ControllerProps<TFieldValues, TName>): null;

export const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
>(
  props: ControllerProps<TFieldValues, TName>,
) => {
  return Controller(props);
};



declare function useRef<T>(initial: T): { current: T };
declare function useRef<T = undefined>(): { current: T | undefined };

export const useAutoSave = <T, R = void>(
  onSave: (data: T) => Promise<R>,
  options: { delay?: number } = {},
): { save: (data: T) => void } => {
  const { delay = 2000 } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const save = (data: T): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      void onSave(data);
    }, delay);
  };

  return { save };
};



declare type OptionValue = string | number;
declare interface ComboboxOption<T = OptionValue> { label: string; value: T }
declare interface MultiSelectProps<T = OptionValue> {
  options: ComboboxOption<T>[];
  selectedValues: T[];
  onChange: (values: T[]) => void;
  placeholder?: string;
}

export function MultiSelectCombobox<T = OptionValue>(props: MultiSelectProps<T>): string {
  const { options, selectedValues, placeholder = 'Select values...' } = props;
  const selected = options.filter((o) => selectedValues.includes(o.value));
  return selected.map((o) => o.label).join(', ') || placeholder;
}



declare interface ColumnDef<TData, TValue> { id: string; accessorFn: (row: TData) => TValue }
declare interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  totalPages?: number;
  currentPage?: number;
}

export function DataTable<TData, TValue>({ columns, data, totalPages = 1, currentPage = 1 }: DataTableProps<TData, TValue>): string {
  return `Showing ${data.length} rows across ${totalPages} pages (page ${currentPage})`;
}
