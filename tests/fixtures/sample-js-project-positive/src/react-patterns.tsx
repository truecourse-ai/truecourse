export function ServerList(): JSX.Element {
  return <div><ul><li>Item</li></ul></div>;
}
export function SearchInput(): JSX.Element {
  return <div><input type="text" readOnly /></div>;
}



// --- dead-method shape: framework-invoked-object-literal-callback (useMutation onSuccess in component) ---
declare function useMutation<T>(opts: { mutationFn: (data: T) => Promise<void>; onSuccess?: () => void }): { mutate: (data: T) => void };
declare function useRouter(): { refresh: () => void };
declare function toast(msg: string): void;

function DeleteApiTokenButton({ tokenId }: { tokenId: string }) {
  const router = useRouter();
  const { mutate: deleteToken } = useMutation({
    mutationFn: async (id: string) => { await revokeApiToken(id); },
    onSuccess() {
      router.refresh();
      toast('Token deleted successfully');
    },
  });
  return <button onClick={() => deleteToken(tokenId)}>Delete</button>;
}

declare function revokeApiToken(id: string): Promise<void>;



// --- raw-error-in-response shape: client-side-code (React useState setter, not HTTP response) ---
declare function useState<T>(init: T): [T, (v: T) => void];
declare function generateEmbedToken(opts: { resourceId: string }): Promise<string>;

function EmbedPlayground({ resourceId }: { resourceId: string }) {
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  async function handleGenerateEmbed() {
    try {
      const token = await generateEmbedToken({ resourceId });
      setEmbedUrl(`/embed/${resourceId}?token=${token}`);
      setTokenError(null);
    } catch (error) {
      // error shown in UI DOM, not in an HTTP API response
      setTokenError(error instanceof Error ? error.message : 'Failed to generate embed token');
    }
  }

  return (
    <div>
      <button onClick={handleGenerateEmbed}>Generate Embed</button>
      {tokenError && <p className="error">{tokenError}</p>}
      {embedUrl && <iframe src={embedUrl} />}
    </div>
  );
}




// --- argument-type-mismatch shape: useEffect with array length check and navigation call ---
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;
declare const navigate_0080: { replace: (path: string) => void };
declare const selectedItems_0080: unknown[];
declare const availableItems_0080: unknown[];

function ItemSelectionEffect_0080(): null {
  useEffect(() => {
    if (selectedItems_0080.length > 0 && availableItems_0080.length === 0) {
      navigate_0080.replace('/items/empty');
    }
  }, [selectedItems_0080.length, availableItems_0080.length]);
  return null;
}




// --- argument-type-mismatch shape: typed .map() with index producing JSX elements ---
declare const fieldOptions_0109: Array<{ value: string; label: string }>;
declare function RadioItem({ value, label }: { value: string; label: string }): JSX.Element;

function renderOptionList_0109(): JSX.Element[] {
  return fieldOptions_0109.map((item, index) => (
    <div key={index}>
      <RadioItem value={item.value} label={item.label} />
    </div>
  ));
}




// --- argument-type-mismatch shape: i18n translation helper result used as JSX children ---
declare function t(template: TemplateStringsArray | string): string;
declare function tag(strings: TemplateStringsArray, ...values: unknown[]): { id: string };

function RecipientBadge_0133({ isSelf }: { isSelf: boolean }): JSX.Element {
  return (
    <span className="text-xs font-medium text-muted-foreground">
      {isSelf ? t('(You)') : t('(Recipient)')}
    </span>
  );
}




// --- argument-type-mismatch shape: JSX element with function-call string prop ---
declare function getAssetUrl_0156(path: string): string;
declare function Img0156({ src, className, alt }: { src: string; className?: string; alt?: string }): JSX.Element;

function DownloadBanner_0156(): JSX.Element {
  return (
    <div className="flex items-center gap-2 p-4 rounded-lg bg-muted">
      <Img0156
        src={getAssetUrl_0156('/static/download.png')}
        className="h-8 w-8 object-contain"
        alt="Download"
      />
      <span className="text-sm font-medium">Download your document</span>
    </div>
  );
}




// --- argument-type-mismatch shape: onOpenChange guard with short-circuit to block close during async ---
declare function useState_018a<T>(init: T): [T, (v: T) => void];

function DeleteConfirmDialog_018a({ resourceId }: { resourceId: string }): JSX.Element {
  const [open, setOpen] = useState_018a(false);
  const [isDeleting, setIsDeleting] = useState_018a(false);

  async function handleDelete() {
    setIsDeleting(true);
    try {
      await deleteResource_018a(resourceId);
      setOpen(false);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Dialog_018a
      open={open}
      // Intentional short-circuit: prevents dialog from closing while deletion is in progress
      onOpenChange={(value: boolean) => !isDeleting && setOpen(value)}
    >
      <button onClick={handleDelete} disabled={isDeleting}>Delete</button>
    </Dialog_018a>
  );
}

declare function deleteResource_018a(id: string): Promise<void>;
declare function Dialog_018a(props: { open: boolean; onOpenChange: (value: boolean) => void; children: unknown }): JSX.Element;




// --- argument-type-mismatch shape: cn() with string arg and variant factory call returning string ---
declare function cn_018c(...classes: (string | undefined | false | null)[]): string;
declare function spinnerVariants_018c(opts: { size: string }): string;
declare const Spinner_018c: (props: { className: string }) => JSX.Element;

function LoadingButton_018c({ size }: { size: string }): JSX.Element {
  return (
    <button className="flex items-center gap-2" disabled>
      <Spinner_018c className={cn_018c('mr-2 animate-spin', spinnerVariants_018c({ size }))} />
      Loading...
    </button>
  );
}



// FP shape 01b7861b176d: typed array .map to JSX — no type mismatch
declare const validationMessages: string[];

function ValidationList(): JSX.Element {
  return (
    <ul>
      {validationMessages.map((msg, index) => (
        <li className="text-red-500 text-sm" key={index}>{msg}</li>
      ))}
    </ul>
  );
}



// FP shape 03195cbf987a: void-wrapped async call in JSX event handler — no type mismatch
declare function copyToClipboard(label: string, value: string): Promise<void>;
declare const localTimestamp: string;

function TimestampDisplay(): JSX.Element {
  return (
    <div
      className="cursor-pointer"
      onClick={() => void copyToClipboard('Local', localTimestamp)}
    >
      {localTimestamp}
    </div>
  );
}



// FP shape 03c1d9fcfc28: React input onChange handler — no type mismatch
declare const setSearchQuery: (val: string) => void;

function SearchInput(): JSX.Element {
  return (
    <input
      type="text"
      placeholder="Search..."
      onChange={(e) => setSearchQuery(e.target.value.trimStart())}
    />
  );
}



// FP shape 03ea8cc149f3: typed JSX list render with .map() — no type mismatch
interface Subscriber { id: string; email: string; name: string; }
declare const subscribers: Subscriber[];

function SubscriberList(): JSX.Element {
  return (
    <ul className="divide-y">
      {subscribers.map((subscriber) => (
        <li key={subscriber.id} className="py-2">
          <span className="font-medium">{subscriber.name}</span>
          <span className="text-gray-500 ml-2">{subscriber.email}</span>
        </li>
      ))}
    </ul>
  );
}



// FP shape 04a8c645e5eb: .map() rendering JSX with typed key — no type mismatch
interface Collaborator { id: string; name: string; avatarUrl?: string; }
declare const collaborators: Collaborator[];

function CollaboratorList(): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {collaborators.map((collaborator) => (
        <div key={collaborator.id} className="flex items-center gap-3">
          <span>{collaborator.name}</span>
        </div>
      ))}
    </div>
  );
}



// FP shape 066555a00d97: react-hook-form handleSubmit — no type mismatch
interface ProfileFormData { displayName: string; bio: string; }
declare const profileForm: {
  handleSubmit: (onValid: (data: ProfileFormData) => void | Promise<void>) => (e: unknown) => void;
};
declare function saveProfile(data: ProfileFormData): Promise<void>;

function ProfileForm(): JSX.Element {
  return (
    <form onSubmit={profileForm.handleSubmit(saveProfile)}>
      <button type="submit">Save</button>
    </form>
  );
}


// FP shape: useEffect with inner sync helper function — no type mismatch
declare function useEffect(cb: () => void | (() => void), deps?: unknown[]): void;
declare function fetchItemList(query: string): Promise<string[]>;
declare let itemQuery: string;

function useItemSearch(query: string) {
  useEffect(() => {
    const doFetchSync = () => {
      fetchItemList(query).then(() => {}).catch(() => {});
    };
    doFetchSync();
  }, [query]);
}


// FP shape: forwardRef with default props in destructuring — no type mismatch
import React from 'react';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  color?: string;
}

const CheckIcon = React.forwardRef<SVGSVGElement, IconProps>(
  ({ size = 24, color = 'currentColor', ...props }, ref) => (
    <svg ref={ref} width={size} height={size} fill={color} {...props}>
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </svg>
  )
);
CheckIcon.displayName = 'CheckIcon';


// FP shape: generic component factory with typed props callback — no type mismatch
interface CallableCall {
  resolve: (value: string | null) => void;
  reject: (reason?: unknown) => void;
}
interface ConfirmDialogProps {
  call: CallableCall;
  message: string;
}
declare function createCallable<P, R>(
  render: (props: P & { call: CallableCall }) => React.ReactNode
): (props: Omit<P, 'call'>) => Promise<R>;

declare const React: { createElement: (...args: unknown[]) => unknown };

const ConfirmDialog = createCallable<ConfirmDialogProps, string | null>(
  ({ call, message }) => {
    return null; // simplified
  }
);


// FP shape: JSX element with ref, cn() className, and spread props — no type mismatch
import React from 'react';
declare function cn(...classes: (string | undefined | false | null)[]): string;

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

const Panel = React.forwardRef<HTMLDivElement, PanelProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('h-full w-full overflow-auto', className)}
      {...props}
    />
  )
);
Panel.displayName = 'Panel';


// FP shape: standard Radix UI forwardRef pattern — not a type mismatch
import React from 'react';

declare namespace DialogPrimitive {
  const Title: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLHeadingElement> & React.RefAttributes<HTMLHeadingElement>>;
}

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={className ?? ''} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;


// FP shape: Dialog onOpenChange with loading guard — no type mismatch
import React from 'react';

declare function useBoolean(initial?: boolean): [boolean, { set: (v: boolean) => void }];
declare const Dialog: React.ComponentType<{ open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }>;

function DeleteConfirmDialog({ children }: { children: React.ReactNode }) {
  const [open, { set: setOpen }] = useBoolean(false);
  const [isLoading, { set: setIsLoading }] = useBoolean(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => !isLoading && setOpen(value)}
    >
      {children}
    </Dialog>
  );
}


// FP shape: JSX span with cn() className and spread props — no type mismatch
import React from 'react';
declare function cn(...args: (string | undefined | null | false)[]): string;

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'error';
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        variant === 'success' && 'bg-green-100 text-green-800',
        variant === 'error' && 'bg-red-100 text-red-800',
        className
      )}
      {...props}
    />
  )
);
Badge.displayName = 'Badge';


// FP shape: react-hook-form handleSubmit — no type mismatch
import React from 'react';
interface FormValues { email: string; password: string }
interface UseFormReturn<T> {
  handleSubmit: (onSubmit: (data: T) => void | Promise<void>) => React.FormEventHandler;
  register: (name: keyof T) => object;
}
declare function useForm<T>(): UseFormReturn<T>;

function LoginForm() {
  const form = useForm<FormValues>();
  const onSubmit = async (data: FormValues) => {
    console.log(data.email, data.password);
  };
  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <input {...form.register('email')} />
      <input {...form.register('password')} />
      <button type="submit">Login</button>
    </form>
  );
}


// FP shape: ts-pattern match with number literal cases — no type mismatch
import React from 'react';
declare const match: <T>(value: T) => {
  with: <P>(pattern: P, handler: () => React.ReactElement) => {
    with: <P2>(pattern: P2, handler: () => React.ReactElement) => {
      otherwise: (handler: () => React.ReactElement) => React.ReactElement;
    };
  };
};

function renderErrorPage(errorCode: number): React.ReactElement {
  return match(errorCode)
    .with(404, () => <div>Page not found</div>)
    .with(403, () => <div>Access denied</div>)
    .otherwise(() => <div>Something went wrong</div>);
}


// FP shape: Object.entries .map destructuring to JSX — no type mismatch
import React from 'react';
declare const SelectItem: React.ComponentType<{ key?: string; value: string; children: React.ReactNode }>;
const SUPPORTED_LOCALES: Record<string, { label: string; flag: string }> = {
  'en-US': { label: 'English', flag: '🇺🇸' },
  'fr-FR': { label: 'Français', flag: '🇫🇷' },
};

function LocaleSelectOptions() {
  return (
    <>
      {Object.entries(SUPPORTED_LOCALES).map(([code, locale]) => (
        <SelectItem key={code} value={code}>
          {locale.flag} {locale.label}
        </SelectItem>
      ))}
    </>
  );
}


// FP shape: string array .map to JSX key+content element — no type mismatch
import React from 'react';

interface RecoveryCodesDisplayProps {
  codes: string[];
}

function RecoveryCodesDisplay({ codes }: RecoveryCodesDisplayProps) {
  return (
    <ul className="space-y-1">
      {codes.map((code) => (
        <li key={code} className="font-mono text-sm">
          {code}
        </li>
      ))}
    </ul>
  );
}


// FP shape: useRef typed with Map initializer — no type mismatch
declare function useRef<T>(initial: T): { current: T };

function useAsyncTaskRegistry() {
  const taskRegistry = useRef<Map<string, () => Promise<void>>>(new Map());

  function registerTask(id: string, task: () => Promise<void>) {
    taskRegistry.current.set(id, task);
  }

  async function runTask(id: string): Promise<void> {
    const task = taskRegistry.current.get(id);
    if (task) {
      await task();
    }
  }

  return { registerTask, runTask };
}


// FP shape: createCallable generic factory with typed props — no type mismatch
interface CallHandle {
  resolve: (value: string | null) => void;
}
interface WebhookPreviewProps {
  call: CallHandle;
  endpointUrl: string;
  payload: Record<string, unknown>;
}
declare function createCallable<P, R>(
  render: (props: P & { call: CallHandle }) => null
): (props: Omit<P, 'call'>) => Promise<R>;

const WebhookPreviewDialog = createCallable<WebhookPreviewProps, string | null>(
  ({ call, endpointUrl, payload }) => {
    return null;
  }
);



// D00: map rendering typed items as React form fields — no type mismatch
declare function FormField(props: { key?: string; name: string; label: string; index: number }): JSX.Element;

interface TaskFormItem {
  id: string;
  name: string;
  label: string;
}

declare const taskFormItems: TaskFormItem[];

export function TaskFieldList() {
  return (
    <ul>
      {taskFormItems.map((item, i) => (
        <FormField key={item.id} name={item.name} label={item.label} index={i} />
      ))}
    </ul>
  );
}



// D11: forwarding event node to typed handler in JSX prop — no type mismatch
interface DragNode {
  id: string;
  position: { x: number; y: number };
}

interface DraggableFieldProps {
  index: number;
  onMove: (node: DragNode) => void;
}

declare function DraggableField(props: DraggableFieldProps): JSX.Element;

declare function onFieldMove(node: DragNode, index: number): void;

interface FieldItem {
  id: string;
}

export function FieldList({ fields }: { fields: FieldItem[] }) {
  return (
    <ul>
      {fields.map((field, index) => (
        <DraggableField
          key={field.id}
          index={index}
          onMove={(node) => onFieldMove(node, index)}
        />
      ))}
    </ul>
  );
}



// D12: mapping tanstack table headers to JSX — no type mismatch
interface TableHeader {
  id: string;
  column: { columnDef: { header: string } };
  getContext(): unknown;
}

interface HeaderGroup {
  id: string;
  headers: TableHeader[];
}

declare function TableHead(props: { children?: string }): JSX.Element;

export function DataTableHeader({ headerGroup }: { headerGroup: HeaderGroup }) {
  return (
    <tr>
      {headerGroup.headers.map((header) => (
        <TableHead key={header.id}>{header.column.columnDef.header}</TableHead>
      ))}
    </tr>
  );
}



// D19: react-hook-form handleSubmit wrapping typed handler — no type mismatch
interface LoginFormValues {
  email: string;
  password: string;
}

interface UseFormReturn {
  handleSubmit(onValid: (data: LoginFormValues) => Promise<void>): (e: React.FormEvent) => void;
}

declare function useForm(): UseFormReturn;
declare function authenticateUser(data: LoginFormValues): Promise<void>;

export function LoginForm() {
  const form = useForm();

  async function onFormSubmit(data: LoginFormValues) {
    await authenticateUser(data);
  }

  return <form onSubmit={form.handleSubmit(onFormSubmit)} />;
}



// D21: Select onValueChange forwarding string to typed handler — no type mismatch
declare function Select(props: {
  value?: string;
  onValueChange: (val: string) => void;
  children?: React.ReactNode;
}): JSX.Element;

type ValidationRule = 'required' | 'minLength' | 'maxLength' | 'pattern';

declare function handleSettingChange(setting: string, value: string): void;

export function ValidationRuleSelect({ currentRule }: { currentRule: ValidationRule }) {
  return (
    <Select
      value={currentRule}
      onValueChange={(val) => handleSettingChange('validationRule', val)}
    />
  );
}



// D23: React input onChange handler setting state — no type mismatch
declare function useState<T>(initial: T): [T, (v: T) => void];

export function MemberSearchInput() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <input
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      placeholder="Search members..."
    />
  );
}



// D24: typed map to JSX list items with index — no type mismatch
interface DocumentSummary {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
}

interface PaginatedResult<T> {
  data: T[];
  total: number;
}

declare const results: { data: PaginatedResult<DocumentSummary> };

export function RecentDocumentList() {
  return (
    <ul>
      {results.data.data.map((document, documentIndex) => (
        <li key={document.id} data-index={documentIndex}>
          {document.title}
        </li>
      ))}
    </ul>
  );
}



// D26: onChange with nullish coalescing to ensure string — no type mismatch
declare function PhoneInput(props: {
  value: string;
  onChange: (value: string | null) => void;
}): JSX.Element;

interface PhoneFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function PhoneFormField({ value, onChange }: PhoneFieldProps) {
  return (
    <PhoneInput
      value={value}
      onChange={(v) => onChange(v ?? '')}
    />
  );
}



// D28: react-hook-form handleSubmit wrapping typed submit handler — no type mismatch
interface RedistributeFormValues {
  recipientEmail: string;
  message: string;
}

declare function handleSubmit(
  onValid: (data: RedistributeFormValues) => Promise<void>
): (e: React.FormEvent) => void;

async function onFormSubmit(data: RedistributeFormValues): Promise<void> {
  console.log('Redistributing to:', data.recipientEmail);
}

export function RedistributeForm() {
  return <form onSubmit={handleSubmit(onFormSubmit)} />;
}



// D33: map array of recipients to JSX list items — no type mismatch
interface DistributionRecipient {
  id: string;
  email: string;
  name: string;
  role: string;
}

declare function RecipientBadge(props: { email: string; name: string; role: string }): JSX.Element;

export function RecipientList({ recipients }: { recipients: DistributionRecipient[] }) {
  return (
    <ul>
      {recipients.map((recipient) => (
        <li key={recipient.id}>
          <RecipientBadge
            email={recipient.email}
            name={recipient.name}
            role={recipient.role}
          />
        </li>
      ))}
    </ul>
  );
}



// D43: cn() className utility called with string literals and prop — no type mismatch
declare function cn(...classes: (string | undefined | null | boolean)[]): string;

interface AvatarGroupProps {
  users: Array<{ id: string; initials: string; imageUrl?: string }>;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function AvatarGroup({ users, className, size = 'md' }: AvatarGroupProps) {
  return (
    <div className={cn('flex w-full max-w-xs items-center gap-2', className)}>
      {users.map((user) => (
        <div key={user.id} className={cn('rounded-full', size === 'sm' && 'h-6 w-6')}>
          {user.initials}
        </div>
      ))}
    </div>
  );
}



// D46: Dialog onOpenChange with isPending guard — idiomatic pattern, no type mismatch
declare function Dialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  children?: React.ReactNode;
}): JSX.Element;

declare function useState<T>(initial: T): [T, (v: T) => void];
declare const isPending: boolean;

export function ConfirmDeleteDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(value) => !isPending && setOpen(value)}>
      {trigger}
    </Dialog>
  );
}



// --- FP shape 18746cbd3ccb: renderToPipeableStream with JSX Provider ---
declare function renderToPipeableStream(
  element: React.ReactElement,
  options: { onShellReady: () => void; onError: (err: unknown) => void },
): { pipe: (writable: unknown) => void };

declare const LocaleProvider: React.FC<{ locale: string; children: React.ReactNode }>;

function renderAppToStream(locale: string, writable: unknown): void {
  const { pipe } = renderToPipeableStream(
    <LocaleProvider locale={locale}>
      <div className="app-root" />
    </LocaleProvider>,
    {
      onShellReady() {
        pipe(writable);
      },
      onError(err) {
        console.error(err);
      },
    },
  );
}



// --- FP shape 18c4c8280c0b: tanstack table header groups map to JSX ---
interface HeaderGroup {
  id: string;
  headers: Array<{ id: string; column: { columnDef: { header: unknown } } }>;
}

interface DataTableInstance {
  getHeaderGroups(): HeaderGroup[];
}

declare const TableRow: React.FC<{ key: string; children?: React.ReactNode }>;
declare const TableHead: React.FC<{ key: string; children?: React.ReactNode }>;
declare const TableHeader: React.FC<{ children?: React.ReactNode }>;

function DataTableHeader({ table }: { table: DataTableInstance }): React.ReactElement {
  return (
    <TableHeader>
      {table.getHeaderGroups().map((headerGroup) => (
        <TableRow key={headerGroup.id}>
          {headerGroup.headers.map((header) => (
            <TableHead key={header.id}>{String(header.column.columnDef.header)}</TableHead>
          ))}
        </TableRow>
      ))}
    </TableHeader>
  );
}



// --- FP shape 18e8039dcf29: onValueChange with explicit cast to union type ---
declare const Select: React.FC<{ value: string; onValueChange: (value: string) => void; children?: React.ReactNode }>;
declare const SelectTrigger: React.FC<{ children?: React.ReactNode }>;
declare const SelectContent: React.FC<{ children?: React.ReactNode }>;
declare const SelectItem: React.FC<{ value: string; children?: React.ReactNode }>;

type PlanAction = 'upgrade' | 'downgrade';

function PlanSelector({ onActionChange }: { onActionChange: (action: PlanAction) => void }): React.ReactElement {
  const [currentAction, setCurrentAction] = React.useState<PlanAction>('upgrade');
  return (
    <Select
      value={currentAction}
      onValueChange={(value) => {
        setCurrentAction(value as PlanAction);
        onActionChange(value as PlanAction);
      }}
    >
      <SelectTrigger />
      <SelectContent>
        <SelectItem value="upgrade">Upgrade</SelectItem>
        <SelectItem value="downgrade">Downgrade</SelectItem>
      </SelectContent>
    </Select>
  );
}



// --- FP shape 1927786e1072: createCallable generic invocation ---
interface ConfirmDialogProps {
  title: string;
  message: string;
}

interface ConfirmResult {
  confirmed: boolean;
}

declare function createCallable<TProps, TReturn>(
  component: React.FC<TProps & { call: { resolve: (result: TReturn) => void } }>,
): (props: TProps) => Promise<TReturn>;

const ConfirmDialog = createCallable<ConfirmDialogProps, ConfirmResult>(
  ({ title, message, call }) => {
    return (
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
        <button onClick={() => call.resolve({ confirmed: true })}>Confirm</button>
        <button onClick={() => call.resolve({ confirmed: false })}>Cancel</button>
      </div>
    );
  },
);



// --- FP shape 195791a0718e: form.handleSubmit(onSubmit) standard pattern ---
interface SignatureFormValues {
  signerName: string;
  signerEmail: string;
  agree: boolean;
}

declare function useForm<T>(): {
  handleSubmit: (handler: (values: T) => void | Promise<void>) => React.FormEventHandler;
  register: (name: keyof T) => { name: string; onChange: React.ChangeEventHandler };
};

function SignatureAutoForm(): React.ReactElement {
  const form = useForm<SignatureFormValues>();

  const onSubmit = async (values: SignatureFormValues) => {
    console.log('Signing as', values.signerName);
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <input {...form.register('signerName')} />
      <button type="submit">Sign</button>
    </form>
  );
}



// --- FP shape 1981de9ae734: React.forwardRef with generics ---
interface VisibilitySelectProps {
  currentUserRole: string;
  isAdminView?: boolean;
  value?: string;
  onChange?: (value: string) => void;
}

declare const forwardRef: <T, P>(
  render: (props: P, ref: React.Ref<T>) => React.ReactElement | null,
) => React.ForwardRefExoticComponent<P & React.RefAttributes<T>>;

const VisibilitySelect = forwardRef<HTMLButtonElement, VisibilitySelectProps>(
  ({ currentUserRole, isAdminView = false, value, onChange, ...props }, ref) => {
    return (
      <button ref={ref} data-role={currentUserRole} data-admin={isAdminView} {...props}>
        {value ?? 'Select visibility'}
      </button>
    );
  },
);



// --- FP shape 1a4e22668611: optional chained .map() on typed array in JSX ---
interface RadioOption {
  label: string;
  value: string;
}

function RadioOptionList({ options }: { options?: RadioOption[] }): React.ReactElement {
  return (
    <div className="radio-group">
      {options?.map((item, index) => (
        <div key={index} className="radio-item">
          <input type="radio" id={`opt-${index}`} value={item.value} />
          <label htmlFor={`opt-${index}`}>{item.label}</label>
        </div>
      ))}
    </div>
  );
}



// --- FP shape 1a7162cd877c: form.handleSubmit(onFormSubmit) variant ---
interface EmailCreateFormValues {
  alias: string;
  domainId: string;
  displayName: string;
}

declare function useForm2<T>(): {
  handleSubmit: (handler: (values: T) => Promise<void>) => React.FormEventHandler;
  control: unknown;
};

declare const FormField: React.FC<{ control: unknown; name: string; render: (args: { field: unknown }) => React.ReactElement }>;

function OrgEmailCreateDialog(): React.ReactElement {
  const form = useForm2<EmailCreateFormValues>();

  const onFormSubmit = async (values: EmailCreateFormValues): Promise<void> => {
    console.log('Creating email alias:', values.alias, '@', values.domainId);
  };

  return (
    <form onSubmit={form.handleSubmit(onFormSubmit)}>
      <FormField
        control={form.control}
        name="alias"
        render={({ field }) => <input {...(field as object)} />}
      />
      <button type="submit">Create</button>
    </form>
  );
}



// --- FP shape 1abd38a58181: JSX Img with string prop from helper call ---
declare function getAssetUrl(path: string): string;
declare const Img: React.FC<{ src: string; className?: string; alt?: string; width?: number; height?: number }>;
declare const Section: React.FC<{ children?: React.ReactNode }>;

function EmailPendingBanner(): React.ReactElement {
  return (
    <Section>
      <Img
        src={getAssetUrl('/static/pending-clock.png')}
        className="mx-auto my-4"
        alt="Pending"
        width={64}
        height={64}
      />
    </Section>
  );
}



// --- FP shape 1d81647ef28d: useMemo building typed array ---
interface PricingTier {
  id: string;
  name: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
}

interface DisplayPrice {
  tierId: string;
  label: string;
  monthly: string;
  annual: string;
  savings: string;
}

declare function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;

function useBillingPlanPrices(tiers: PricingTier[]): DisplayPrice[] {
  return useMemo(() => {
    const prices: DisplayPrice[] = [];
    for (const tier of tiers) {
      const monthlyCents = tier.monthlyPriceCents;
      const annualCents = tier.annualPriceCents;
      const savedCents = monthlyCents * 12 - annualCents;
      prices.push({
        tierId: tier.id,
        label: tier.name,
        monthly: `$${(monthlyCents / 100).toFixed(2)}`,
        annual: `$${(annualCents / 100).toFixed(2)}`,
        savings: savedCents > 0 ? `Save $${(savedCents / 100).toFixed(0)}/yr` : '',
      });
    }
    return prices;
  }, [tiers]);
}



// --- FP shape 1d87aa44e440: array literal of enum values in JSX prop ---
type DocumentStatus = 'DRAFT' | 'PENDING' | 'COMPLETED' | 'DECLINED' | 'EXPIRED';

interface StatusFilterProps {
  allowedStatuses: DocumentStatus[];
  onStatusChange: (statuses: DocumentStatus[]) => void;
}

declare const StatusMultiSelect: React.FC<StatusFilterProps>;

function DocumentsFilterBar({ onFilter }: { onFilter: (statuses: DocumentStatus[]) => void }): React.ReactElement {
  return (
    <StatusMultiSelect
      allowedStatuses={['DRAFT', 'PENDING', 'COMPLETED', 'DECLINED', 'EXPIRED']}
      onStatusChange={onFilter}
    />
  );
}



// G02: .map on typed array objects, passing item.id as value prop — standard React pattern
declare const organisations: Array<{ id: string; name: string; slug: string }>;
declare function SelectItem(props: { value: string; children: React.ReactNode }): JSX.Element;
declare function Select(props: { children: React.ReactNode }): JSX.Element;

function OrganisationSelect() {
  return (
    <Select>
      {organisations.map((org) => (
        <SelectItem key={org.id} value={org.id}>
          {org.name}
        </SelectItem>
      ))}
    </Select>
  );
}



// G07: react-hook-form standard submit handler — no type mismatch
declare function useForm<T>(): { handleSubmit: (fn: (data: T) => void) => React.FormEventHandler };
declare type ProfileFormValues = { displayName: string; bio: string };

function ProfileForm() {
  const form = useForm<ProfileFormValues>();

  function onFormSubmit(data: ProfileFormValues) {
    console.log(data.displayName, data.bio);
  }

  return <form onSubmit={form.handleSubmit(onFormSubmit)} />;
}



// G10: Dialog onOpenChange with boolean guard — standard React pattern, no type mismatch
declare function useForm<T>(): { formState: { isSubmitting: boolean } };
declare function Dialog(props: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }): JSX.Element;
declare type SettingsFormValues = { email: string };

function SettingsDialog() {
  const [open, setOpen] = React.useState(false);
  const form = useForm<SettingsFormValues>();

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => !form.formState.isSubmitting && setOpen(value)}
    >
      <div />
    </Dialog>
  );
}



// G12: cn() className utility call — no type mismatch
declare function cn(...classes: Array<string | undefined | null | false>): string;

function ActionBar({ className }: { className?: string }) {
  return (
    <div className={cn('flex justify-end space-x-2', className)}>
      <button type="button">Save</button>
    </div>
  );
}



// G14: .map rendering JSX with index key — standard React list rendering, no type mismatch
declare const dnsEntries: Array<{ type: string; host: string; value: string }>;

function DnsRecordTable() {
  return (
    <table>
      <tbody>
        {dnsEntries.map((entry, index) => (
          <tr key={index}>
            <td>{entry.type}</td>
            <td>{entry.host}</td>
            <td>{entry.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}



// G21: onChange calling setState with the correct type — no type mismatch
declare function SignaturePad(props: { onChange: (value: string) => void }): JSX.Element;

function SignatureCapture() {
  const [signature, setSignature] = React.useState<string>('');

  return <SignaturePad onChange={(value) => setSignature(value)} />;
}



// G22: useCallback with generic setState dispatch — correctly typed with T; no type mismatch
function usePersistentState<T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = React.useState<T>(initialValue);

  const setPersistentState = React.useCallback(
    (value: React.SetStateAction<T>) => {
      setState(value);
    },
    [],
  );

  return [state, setPersistentState];
}



// G26: useMemo with correctly typed array literal — no type mismatch
declare type ColumnDef = { id: string; header: string; accessorKey: string };
declare const baseColumns: ColumnDef[];

function DataGrid() {
  const columns = React.useMemo(
    () => [
      ...baseColumns,
      { id: 'actions', header: 'Actions', accessorKey: 'actions' },
    ],
    [],
  );

  return <div>{columns.length} columns</div>;
}



// G30: React checkbox onChange handler — standard pattern; no type mismatch
function FeatureToggle() {
  const [isEnabled, setIsEnabled] = React.useState(false);

  return (
    <label>
      <input
        type="checkbox"
        checked={isEnabled}
        onChange={(e) => setIsEnabled(e.target.checked)}
      />
      Enable feature
    </label>
  );
}



// G31: JSX src={getAssetUrl(...)} — getAssetUrl returns string, src is string; no type mismatch
declare function getAssetUrl(path: string): string;
declare function Img(props: { src: string; className?: string; alt?: string }): JSX.Element;

function WelcomeBanner() {
  return (
    <Img
      src={getAssetUrl('/static/welcome-banner.png')}
      className="w-full h-auto"
      alt="Welcome"
    />
  );
}



// G37: cn() with string and optional className — accepts string | undefined; no type mismatch
declare function cn(...classes: Array<string | undefined | null | false>): string;

function UploadButton({ className }: { className?: string }) {
  return (
    <div className={cn('relative cursor-pointer', className)}>
      <button type="button">Upload</button>
    </div>
  );
}



// G45: .map rendering JSX components with key — standard React list; no type mismatch
declare type PageWidget = { id: string; type: string; x: number; y: number; width: number; height: number };
declare const pageWidgets: PageWidget[];
declare function WidgetRenderer(props: { widget: PageWidget }): JSX.Element;

function PageCanvas() {
  return (
    <div className="relative">
      {pageWidgets.map((widget) => (
        <WidgetRenderer key={widget.id} widget={widget} />
      ))}
    </div>
  );
}



// G47: useEffect with early return guard — standard React effect; no type mismatch
declare const canvasRef: { current: HTMLCanvasElement | null };
declare function drawFieldOverlay(canvas: HTMLCanvasElement, scale: number): void;
declare const scale: number;

function FieldOverlayCanvas() {
  React.useEffect(() => {
    if (!canvasRef.current) return;
    drawFieldOverlay(canvasRef.current, scale);
  }, [scale]);

  return <canvas ref={canvasRef} />;
}



// H03: useCallback wrapping a form submit handler — no type mismatch
declare function useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly unknown[]): T;
declare function launchWorkflow(): Promise<void>;
declare const workflowId: string;
declare const teamId: string;

const handleWorkflowSubmit = useCallback(
  (e: React.FormEvent) => {
    e.preventDefault();
    void launchWorkflow();
  },
  [workflowId, teamId],
);



// H07: array.map rendering JSX list items — standard React rendering, no type mismatch
interface Subscriber { id: number; name: string; email: string; plan: string; }
interface SubscriberListProps { subscribers: Subscriber[] }

declare function Badge(props: { children: React.ReactNode; variant?: string }): JSX.Element;

function SubscriberList({ subscribers }: SubscriberListProps) {
  return (
    <ul className="space-y-2">
      {subscribers.map((subscriber) => (
        <li key={subscriber.id} className="rounded border p-3">
          <span className="font-semibold">{subscriber.name}</span>
          <Badge variant="secondary">{subscriber.email}</Badge>
          <Badge variant="outline">{subscriber.plan}</Badge>
        </li>
      ))}
    </ul>
  );
}



// H10: array.map rendering JSX with key prop — standard React list rendering, no type mismatch
interface Workspace { id: number; name: string; slug: string; ownerId: number; }
interface WorkspaceListProps { workspaces: Workspace[] }

function WorkspaceList({ workspaces }: WorkspaceListProps) {
  return (
    <div className="grid gap-4">
      {workspaces.map((workspace) => (
        <div key={workspace.id} className="rounded-lg border p-4">
          <h3 className="font-semibold">{workspace.name}</h3>
          <p className="text-sm text-muted-foreground">{workspace.slug}</p>
        </div>
      ))}
    </div>
  );
}



// H26: setState called with plain object spread; array.map returns correctly typed items — standard React state update, no type mismatch
interface LineItem { id: number; name: string; quantity: number; unitPrice: number; }
interface Invoice { lineItems: LineItem[]; status: string; updatedAt: string; }

declare function setLocalInvoice(invoice: Invoice): void;
declare const currentInvoice: Invoice;

function updateLineItemQuantity(itemId: number, newQuantity: number) {
  setLocalInvoice({
    ...currentInvoice,
    lineItems: currentInvoice.lineItems.map((item) =>
      item.id === itemId ? { ...item, quantity: newQuantity } : item,
    ),
    updatedAt: new Date().toISOString(),
  });
}



// H29: onValueChange casts string to union literal with 'as' — intentional runtime narrowing, no type mismatch bug
type BillingCycle = 'monthly' | 'annual' | 'lifetime';

declare function Select(props: { value: BillingCycle; onValueChange: (value: string) => void; children: React.ReactNode }): JSX.Element;
declare function SelectTrigger(props: { children: React.ReactNode }): JSX.Element;
declare function SelectValue(): JSX.Element;
declare function SelectContent(props: { children: React.ReactNode }): JSX.Element;
declare function SelectItem(props: { value: string; children: React.ReactNode }): JSX.Element;
declare function useState<T>(initial: T): [T, (val: T) => void];

function BillingCycleSelector() {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');

  return (
    <Select
      value={cycle}
      onValueChange={(value) => setCycle(value as BillingCycle)}
    >
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="monthly">Monthly</SelectItem>
        <SelectItem value="annual">Annual</SelectItem>
        <SelectItem value="lifetime">Lifetime</SelectItem>
      </SelectContent>
    </Select>
  );
}



// H39: useMemo returning column definitions array — standard TanStack table usage, no type mismatch
declare function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
declare function createColumnHelper<T>(): { accessor<K extends keyof T>(key: K, opts: { header: string; cell?: (info: { getValue(): T[K] }) => React.ReactNode }): unknown };

interface OrderRow { id: number; customerName: string; total: number; status: string; createdAt: string; }

const columnHelper = createColumnHelper<OrderRow>();

const columns = useMemo(
  () => [
    columnHelper.accessor('id', { header: 'Order ID' }),
    columnHelper.accessor('customerName', { header: 'Customer' }),
    columnHelper.accessor('total', {
      header: 'Total',
      cell: (info) => `$${info.getValue().toFixed(2)}`,
    }),
    columnHelper.accessor('status', { header: 'Status' }),
    columnHelper.accessor('createdAt', { header: 'Created' }),
  ],
  [],
);



// H41: Dialog onOpenChange ternary returning null — valid void/null from event handler, no type mismatch
declare function Dialog(props: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }): JSX.Element;
declare function DialogContent(props: { children: React.ReactNode }): JSX.Element;
declare const call: { end(reason: null): void };
declare function useState<T>(initial: T): [T, (val: T) => void];

function AnnotationDialog({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(value) => (!value ? call.end(null) : null)}
    >
      <DialogContent>{children}</DialogContent>
    </Dialog>
  );
}



// H46: Dialog onOpenChange boolean check ending call — no type mismatch
declare function Dialog(props: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }): JSX.Element;
declare function DialogContent(props: { children: React.ReactNode }): JSX.Element;
declare function DialogHeader(props: { children: React.ReactNode }): JSX.Element;
declare const session: { close(reason: null): void };
declare function useState<T>(initial: T): [T, (val: T) => void];

function ApprovalDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => (!value ? session.close(null) : null)}
    >
      <DialogContent>
        <DialogHeader>{children}</DialogHeader>
      </DialogContent>
    </Dialog>
  );
}



// FP shape 2b9214934459: form.handleSubmit with onFormSubmit callback — standard React Hook Form usage
declare const recoveryForm: { handleSubmit: (fn: (data: unknown) => Promise<void>) => (e: unknown) => void };
async function onRecoverySubmit(data: unknown): Promise<void> { void data; }

export function RecoveryFormButton() {
  const handleClick = recoveryForm.handleSubmit(onRecoverySubmit);
  return handleClick;
}



// FP shape 2c82c8d31988: cn() with className prop — standard Tailwind class merge
declare function cn(...args: unknown[]): string;
declare const className: string | undefined;

export function scrollWrapper(props: { className?: string }) {
  return cn('relative overflow-hidden', props.className);
}



// FP shape 2d2b717c13c0: useMemo with conditional return — standard React memo
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare const mode: string;
declare const items: Array<{ id: string; label: string }>;

export function useFilteredItems(searchTerm: string) {
  return useMemo(() => {
    if (!searchTerm) return items;
    return items.filter((item) => item.label.includes(searchTerm));
  }, [searchTerm, mode]);
}



// FP shape 2d7f92758fd2: cn() with string and object argument — standard Tailwind class merge
declare function cn(...args: unknown[]): string;

export function signaturePadClass(isActive: boolean, isError: boolean): string {
  return cn('relative aspect-video border rounded', {
    'border-blue-500': isActive,
    'border-red-500': isError,
    'border-gray-300': !isActive && !isError,
  });
}



// FP shape 2dd5cefbb967: array.map returning JSX list items — standard React list rendering
declare const React: { createElement: (tag: string, props: unknown, ...children: unknown[]) => unknown };
declare const recipients: Array<{ id: string; name: string; email: string }>;

export function renderRecipientList() {
  return recipients.map((recipient) =>
    React.createElement('li', { key: recipient.id },
      React.createElement('span', null, recipient.name),
      React.createElement('span', null, recipient.email),
    ),
  );
}



// FP shape 2df0de82e581: useCallback async function with early return — standard React callback
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function setQuota(q: { used: number; limit: number } | null): void;
declare function fetchQuota(): Promise<{ used: number; limit: number } | null>;
declare const isEnabled: boolean;

export function useRefreshQuota() {
  return useCallback(async () => {
    if (!isEnabled) return;
    const quota = await fetchQuota();
    setQuota(quota);
  }, [isEnabled]);
}



// FP shape 2e655d335561: Number() coercion on row.getValue('unknown') — intentional coercion in table renderer
declare const row: { getValue: (key: string) => unknown };

export function renderMemberCountCell() {
  const raw = row.getValue('memberCount');
  const count = Number(raw);
  return count;
}

export function renderSessionCountCell() {
  const raw = row.getValue('sessionCount');
  const count = Number(raw);
  return count;
}



// FP shape 2e80a8e96a7b: cn() with string-only args — standard class merge
declare function cn(...args: unknown[]): string;

export function getFlowContainerClass(): string {
  return cn('-mx-2 flex flex-1 flex-col px-2');
}



// FP shape 2f950b8b6910: errors.map rendering JSX list items with index key — standard React list
declare const React: { createElement: (tag: string, props: unknown, ...children: unknown[]) => unknown };
declare const processingErrors: Array<{ message: string; code: string }>;

export function renderErrorList() {
  return processingErrors.map((err, index) =>
    React.createElement('li', { key: index }, err.message),
  );
}



// FP shape 3085be84decb: React.forwardRef<HTMLElement, Props>() — standard forwardRef usage
declare const React: {
  forwardRef: <T, P>(render: (props: P, ref: unknown) => unknown) => (props: P & { ref?: unknown }) => unknown;
};

type MessageProps = { className?: string; children?: unknown };

export const FormMessage = React.forwardRef<HTMLParagraphElement, MessageProps>(
  (props, ref) => { void props; void ref; return null; },
);



// FP shape 30cd3db924d0: ROLE_HIERARCHY[key].map() returning JSX SelectItem — standard array map JSX
declare const React: { createElement: (tag: string, props: unknown, ...children: unknown[]) => unknown };
const MEMBER_ROLE_HIERARCHY: Record<string, Array<{ value: string; label: string }>> = {
  admin: [{ value: 'admin', label: 'Admin' }, { value: 'member', label: 'Member' }],
  member: [{ value: 'member', label: 'Member' }],
};
declare const currentRole: string;

export function renderRoleSelectItems() {
  return (MEMBER_ROLE_HIERARCHY[currentRole] ?? []).map((role) =>
    React.createElement('option', { key: role.value, value: role.value }, role.label),
  );
}



// onOpenChange with logical short-circuit guard — standard dialog pattern, no type mismatch
declare function Dialog(props: { open: boolean; onOpenChange: (value: boolean) => void; children?: any }): any;
declare const isSubmitting: boolean;
declare function setIsModalOpen(v: boolean): void;

function ConfirmationDialog({ isOpen }: { isOpen: boolean }) {
  return Dialog({
    open: isOpen,
    onOpenChange: (value) => !isSubmitting && setIsModalOpen(value),
    children: null,
  });
}



// Standard React input onChange handler — no type mismatch
declare function useState<T>(init: T): [T, (val: T) => void];
declare function Input(props: { defaultValue?: string; onChange: (e: { target: { value: string } }) => void; placeholder?: string }): any;

function SearchBar() {
  const [query, setQuery] = useState('');

  return Input({
    defaultValue: query,
    onChange: (e) => setQuery(e.target.value),
    placeholder: 'Search...',
  });
}



// useMemo with conditional return — standard React memo, no type mismatch
declare function useMemo<T>(factory: () => T, deps: readonly any[]): T;
declare const isDirectTemplate: boolean;
declare const userName: string;
declare const email: string;

function useRecipientPayload() {
  const recipientPayload = useMemo(() => {
    if (!isDirectTemplate) {
      return {
        name: userName,
        email: email,
      };
    }

    return null;
  }, [isDirectTemplate, userName, email]);

  return recipientPayload;
}



// onValueChange with single-arg forwarding — standard Select handler, no type mismatch
declare function Select(props: { value: string; onValueChange: (val: string) => void; children?: any }): any;
declare function handleInput(key: string, val: string): void;
declare const fieldState: { currencyFormat: string };

function CurrencySelector() {
  return Select({
    value: fieldState.currencyFormat ?? '',
    onValueChange: (val) => handleInput('currencyFormat', val),
    children: null,
  });
}



// ts-pattern match().with() — correct API usage for object pattern matching, no type mismatch
declare const match: (val: any) => { with: (pattern: any, handler: () => any) => any; otherwise: (handler: () => any) => any };
declare const status: string;
declare const role: string;

function resolveActionLabel() {
  return match({ status, role })
    .with({ status: 'pending', role: 'admin' }, () => 'Review')
    .with({ status: 'complete' }, () => 'View')
    .otherwise(() => 'Open');
}



// form.handleSubmit(onFormSubmit) — standard React Hook Form usage, no type mismatch
declare const form: { handleSubmit: (fn: (data: any) => void | Promise<void>) => (e?: any) => void };
declare function onLoginSubmit(data: { email: string; password: string }): Promise<void>;

function LoginForm() {
  const handleFormSubmit = form.handleSubmit(onLoginSubmit);
  return handleFormSubmit;
}



// onSelect async arrow calling setState with string value — correct usage, no type mismatch
declare function CommandItem(props: { key?: string; onSelect: () => void | Promise<void>; children?: any }): any;
declare function setLocale(locale: string): void;
declare const availableLocales: Array<{ code: string; label: string }>;

function LocaleSwitcher() {
  return availableLocales.map((locale) =>
    CommandItem({
      key: locale.code,
      onSelect: async () => setLocale(locale.code),
      children: locale.label,
    }),
  );
}



// cn() with className argument — standard Tailwind class merge utility, no type mismatch
declare function cn(...classes: (string | undefined | null | false)[]): string;
declare const className: string | undefined;

function AvatarSkeleton({ className }: { className?: string }) {
  return {
    containerClass: cn('flex flex-col items-center rounded-xl bg-neutral-100 p-4', className),
    imageClass: cn('h-20 w-20 rounded-full border-2', className),
  };
}



// cn('w-full', className) with ...props spread — standard Tailwind merge passthrough, no type mismatch
declare function cn(...classes: (string | undefined | null | false)[]): string;

function TabsContainer({ className, ...props }: { className?: string; [key: string]: any }) {
  return {
    className: cn('w-full', className),
    ...props,
  };
}



// useCallback wrapping form.getValues — standard React Hook Form callback, no type mismatch
declare function useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly any[]): T;
declare const form: { getValues: (key: string) => any; trigger: (key: string) => Promise<boolean> };

function useRecipientSyncCallback() {
  const syncRecipients = useCallback(
    async (index: number, newRole: string) => {
      const currentRecipients = form.getValues('recipients');
      const updatedRecipients = currentRecipients.map((r: any, i: number) =>
        i === index ? { ...r, role: newRole } : r,
      );

      await form.trigger('recipients');
      return updatedRecipients;
    },
    [form],
  );

  return { syncRecipients };
}



// onOpenChange arrow with short-circuit expression — setIsOpen(value) called with boolean, no type mismatch
declare function Dialog(props: { open: boolean; onOpenChange: (value: boolean) => void; children?: any }): any;
declare function useState<T>(init: T): [T, (val: T) => void];

function DeleteConfirmDialog({ children }: { children?: any }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  return Dialog({
    open: isOpen,
    onOpenChange: (value) => !isDeleting && setIsOpen(value),
    children,
  });
}



// onChange with nullish coalescing to '' — type-safe fallback, no type mismatch
declare function useState<T>(init: T): [T, (val: T) => void];
declare function SignaturePad(props: { value: string; onChange: (v: string | null | undefined) => void; disabled?: boolean }): any;

function SignatureCapture() {
  const [signature, setSignature] = useState('');

  return SignaturePad({
    value: signature,
    onChange: (v) => setSignature(v ?? ''),
    disabled: false,
  });
}



// field.onChange(groups.map(...)) — correctly typed array passed to react-hook-form field, no type mismatch
type Group = { id: string; name: string };
type FieldValue = { groupId: string; role: string };
declare const field: { onChange: (value: FieldValue[]) => void; value: FieldValue[] };
declare const selectedGroups: Group[];

function handleGroupSelection(newGroups: Group[]) {
  field.onChange(
    newGroups.map((group) => ({
      groupId: group.id,
      role:
        field.value.find((v) => v.groupId === group.id)?.role || 'member',
    })),
  );
}



// useMemo returning column definitions — columns correctly typed for DataTable, no type mismatch
declare function useMemo<T>(factory: () => T, deps: readonly any[]): T;
declare function DateTime(args: any): { toRelative: () => string | null };
type ColumnDef<T> = { header: string; accessorKey: string; cell?: (props: { row: { original: T } }) => any };

type LinkedAccount = { provider: string; createdAt: Date | null };

function useLinkedAccountColumns() {
  const columns = useMemo(() => {
    return [
      {
        header: 'Provider',
        accessorKey: 'provider',
        cell: ({ row }: { row: { original: LinkedAccount } }) => row.original.provider,
      },
      {
        header: 'Linked At',
        accessorKey: 'createdAt',
        cell: ({ row }: { row: { original: LinkedAccount } }) =>
          row.original.createdAt
            ? DateTime({ jsDate: row.original.createdAt }).toRelative()
            : 'Unknown',
      },
    ] satisfies ColumnDef<LinkedAccount>[];
  }, []);

  return columns;
}



// onOpenChange returning undefined or calling setIsOpen — both valid return types, no type mismatch
declare function Dialog(props: { open: boolean; onOpenChange: (value: boolean) => void; children?: any }): any;
declare function useState<T>(init: T): [T, (val: T) => void];

function RevokeSessionsDialog({ disabled }: { disabled?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  return Dialog({
    open: isOpen,
    onOpenChange: (value) => (isProcessing ? undefined : setIsOpen(value)),
    children: null,
  });
}



// FP shape: standard React select onChange handler; no type mismatch
declare function setTheme(v: string): void;

function ThemeSelector() {
  return (
    <select onChange={(e) => setTheme(e.target.value)}>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  );
}



// FP shape: onChange arrow calling setter with nullish coalescing; no type mismatch
declare function setComment(v: string): void;

function CommentInput({ onValueChange }: { onValueChange?: (v: string | null) => void }) {
  return (
    <input
      type="text"
      onChange={(v) => setComment(v ?? '')}
    />
  );
}



// FP shape: array.map with index key rendering list JSX; no type mismatch
declare const options: Array<{ label: string; value: string }>;
declare function Checkbox(props: { key?: number; label: string; value: string }): JSX.Element;

function OptionList() {
  return (
    <div>
      {options.map((opt, index) => (
        <Checkbox key={index} label={opt.label} value={opt.value} />
      ))}
    </div>
  );
}



// FP shape: ts-pattern match(enum).with(EnumValue, () => JSX); no type mismatch
declare function match<T>(val: T): { with: <P>(pattern: P, fn: () => unknown) => { otherwise: (fn: () => unknown) => unknown } };
declare const StatusBadge: { PENDING: string; COMPLETE: string };
declare const currentStatus: string;

function StatusView() {
  return match(currentStatus)
    .with(StatusBadge.PENDING, () => <span>Pending</span>)
    .otherwise(() => <span>Done</span>);
}



// FP shape: React.forwardRef with intersection type; no type mismatch
declare namespace React {
  function forwardRef<T, P>(fn: (props: P, ref: unknown) => JSX.Element): (props: P) => JSX.Element;
  type ComponentPropsWithoutRef<T> = Record<string, unknown>;
  type ElementRef<T> = HTMLElement;
}

type ToggleProps = React.ComponentPropsWithoutRef<'button'> & { pressed?: boolean };

const Toggle = React.forwardRef<React.ElementRef<'button'>, ToggleProps>(
  ({ pressed, ...props }, ref) => (
    <button aria-pressed={pressed} {...props} />
  )
);



// FP shape: useCallback with drag-and-drop result type; no type mismatch
declare function useCallback<T extends Function>(fn: T, deps: unknown[]): T;
declare const reorderItems: (sourceIdx: number, destIdx: number) => void;

type DragResult = { source: { index: number }; destination?: { index: number } | null };

function SortableList() {
  const onDragEnd = useCallback(
    async (result: DragResult) => {
      if (!result.destination) return;
      reorderItems(result.source.index, result.destination.index);
    },
    []
  );
  return <div onDrop={() => {}} />;
}



// FP shape: onOpenChange arrow returning null or side-effect call; no type mismatch
declare const modal: { close: (err: null) => void };

function DropdownPanel({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  return (
    <div
      onClick={() =>
        onOpenChange
          ? onOpenChange(false)
          : modal.close(null)
      }
    />
  );
}



// FP shape: async callback forwarding typed args to sign handler; no type mismatch
declare function signDocument(authOpts: unknown, displayName: string): Promise<void>;
declare const localName: string;

const reAuthProps = {
  onReauthFormSubmit: async (authOptions: unknown) =>
    await signDocument(authOptions, localName),
};



// FP shape: onChange calling setter with e.target.value string method; no type mismatch
declare function setDisplayName(v: string): void;

function NameInput() {
  return (
    <input
      type="text"
      onChange={(e) => setDisplayName(e.target.value.trimStart())}
      placeholder="Enter your name"
    />
  );
}



// FP shape: ts-pattern match on object destructure with enum values; no type mismatch
declare function match<T>(val: T): { with: <P>(pattern: P, fn: () => unknown) => { otherwise: (fn: () => unknown) => unknown } };
declare const UserRole: { ADMIN: string; VIEWER: string };
declare const userRole: string;
declare const targetSection: string;

const canAccess = match({ role: userRole, section: targetSection })
  .with({ role: UserRole.ADMIN }, () => true)
  .otherwise(() => false);



// FP shape: array.map rendering list with key prop; no type mismatch
declare const participants: Array<{ id: string; name: string; email: string }>;

function ParticipantList() {
  return (
    <ul>
      {participants.map((participant) => (
        <li key={participant.id}>
          {participant.name} — {participant.email}
        </li>
      ))}
    </ul>
  );
}



// FP shape: optional-chain array.map with index for error messages; no type mismatch
declare const validationErrors: { messages?: string[] } | undefined;

function ValidationErrorList() {
  return (
    <ul>
      {validationErrors?.messages?.map((error, index) => (
        <li key={index} className="text-red-500">{error}</li>
      ))}
    </ul>
  );
}



// FP shape: forwardRef with custom props; no type mismatch
declare namespace React {
  function forwardRef<T, P>(fn: (props: P, ref: unknown) => JSX.Element): (props: P & { ref?: unknown }) => JSX.Element;
}

type PanelProps = {
  title: string;
  collapsible?: boolean;
  className?: string;
};

const CollapsiblePanel = React.forwardRef<HTMLDivElement, PanelProps>(
  ({ title, collapsible = true, className }, ref) => (
    <div ref={ref} className={className}>
      <h3>{title}</h3>
    </div>
  )
);



// FP shape: useMemo with array.find — standard React memo computation
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare const order: { lineItems: Array<{ assigneeId: number }>; fields: unknown[] };
declare const selectedAssigneeId: number | null;

function useOrderEditor() {
  const isAssigneeDisabled = useMemo(() => {
    const selectedAssignee = order.lineItems.find(
      (item) => item.assigneeId === selectedAssigneeId,
    );
    const fields = order.fields;
    if (!selectedAssignee) {
      return true;
    }
    return fields === null;
  }, [selectedAssigneeId, order.lineItems, order.fields]);

  return isAssigneeDisabled;
}



// FP shape: Object.values(enumMap).map(item => <Component />) — standard enum map to JSX
declare const STATUS_LABEL_MAP: Record<string, string>;

function StatusList() {
  return (
    <ul>
      {Object.values(STATUS_LABEL_MAP).map((label) => (
        <li key={label}>{label}</li>
      ))}
    </ul>
  );
}



// FP shape: i18n(msg`label`) inside JSX span — i18n call is correct
declare function _(template: TemplateStringsArray, ...args: unknown[]): string;
declare function msg(template: TemplateStringsArray, ...args: unknown[]): TemplateStringsArray;

function MetricsTable() {
  return (
    <table>
      <thead>
        <tr>
          <th><span>{_`Name`}</span></th>
          <th><span>{_`Value`}</span></th>
          <th><span>{_`Updated`}</span></th>
        </tr>
      </thead>
    </table>
  );
}



// FP shape: form.handleSubmit(onFormSubmit) — standard React Hook Form pattern
declare const profileForm: { handleSubmit: (fn: (data: Record<string, unknown>) => Promise<void>) => (e: Event) => void };

async function onProfileFormSubmit(data: Record<string, unknown>): Promise<void> {
  await saveProfile(data);
}

declare function saveProfile(data: Record<string, unknown>): Promise<void>;

function ProfileEditDialog() {
  return (
    <form onSubmit={profileForm.handleSubmit(onProfileFormSubmit)}>
      <button type="submit">Save</button>
    </form>
  );
}



// FP shape: values.map rendering controlled Input with onChange — standard React controlled input
declare const fieldOptions: string[];
declare function setFieldOptions(next: string[]): void;

function DynamicOptionsEditor() {
  return (
    <ul>
      {fieldOptions.map((option, index) => (
        <li key={index}>
          <input
            type="text"
            value={option}
            onChange={(e) => {
              const next = [...fieldOptions];
              next[index] = e.target.value;
              setFieldOptions(next);
            }}
          />
        </li>
      ))}
    </ul>
  );
}



// FP shape: executeProcedure({ onSuccess, onError, target }) — object literal matching expected signature
declare function executeSecureAction(opts: {
  onReauthRequired: () => void;
  actionTarget: string;
}): void;
declare const targetResourceId: string;

function SecureActionButton() {
  function handleClick() {
    executeSecureAction({
      onReauthRequired: () => {
        window.location.href = '/login?redirect=' + encodeURIComponent(window.location.href);
      },
      actionTarget: targetResourceId,
    });
  }
  return <button onClick={handleClick}>Execute</button>;
}



// FP shape: useRef<Set<Promise<T>>>(new Set()) — generic Set initialization as ref
declare function useRef<T>(initial: T): { current: T };

function useAsyncTracker() {
  const pendingOps = useRef<Set<Promise<unknown>>>(new Set());

  async function trackOperation(op: Promise<unknown>) {
    pendingOps.current.add(op);
    try {
      await op;
    } finally {
      pendingOps.current.delete(op);
    }
  }

  return { pendingOps, trackOperation };
}



// FP shape: onDrop async arrow taking files[] and calling handler(files[0]) — correct type
declare function onFileSelected(file: File): Promise<void>;

function FileDropZone() {
  async function onDrop(files: File[]) {
    if (files.length > 0) {
      await onFileSelected(files[0]);
    }
  }

  return (
    <div
      onDrop={(e) => {
        e.preventDefault();
        const droppedFiles = Array.from(e.dataTransfer.files);
        void onDrop(droppedFiles);
      }}
    >
      Drop file here
    </div>
  );
}



// FP shape: form.getValues('field').map(...) — typed array from form values
declare const workspaceForm: { getValues: (field: string) => Array<{ name: string; permissions: string[] }> };

function WorkspaceRolesDisplay() {
  return (
    <ul>
      {workspaceForm.getValues('roles').map((role, index) => (
        <li key={index}>
          <strong>{role.name}</strong>: {role.permissions.join(', ')}
        </li>
      ))}
    </ul>
  );
}



// FP shape: items.map(item => !hiddenIds[item.id] && <Component />) — standard conditional render
declare const formFields: Array<{ id: string; label: string; value: string }>;
declare const collapsedFieldIds: Record<string, boolean>;

function ReadOnlyFormFields() {
  return (
    <div>
      {formFields.map((field) => !collapsedFieldIds[field.id] && (
        <div key={field.id}>
          <label>{field.label}</label>
          <span>{field.value}</span>
        </div>
      ))}
    </div>
  );
}



// Wave-M13: onOpenChange with boolean guard — standard dialog pattern
declare const isSubmitting: boolean;
declare function setDialogOpen(open: boolean): void;

const dialogProps = {
  onOpenChange: (value: boolean) => !isSubmitting && setDialogOpen(value),
};



// Wave-M15: useMemo with .filter(predicateFn) — predicate takes item returns boolean
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare function isItemRequiredAndUnsigned(item: { required: boolean; inserted: boolean }): boolean;
declare const localItems: Array<{ required: boolean; inserted: boolean; id: string }>;

const itemsRequiringValidation = useMemo(() => {
  return localItems.filter((item) => isItemRequiredAndUnsigned(item));
}, [localItems]);



// Wave-M20: table.getRowModel().rows.map((row) => <Row key={row.id} />) — standard TanStack table rendering
declare function flexRender(component: unknown, context: unknown): unknown;
declare const table: {
  getRowModel: () => { rows: Array<{ id: string; original: unknown; getIsSelected: () => boolean; getVisibleCells: () => Array<{ id: string; column: { columnDef: { cell: unknown }; getSize: () => number }; getContext: () => unknown }> }> };
  getHeaderGroups: () => Array<{ id: string; headers: Array<{ id: string; isPlaceholder: boolean; column: { columnDef: { header: unknown } }; getContext: () => unknown }> }>;
};

function renderTableRows() {
  return table.getRowModel().rows.map((row) => ({
    key: row.id,
    isSelected: row.getIsSelected(),
    cells: row.getVisibleCells().map((cell) => ({
      key: cell.id,
      width: cell.column.getSize(),
      content: flexRender(cell.column.columnDef.cell, cell.getContext()),
    })),
  }));
}



// Wave-M24: form.watch('fieldName') call inside JSX — typed correctly for form schema
declare const form: { watch: (field: 'recipientName' | 'recipientEmail') => string };

const confirmationText = `Sending to ${form.watch('recipientName')} (${form.watch('recipientEmail')})`;



// Wave-M38: String(item) used as JSX value prop — converts item to string for value attribute
declare const validationLengths: number[];
declare function handleSelect(field: string, value: string): void;

function renderLengthOptions(validationLengths: number[]) {
  return validationLengths.map((item, index) => ({
    key: index,
    value: String(item),
    label: item,
  }));
}



// Wave-M42: renderAvatars(recipients) — recipients correctly typed for this function
declare interface Participant { id: number; name: string; email: string; role: string }
declare function renderAvatars(participants: Participant[]): unknown;
declare const participants: Participant[];

const avatarElements = renderAvatars(participants);



// Wave-M46: useMemo with .filter() and auth extraction call — all arguments correctly typed
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare function extractAuthMethods(opts: { documentAuth: object; recipientAuth: object }): { requiresEmail: boolean; requiresAction: boolean };
declare const recipientsWithIndex: Array<{ id: string; authOptions: object; email: string; index: number }>;
declare const documentAuthOptions: object;

const recipientsMissingEmail = useMemo(() => {
  return recipientsWithIndex.filter((recipient) => {
    const auth = extractAuthMethods({
      documentAuth: documentAuthOptions,
      recipientAuth: recipient.authOptions,
    });
    return (auth.requiresEmail || auth.requiresAction) && !recipient.email;
  });
}, [recipientsWithIndex, documentAuthOptions]);



// FP: ts-pattern match().with(string_literal, () => JSX) — correct usage
declare const match: <T>(value: T) => { with: <P>(pattern: P, handler: () => any) => any };
declare const validationError: string | null;

function renderValidationFeedback() {
  return match(validationError)
    .with('required', () => <span>This field is required</span>)
    .with('invalid-email', () => <span>Please enter a valid email</span>)
    .with('too-short', () => <span>Value is too short</span>);
}



// FP: .map() over items array in JSX with key={item.id} — correct JSX render pattern
interface DownloadItem { id: string; name: string; size: number; }
declare const downloadItems: DownloadItem[];

function DownloadList() {
  return (
    <ul>
      {downloadItems.map((item) => (
        <li key={item.id}>
          {item.name} ({item.size} bytes)
        </li>
      ))}
    </ul>
  );
}



// FP: row.getValue('columnId') in TanStack table cell renderer — getValue with string key is correct API
declare const row: { getValue: (columnId: string) => unknown };

const userEmailColumn = {
  accessorKey: 'email',
  cell: ({ row }: { row: typeof row }) => {
    const email = row.getValue('email') as string;
    return <span>{email}</span>;
  },
};



// FP: onClick={() => handleColumnSort('columnKey')} — string literal passed to function expecting string
declare function handleColumnSort(column: string): void;

function SortableTableHeader() {
  return (
    <div>
      <button onClick={() => handleColumnSort('createdAt')}>Created</button>
      <button onClick={() => handleColumnSort('totalVolume')}>Volume</button>
      <button onClick={() => handleColumnSort('memberCount')}>Members</button>
    </div>
  );
}



// FP: Object.entries(themeVars).map() in JSX — Object.entries returns [string, string][] entries, correct
declare const themeVars: Record<string, string>;

function ThemeVariablesPanel() {
  return (
    <div>
      {Object.entries(themeVars).map(([key, value]) => (
        <div key={key}>
          <code>{key}</code>: <span>{value}</span>
        </div>
      ))}
    </div>
  );
}



// FP: options.map((item, index) => <SelectItem value={item.value}>) — standard JSX render; types correct
interface SelectOption { value: string; label: string; }
declare const SelectItem: React.FC<{ value: string; children?: React.ReactNode }>;
declare const currencyOptions: SelectOption[];

function CurrencySelect() {
  return (
    <select>
      {currencyOptions.map((item, index) => (
        <SelectItem key={index} value={item.value}>
          {item.label}
        </SelectItem>
      ))}
    </select>
  );
}



// FP: entries.map(([groupKey, groupItems], groupIndex) => <CommandGroup key={groupIndex}>) — destructured array map
declare const CommandGroup: React.FC<{ children?: React.ReactNode }>;
declare const categoryMap: Array<[string, Array<{ id: number; label: string }>]>;

function CategoryList() {
  return (
    <div>
      {categoryMap.map(([categoryKey, categoryItems], categoryIndex) => (
        <CommandGroup key={categoryIndex}>
          <h3>{categoryKey}</h3>
          {categoryItems.map((item) => (
            <div key={item.id}>{item.label}</div>
          ))}
        </CommandGroup>
      ))}
    </div>
  );
}



// FP: notifications.map(({id, title, body, action, ...rest}) => <Notification key={id} {...rest}>) — destructured map with spread in JSX
interface NotificationData { id: string; title: string; body: string; action?: (() => void); type: string; variant: string; }
declare const Notification: React.FC<{ type: string; variant: string }>;
declare const notifications: NotificationData[];

function NotificationStack() {
  return (
    <div>
      {notifications.map(({ id, title, body, action, ...rest }) => (
        <Notification key={id} {...rest} />
      ))}
    </div>
  );
}



// FP: .map() over wizard steps in JSX; step.icon is correctly typed as icon component
interface WizardStep { id: string; label: string; icon: React.FC<{ className?: string }>; completed: boolean; }
declare const wizardSteps: WizardStep[];

function WizardProgressBar() {
  return (
    <nav>
      {wizardSteps.map((step) => {
        const Icon = step.icon;
        return (
          <div key={step.id}>
            <Icon className={step.completed ? 'text-green-500' : 'text-gray-400'} />
            <span>{step.label}</span>
          </div>
        );
      })}
    </nav>
  );
}



// FP: React.forwardRef<React.ElementRef<typeof Primitive>, React.ComponentPropsWithoutRef<...>>; correct forwardRef generics
declare const SearchPrimitive: React.FC<{ onValueChange?: (v: string) => void; className?: string; }>;
declare const cn: (...classes: (string | undefined | false)[]) => string;

const SearchInput = React.forwardRef<
  React.ElementRef<typeof SearchPrimitive>,
  React.ComponentPropsWithoutRef<typeof SearchPrimitive>
>(({ className, ...props }, ref) => (
  <SearchPrimitive
    className={cn('rounded border px-3 py-2', className)}
    {...props}
  />
));
SearchInput.displayName = 'SearchInput';



// FP: .map() over apiTokens in JSX with key={token.id} — correct JSX render
interface ApiToken { id: string; name: string; createdAt: string; lastUsed: string | null; }
declare const apiTokens: ApiToken[];

function ApiTokenList() {
  return (
    <ul>
      {apiTokens.map((token) => (
        <li key={token.id}>
          <strong>{token.name}</strong>
          <time>{token.createdAt}</time>
        </li>
      ))}
    </ul>
  );
}



// FP: React.forwardRef with div wrapper and cn(className) — correct forwardRef pattern
declare const cn: (...classes: (string | undefined | false)[]) => string;

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('rounded-lg border bg-white shadow-sm', className)}
    {...props}
  />
));
Card.displayName = 'Card';



// FP: <OptionItem key={i} onSelect={() => handleSelect(option.value)}> — option.value is correctly typed string
interface FilterOption { value: string; label: string; }
declare const OptionItem: React.FC<{ onSelect: () => void; children?: React.ReactNode }>;
declare function handleSelect(value: string): void;
declare const filterOptions: FilterOption[];

function FilterMenu() {
  return (
    <ul>
      {filterOptions.map((option, i) => (
        <OptionItem key={i} onSelect={() => handleSelect(option.value)}>
          {option.label}
        </OptionItem>
      ))}
    </ul>
  );
}



// FP: formatOptions.map((item, index) => <SelectItem value={item.value}>) — correct JSX render with typed value
interface FormatOption { value: string; label: string; preview?: string; }
declare const SelectItem: React.FC<{ value: string; children?: React.ReactNode }>;
declare const dateFormatOptions: FormatOption[];

function DateFormatPicker() {
  return (
    <div>
      {dateFormatOptions.map((item, index) => (
        <SelectItem key={index} value={item.value}>
          {item.label}
        </SelectItem>
      ))}
    </div>
  );
}



// FP: ts-pattern exhaustive match returning ReactNode paragraphs — correct types
declare const match: <T>(value: T) => {
  with: <P>(pattern: P, handler: () => React.ReactNode) => {
    with: <P2>(pattern: P2, handler: () => React.ReactNode) => {
      exhaustive: () => React.ReactNode;
    };
  };
};
declare const completionStatus: 'success' | 'expired' | 'pending';

function CompletionMessage() {
  return match(completionStatus)
    .with('success', () => <p>Your request was completed successfully.</p>)
    .with('expired', () => <p>This link has expired. Please request a new one.</p>)
    .exhaustive();
}



// FP: header: () => <span>{columnLabel}</span> — TanStack table header returning JSX, correct type
declare function _: (descriptor: { id: string; defaultMessage: string }) => string;
declare function msg(strings: TemplateStringsArray): { id: string; defaultMessage: string };

const tableColumns = [
  {
    accessorKey: 'joinedAt',
    header: () => <span className="whitespace-nowrap">{_(msg`Joined`)}</span>,
  },
  {
    accessorKey: 'lastActive',
    header: () => <span className="whitespace-nowrap">{_(msg`Last active`)}</span>,
  },
];



// FP: onOpenChange guard: (open) => !isLoading && setDialogOpen(open) — standard dialog open pattern
declare const isLoading: boolean;
declare const setDialogOpen: (open: boolean) => void;

function ConfirmDialog() {
  return (
    <div
      data-open={false}
      onClick={() => {}}
    >
      <input
        onChange={(e) => {
          const open = e.target.checked;
          if (!isLoading && open !== undefined) {
            setDialogOpen(open);
          }
        }}
      />
    </div>
  );
}

declare const Dialog: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void; children?: React.ReactNode }>;

function DeleteModal({ isDeleting, open }: { isDeleting: boolean; open: boolean }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => !isDeleting && setDialogOpen(value)}
    />
  );
}



// FP: useState initializer with .find() returning T | undefined, then || null — correct useState<T|null> pattern
interface TeamMember { id: string; name: string; role: string; }
declare const teamMembers: TeamMember[];
declare const defaultMemberId: string | null;
declare const useState: <T>(initial: T) => [T, (v: T) => void];

const [selectedMember, setSelectedMember] = useState<TeamMember | null>(
  teamMembers.find((m) => m.id === defaultMemberId) || null,
);



// FP: Array(count).fill(0).map((_, index) => ...) — standard array construction idiom; types correct
declare const skeletonRows: number;

function SkeletonTable() {
  return (
    <tbody>
      {Array(skeletonRows)
        .fill(0)
        .map((_, index) => (
          <tr key={index}>
            <td className="animate-pulse bg-gray-200 h-4 rounded" />
            <td className="animate-pulse bg-gray-200 h-4 rounded" />
            <td className="animate-pulse bg-gray-200 h-4 rounded" />
          </tr>
        ))}
    </tbody>
  );
}



// FP: <ImageComponent src={getStaticUrl('/assets/banner.png')} className="..."> — standard JSX props, not a type mismatch
declare const ImageComponent: React.FC<{ src: string; className?: string; alt?: string }>;
declare function getStaticUrl(path: string): string;

function EmailBanner() {
  return (
    <div>
      <ImageComponent
        src={getStaticUrl('/assets/banner.png')}
        className="w-full max-w-lg mx-auto"
        alt="Welcome banner"
      />
    </div>
  );
}



// FP: useState initialized with .sort() using numeric subtraction comparator — valid sort comparator
interface SortablePanel { id: string; title: string; order: number; }
declare const dashboardPanels: SortablePanel[];
declare const useState: <T>(initial: T) => [T, (v: T) => void];

const [panels, setPanels] = useState<SortablePanel[]>(
  [...dashboardPanels].sort((a, b) => a.order - b.order),
);



// FP: responseData?.breadcrumbs.map((crumb) => <div key={crumb.id}>) — standard optional-chained JSX render
interface Breadcrumb { id: string; label: string; href: string; }
declare const responseData: { breadcrumbs: Breadcrumb[] } | undefined;

function BreadcrumbNav() {
  return (
    <nav>
      {responseData?.breadcrumbs.map((crumb) => (
        <a key={crumb.id} href={crumb.href}>
          {crumb.label}
        </a>
      ))}
    </nav>
  );
}



// Async event handlers with void operator pattern
declare function copyToClipboard(text: string): Promise<boolean>;
declare function showToast(message: string): void;

export function NotificationPanel({ notifications }: { notifications: Array<{ id: string; message: string }> }): JSX.Element {
  const handleCopyNotificationId = async (notificationId: string) => {
    try {
      const success = await copyToClipboard(notificationId);
      
      if (!success) {
        throw new Error('Copy failed');
      }
      
      showToast('Notification ID copied to clipboard');
    } catch (err) {
      showToast('Failed to copy notification ID');
    }
  };

  return (
    <div>
      {notifications.map((notification) => (
        <div key={notification.id}>
          <span>{notification.message}</span>
          <button onClick={() => void handleCopyNotificationId(notification.id)}>
            Copy ID
          </button>
        </div>
      ))}
    </div>
  );
}



// Notification type selector pattern
declare const NotificationOption: React.FC<{
  key?: string;
  value: string;
  children: React.ReactNode;
}>;

interface NotificationConfig {
  availableTypes: string[];
}

export function NotificationTypeSelector({ config }: { config: NotificationConfig }): JSX.Element {
  const formatDisplayName = (type: string): string => type.replace(/_/g, ' ').toUpperCase();
  
  return (
    <div>
      {config.availableTypes.map((notifType) => (
        <NotificationOption key={notifType} value={notifType}>
          {formatDisplayName(notifType)}
        </NotificationOption>
      ))}
    </div>
  );
}



// Form field with ternary normalization
declare const Select: React.ComponentType<{
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}>;

interface FieldController {
  onChange: (value: string | null) => void;
  value: string | null;
}

export function CategorySelector({ field }: { field: FieldController }) {
  return (
    <Select
      value={field.value === null ? 'unset' : field.value}
      onValueChange={(value) => field.onChange(value === 'unset' ? null : value)}
    >
      <option value="electronics">Electronics</option>
      <option value="books">Books</option>
      <option value="unset">No Category</option>
    </Select>
  );
}

export function PriorityDropdown({ field }: { field: FieldController }) {
  return (
    <Select
      value={field.value ?? 'none'}
      onValueChange={(priority) => field.onChange(priority === 'none' ? null : priority)}
    >
      <option value="high">High</option>
      <option value="medium">Medium</option>
      <option value="low">Low</option>
      <option value="none">None</option>
    </Select>
  );
}



// Table row API that returns unknown values (common in data grid libraries)
declare const dataRow: {
  getValue: (key: string) => unknown;
  original: Record<string, unknown>;
};

// Cell renderers that convert unknown table values to numbers (intentional type conversion)
export function ProductPriceCell(): JSX.Element {
  return <div>{Number(dataRow.getValue('price'))}</div>;
}

export function QuantityCell(): JSX.Element {
  return <span>{Number(dataRow.getValue('quantity'))}</span>;
}

export function StockLevelCell(): JSX.Element {
  const stockValue = Number(dataRow.getValue('stockLevel'));
  return <div className="stock">{stockValue}</div>;
}



// Array.map() in JSX with key prop — no type mismatch
declare const availableProducts: Array<{ id: string; title: string; description: string }>;

export function ProductGrid(): JSX.Element {
  return (
    <div className="grid">
      {availableProducts.map((product) => (
        <div key={product.id} className="product-card">
          <h3>{product.title}</h3>
          <p>{product.description}</p>
        </div>
      ))}
    </div>
  );
}



// Pattern matching with ts-pattern - state machine rendering
declare const match: <T>(value: T) => {
  with: <P>(pattern: P, handler: () => JSX.Element) => any;
  exhaustive: () => JSX.Element;
};

enum VerificationStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED'
}

export function VerificationStatusDisplay({ status }: { status: VerificationStatus }): JSX.Element {
  return match(status)
    .with(VerificationStatus.PENDING, () => (
      <div className="status-container">
        <span className="icon pending" />
        <p>Verification in progress...</p>
      </div>
    ))
    .with(VerificationStatus.SUCCESS, () => (
      <div className="status-container">
        <span className="icon success" />
        <p>Verification successful!</p>
      </div>
    ))
    .with(VerificationStatus.FAILED, () => (
      <div className="status-container">
        <span className="icon error" />
        <p>Verification failed. Please try again.</p>
      </div>
    ))
    .with(VerificationStatus.EXPIRED, () => (
      <div className="status-container">
        <span className="icon warning" />
        <p>Verification token has expired.</p>
      </div>
    ))
    .exhaustive();
}



// Valid functional setState pattern with computed property key
declare function useState<T>(initial: T): [T, (updater: T | ((prev: T) => T)) => void];
declare function generateLoadingKey(id: string, action: string): string;

interface LoadingStates {
  [key: string]: boolean;
}

export function FileUploadManager() {
  const [loadingStates, setLoadingStates] = useState<LoadingStates>({});

  const handleFileUpload = async (fileId: string, operation: 'upload' | 'process') => {
    const key = generateLoadingKey(fileId, operation);

    if (loadingStates[key]) {
      return;
    }

    // Valid: functional setState with spread and computed property
    setLoadingStates((prev) => ({
      ...prev,
      [generateLoadingKey(fileId, operation)]: true,
    }));

    try {
      // Simulate async operation
      await Promise.resolve();

      setLoadingStates((prev) => ({
        ...prev,
        [generateLoadingKey(fileId, operation)]: false,
      }));
    } catch (error) {
      setLoadingStates((prev) => ({
        ...prev,
        [generateLoadingKey(fileId, operation)]: false,
      }));
    }
  };

  return null;
}



// False positive: string.split() returns string[], map callback correctly receives string
declare const userProfile: { bio: string };

function UserBioDisplay() {
  return (
    <div className="bio-section">
      {userProfile.bio.split('\n').map((paragraph, idx) => {
        return (
          <>
            {idx > 0 && <br />}
            {paragraph}
          </>
        );
      })}
    </div>
  );
}

// Similar pattern with company address
declare const companyInfo: { address: string };

function CompanyAddress() {
  return (
    <address className="text-sm">
      {companyInfo.address.split('\n').map((line, index) => (
        <span key={index}>
          {index > 0 && <br />}
          {line}
        </span>
      ))}
    </address>
  );
}



// Functional setState patterns - these are valid React state updates
export function CounterComponent(): JSX.Element {
  const [count, setCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [retryAttempts, setRetryAttempts] = useState(0);

  const incrementCount = () => {
    setCount((prev) => prev + 1);
  };

  const nextPage = () => {
    setPageNumber((current) => current + 1);
  };

  const handleRetry = () => {
    setRetryAttempts((attempts) => attempts + 1);
  };

  return (
    <div>
      <button onClick={incrementCount}>Count: {count}</button>
      <button onClick={nextPage}>Page: {pageNumber}</button>
      <button onClick={handleRetry}>Retries: {retryAttempts}</button>
    </div>
  );
}

export function AnimationController(): JSX.Element {
  const [animationKey, setAnimationKey] = useState(0);

  const resetAnimation = () => {
    setAnimationKey((prev) => prev + 1);
  };

  return <div key={animationKey} onClick={resetAnimation}>Animated Content</div>;
}

function useState<S>(initialState: S): [S, (value: S | ((prev: S) => S)) => void] {
  return [initialState, () => {}];
}



// Modal toggle component using functional setState updater
declare function useState<T>(initialValue: T): [T, (value: T | ((prev: T) => T)) => void];

export function ModalToggle() {
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggleVisibility = () => {
    // Valid: functional setState with boolean updater
    setIsVisible((visible) => !visible);
  };

  const handleToggleExpansion = () => {
    // Valid: functional setState with boolean updater
    setIsExpanded((expanded) => !expanded);
  };

  return null;
}

export function DialogController() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const toggleDialog = () => {
    // Valid: functional setState receiving previous boolean state
    setIsDialogOpen((isOpen) => !isOpen);
  };

  return null;
}



// Pattern: input onChange handler with e.target.value passed to string-typed function
declare const useState: <T>(initial: T) => [T, (v: T) => void];

export function EmailInput(): JSX.Element {
  const [email, setEmail] = useState('');

  const handleEmailUpdate = (value: string) => {
    setEmail(value);
  };

  return (
    <input
      type="email"
      value={email}
      onChange={(e) => handleEmailUpdate(e.target.value)}
    />
  );
}

export function PasswordField(): JSX.Element {
  const [password, setPassword] = useState('');

  const updatePassword = (newPassword: string) => {
    setPassword(newPassword);
  };

  return (
    <input
      type="password"
      value={password}
      onChange={(e) => updatePassword(e.target.value)}
    />
  );
}



// useMemo with filter using boolean predicate
declare const useMemo: <T>(factory: () => T, deps: unknown[]) => T;

interface Task {
  id: string;
  title: string;
  completed: boolean;
}

export function TaskList({ tasks, showAll }: { tasks: Task[]; showAll: boolean }): JSX.Element {
  const pendingTasks = useMemo(() => {
    if (showAll) {
      return tasks.filter((task) => !task.completed);
    }
    return tasks.filter((task) => !task.completed);
  }, [tasks, showAll]);

  return (
    <div>
      {pendingTasks.map((task) => (
        <div key={task.id}>{task.title}</div>
      ))}
    </div>
  );
}



// Snippet: standard React list rendering with stable id key, no type mismatch
declare const React: any;
declare function ListItem(props: { key: number; label: string; value: string }): any;
declare const categoryItems: Array<{ id: number; label: string; value: string }>;

export function CategoryList() {
  return React.createElement(
    'ul',
    null,
    categoryItems.map((item) =>
      React.createElement(ListItem, { key: item.id, label: item.label, value: item.value }),
    ),
  );
}



// Snippet: onOpenChange guard pattern — standard dialog handler
declare const formState: { isSubmitting: boolean };
declare function setModalOpen(value: boolean): void;

export const dialogOpenChangeHandler = (value: boolean) =>
  !formState.isSubmitting && setModalOpen(value);



// Snippet: onValueChange with explicit as-cast to string literal union — intentional cast
type BillingCycle = 'monthly' | 'annual';
declare function setBillingCycle(cycle: BillingCycle): void;

export const handleBillingCycleChange = (value: string) =>
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  setBillingCycle(value as BillingCycle);



// Snippet: JSX component call with string return from translation function — correct types
declare function translate(strings: TemplateStringsArray, ...values: unknown[]): string;
declare function SelectPlaceholder(props: { placeholder: string }): any;

export function SelectWithTranslatedPlaceholder() {
  return SelectPlaceholder({ placeholder: translate`Choose an option` });
}



// Snippet: onValueChange ternary converting sentinel to undefined — field.onChange accepts string | undefined
declare function fieldOnChange(value: string | undefined): void;
declare const EMPTY_SENTINEL = '-1';

export const handleDropdownChange = (value: string) =>
  fieldOnChange(value === EMPTY_SENTINEL ? undefined : value);



// Snippet: useMemo wrapping filter chain on typed array — boolean predicate
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare function sortByPosition<T>(items: T[]): T[];
declare const formItems: Array<{ id: string; completed: boolean; required: boolean }>;

export const pendingRequiredItems = useMemo(
  () => sortByPosition(formItems.filter((item) => !item.completed && item.required)),
  [formItems],
);



// Snippet: .map() over paginated data in JSX with stable id key — no type mismatch
declare const React: any;
declare function FileItem(props: { key: number; href: string; name: string }): any;
declare const fileList: { data: Array<{ id: number; url: string; label: string }> };

export function FileListPanel() {
  return React.createElement(
    'ul',
    null,
    fileList.data.map((file) =>
      React.createElement(FileItem, { key: file.id, href: file.url, name: file.label }),
    ),
  );
}



// Snippet: .map() over typed array in JSX rendering table rows — no type mismatch
declare const React: any;
declare function TableRow(props: { key: number; children: unknown }): any;
declare function TableCell(props: { children: string }): any;
declare const approvedContributors: Array<{ id: number; name: string; email: string }>;

export function ContributorsTable() {
  return React.createElement(
    'tbody',
    null,
    approvedContributors.map((row) =>
      React.createElement(
        TableRow,
        { key: row.id },
        React.createElement(TableCell, null, row.name),
        React.createElement(TableCell, null, row.email),
      ),
    ),
  );
}



// Snippet: Object.values(enum).map() in JSX SelectItem — Object.values returns string[]
enum PermissionLevel { Read = 'READ', Write = 'WRITE', Admin = 'ADMIN' }
declare const React: any;
declare function SelectOption(props: { key: string; value: string; children: string }): any;

export function PermissionSelector() {
  return React.createElement(
    'select',
    null,
    Object.values(PermissionLevel).map((level) =>
      React.createElement(SelectOption, { key: level, value: level }, level),
    ),
  );
}



// Snippet: useEffect with void operator on async call — valid pattern
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function triggerAuthFlow(opts: { onSuccess: () => Promise<void>; target: string }): Promise<void>;
declare const fieldType: string;
declare const hasDefaultValue: boolean;
declare function onComplete(): Promise<void>;

useEffect(() => {
  if (hasDefaultValue) {
    void triggerAuthFlow({
      onSuccess: async () => onComplete(),
      target: fieldType,
    });
  }
}, []);



// Snippet: standard HTML input onChange event handler — types correct
declare function setQuery(value: string): void;

export const handleSearchInput = (e: { target: { value: string } }) =>
  setQuery(e.target.value);



// Snippet: onOpenChange guard preventing close while submitting — idiomatic React
declare const formState: { isSubmitting: boolean };
declare function setDialogOpen(open: boolean): void;

export const guardedOpenChange = (value: boolean) =>
  !formState.isSubmitting && setDialogOpen(value);



// Snippet: .map() with .findIndex() inside JSX — correct array method usage
declare const React: any;
declare function FieldCard(props: { key: string; index: number; label: string }): any;
declare const layoutFields: Array<{ formId: string; label: string }>;
declare const assignees: Array<{ id: number }>;

export function FieldGrid() {
  return React.createElement(
    'div',
    null,
    layoutFields.map((field) =>
      React.createElement(FieldCard, {
        key: field.formId,
        index: assignees.findIndex((a) => a.id === Number(field.formId)),
        label: field.label,
      }),
    ),
  );
}



// Snippet: onValueChange null-sentinel pattern — field.onChange accepts null | string
declare function fieldOnChange(value: null | string): void;
declare const NULL_SENTINEL = '__null__';

export const handleNullableSelectorChange = (value: string) =>
  fieldOnChange(value === NULL_SENTINEL ? null : value);



// Snippet: form.handleSubmit(onFormSubmit) — standard react-hook-form pattern
declare const form: { handleSubmit: (fn: (data: { title: string }) => Promise<void>) => (e: unknown) => void };
declare async function onFormSubmit(data: { title: string }): Promise<void>;

export const submitHandler = form.handleSubmit(onFormSubmit);



// Snippet: React.forwardRef with correct generic type parameters
declare const React: {
  forwardRef: <T, P>(render: (props: P, ref: unknown) => unknown) => unknown;
};
declare function cn(...args: unknown[]): string;

export const DataCell = React.forwardRef<
  HTMLTableCellElement,
  { className?: string; truncate?: boolean; children?: unknown }
>(({ className, truncate = true, ...props }, ref) => {
  return { ref, className: cn('p-4', truncate && 'truncate', className), ...props };
});



// Snippet: setState with functional updater returning same-type trimmed array
declare function setNavigationStack(fn: (prev: string[]) => string[]): void;

export function popNavigationPage() {
  setNavigationStack((pages) => pages.slice(0, -1));
}



// Snippet: div with ref and cn() className — correct attribute types
declare const React: any;
declare const childRef: { current: HTMLDivElement | null };
declare function cn(...args: unknown[]): string;
declare const extraClass: string | undefined;

export function AutoSizingContainer({ children }: { children: unknown }) {
  return React.createElement(
    'div',
    { ref: childRef, className: cn('inline-block leading-none', extraClass) },
    children,
  );
}



// Snippet: setState with functional updater using modulo arithmetic — number arithmetic is type-correct
declare function setCurrentSlide(fn: (prev: number) => number): void;
declare const totalSlides: number;

export function advanceSlide() {
  setCurrentSlide((prev) => (prev + 1) % totalSlides);
}



// Shape: standard React onChange handler with e.target.value
declare function useState<T>(init: T): [T, (v: T) => void];

function ConfirmationInput({ expectedValue }: { expectedValue: string }) {
  const [inputValue, setInputValue] = useState('');

  return (
    <input
      type="text"
      value={inputValue}
      onChange={(e) => setInputValue(e.target.value)}
      placeholder={`Type "${expectedValue}" to confirm`}
    />
  );
}



// Shape: .map() where field.icon is a component type assigned to a capitalized variable
interface ControlItem { controlType: string; label: string; icon: React.ComponentType<{ className?: string }> }
declare const controlItems: ControlItem[];

function renderControlItems(controlItems: ControlItem[]) {
  return controlItems.map((item) => {
    const Icon = item.icon;
    return (
      <button key={item.controlType} type="button">
        {Icon && <Icon className="h-4 w-4" />}
        <span>{item.label}</span>
      </button>
    );
  });
}



// Shape: setState updater spreading Record<string,string> with computed key override
declare function useState<T>(init: T): [T, (updater: T | ((prev: T) => T)) => void];

function ThemeEditor() {
  const [themeVars, setThemeVars] = useState<Record<string, string>>({});

  const handleColorChange = (varName: string, colorValue: string) => {
    setThemeVars((prev) => ({ ...prev, [varName]: colorValue }));
  };

  const handleClearVar = (varName: string) => {
    setThemeVars((prev) => ({ ...prev, [varName]: '' }));
  };

  return null;
}



// Shape: setState updater building cleared Record<string,string> from previous keys
declare function useState<T>(init: T): [T, (updater: T | ((prev: T) => T)) => void];

function StyleEditor() {
  const [styleVars, setStyleVars] = useState<Record<string, string>>({ color: '#ff0000', size: '14px' });

  const clearAllStyles = () => {
    setStyleVars((prev) => {
      const cleared: Record<string, string> = {};
      for (const key of Object.keys(prev)) {
        cleared[key] = '';
      }
      return cleared;
    });
  };

  return null;
}



// Shape: JSX prop with tagged template translation — t`...` returns string, placeholder expects string
declare function t(strings: TemplateStringsArray, ...values: unknown[]): string;
declare const Select: React.ComponentType<{ value?: string; onValueChange?: (v: string) => void; children?: React.ReactNode }>;
declare const SelectTrigger: React.ComponentType<{ className?: string; children?: React.ReactNode }>;
declare const SelectValue: React.ComponentType<{ placeholder?: string }>;
declare const SelectContent: React.ComponentType<{ children?: React.ReactNode }>;
declare const SelectItem: React.ComponentType<{ value: string; children?: React.ReactNode }>;

function AlignmentSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="mt-2">
        <SelectValue placeholder={t`Select alignment`} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="left">Left</SelectItem>
        <SelectItem value="center">Center</SelectItem>
        <SelectItem value="right">Right</SelectItem>
      </SelectContent>
    </Select>
  );
}



// Shape: onValueChange mapping sentinel string to null — field.onChange accepts null
declare const Select: React.ComponentType<{ value: string; onValueChange: (v: string) => void; children?: React.ReactNode }>;
declare const SelectTrigger: React.ComponentType<{ children?: React.ReactNode }>;
declare const SelectValue: React.ComponentType;
declare const SelectContent: React.ComponentType<{ children?: React.ReactNode }>;
declare const SelectItem: React.ComponentType<{ value: string; children?: React.ReactNode }>;

function AssigneeSelect({ field }: { field: { value: string | null; onChange: (v: string | null) => void } }) {
  return (
    <Select
      value={field.value === null ? '-1' : field.value}
      onValueChange={(value) => field.onChange(value === '-1' ? null : value)}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="-1">Unassigned</SelectItem>
        <SelectItem value="user-1">Alice</SelectItem>
      </SelectContent>
    </Select>
  );
}



// Shape: React onChange={(e) => setState(e.target.value)} — HTMLInputElement event handler
declare function useState<T>(init: T): [T, (v: T) => void];

function SearchInput({ onSearch }: { onSearch: (query: string) => void }) {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <input
      type="text"
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      placeholder="Search..."
    />
  );
}

function FilterInput({ label }: { label: string }) {
  const [filterValue, setFilterValue] = useState('');

  return (
    <div>
      <label>{label}</label>
      <input
        type="text"
        value={filterValue}
        onChange={(e) => setFilterValue(e.target.value)}
      />
    </div>
  );
}



// Shape: setCurrentStep={(step) => setStep(StepsArray[step - 1])} — array indexed by step number
declare const WizardSteps: string[];
declare function useState<T>(init: T): [T, (v: T) => void];

function MultiStepWizard({ children }: { children?: React.ReactNode }) {
  const [activeStep, setActiveStep] = useState(WizardSteps[0]);

  return (
    <div>
      <Stepper
        currentStep={WizardSteps.indexOf(activeStep) + 1}
        setCurrentStep={(step: number) => setActiveStep(WizardSteps[step - 1])}
      >
        {children}
      </Stepper>
    </div>
  );
}

declare const Stepper: React.ComponentType<{ currentStep: number; setCurrentStep: (step: number) => void; children?: React.ReactNode }>;



// Shape: React.forwardRef<Element, Props>((props, ref) => {...}) — correct forwardRef generic
declare const React: {
  forwardRef<T, P>(render: (props: P, ref: React.Ref<T>) => React.ReactElement | null): React.ForwardRefExoticComponent<P & React.RefAttributes<T>>;
};
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  bordered?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, elevated, bordered, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={['card', elevated ? 'card--elevated' : '', bordered ? 'card--bordered' : '', className].filter(Boolean).join(' ')}
        {...props}
      />
    );
  },
);



// Shape: onValueChange receives string, Number(value) converts it to number for state setter
declare function useState<T>(init: T): [T, (v: T) => void];
declare const Select: React.ComponentType<{ value?: string; onValueChange: (v: string) => void; children?: React.ReactNode }>;
declare const SelectTrigger: React.ComponentType<{ children?: React.ReactNode }>;
declare const SelectValue: React.ComponentType;
declare const SelectContent: React.ComponentType<{ children?: React.ReactNode }>;
declare const SelectItem: React.ComponentType<{ value: string; children?: React.ReactNode }>;

function TeamMemberSelect({ members }: { members: { id: number; name: string }[] }) {
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);

  return (
    <Select
      value={selectedMemberId?.toString()}
      onValueChange={(value) => setSelectedMemberId(Number(value))}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {members.map((m) => (
          <SelectItem key={m.id} value={m.id.toString()}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}



// Shape: arrow function in .map() over typed items array — callback receives correct item type
interface ActionItem { href: string; title: string; icon: React.ReactNode; }
declare const actionItems: ActionItem[];

function ActionList({ items }: { items: ActionItem[] }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.href}>
          <a href={item.href}>
            {item.icon}
            {item.title}
          </a>
        </li>
      ))}
    </ul>
  );
}



// Shape 6068e9ddf076: Array.map() over Map entries inside JSX; destructured [key, value] is correct.
declare const fieldCountsByCategory: Map<string, number>;
declare function CategoryBadge(props: { category: string; count: number }): JSX.Element;

function CategorySummaryList(): JSX.Element {
  return (
    <ul>
      {Array.from(fieldCountsByCategory.entries()).map(([category, count]) => (
        <li key={category}>
          <CategoryBadge category={category} count={count} />
        </li>
      ))}
    </ul>
  ) as unknown as JSX.Element;
}



// Shape 60ef6b8d8173: onChange event handler calling string state setter with e.target.value.
declare function useState_string(init: string): [string, (v: string) => void];

function ThemeEditor(): JSX.Element {
  const [rawCss, setRawCss] = useState_string('');
  return (
    <textarea
      value={rawCss}
      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRawCss(e.target.value)}
    />
  ) as unknown as JSX.Element;
}



// Shape 61484b741cab: React.forwardRef for a search input with correct element/props generics.
declare namespace React {
  function forwardRef<T, P>(render: (props: P, ref: React.Ref<T>) => JSX.Element): (props: P & { ref?: React.Ref<T> }) => JSX.Element;
  type Ref<T> = { current: T | null };
  type ElementRef<T> = T extends new (...args: unknown[]) => infer R ? R : never;
}
declare const SearchRoot: new () => HTMLInputElement;
interface SearchInputProps { placeholder?: string; className?: string }

const SearchInput = React.forwardRef<React.ElementRef<typeof SearchRoot>, SearchInputProps>(
  ({ placeholder, className }, ref) => (
    <input ref={ref as unknown} className={className} placeholder={placeholder} />
  ) as unknown as JSX.Element,
);



// Shape 618a42b17d39: React.forwardRef with extended props interface (required optional field).
declare namespace ReactExt {
  function forwardRef<T, P>(render: (props: P, ref: unknown) => JSX.Element): (props: P) => JSX.Element;
  type ElementRef<C> = C extends new () => infer T ? T : never;
}
declare const LabelRoot: new () => HTMLLabelElement;
interface LabelRootProps { htmlFor?: string; children?: unknown }
interface RequiredLabelProps extends LabelRootProps { required?: boolean }

const RequiredLabel = ReactExt.forwardRef<ReactExt.ElementRef<typeof LabelRoot>, RequiredLabelProps>(
  ({ required, children, ...props }, ref) => (
    <label {...(props as object)} ref={ref as unknown}>
      {children}{required && <span aria-hidden>*</span>}
    </label>
  ) as unknown as JSX.Element,
);



// Shape 61d05e890624: Array.map() with findIndex() inside JSX; correct types.
interface FormEntry { id: string; label: string }
declare const formEntries: FormEntry[];
declare const selectedEntryId: string;
declare function EntryRow(props: { entry: FormEntry; index: number; isSelected: boolean }): JSX.Element;

function EntryList(): JSX.Element {
  const selectedIndex = formEntries.findIndex((e) => e.id === selectedEntryId);
  return (
    <ul>
      {formEntries.map((entry, index) => (
        <li key={entry.id}>
          <EntryRow entry={entry} index={index} isSelected={index === selectedIndex} />
        </li>
      ))}
    </ul>
  ) as unknown as JSX.Element;
}



// Shape 6213d6fddbb6: onOpenChange callback guarded by boolean loading state.
declare function useModal(): { isOpen: boolean; setIsOpen: (v: boolean) => void; isProcessing: boolean };

function useCopyDialog() {
  const { isOpen, setIsOpen, isProcessing } = useModal();
  const handleOpenChange = (value: boolean): void => {
    if (!isProcessing) {
      setIsOpen(value);
    }
  };
  return { isOpen, handleOpenChange };
}



// Shape 6271ee64c66d: React Hook Form handleSubmit() returning FormEventHandler for onSubmit prop.
declare function useFormRHF<T>(): { handleSubmit: (fn: (data: T) => Promise<void>) => React.FormEventHandler };
interface ResetPasswordData { email: string }
declare function sendPasswordReset(data: ResetPasswordData): Promise<void>;

function PasswordResetForm(): JSX.Element {
  const { handleSubmit } = useFormRHF<ResetPasswordData>();
  return (
    <form className="space-y-4" onSubmit={handleSubmit(sendPasswordReset)}>
      <button type="submit">Reset</button>
    </form>
  ) as unknown as JSX.Element;
}



// Shape 651963506a2f: array.map((item, index) => <SelectItem key={index} value={item}>) — JSX array render; types correct.
declare function SelectItem(props: { key?: unknown; value: string; children?: unknown }): JSX.Element;
declare const validationRuleLabels: string[];

function ValidationRuleSelect(): JSX.Element {
  return (
    <select>
      {validationRuleLabels.map((item, index) => (
        <SelectItem key={index} value={item}>
          {item}
        </SelectItem>
      ))}
    </select>
  ) as unknown as JSX.Element;
}



// Shape 6548a6e0edc6: onValueChange callback with ternary returning null or array; field.onChange accepts both.
declare function useController(): { field: { onChange: (v: null | string[]) => void } };

function MultiSelectField(): JSX.Element {
  const { field } = useController();
  return (
    <select
      onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
        field.onChange(e.target.value === '-1' ? null : [e.target.value])
      }
    />
  ) as unknown as JSX.Element;
}



// Shape 654d2bf9fdf8: useMemo returning a typed editor config; helper called with correct args.
interface EditorConfig { title: string; locale: string; timezone: string }
interface DocumentMeta { locale?: string; timezone?: string }
declare function useMemoHook<T>(fn: () => T, deps: unknown[]): T;
declare function extractDocumentMeta(meta: DocumentMeta): { locale: string; timezone: string };
declare const documentMeta: DocumentMeta;
declare const documentTitle: string;

const editorConfig = useMemoHook<EditorConfig>(() => {
  const { locale, timezone } = extractDocumentMeta(documentMeta);
  return { title: documentTitle, locale, timezone };
}, [documentMeta, documentTitle]);



// Shape 6615e101f9c3: onClick handler passing boolean true to boolean state setter.
declare function useState_bool(init: boolean): [boolean, (v: boolean) => void];

function AppHeader(): JSX.Element {
  const [isSearchOpen, setIsSearchOpen] = useState_bool(false);
  return (
    <header>
      <button type="button" onClick={() => setIsSearchOpen(true)}>Search</button>
      <button type="button" onClick={() => setIsSearchOpen(false)}>Close</button>
    </header>
  ) as unknown as JSX.Element;
}



// Shape 6e00e24b665f: onChange updating state with spread and checkbox value — valid React state updater
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];

interface FeatureFlags { darkMode: boolean; notifications: boolean; analytics: boolean; }

function FeatureFlagPanel() {
  const [flags, setFlags] = useState<FeatureFlags>({ darkMode: false, notifications: true, analytics: false });
  return (
    <div>
      {(Object.keys(flags) as Array<keyof FeatureFlags>).map((key) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={flags[key]}
            onChange={(e) => setFlags((prev) => ({ ...prev, [key]: e.target.checked }))}
          />
          {key}
        </label>
      ))}
    </div>
  );
}



// Shape 6e1b3d9d6fa8: onChange={(e) => setter(e.target.value)} — standard input onChange handler
declare function useState<T>(init: T): [T, (v: T) => void];

function EmailInput() {
  const [email, setEmail] = useState('');
  return (
    <input
      type="email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      className="border rounded px-2 py-1"
    />
  );
}



// Shape 6e9b394e742f: ReactEmail.render(<Component>...) with JSX and options — valid email render call
declare const ReactEmail: { render: (element: React.ReactNode, options?: { plainText?: boolean }) => Promise<string> };
declare const BrandingWrapper: React.ComponentType<{ children: React.ReactNode }>;

async function buildEmailHtml(content: React.ReactNode) {
  return ReactEmail.render(
    <BrandingWrapper>
      {content}
    </BrandingWrapper>,
    { plainText: false },
  );
}



// Shape 6eacd547cad9: onValueChange converting sentinel to null — intentional string-to-null transform
declare function useState<T>(init: T): [T, (v: T) => void];
declare const FORMATS: Array<{ key: string; value: string; label: string }>;

function FormatSelector() {
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);
  return (
    <select
      value={selectedFormat === null ? '-1' : selectedFormat}
      onChange={(e) => setSelectedFormat(e.target.value === '-1' ? null : e.target.value)}
    >
      <option value="-1">None</option>
      {FORMATS.map((fmt) => (
        <option key={fmt.key} value={fmt.value}>{fmt.label}</option>
      ))}
    </select>
  );
}



// Shape 6f5e6aae1121: Dialog onOpenChange={(value) => setOpen(value)} — passthrough boolean handler
declare function useState<T>(init: T): [T, (v: T) => void];
declare const DialogRoot: React.ComponentType<{ open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }>;
declare const DialogContent: React.ComponentType<{ children: React.ReactNode }>;

function ShareLinksDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <DialogRoot open={open} onOpenChange={(value) => setOpen(value)}>
      <DialogContent>
        {trigger}
      </DialogContent>
    </DialogRoot>
  );
}



// Shape 6fc989b4600a: useMemo with array.find() returning item or null — valid nullable find
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
interface Participant { id: number; name: string; role: string; }
declare const meeting: { participants: Participant[] } | null;
declare const selectedParticipantId: number | null;

const selectedParticipant = useMemo(() => {
  return meeting?.participants.find((p) => p.id === selectedParticipantId) || null;
}, [meeting?.participants, selectedParticipantId]);



// Shape 6fcf7453f39a: form.handleSubmit(onSubmit) — standard react-hook-form pattern
declare const useForm: <T>() => { handleSubmit: (fn: (data: T) => Promise<void>) => React.FormEventHandler; formState: { isSubmitting: boolean } };
interface SupportTicketData { subject: string; message: string; }

function SupportTicketForm() {
  const form = useForm<SupportTicketData>();

  const onSubmit = async (data: SupportTicketData) => {
    await fetch('/api/support', { method: 'POST', body: JSON.stringify(data) });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <button type="submit" disabled={form.formState.isSubmitting}>Submit</button>
    </form>
  );
}



// Shape 7007fb574ffa: chained .filter().map() over typed array for React rendering — no type mismatch
interface Signer { id: number; name: string; fields: unknown[]; signingStatus: string; }
declare const allSigners: Signer[];

function SignerList() {
  return (
    <ul>
      {allSigners
        .filter((s) => s.fields.length > 0)
        .map((s) => (
          <li key={s.id}>{s.name}</li>
        ))}
    </ul>
  );
}



// Shape 70ef07d747a0: .map() rendering React list of form fields with index key — no type mismatch
interface MemberInvite { id: string; email: string; role: string; }
declare const memberInvites: MemberInvite[];

function MemberInviteList() {
  return (
    <div>
      {memberInvites.map((invite, index) => (
        <div key={invite.id} className="flex flex-row space-x-4">
          <span>{index + 1}. {invite.email}</span>
          <span>{invite.role}</span>
        </div>
      ))}
    </div>
  );
}



// Shape 725ce87a5b9a: array.map() rendering button elements — standard JSX list rendering
interface ToolbarItem { type: string; label: string; icon: string; }
declare const toolbarItems: ToolbarItem[];
declare function handleToolSelect(type: string): void;

function ToolbarPanel() {
  return (
    <div className="grid grid-cols-5 gap-1 rounded-md border bg-white p-1">
      {toolbarItems.map((item) => (
        <button
          key={item.type}
          onClick={() => handleToolSelect(item.type)}
          className="rounded px-2 py-1 text-xs hover:bg-gray-100"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}



// Shape 738f6c9f764c: array.map() rendering divs with onMouseEnter setting hovered state — valid JSX list
interface OrgEntry { id: number; name: string; url: string; }
declare const organisations: OrgEntry[];
declare function useState<T>(init: T): [T, (v: T | null) => void];
declare function cn(...args: (string | boolean | undefined)[]): string;

function OrgSwitcher({ currentOrgId }: { currentOrgId: number }) {
  const [hoveredOrgId, setHoveredOrgId] = useState<number | null>(null);
  return (
    <div>
      {organisations.map((org) => (
        <div
          key={org.id}
          className={cn('px-4 py-2', org.id === hoveredOrgId && 'bg-accent')}
          onMouseEnter={() => setHoveredOrgId(org.id)}
        >
          {org.name}
        </div>
      ))}
    </div>
  );
}



// Shape 7418e6891d7b: array.map() rendering li elements with template literal — standard JSX list
interface RecipientEntry { name: string; email: string; }
declare const recipients: RecipientEntry[];

function RecipientPreviewList() {
  return (
    <ul className="mt-2 list-inside list-disc text-sm">
      {recipients.map((recipient, index) => (
        <li key={index}>
          {recipient.name ? `${recipient.name} (${recipient.email})` : recipient.email}
        </li>
      ))}
    </ul>
  );
}



// Shape 743f6afd174c: array.map((item, i) => <li key={i}>) — standard JSX list render with index key
interface InfoItem { description: string; value: string; }
declare const documentInfo: InfoItem[];
declare function _(msg: string): string;

function DocumentInfoList() {
  return (
    <ul className="divide-y border-t">
      {documentInfo.map((item, i) => (
        <li key={i} className="flex items-center justify-between px-4 py-2 text-sm">
          <span className="text-muted-foreground">{_(item.description)}</span>
          <span>{item.value}</span>
        </li>
      ))}
    </ul>
  );
}



// --- argument-type-mismatch shape: forEach + setValue in react-hook-form ---
// signers.forEach calling setValue per index — standard RHF pattern, no type mismatch.
declare const SigningMode: { SEQUENTIAL: string; PARALLEL: string };
declare function setValue(path: string, value: unknown): void;
declare const signers: Array<{ id: string; email: string }>;
function applySigningOrder(mode: string): void {
  if (mode === SigningMode.SEQUENTIAL) {
    signers.forEach((_signer, index) => {
      setValue(`signers.${index}.signingOrder`, index + 1);
    });
  }
}



// --- argument-type-mismatch shape: form.handleSubmit(onSubmit) ---
// Standard react-hook-form handleSubmit wrapping a typed submit handler.
declare function useForm<T>(): { handleSubmit: (fn: (data: T) => void | Promise<void>) => (e: React.FormEvent) => void; formState: { isSubmitting: boolean } };
interface SsoFormValues { enabled: boolean; providerUrl: string }
function SsoSettingsForm(): void {
  const form = useForm<SsoFormValues>();
  const onSubmit = async (data: SsoFormValues): Promise<void> => {
    console.log('updating provider', data.providerUrl);
  };
  const handleFormSubmit = form.handleSubmit(onSubmit);
  console.log(handleFormSubmit);
}



// --- argument-type-mismatch shape: filter excluding enum roles ---
// recipients.filter with !== comparison for two enum values; standard exclusion filter.
declare const ParticipantRole: { CC: string; VIEWER: string; SIGNER: string; APPROVER: string };
interface Participant { id: number; role: string; sendStatus: string }
declare const SendState: { SENT: string; PENDING: string };
declare const participants: Participant[];
declare function setActiveSigner(p: Participant | undefined): void;
function updateActiveSigner(): void {
  const signable = participants.filter(
    (p) => p.role !== ParticipantRole.CC && p.role !== ParticipantRole.VIEWER,
  );
  setActiveSigner(
    signable.find((r) => r.sendStatus !== SendState.SENT) ?? signable[0],
  );
}



// --- argument-type-mismatch shape: string split + map with index key ---
// (bio ?? '').split('\n').map((line, index) => <p key={index}>) — standard JSX list render.
declare const React: { createElement: (tag: string, props: object, ...children: unknown[]) => unknown };
function renderBioLines(bio: string | null): unknown[] {
  return (bio ?? '').split('\n').map((line, index) =>
    React.createElement('p', { key: index, className: 'bio-line' }, line),
  );
}



// --- argument-type-mismatch shape: i18n.date() in table cell renderer ---
// i18n.date(row.original.createdAt) formats a Date object; valid i18n call, no type mismatch.
declare const i18n: { date: (d: Date) => string };
interface TeamInviteRow { email: string; createdAt: Date; organisationRole: string }
declare const ROLE_LABEL_MAP: Record<string, string>;
const inviteColumns = [
  { header: 'Email', accessorKey: 'email' as const },
  { header: 'Role', accessorKey: 'organisationRole' as const, cell: ({ row }: { row: { original: TeamInviteRow } }) => ROLE_LABEL_MAP[row.original.organisationRole] },
  { header: 'Invited', accessorKey: 'createdAt' as const, cell: ({ row }: { row: { original: TeamInviteRow } }) => i18n.date(row.original.createdAt) },
];



// --- argument-type-mismatch shape: Array(n).fill(0).map for loading skeletons ---
// Array(3).fill(0).map((_, index) => ...) — standard skeleton loader pattern, no type mismatch.
declare const React: { createElement: (tag: string, props: object, ...c: unknown[]) => unknown };
function renderSkeletonRows(count: number): unknown[] {
  return Array(count)
    .fill(0)
    .map((_, index) =>
      React.createElement('div', { key: index, className: 'skeleton-row' },
        React.createElement('div', { className: 'skeleton-line' }),
      ),
    );
}



// --- argument-type-mismatch shape: React.forwardRef with Radix UI primitive types ---
// React.forwardRef<ElementRef<typeof Primitive>, ComponentPropsWithoutRef<typeof Primitive>> — standard Radix wrapper.
declare const React: { forwardRef: <T, P>(render: (props: P, ref: T) => unknown) => unknown };
declare const CollapsiblePrimitive: { Root: unknown; Trigger: unknown };
type CollapsibleRef = React.ElementRef<typeof CollapsiblePrimitive.Root>;
type CollapsibleProps = React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Root> & { className?: string };
declare namespace React {
  type ElementRef<T> = T extends { new(): infer R } ? R : never;
  type ComponentPropsWithoutRef<T> = T extends (props: infer P) => unknown ? Omit<P, 'ref'> : never;
}
const CollapsibleItem = React.forwardRef<CollapsibleRef, CollapsibleProps>(
  ({ className, ...props }, ref) => {
    console.log(className, props, ref);
    return null;
  },
);



// --- argument-type-mismatch shape: useEffect async search with optional callback ---
// useEffect wrapping async search; onSearch callback is optional, returns Promise<Option[]>.
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;
declare function useState<T>(init: T): [T, (v: T) => void];
interface SearchOption { label: string; value: string }
function useAsyncSearch(
  onSearch: ((term: string) => Promise<SearchOption[]>) | undefined,
  searchTerm: string,
  open: boolean,
): void {
  const [, setOptions] = useState<SearchOption[]>([]);
  const [, setIsLoading] = useState(false);
  useEffect(() => {
    const doSearch = async () => {
      setIsLoading(true);
      const res = await onSearch?.(searchTerm);
      setOptions(res || []);
      setIsLoading(false);
    };
    const exec = async () => {
      if (!onSearch || !open) return;
      if (searchTerm) {
        await doSearch();
      }
    };
    void exec();
  }, [searchTerm, open]);
}



// --- argument-type-mismatch shape: translation function with record index ---
// t(ROLE_MAP[row.original.teamRole]) — i18n lookup with string key indexing; valid pattern.
declare function t(msg: string): string;
declare const TEAM_ROLE_LABELS: Record<string, string>;
interface GroupTeamRow { name: string; teamRole: string }
const groupTeamColumns = [
  { header: 'Team', accessorKey: 'name' as const },
  {
    header: 'Team Role',
    cell: ({ row }: { row: { original: GroupTeamRow } }) => t(TEAM_ROLE_LABELS[row.original.teamRole]),
  },
];



// --- argument-type-mismatch shape: find with fallback to first element ---
// steps.find(step => step.id === param) ?? steps[0] — valid find with default, no type mismatch.
interface WizardStep { id: string; label: string }
declare const wizardSteps: WizardStep[];
declare function useSearchParams(): [{ get: (key: string) => string | null }];
function useCurrentStep(): WizardStep {
  const [searchParams] = useSearchParams();
  const stepParam = searchParams.get('step') || wizardSteps[0].id;
  return wizardSteps.find((step) => step.id === stepParam) || wizardSteps[0];
}



// --- argument-type-mismatch shape: form.handleSubmit wrapping an async handler ---
// form.handleSubmit(onFormSubmit) — react-hook-form standard pattern, types aligned.
declare function useForm<T>(): { handleSubmit: (fn: (data: T) => Promise<void> | void) => (e: React.FormEvent) => void; setValue: (name: keyof T, value: unknown) => void }
declare namespace React { interface FormEvent { preventDefault(): void } }
interface SignInValues { email: string; password: string }
function SignInForm(): void {
  const form = useForm<SignInValues>();
  const onFormSubmit = async (values: SignInValues): Promise<void> => {
    console.log('signing in', values.email);
  };
  const boundSubmit = form.handleSubmit(onFormSubmit);
  console.log(boundSubmit);
}



// --- argument-type-mismatch shape: destructured callback passed to custom hook ---
// useRenderer(({ stage, layer }) => createCanvas(stage, layer)) — matching destructured callback signature.
interface RenderCtx { stage: unknown; layer: unknown }
declare function useRenderer(init: (ctx: RenderCtx) => unknown, data: unknown): { scale: number; pageNumber: number }
declare function createCanvas(stage: unknown, layer: unknown): unknown;
declare const pageData: unknown;
function PageRenderer(): void {
  const { scale, pageNumber } = useRenderer(
    ({ stage, layer }) => createCanvas(stage, layer),
    pageData,
  );
  console.log(scale, pageNumber);
}



// --- argument-type-mismatch shape: form.handleSubmit in dialog onSubmit ---
// form.handleSubmit(onFormSubmit) as <form onSubmit={...}> prop — RHF FormEventHandler pattern.
declare function useForm<T>(): { handleSubmit: (fn: (d: T) => Promise<void>) => React.FormEventHandler; formState: { isSubmitting: boolean } };
declare namespace React { type FormEventHandler = (e: { preventDefault(): void }) => void }
interface CreateOrgValues { name: string; ownerEmail: string }
function CreateOrgDialog(): void {
  const form = useForm<CreateOrgValues>();
  const onFormSubmit = async (data: CreateOrgValues): Promise<void> => {
    console.log('creating org', data.name, 'for', data.ownerEmail);
  };
  const handler = form.handleSubmit(onFormSubmit);
  console.log(handler);
}



// --- argument-type-mismatch shape: matches.some() checking route id string ---
// matches.some(m => m?.id === 'routes/foo') — valid string equality predicate, no type mismatch.
interface RouteMatch { id?: string; pathname: string }
declare const matches: RouteMatch[];
const SIGNING_ROUTE_IDS = ['routes/sign.$token', 'routes/direct.$token'];
const hideNav = matches.some(
  (match) => match?.id !== undefined && SIGNING_ROUTE_IDS.includes(match.id),
);



// --- argument-type-mismatch shape: cn() with conditional input type ---
// cn('pr-10', className) with type ternary — valid classname merge, no type mismatch.
declare function cn(...classes: (string | undefined)[]): string;
declare const React: { forwardRef: <T, P>(render: (props: P, ref: T) => unknown) => unknown };
interface SecureInputProps { className?: string; showReveal?: boolean }
const SecureInput = React.forwardRef<HTMLInputElement, SecureInputProps>((
  { className, showReveal = true, ...props },
  ref,
) => {
  const mergedClass = cn('pr-10', className);
  console.log(mergedClass, showReveal, props, ref);
  return null;
});



// --- argument-type-mismatch shape: field.onChange with map updating one item by index ---
// field.onChange(recipients.map((r, i) => i === index ? {...r, role} : r)) — standard RHF field array update.
declare function useWatch<T>(opts: { name: string }): T;
declare const ParticipantRole: { SIGNER: string; APPROVER: string; VIEWER: string; CC: string };
interface ParticipantEntry { email: string; role: string }
declare function field_onChange(val: ParticipantEntry[]): void;
declare const participants: ParticipantEntry[];
function updateParticipantRole(index: number, newRole: string): void {
  field_onChange(
    participants.map((participant, idx) =>
      idx === index ? { ...participant, role: newRole } : participant,
    ),
  );
}



// --- argument-type-mismatch shape: cn() with className prop spread ---
// cn('base-class', className) in a disclosure/note component — valid class merge, no type mismatch.
declare function cn(...classes: (string | undefined)[]): string;
interface DisclosureProps { className?: string; children?: unknown }
function LegalDisclosure({ className, children }: DisclosureProps): unknown {
  const mergedClass = cn('text-muted text-xs', className);
  console.log(mergedClass, children);
  return null;
}



// --- argument-type-mismatch shape: tRPC useQuery hook with typed input ---
// trpc.resource.list.useQuery({...typed input...}) — types are inferred from router definition.
declare const trpc: {
  group: {
    list: {
      useQuery: (input: { orgId: string; query?: string; page?: number; types?: string[] }, opts?: object) => { data: unknown; isLoading: boolean; isLoadingError: boolean }
    }
  }
};
declare const GroupKind: { CUSTOM: string };
function useGroupList(orgId: string, query?: string): { data: unknown; isLoading: boolean; isLoadingError: boolean } {
  return trpc.group.list.useQuery(
    {
      orgId,
      query,
      page: 1,
      types: [GroupKind.CUSTOM],
    },
    { placeholderData: (prev: unknown) => prev },
  );
}



// --- argument-type-mismatch shape: map with lingui _ translation in JSX ---
// infoItems.map((info, i) => <div key={i}>{_(info.description)}</div>) — valid JSX with lingui macro.
declare function _(msg: string): string;
declare const React: { createElement: (tag: string, props: object, ...c: unknown[]) => unknown };
interface InfoItem { description: string; value: string | number }
declare const documentInformation: InfoItem[];
function renderInfoGrid(): unknown[] {
  return documentInformation.map((info, i) =>
    React.createElement('div', { key: i, className: 'info-cell' },
      React.createElement('h3', { className: 'font-semibold' }, _(info.description)),
      React.createElement('p', { className: 'text-muted' }, String(info.value)),
    ),
  );
}



// FP shape 91dabac8effc: Array.map() over typed array rendering JSX elements — standard render pattern, no type mismatch
declare const FolderIcon: React.ComponentType<{ className?: string }>;

interface Folder {
  id: string;
  name: string;
}

interface FolderListProps {
  folders: Folder[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function FolderList({ folders, selectedId, onSelect }: FolderListProps) {
  return (
    <div className="space-y-2">
      {folders.map((folder) => (
        <button
          key={folder.id}
          type="button"
          className={selectedId === folder.id ? 'font-bold' : 'font-normal'}
          onClick={() => onSelect(folder.id)}
        >
          <FolderIcon className="mr-2 h-4 w-4" />
          {folder.name}
        </button>
      ))}
    </div>
  );
}



// FP shape 91fdb613c240: Array.map() over string chunks rendering JSX — standard list render, no type mismatch
interface MessageBodyProps {
  text?: string;
}

function MessageBody({ text }: MessageBodyProps) {
  if (!text) return null;

  const paragraphs = text.trim().replace(/\n{2,}/g, '\n\n').split('\n\n');

  return paragraphs.map((para, i) => (
    <p key={`para-${i}`} className="whitespace-pre-line break-words text-base text-slate-600">
      {para.split('\n').map((line, j) => (
        <React.Fragment key={`line-${i}-${j}`}>
          {j > 0 && <br />}
          {line}
        </React.Fragment>
      ))}
    </p>
  ));
}



// FP shape 931f04eec35c: custom hook with callback and data argument — no type mismatch
declare function useCanvasRenderer(
  setup: (ctx: { canvas: HTMLCanvasElement; layer: unknown }) => void,
  data: { width: number; height: number; scale: number }
): { canvas: HTMLCanvasElement | null; layer: unknown };

function PageCanvas({ pageData }: { pageData: { width: number; height: number; scale: number } }) {
  const { canvas, layer } = useCanvasRenderer(({ canvas: c, layer: l }) => {
    const ctx = c.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, c.width, c.height);
  }, pageData);

  return <div>{canvas && <span>Canvas ready</span>}</div>;
}



// FP shape 94b9f07089ed: useMemo with Object.entries().filter().map() — standard memoized computation, no type mismatch
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;

type Role = 'ADMIN' | 'VIEWER' | 'EDITOR';

interface Participant {
  id: string;
  name: string;
  role: Role;
}

function useFilteredParticipants(participants: Participant[]) {
  const byRole = useMemo(() => {
    const grouped: Record<Role, Participant[]> = { ADMIN: [], VIEWER: [], EDITOR: [] };
    participants.forEach((p) => grouped[p.role].push(p));
    return grouped;
  }, [participants]);

  const displayGroups = useMemo(() => {
    return Object.entries(byRole)
      .filter(([role]) => role !== 'VIEWER')
      .map(([role, members]) => ({ role: role as Role, members }));
  }, [byRole]);

  return displayGroups;
}



// FP shape 9599b17b691f: useEffect with spread copy of typed array — standard mutable copy pattern, no type mismatch
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;

interface LocalField {
  id: string;
  value: string;
  type: 'TEXT' | 'DATE' | 'NUMBER';
}

function useFieldSync(initialFields: LocalField[]): void {
  useEffect(() => {
    const mutableFields = [...initialFields];

    mutableFields.forEach((field, index) => {
      if (field.type === 'DATE' && !field.value) {
        mutableFields[index] = { ...field, value: new Date().toISOString() };
      }
    });
  }, [initialFields]);
}



// FP shape 95b6d6a23baa: onChange callback converting nullish to empty string — ensures string type, no type mismatch
interface SignatureInputProps {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

declare function SignaturePad(props: {
  value: string;
  onChange: (v: string | null) => void;
  disabled?: boolean;
}): JSX.Element;

function SignatureField({ value, onChange, disabled }: SignatureInputProps) {
  return (
    <SignaturePad
      value={value}
      onChange={(v) => onChange(v ?? '')}
      disabled={disabled}
    />
  );
}



// FP shape 95c7d3563dcc: onResize prop accepting node argument — standard event callback, no type mismatch
interface ResizableField {
  id: string;
  formId: string;
  recipientId: string;
}

interface FieldItemProps {
  field: ResizableField;
  onResize: (node: HTMLElement) => void;
  onMove: (node: HTMLElement) => void;
  onRemove: () => void;
}

declare function FieldItem(props: FieldItemProps): JSX.Element;

function FieldsList({ fields }: { fields: ResizableField[] }) {
  function handleFieldResize(node: HTMLElement, index: number) {
    console.log('Resized field at index', index, node.offsetWidth);
  }

  function handleFieldMove(node: HTMLElement, index: number) {
    console.log('Moved field at index', index, node.offsetLeft);
  }

  return (
    <div>
      {fields.map((field, index) => (
        <FieldItem
          key={field.formId}
          field={field}
          onResize={(node) => handleFieldResize(node, index)}
          onMove={(node) => handleFieldMove(node, index)}
          onRemove={() => console.log('Remove', index)}
        />
      ))}
    </div>
  );
}



// FP shape 95eae161f323: React.forwardRef wrapping HTML input — standard primitive pattern, no type mismatch
type TextInputProps = React.InputHTMLAttributes<HTMLInputElement>;

const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-md border bg-white px-3 py-2 text-sm focus:outline-none',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
TextInput.displayName = 'TextInput';



// FP shape 95efa3403cda: SelectValue placeholder with template literal from i18n function — string result, no type mismatch
type MessageDescriptor = { id: string };
declare function t(msg: MessageDescriptor): string;
declare function msg(strings: TemplateStringsArray): MessageDescriptor;
declare const SelectValue: React.ComponentType<{ defaultValue?: string; placeholder?: string }>;

interface DropdownSelectorProps {
  value: string;
  options: { label: string; value: string }[];
}

function DropdownSelector({ value, options }: DropdownSelectorProps) {
  return (
    <div>
      <SelectValue
        defaultValue={value}
        placeholder={`-- ${t(msg`Select an option`)} --`}
      />
    </div>
  );
}



// FP shape 9625d4670081: useState with lazy initializer returning typed object — valid initializer, no type mismatch
declare function useState<T>(init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];

type SignatureType = 'DRAW' | 'TYPE' | 'UPLOAD';

interface EmbedConfig {
  title: string;
  signatureTypes: SignatureType[];
  redirectUrl: string | undefined;
  allowDictate: boolean;
}

interface DocumentMeta {
  drawEnabled: boolean;
  typeEnabled: boolean;
  uploadEnabled: boolean;
  redirectUrl?: string;
}

function useEmbedConfig(doc: { title: string; meta: DocumentMeta | null }) {
  const [config, setConfig] = useState<EmbedConfig | null>(() => {
    const types: SignatureType[] = [];
    if (doc.meta?.drawEnabled) types.push('DRAW');
    if (doc.meta?.typeEnabled) types.push('TYPE');
    if (doc.meta?.uploadEnabled) types.push('UPLOAD');

    return {
      title: doc.title,
      signatureTypes: types,
      redirectUrl: doc.meta?.redirectUrl ?? undefined,
      allowDictate: false,
    };
  });

  return { config, setConfig };
}



// FP shape 96637e17cb61: table cell with nullish fallback string — standard cell renderer, no type mismatch
interface SessionRow {
  id: string;
  ipAddress: string | null;
  updatedAt: Date;
  createdAt: Date;
}

declare function useRelative(date: Date): string;

function renderIpCell(row: SessionRow): string {
  return row.ipAddress || 'Unknown';
}

function renderLastActiveCell(row: SessionRow): string {
  return useRelative(row.updatedAt);
}



// --- FP shape: Array.map() over detail objects with index key in JSX ---
declare const React: { createElement(type: string, props: Record<string, unknown>, ...children: unknown[]): unknown };
declare const webhookDetails: Array<{ label: string; value: string }>;

const renderedDetails = webhookDetails.map((detail, index) =>
  React.createElement('div', { key: index },
    React.createElement('span', {}, detail.label),
    React.createElement('span', {}, detail.value),
  )
);



// --- FP shape: date formatting in table cell using i18n.date() ---
declare const i18n: { date(d: Date, opts?: Record<string, string>): string };
declare const createdAt: string;

const formattedDate = i18n.date(new Date(createdAt), { dateStyle: 'medium' });



// --- FP shape: onChange handler passing e.target.value to a typed setter ---
declare const setSearchTerm: (value: string) => void;

function handleSearchChange(e: { target: { value: string } }): void {
  setSearchTerm(e.target.value);
}



// --- FP shape: Array.map() with destructured entries rendered in JSX ---
declare const React2: { createElement(type: string, props: Record<string, unknown>, ...children: unknown[]): unknown };
declare const recipientEntries: Array<[string, { name: string; email: string }]>;

const recipientNodes = recipientEntries.map(([key, recipient]) =>
  React2.createElement('div', { key },
    React2.createElement('span', {}, recipient.name),
    React2.createElement('span', {}, recipient.email),
  )
);



// --- FP shape: Array.map() with index parameter used as JSX key ---
declare const React3: { createElement(type: string, props: Record<string, unknown>, ...children: unknown[]): unknown };
declare const formSections: Array<{ title: string; description: string }>;

const sectionNodes = formSections.map((section, index) =>
  React3.createElement('section', { key: index },
    React3.createElement('h3', {}, section.title),
    React3.createElement('p', {}, section.description),
  )
);



// --- FP shape: Radix Select onValueChange callback receiving typed value ---
declare const setSelectedColor: (color: string) => void;
declare const colorOptions: Array<{ value: string; label: string }>;

function handleColorChange(value: string): void {
  setSelectedColor(value);
}

const onValueChange = handleColorChange;



// --- FP shape: TanStack table column def with header function receiving table instance ---
declare const React4: { createElement(type: string, props: Record<string, unknown>, ...children: unknown[]): unknown };
declare const cols: Array<{
  id: string;
  header?: (opts: { table: { getIsAllRowsSelected(): boolean; toggleAllRowsSelected(v: boolean): void } }) => unknown;
  cell?: (opts: { row: { getIsSelected(): boolean; toggleSelected(v: boolean): void } }) => unknown;
}>;

cols.push({
  id: 'select',
  header: ({ table }) =>
    React4.createElement('input', {
      type: 'checkbox',
      checked: table.getIsAllRowsSelected(),
      onChange: (e: { target: { checked: boolean } }) => table.toggleAllRowsSelected(e.target.checked),
    }),
});



// --- FP shape: Array.map() over string values rendering option items with index key ---
declare const React5: { createElement(type: string, props: Record<string, unknown>, ...children: unknown[]): unknown };
declare const dropdownOptions: string[];

const optionNodes = dropdownOptions.map((value, index) =>
  React5.createElement('option', { key: index, value }, value)
);



// --- FP shape: field.onChange() passthrough in controlled component ---
declare const field: { onChange(value: boolean): void; value: boolean };

function handleToggle(value: boolean): void {
  field.onChange(value);
}



// Hook with typed async callback pattern
type SaveConfig = {
  data: Record<string, unknown>;
  timestamp: number;
};

type SaveResult = {
  success: boolean;
  savedAt: Date;
};

declare function useAutosave<T>(
  callback: (value: T) => Promise<SaveResult>
): {
  triggerSave: (value: T) => void;
  isPending: boolean;
};

export function PreferencesEditor() {
  const { triggerSave, isPending } = useAutosave(async (config: SaveConfig['data']) => {
    const response = await fetch('/api/preferences', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    const result = await response.json();
    return {
      success: result.ok,
      savedAt: new Date(result.timestamp),
    };
  });

  return <div>{isPending ? 'Saving...' : 'Saved'}</div>;
}



// argument-type-mismatch: i18n translation function with MessageDescriptor
type MessageDescriptor = { id: string; defaultMessage: string };
declare function translate(descriptor: MessageDescriptor): string;

const ONBOARDING_STEPS = [
  {
    heading: { id: 'step1', defaultMessage: 'Welcome to the platform' } as MessageDescriptor,
    content: { id: 'step1.desc', defaultMessage: 'Get started with your account' } as MessageDescriptor,
  },
  {
    heading: { id: 'step2', defaultMessage: 'Configure your profile' } as MessageDescriptor,
    content: { id: 'step2.desc', defaultMessage: 'Add your details and preferences' } as MessageDescriptor,
  },
];

export function OnboardingWizard(): JSX.Element {
  return (
    <div>
      {ONBOARDING_STEPS.map((step, idx) => (
        <div key={idx}>
          <h3>{translate(step.heading)}</h3>
          <p>{translate(step.content)}</p>
        </div>
      ))}
    </div>
  );
}



// Controlled input with change handler that takes index + value
declare const React: typeof import('react');
declare const Input: React.ComponentType<{
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
}>;

interface FormOption {
  label: string;
}

export function SettingsForm() {
  const [options, setOptions] = React.useState<FormOption[]>([
    { label: 'Default' }
  ]);

  const updateOptionLabel = (index: number, newLabel: string) => {
    const updated = [...options];
    updated[index].label = newLabel;
    setOptions(updated);
  };

  return (
    <div>
      {options.map((option, index) => (
        <div key={index}>
          <Input
            value={option.label}
            onChange={(e) => updateOptionLabel(index, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}



// Utility to merge class names
declare function classNames(...classes: (string | undefined)[]): string;

// UI primitive component (like Radix UI)
declare const TextInputPrimitive: {
  Field: React.ForwardRefExoticComponent<
    React.ComponentPropsWithoutRef<'input'> & React.RefAttributes<HTMLInputElement>
  >;
};

// Variant generator (like class-variance-authority)
declare const inputStyles: () => string;

interface InputFieldProps extends React.ComponentPropsWithoutRef<typeof TextInputPrimitive.Field> {
  variant?: 'default' | 'error';
}

export const InputField = React.forwardRef<
  React.ElementRef<typeof TextInputPrimitive.Field>,
  InputFieldProps
>(({ className, variant, ...props }, ref) => (
  <TextInputPrimitive.Field 
    ref={ref} 
    className={classNames(inputStyles(), className)} 
    {...props} 
  />
));

InputField.displayName = 'InputField';



// Array generation pattern for rendering multiple placeholders
declare const PlaceholderCard: React.FC<{ index: number }>;

function ProductGrid() {
  const itemCount = 8;
  
  return (
    <div className="grid grid-cols-4 gap-4">
      {Array.from({ length: itemCount }).map((_, idx) => (
        <PlaceholderCard key={idx} index={idx} />
      ))}
    </div>
  );
}

function SkeletonList() {
  return (
    <ul>
      {Array.from({ length: 5 }).map((_, position) => (
        <li key={position} className="skeleton-item">
          <span>Loading item {position + 1}</span>
        </li>
      ))}
    </ul>
  );
}



type CartItem = { id: string; name: string; quantity: number };
type ShoppingCart = { items: CartItem[] };

declare function useShoppingCart(): {
  cart: ShoppingCart;
  updateCart: (partial: Partial<ShoppingCart>) => void;
};

export function CartManager() {
  const { cart, updateCart } = useShoppingCart();
  const items = cart.items ?? [];

  const removeItem = (itemId: string) => {
    updateCart({
      items: items.filter((item) => item.id !== itemId),
    });
  };

  const addItem = (newItem: CartItem) => {
    updateCart({
      items: [...items, newItem],
    });
  };

  return (
    <div>
      {items.map((item) => (
        <div key={item.id}>
          <span>{item.name}</span>
          <button onClick={() => removeItem(item.id)}>Remove</button>
        </div>
      ))}
    </div>
  );
}



// useMemo returning table column definitions - standard TanStack table setup
declare const useMemo: <T>(factory: () => T, deps: ReadonlyArray<unknown>) => T;
declare const formatDate: (date: Date) => string;
declare const translate: (key: string) => string;

type ColumnDef<T> = {
  header: string;
  accessorKey: keyof T;
  cell?: (context: { row: { original: T } }) => string | number | React.ReactNode;
};

type ProductItem = {
  sku: string;
  name: string;
  category: string;
  stock: number;
  lastRestocked: Date;
};

function InventoryTable() {
  const productColumns = useMemo(() => {
    return [
      {
        header: translate('product.sku'),
        accessorKey: 'sku' as const,
      },
      {
        header: translate('product.category'),
        accessorKey: 'category' as const,
        cell: ({ row }) => translate(`categories.${row.original.category}`),
      },
      {
        header: translate('product.stock'),
        accessorKey: 'stock' as const,
        cell: ({ row }) => row.original.stock,
      },
      {
        header: translate('product.lastRestocked'),
        accessorKey: 'lastRestocked' as const,
        cell: ({ row }) => formatDate(row.original.lastRestocked),
      },
    ] satisfies ColumnDef<ProductItem>[];
  }, [translate, formatDate]);

  return productColumns;
}



// ts-pattern usage: pattern matching on string literal union types
declare function match<T>(value: T): {
  with<P>(pattern: P, handler: () => any): any;
  exhaustive(): any;
};

type WizardStep = 'details' | 'payment' | 'confirmation';

export function CheckoutWizard() {
  const [currentStep, setCurrentStep] = useState<WizardStep>('details');

  return (
    <div>
      {match(currentStep)
        .with('details', () => (
          <form>
            <label>Name</label>
            <input type="text" />
            <button onClick={() => setCurrentStep('payment')}>Next</button>
          </form>
        ))
        .with('payment', () => (
          <div>
            <h2>Payment Information</h2>
            <input type="text" placeholder="Card number" />
            <button onClick={() => setCurrentStep('confirmation')}>Submit</button>
          </div>
        ))
        .with('confirmation', () => (
          <div>
            <h2>Order Confirmed</h2>
            <p>Thank you for your purchase!</p>
          </div>
        ))
        .exhaustive()}
    </div>
  );
}

type FormMode = 'create' | 'edit' | 'preview';

export function DynamicForm({ mode }: { mode: FormMode }) {
  return match(mode)
    .with('create', () => <button type="submit">Create</button>)
    .with('edit', () => <button type="submit">Save Changes</button>)
    .with('preview', () => <button disabled>Read Only</button>)
    .exhaustive();
}

declare function useState<T>(initial: T): [T, (value: T) => void];



// Array.map() extracting nested property - standard transform pattern
interface TeamMember {
  id: string;
  projectAssignments: Array<{ project: ProjectInfo }>;
}

interface ProjectInfo {
  name: string;
  priority: number;
}

declare function getHighestPriorityProject(projects: ProjectInfo[]): ProjectInfo;

export function TeamMemberCard({ member }: { member: TeamMember }): JSX.Element {
  const activeProjects = member.projectAssignments.map((assignment) => assignment.project);
  const topProject = getHighestPriorityProject(activeProjects);
  
  return <div>{topProject.name}</div>;
}



// Positive: argument-type-mismatch — state updater with map and spread preserving type
interface CartItem {
  id: string;
  name: string;
  quantity: number;
  isProcessing: boolean;
  isDiscounted: boolean;
}

declare function useState<T>(initial: T): [T, (updater: T | ((prev: T) => T)) => void];

export function ShoppingCart(): JSX.Element {
  const [items, setItems] = useState<CartItem[]>([]);

  const markItemAsProcessing = (itemId: string): void => {
    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, isProcessing: true } : item)));
  };

  const applyDiscountToItem = (itemId: string): void => {
    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, isDiscounted: true } : item)));
  };

  return <div>{items.length} items</div>;
}



declare const WORKSPACE_ROLE_HIERARCHY: Record<string, readonly string[]>;
declare const WORKSPACE_ROLE_LABELS: Record<string, string>;
declare function t(label: string): string | null;
declare const SelectContent: (props: { position?: string; children: React.ReactNode }) => JSX.Element;
declare const SelectItem: (props: { value: string; children: React.ReactNode }) => JSX.Element;

interface WorkspaceSession {
  activeRole: string;
}

export function WorkspaceRoleSelector({ session }: { session: WorkspaceSession }): JSX.Element {
  return (
    <SelectContent position="popper">
      {WORKSPACE_ROLE_HIERARCHY[session.activeRole].map((role) => (
        <SelectItem key={role} value={role}>
          {t(WORKSPACE_ROLE_LABELS[role]) ?? role}
        </SelectItem>
      ))}
    </SelectContent>
  );
}



declare function useOrderState(): [OrderState, (updater: (prev: OrderState) => OrderState) => void];

interface OrderItem {
  id: string;
  qty: number;
  name: string;
}

interface OrderSection {
  items: OrderItem[];
  subtotal: number;
}

interface OrderState {
  active: OrderSection;
  pending: OrderSection;
  customerId: string;
}

function OrderPanel() {
  const [orderData, setOrderData] = useOrderState();
  const itemId = 'item-1';
  const updatedItem: OrderItem = { id: itemId, qty: 2, name: 'Widget' };

  const applyUpdate = () => {
    setOrderData((prev) => ({
      ...prev,
      active: {
        ...prev.active,
        items: prev.active.items.map((item) =>
          item.id === itemId ? { ...item, qty: updatedItem.qty } : item,
        ),
      },
      pending: {
        ...prev.pending,
        items: prev.pending.items.map((item) =>
          item.id === itemId ? updatedItem : item,
        ),
      },
    }));
  };

  return null;
}



// File upload drop zone — useFileUploader accept maps MIME type string keys to extension arrays;
// JSX spread of getRootProps()/getInputProps() return values is the standard react-dropzone pattern.
declare function useFileUploader(options: {
  accept?: Record<string, string[]>;
  multiple?: boolean;
  maxSize?: number;
  maxFiles?: number;
  onDrop?: (files: File[]) => void;
  onDropRejected?: (rejections: unknown[]) => void;
  noClick?: boolean;
  noDragEventsBubbling?: boolean;
}): {
  getRootProps: () => Record<string, unknown>;
  getInputProps: () => Record<string, unknown>;
  isDragging: boolean;
};
declare function toBytes(mb: number): number;
declare const MAX_UPLOAD_MB: number;
declare const maxFileCount: number;
declare function handleFiles(files: File[]): Promise<void>;
declare function handleRejection(rejections: unknown[]): void;

export function AttachmentDropZone(): JSX.Element {
  const { getRootProps, getInputProps, isDragging } = useFileUploader({
    accept: {
      'application/pdf': ['.pdf'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
    },
    multiple: true,
    maxSize: toBytes(MAX_UPLOAD_MB),
    maxFiles: maxFileCount,
    onDrop: (files) => void handleFiles(files),
    onDropRejected: handleRejection,
    noClick: true,
    noDragEventsBubbling: true,
  });

  return (
    <div {...getRootProps()}>
      <input {...getInputProps()} />
      {isDragging && <div className="drop-overlay">Drop files here</div>}
    </div>
  );
}



// ForwardRef with intersection type arguments
declare const BadgePrimitive: { Root: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLSpanElement> & React.RefAttributes<HTMLSpanElement>> };
declare function badgeVariants(opts?: { variant?: string }): string;
declare function cn(...classes: (string | undefined)[]): string;
declare namespace React {
  function forwardRef<T, P>(render: (props: P, ref: React.Ref<T>) => React.ReactElement | null): React.ForwardRefExoticComponent<P & React.RefAttributes<T>>;
  type ElementRef<C> = any;
  type ComponentPropsWithoutRef<C> = any;
  type Ref<T> = any;
  type ReactElement = any;
  type ForwardRefExoticComponent<P> = any;
  type RefAttributes<T> = any;
  type HTMLAttributes<T> = any;
}
declare type VariantProps<T> = { variant?: string };

const StatusBadge = React.forwardRef<
  React.ElementRef<typeof BadgePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof BadgePrimitive.Root> &
    VariantProps<typeof badgeVariants> & { pulse?: boolean }
>(({ className, variant, pulse, ...props }, ref) => (
  <BadgePrimitive.Root
    ref={ref}
    className={cn(badgeVariants({ variant }), className)}
    {...props}
  />
));
StatusBadge.displayName = BadgePrimitive.Root.displayName;



// react-hook-form handleSubmit pattern — onSubmit passed to handleSubmit is not a type mismatch
declare function useSettingsForm(): {
  handleSubmit: (handler: (data: Record<string, unknown>) => void | Promise<void>) => (e: { preventDefault(): void }) => void;
  control: unknown;
};
declare function saveSettings(values: { displayName: string; timezone: string }): Promise<void>;
declare function showToast(opts: { title: string; variant?: string }): void;

interface SettingsFormValues {
  displayName: string;
  timezone: string;
}

export function AccountSettingsForm(): JSX.Element {
  const form = useSettingsForm();

  const onSubmit = async (values: SettingsFormValues) => {
    try {
      await saveSettings(values);
      showToast({ title: "Settings saved" });
    } catch {
      showToast({ title: "Failed to save settings", variant: "destructive" });
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <button type="submit">Save</button>
    </form>
  );
}



declare const cn: (...args: unknown[]) => string;

interface ValidationMessages {
  minLength?: string[];
  maxLength?: string[];
  pattern?: string[];
  required?: string[];
}

interface FieldErrorListProps {
  messages: ValidationMessages;
  hasErrors: boolean;
}

export function FieldErrorList({ messages, hasErrors }: FieldErrorListProps): JSX.Element {
  return (
    <div>
      {hasErrors && (
        <div className="mt-2 space-y-1">
          {messages.minLength?.map((msg, idx) => (
            <p key={idx} className={cn('text-sm text-red-500')}>
              {msg}
            </p>
          ))}
          {messages.maxLength?.map((msg, idx) => (
            <p key={idx} className={cn('text-sm text-red-500')}>
              {msg}
            </p>
          ))}
          {messages.pattern?.map((msg, idx) => (
            <p key={idx} className={cn('text-sm text-red-500')}>
              {msg}
            </p>
          ))}
          {messages.required?.map((msg, idx) => (
            <p key={idx} className={cn('text-sm text-red-500')}>
              {msg}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}



// ─── useMemo typed-mapper shape (FP: argument-type-mismatch) ────────────────
declare const React: {
  useMemo: <T>(factory: () => T, deps: readonly unknown[]) => T;
};

type SelectOption<V> = {
  label: string;
  value: V;
  disabled?: boolean;
};

function useResolvedSelections<V extends string | number>(
  activeValues: V[],
  allOptions: SelectOption<V>[],
): SelectOption<V>[] {
  const resolved = React.useMemo(() => {
    return activeValues.map((v): SelectOption<V> => {
      const found = allOptions.find((opt) => opt.value === v);
      if (found) {
        return found;
      }
      return {
        label: String(v),
        value: v,
      };
    });
  }, [activeValues, allOptions]);

  return resolved;
}



declare function useState<T>(initial: T): [T, (next: T) => void];

export function FilterBar(): JSX.Element {
  const [filterTerm, setFilterTerm] = useState<string>('');

  return (
    <div>
      <input
        type="search"
        placeholder="Filter results..."
        value={filterTerm}
        onChange={(e) => setFilterTerm(e.target.value)}
      />
    </div>
  );
}

export function TagPicker(): JSX.Element {
  const [tagName, setTagName] = useState<string>('');

  return (
    <label>
      <span>Tag</span>
      <input
        type="text"
        value={tagName}
        onChange={(evt) => setTagName(evt.target.value)}
      />
    </label>
  );
}



// FF30 — React.forwardRef with spread props on a table element; no type mismatch
declare const React: {
  forwardRef<T, P>(render: (props: P, ref: React.Ref<T>) => JSX.Element): (props: P & { ref?: React.Ref<T> }) => JSX.Element;
};
declare function cn(...classes: Array<string | undefined>): string;

const DataTable = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <table
    ref={ref}
    className={cn('w-full caption-bottom text-sm', className)}
    {...props}
  />
));



// FF40 — React.forwardRef with generic type params for a Radix Slot wrapper
declare const React: {
  forwardRef<T, P>(render: (props: P, ref: unknown) => JSX.Element): (props: P & { ref?: unknown }) => JSX.Element;
};
declare const Slot: { displayName?: string };
type SlotElement = HTMLElement;
type SlotProps = { className?: string; children?: unknown; asChild?: boolean };

const FormControl = React.forwardRef<SlotElement, SlotProps>(({ className, ...props }, ref) => (
  <div ref={ref as never} className={className} {...(props as object)} />
));



declare function useToggle(initial: boolean): [boolean, (next: boolean) => void];
declare const ConfirmDialog: (props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: unknown;
}) => JSX.Element;
declare const ConfirmDialogTrigger: (props: { asChild?: boolean; children?: unknown }) => JSX.Element;
declare const ConfirmDialogContent: (props: { children?: unknown }) => JSX.Element;

export function RevokeAccessPanel(): JSX.Element {
  const [open, setOpen] = useToggle(false);
  const [isProcessingRevoke] = useToggle(false);

  return (
    <ConfirmDialog open={open} onOpenChange={(value) => !isProcessingRevoke && setOpen(value)}>
      <ConfirmDialogTrigger asChild>
        <button type="button" className="text-red-600">Revoke access</button>
      </ConfirmDialogTrigger>
      <ConfirmDialogContent>
        <p>Are you sure you want to revoke access?</p>
      </ConfirmDialogContent>
    </ConfirmDialog>
  );
}



// React onClick handler setting boolean state — trivial click handler, no argument type mismatch
declare function useState<T>(init: T): [T, (v: T) => void];

export function NavBar(): null {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const handleOpen = () => setIsMenuOpen(true);
  handleOpen;
  return null;
}



// React.forwardRef for a div with extra props — standard forwardRef usage, no type mismatch
declare const React: {
  forwardRef: <T, P>(fn: (props: P, ref: unknown) => null) => (props: P & { ref?: unknown }) => null;
  ElementRef: <C>(c: C) => never;
  ComponentPropsWithoutRef: <C>(c: C) => never;
};

const DataRow = React.forwardRef<
  ReturnType<typeof React.ElementRef<'div'>>,
  ReturnType<typeof React.ComponentPropsWithoutRef<'div'>> & { rowIndex: number }
>(({ rowIndex, ...props }, ref) => {
  return null;
});
export { DataRow };



// React Dialog onOpenChange with boolean short-circuit — valid React pattern, no type mismatch
declare function useState<T>(init: T): [T, (v: T) => void];
declare const Dialog: (props: { open: boolean; onOpenChange: (open: boolean) => void; children?: null }) => null;

export function ConfirmDialog(): null {
  const [open, setOpen] = useState(false);
  const isSubmitting = false;
  return Dialog({
    open,
    onOpenChange: (value: boolean) => !isSubmitting && setOpen(value),
    children: null,
  });
}



// JSX array rendering with index as key — standard .map with index, no type mismatch
declare const chatMessages: string[];

export function ChatLog(messages: string[]): null {
  const elements = messages.map((msg, i) => ({ key: i, text: msg }));
  elements;
  return null;
}



// JSX array rendering with object key — standard .map with id key, no type mismatch
interface Permission { id: string; label: string }
declare const permissions: Permission[];

export function PermissionList(items: Permission[]): Array<{ key: string; label: string }> {
  return items.map((perm) => ({ key: perm.id, label: perm.label }));
}



// React.useMemo with typed map and inner find — standard useMemo, no type mismatch
declare const React: { useMemo: <T>(fn: () => T, deps: unknown[]) => T };
interface Tag { id: string; label: string }
declare const selectedTagIds: string[];
declare const allTags: Tag[];

export function useResolvedTags(selectedIds: string[], tags: Tag[]): Tag[] {
  return React.useMemo(
    () => selectedIds.map((id): Tag => tags.find((t) => t.id === id) ?? { id, label: id }),
    [selectedIds, tags]
  );
}



// JSX array rendering with nested object property as key — standard map, no type mismatch
interface TeamInfo { id: string; name: string; memberCount: number }
declare const orgTeams: TeamInfo[];

export function TeamList(teams: TeamInfo[]): Array<{ key: string; name: string }> {
  return teams.map((team) => ({ key: team.id, name: team.name }));
}



// Lingui i18n in JSX rendering — MessageDescriptor passed to translation function, types match
interface MessageDescriptor { id: string; message?: string }
declare function _(msg: MessageDescriptor): string;
declare const msg: (template: TemplateStringsArray, ...args: unknown[]) => MessageDescriptor;
declare const currentLang: string;

export function LanguageLabel(lang: string): string {
  return _({ id: `lang.${lang}`, message: lang });
}



// JSX list rendering with draggable component key from id — standard map, no type mismatch
interface Assignee { id: string; name: string; order: number }
declare function Draggable(props: { key: string; draggableId: string; index: number; children: null }): null;
declare const assignees: Assignee[];

export function AssigneeList(assignees: Assignee[]): Array<ReturnType<typeof Draggable>> {
  return assignees.map((assignee, index) =>
    Draggable({ key: assignee.id, draggableId: assignee.id, index, children: null })
  );
}



// React.forwardRef for a paragraph element with forwarded ref and className — standard pattern, no type mismatch
declare const React: {
  forwardRef: <T, P>(fn: (props: P, ref: T | null) => null) => (props: P & { ref?: T | null }) => null;
};
declare function cn(...classes: (string | undefined)[]): string;
declare const formHintId: string;

const FormHint = React.forwardRef<HTMLParagraphElement, { className?: string; id?: string }>((
  { className, id, ...props },
  ref
) => null);
export { FormHint };



// react-hook-form useForm with mapped default values — standard useForm initialization, no type mismatch
interface FieldEntry { id: string; label: string; required: boolean }
interface FormSchema { fields: Array<{ fieldId: string; fieldLabel: string; isRequired: boolean }> }
declare function useForm<T>(config: { defaultValues: T }): { register: (name: string) => object };
declare const existingFields: FieldEntry[];

export function useFieldsForm(fields: FieldEntry[]) {
  return useForm<FormSchema>({
    defaultValues: {
      fields: fields.map((field) => ({
        fieldId: field.id,
        fieldLabel: field.label,
        isRequired: field.required,
      })),
    },
  });
}



// FP shape: react-hook-form handleSubmit with async destructured handler
declare const profileForm: { handleSubmit: (fn: (values: { displayName: string }) => Promise<void>) => (e: React.FormEvent) => void };
declare function updateProfile(opts: { userId: string; displayName: string }): Promise<void>;
declare const userId: string;

const ProfileFormComponent = () => (
  <form
    onSubmit={profileForm.handleSubmit(async ({ displayName }) =>
      updateProfile({
        userId,
        displayName,
      }),
    )}
  />
);



// FP shape: optional-chain array map to JSX SelectItem elements
declare const fieldConfig: { options?: Array<{ label: string; id: string }> } | null;
declare function SelectOption(props: { key?: string | number; value: string; children?: React.ReactNode }): JSX.Element;

const FieldOptionsDropdown = () => (
  <div>
    {fieldConfig?.options?.map((opt, idx) => (
      <SelectOption key={idx} value={opt.id}>
        {opt.label}
      </SelectOption>
    ))}
  </div>
);



// FP shape: ts-pattern match().with() on discriminated union with P.string pattern
import { match } from 'ts-pattern';
import { P } from 'ts-pattern';

declare type UserAvatar =
  | { avatarImageBase64: string }
  | { initials: string }
  | undefined;

declare const avatar: UserAvatar;
declare const userName: string;

const AvatarDisplay = () =>
  match(avatar)
    .with({ avatarImageBase64: P.string }, (av) => (
      <img src={av.avatarImageBase64} alt="avatar" style={{ borderRadius: '50%' }} />
    ))
    .with({ initials: P.string }, (av) => (
      <span className="avatar-initials">{av.initials}</span>
    ))
    .otherwise(() => (
      <span className="avatar-fallback">{userName[0]?.toUpperCase()}</span>
    ));



// FP shape: React input onChange passing e.target.value to setState
declare function setSearchQuery(value: string): void;
declare const searchQuery: string;

const SearchInput = () => (
  <input
    type="text"
    value={searchQuery}
    placeholder="Search..."
    onChange={(e) => setSearchQuery(e.target.value)}
  />
);



// FP shape: JSX SelectItem receiving enum value as value prop
declare const ContractStatus: { DRAFT: string; ACTIVE: string; EXPIRED: string };
declare function SelectItem(props: { value: string; children?: React.ReactNode }): JSX.Element;

const ContractStatusPicker = () => (
  <div>
    <SelectItem value={ContractStatus.DRAFT}>Draft</SelectItem>
    <SelectItem value={ContractStatus.ACTIVE}>Active</SelectItem>
    <SelectItem value={ContractStatus.EXPIRED}>Expired</SelectItem>
  </div>
);



// FP shape: React createPortal with JSX element and container DOM node
declare function cn(...classes: (string | undefined | null | false)[]): string;
declare const portalContainer: Element;
declare function createPortal(children: React.ReactNode, container: Element): React.ReactPortal;

function FloatingPanel({ children, className, style }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return createPortal(
    <div className={cn('absolute z-50', className)} style={style}>
      {children}
    </div>,
    portalContainer,
  );
}



// FP shape: typed string array mapped to JSX list items with i18n translation
declare function translate(key: string): string;
declare const SUPPORTED_PLAN_FEATURES: readonly string[];
declare const FEATURE_LABELS: Record<string, string>;

const FeatureList = () => (
  <ul>
    {SUPPORTED_PLAN_FEATURES.map((feature) => (
      <li key={feature}>
        {translate(FEATURE_LABELS[feature])}
      </li>
    ))}
  </ul>
);



// FP shape: useForm with zodResolver and typed defaultValues in react-hook-form
import { z } from 'zod';
declare function useForm<T>(opts: { resolver: unknown; defaultValues: Partial<T> }): { handleSubmit: (fn: (vals: T) => void) => (e: any) => void };
declare function zodResolver(schema: unknown): unknown;

const ZEditTeamFormSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  memberLimit: z.number().int().optional(),
});
type TEditTeamFormSchema = z.infer<typeof ZEditTeamFormSchema>;

declare const team: { name: string; slug: string; memberLimit?: number };

const teamForm = useForm<TEditTeamFormSchema>({
  resolver: zodResolver(ZEditTeamFormSchema),
  defaultValues: {
    name: team.name,
    slug: team.slug,
    memberLimit: team.memberLimit,
  },
});



// FP shape: typed array mapped to JSX list elements with key from object id
declare const attachments: Array<{ id: string; filename: string; size: number }>;
declare function AttachmentCard(props: { key?: string; name: string; size: number }): JSX.Element;

const AttachmentList = () => (
  <div>
    {attachments.map((attachment, i) => (
      <AttachmentCard key={attachment.id} name={attachment.filename} size={attachment.size} />
    ))}
  </div>
);



// FP shape: onCheckedChange handling CheckedState union (boolean | 'indeterminate')
declare function setTermsAccepted(value: boolean): void;
declare const termsAccepted: boolean;
declare function Checkbox(props: { id: string; checked: boolean; onCheckedChange: (checked: boolean | 'indeterminate') => void }): JSX.Element;

const TermsCheckbox = () => (
  <Checkbox
    id="accept-terms"
    checked={termsAccepted}
    onCheckedChange={(checked) => setTermsAccepted(checked === 'indeterminate' ? false : checked)}
  />
);



// FP shape: standard react-hook-form form.handleSubmit(onSubmit) as form's onSubmit
declare const orgSettingsForm: { handleSubmit: (fn: (data: { name: string; billingEmail: string }) => void) => (e: React.FormEvent) => void };
declare function onOrgSettingsSubmit(data: { name: string; billingEmail: string }): void;

const OrgSettingsForm = () => (
  <form onSubmit={orgSettingsForm.handleSubmit(onOrgSettingsSubmit)}>
    <button type="submit">Save</button>
  </form>
);



// FP shape: standard react-hook-form form.handleSubmit(onFormSubmit) as form onSubmit
declare const checkoutForm: { handleSubmit: (fn: (data: { shippingAddress: string; paymentMethod: string }) => void) => (e: React.FormEvent) => void };
declare function onCheckoutFormSubmit(data: { shippingAddress: string; paymentMethod: string }): void;

const CheckoutForm = () => (
  <form onSubmit={checkoutForm.handleSubmit(onCheckoutFormSubmit)}>
    <button type="submit">Place Order</button>
  </form>
);



// FP shape: array.map returning JSX elements (CommandItem) from dropdown options
declare const filterOptions: Array<{ value: string; label: string; disabled?: boolean }>;
declare function CommandItem(props: { key?: string; value: string; disabled?: boolean; onSelect?: () => void; children?: React.ReactNode }): JSX.Element;

const FilterPicker = ({ onSelect }: { onSelect: (value: string) => void }) => (
  <div>
    {filterOptions.map((option) => {
      return (
        <CommandItem
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          onSelect={() => onSelect(option.value)}
        >
          {option.label}
        </CommandItem>
      );
    })}
  </div>
);



// FP shape: tRPC useMutation with onSuccess/onError callbacks using toast notification
declare function useToast(): { toast: (opts: { title: string; variant?: string }) => void };
declare const trpc: { subscription: { cancel: { useMutation: (opts: { onSuccess: () => void; onError: (err: unknown) => void }) => { mutateAsync: (opts: { subscriptionId: string }) => Promise<void>; isPending: boolean } } } };

const CancelSubscriptionButton = ({ subscriptionId }: { subscriptionId: string }) => {
  const { toast } = useToast();

  const { mutateAsync: cancelSubscription, isPending } = trpc.subscription.cancel.useMutation({
    onSuccess: () => {
      toast({ title: 'Subscription cancelled successfully.' });
    },
    onError: (err) => {
      console.error(err);
      toast({ title: 'Failed to cancel subscription.', variant: 'destructive' });
    },
  });

  return (
    <button disabled={isPending} onClick={() => void cancelSubscription({ subscriptionId })}>
      Cancel
    </button>
  );
};



// cbc8d6ac6c0a: React onClick handler passing a string literal to a sort function
declare function handleColumnSort(column: string): void;

function SortableColumnHeader() {
  return (
    <button type="button" onClick={() => handleColumnSort('createdAt')}>
      Created At
    </button>
  );
}



// cc07b7e5f287: guarded React input onChange handler with logical AND short-circuit
declare const isFieldLocked: boolean;
declare function setDisplayName(v: string): void;

function GuardedNameInput() {
  return (
    <input
      type="text"
      onChange={(e) => !isFieldLocked && setDisplayName(e.target.value.trimStart())}
    />
  );
}



// cc7636ffb60e: useMemo with early return for guard condition
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare const project: { members: Array<{ id: string; role: string }> } | null;

const projectMemberOptions = useMemo(() => {
  if (!project) {
    return [];
  }
  return project.members.map((m) => ({ value: m.id, label: m.role }));
}, [project]);



// cd341cc6c368: React functional state update using spread to append an item
declare function setActiveViews(updater: (prev: string[]) => string[]): void;
declare const nextView: string;

function navigateToView() {
  setActiveViews((views) => [...views, nextView]);
}



// cd5f2abe7b7c: form.handleSubmit(onSubmit) used as JSX onSubmit handler — canonical react-hook-form API
declare const transferForm: { handleSubmit: (handler: (data: { targetFolderId: string }) => Promise<void>) => React.FormEventHandler };

function onTransferSubmit(data: { targetFolderId: string }): Promise<void> {
  return Promise.resolve();
}

function TransferForm() {
  return (
    <form onSubmit={transferForm.handleSubmit(onTransferSubmit)}>
      <button type="submit">Transfer</button>
    </form>
  );
}



// cdefacbb6d73: .map() returning JSX with string/enum key prop
declare const availableRoles: string[];

function RoleSelector() {
  return (
    <div>
      {availableRoles.map((role) => (
        <button key={role} type="button">
          {role}
        </button>
      ))}
    </div>
  );
}



// ce9a814c131b: field.onChange(parseInt(...) || 0) React Hook Form number input pattern
declare const quantityField: { onChange: (value: number) => void };

function QuantityInput() {
  return (
    <input
      type="number"
      onChange={(e) => quantityField.onChange(parseInt(e.target.value, 10) || 0)}
    />
  );
}



// ced54d3a2772: useEffect with Array.filter inside using enum exclusion
declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
declare const participants: Array<{ role: string; id: string }>;
declare function setActiveParticipants(p: Array<{ role: string; id: string }>): void;
const OBSERVER_ROLE = 'OBSERVER';

function useFilteredParticipants() {
  useEffect(() => {
    const activeParticipants = participants.filter(
      (participant) => participant.role !== OBSERVER_ROLE && participant.id !== '',
    );
    setActiveParticipants(activeParticipants);
  }, [participants]);
}



// cee86e98d1dc: React.useCallback with optional prop guard returning early
declare function useCallback<T extends Function>(fn: T, deps: unknown[]): T;
declare const searchConfig: { filter?: (value: string, search: string) => number } | undefined;

const filterFunction = useCallback(() => {
  if (searchConfig?.filter) {
    return searchConfig.filter;
  }
  return undefined;
}, [searchConfig]);



// d023e7ed3ed5: useEffect with setInterval for cycling messages during PROCESSING state
declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
declare function setMessageIndex(updater: (prev: number) => number): void;
const LOADING_MESSAGES = ['Analyzing...', 'Almost there...', 'Processing...' ];
declare const processingState: string;

function useLoadingMessageCycle() {
  useEffect(() => {
    if (processingState !== 'PROCESSING') {
      return;
    }

    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 4000);

    return () => clearInterval(interval);
  }, [processingState]);
}



// d052a6218a81: useEffect with searchParams.get() || fallback for URL param lookup
declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
declare const searchParams: { get(key: string): string | null };
declare const wizardSteps: Array<{ id: string; label: string }>;
declare function setActiveStep(step: string): void;
declare const currentStep: string;

function useUrlParamStepSync() {
  useEffect(() => {
    const stepParam = searchParams.get('step') || wizardSteps[0].id;
    const foundStep = wizardSteps.find((step) => step.id === stepParam);

    if (foundStep && foundStep.id !== currentStep) {
      setActiveStep(foundStep.id);
    }
  }, [searchParams]);
}



// --- argument-type-mismatch shape: onValueChange arrow-function callback (controlled radio group handler) ---
declare function RadioGroup(props: { onValueChange?: (value: string) => void; className?: string; children?: any }): JSX.Element;
declare function RadioGroupItem(props: { value: string; id: string; checked?: boolean; disabled?: boolean; className?: string }): JSX.Element;
declare function Label(props: { htmlFor: string; className?: string; children?: any }): JSX.Element;
declare function useState<T>(init: T): [T, (v: T) => void];

function ShippingMethodSelector({ options, readOnly }: { options: { id: string; value: string; checked: boolean }[]; readOnly: boolean }) {
  const [selectedMethod, setSelectedMethod] = useState<string>('');

  const handleSelectMethod = (method: string) => {
    setSelectedMethod(method);
  };

  return (
    <RadioGroup onValueChange={(value) => handleSelectMethod(value)} className="gap-y-2">
      {options.map((item, index) => (
        <div key={index} className="flex items-center">
          <RadioGroupItem
            value={item.value}
            id={`method-${item.id}`}
            checked={item.checked}
            disabled={readOnly}
          />
          <Label htmlFor={`method-${item.id}`} className="ml-2 text-sm">
            {item.value}
          </Label>
        </div>
      ))}
    </RadioGroup>
  );
}



// --- argument-type-mismatch shape: React.forwardRef wrapping Primitive component with extended props interface ---
declare namespace DrawerPrimitive {
  const Content: any;
  const Close: any;
  function Portal(props: { position?: string; children?: any }): JSX.Element;
}
declare function cn(...classes: any[]): string;
declare const X: any;
declare function cva(base: string, config: any): (...args: any[]) => string;
declare function VariantProps<T>(fn: T): any;

const drawerVariants = cva('fixed z-50 flex flex-col gap-4 bg-background p-6 shadow-lg transition-all duration-300', {
  variants: {
    position: { top: 'inset-x-0 top-0', bottom: 'inset-x-0 bottom-0', left: 'inset-y-0 left-0', right: 'inset-y-0 right-0' },
  },
  defaultVariants: { position: 'right' },
});

interface DrawerContentProps
  extends React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>,
    VariantProps<typeof drawerVariants> {
  showBackdrop?: boolean;
  drawerClass?: string;
}

declare const React: any;
const DrawerContent = React.forwardRef<React.ElementRef<typeof DrawerPrimitive.Content>, DrawerContentProps>(
  ({ position, className, drawerClass, showBackdrop = true, children, ...props }, ref) => (
    <DrawerPrimitive.Portal position={position}>
      <DrawerPrimitive.Content
        ref={ref}
        className={cn(drawerVariants({ position }), className)}
        {...props}
      >
        {children}
        <DrawerPrimitive.Close className="absolute top-3 right-3 rounded opacity-70 hover:opacity-100">
          <X className="h-4 w-4" />
        </DrawerPrimitive.Close>
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  ),
);

DrawerContent.displayName = DrawerPrimitive.Content.displayName;



// --- argument-type-mismatch shape: form.handleSubmit(onFormSubmit) react-hook-form standard pattern ---
declare function useForm<T>(opts?: any): { handleSubmit: (fn: (data: T) => void | Promise<void>) => React.FormEventHandler; control: any; formState: { isSubmitting: boolean } };
declare const Form: any;
declare const FormField: any;
declare const FormItem: any;
declare const FormLabel: any;
declare const FormControl: any;
declare const FormMessage: any;
declare const Input: any;
declare const Button: any;

type TAccountSettingsForm = { displayName: string; bio: string };

function AccountSettingsForm({ userId }: { userId: string }) {
  const form = useForm<TAccountSettingsForm>({
    defaultValues: { displayName: '', bio: '' },
  });

  const onFormSubmit = async (data: TAccountSettingsForm) => {
    await saveAccountSettings(userId, data);
  };

  return (
    <Form>
      <form onSubmit={form.handleSubmit(onFormSubmit)}>
        <FormField
          control={form.control}
          name="displayName"
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>Display Name</FormLabel>
              <FormControl><Input {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>Save</Button>
      </form>
    </Form>
  );
}

declare function saveAccountSettings(userId: string, data: TAccountSettingsForm): Promise<void>;



// --- argument-type-mismatch shape: cn() with conditional class object (pointer-events-none guard) ---
declare function cn(...args: any[]): string;
declare const Tabs: any;

function DrawingCanvas({ disabled, children }: { disabled: boolean; children?: any }) {
  return (
    <Tabs
      className={cn('relative w-full', {
        'pointer-events-none': disabled,
      })}
    >
      {children}
    </Tabs>
  );
}



// --- argument-type-mismatch shape: Array.map with composite template-literal key in React list ---
declare const CommandItem: any;
declare const CommandGroup: any;

interface ContactSuggestion { email: string; name: string }

function ContactSuggestionList({ suggestions, onSelect }: { suggestions: ContactSuggestion[]; onSelect: (s: ContactSuggestion) => void }) {
  return (
    <CommandGroup>
      {suggestions.map((suggestion, index) => (
        <CommandItem
          key={`${index}-${suggestion.email}`}
          value={suggestion.email}
          onSelect={() => onSelect(suggestion)}
        >
          {suggestion.name} ({suggestion.email})
        </CommandItem>
      ))}
    </CommandGroup>
  );
}



// --- argument-type-mismatch shape: JSX spread of dropzone getRootProps() onto div ---
declare function useDropzone(opts: object): { getRootProps: () => Record<string, any>; getInputProps: () => Record<string, any>; isDragActive: boolean };
declare function cn(...args: any[]): string;

function FileUploadZone({ onFilesDropped, className, children }: { onFilesDropped: (files: File[]) => void; className?: string; children?: any }) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
    onDrop: (files: File[]) => onFilesDropped(files),
    noClick: true,
  });

  return (
    <div {...getRootProps()} className={cn('relative min-h-screen', className)}>
      <input {...getInputProps()} />
      {children}
      {isDragActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <p className="text-white text-lg font-semibold">Drop files here</p>
        </div>
      )}
    </div>
  );
}



// --- argument-type-mismatch shape: Array.map rendering list items with template-literal key ---
interface Assignee { id: string; name: string; email: string }

function formatAssigneeLabel(assignee: Assignee): string {
  return `${assignee.name} <${assignee.email}>`;
}

function AssigneeList({ assignees }: { assignees: Assignee[] }) {
  return (
    <ul className="list-disc list-inside text-sm">
      {assignees.map((assignee) => (
        <li key={`assignee-${assignee.id}`}>
          <span>{formatAssigneeLabel(assignee)}</span>
        </li>
      ))}
    </ul>
  );
}



// Standard Radix UI / shadcn React.forwardRef boilerplate with ElementRef/ComponentPropsWithoutRef
declare const CollapsiblePrimitive: {
  Content: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>>;
  Trigger: React.ForwardRefExoticComponent<React.ButtonHTMLAttributes<HTMLButtonElement> & React.RefAttributes<HTMLButtonElement>>;
};
declare function cn(...args: any[]): string;

const CollapsibleContent = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <CollapsiblePrimitive.Content
    ref={ref}
    className={cn('overflow-hidden transition-all', className)}
    {...props}
  >
    <div className="pb-4">{children}</div>
  </CollapsiblePrimitive.Content>
));

CollapsibleContent.displayName = CollapsiblePrimitive.Content.displayName;

const CollapsibleTrigger = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <CollapsiblePrimitive.Trigger
    ref={ref}
    className={cn('flex items-center', className)}
    {...props}
  >
    {children}
  </CollapsiblePrimitive.Trigger>
));

CollapsibleTrigger.displayName = CollapsiblePrimitive.Trigger.displayName;



// --- argument-type-mismatch shape: optional chaining on dynamic key from variable ---
type BillingCycle = 'monthly' | 'annual';
interface PricingTier { monthly?: { id: string; price: number }; annual?: { id: string; price: number } }

function getPlanId(tier: PricingTier, cycle: BillingCycle): string | undefined {
  return tier[cycle]?.id;
}



// --- argument-type-mismatch shape: table cell renderer calling typed formatter function ---
declare function formatAuditAction(ctx: { locale: string }, row: { type: string; actorName?: string }, viewerId: number): { description: string };
declare const i18nCtx: { locale: string };

const activityColumns = [
  {
    header: 'Action',
    accessorKey: 'type',
    cell: ({ row }: any) => <span>{formatAuditAction(i18nCtx, row.original, row.original.viewerId).description}</span>,
  },
];



// --- argument-type-mismatch shape: Dialog onOpenChange guarded by isPending flag ---
declare const Dialog: any;
declare const DialogTrigger: any;
declare const DialogContent: any;
declare const DialogHeader: any;
declare const DialogTitle: any;
declare function useState3<T>(init: T): [T, (v: T) => void];

function InviteTeamMemberDialog({ trigger }: { trigger?: any }) {
  const [open, setOpen] = useState3(false);
  const [isPending, setIsPending] = useState3(false);

  return (
    <Dialog open={open} onOpenChange={(value: boolean) => !isPending && setOpen(value)}>
      <DialogTrigger asChild>{trigger ?? <button>Invite Member</button>}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}



// --- argument-type-mismatch shape: tRPC useQuery with config object and typed options ---
declare const trpc: { auth: { devices: { list: { useQuery: (opts: object, config?: object) => { data?: { data: any[] }; isInitialLoading: boolean; isRefetching: boolean; isError: boolean } } } } };
const MAX_DEVICES = 10;

function DeviceListProvider({ children }: { children: any }) {
  const deviceQuery = trpc.auth.devices.list.useQuery(
    { perPage: MAX_DEVICES },
    {
      placeholderData: (prev: any) => prev,
      enabled: true,
    },
  );

  const deviceData = {
    devices: deviceQuery.data?.data || [],
    isInitialLoading: deviceQuery.isInitialLoading,
    isRefetching: deviceQuery.isRefetching,
    isError: deviceQuery.isError,
  };

  return children;
}



// --- argument-type-mismatch shape: Radix Slot with cn(variants(...)) spread props pattern ---
declare const Slot: any;
declare function cn2(...args: any[]): string;
declare function buttonVariants2(opts: { variant?: string; size?: string; className?: string }): string;
declare const React: any;

interface LinkButtonProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: string;
  size?: string;
  asChild?: boolean;
}

const LinkButton = React.forwardRef<HTMLAnchorElement, LinkButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    if (asChild) {
      return <Slot className={cn2(buttonVariants2({ variant, size, className }))} ref={ref} {...props} />;
    }
    return <a className={cn2(buttonVariants2({ variant, size, className }))} ref={ref} {...props} />;
  },
);

LinkButton.displayName = 'LinkButton';



// --- argument-type-mismatch shape: functional state updater receiving typed prevState, with .includes() key guard ---
declare function useState4<T>(init: T): [T, (fn: (prev: T) => T) => void];

interface FieldConfig {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  required?: boolean;
  label?: string;
}

type FieldConfigKey = keyof FieldConfig;

function FieldConfigEditor({ initialConfig }: { initialConfig: FieldConfig }) {
  const [fieldConfig, setFieldConfig] = useState4<FieldConfig>(initialConfig);

  const handleConfigChange = (
    key: FieldConfigKey,
    value: string | boolean | number,
  ) => {
    setFieldConfig((prevState: FieldConfig) => {
      if (['minLength', 'maxLength'].includes(key)) {
        const parsed = Number(value);
        return { ...prevState, [key]: isNaN(parsed) ? undefined : parsed };
      }
      return { ...prevState, [key]: value };
    });
  };

  return null;
}



// --- argument-type-mismatch shape: createCallable<Props, ReturnType> with useForm<Schema> generic usage ---
declare function createCallable<P, R>(fn: (props: P & { call: { end: (val: R) => void } }) => any): (props: P) => any;
declare function useForm3<T>(opts?: any): { handleSubmit: (fn: (data: T) => any) => any; register: (name: string) => any; formState: { errors: any } };
declare const Dialog2: any;
declare const DialogContent2: any;
declare const DialogHeader2: any;
declare const DialogTitle2: any;

type TSignatureTextForm = { text: string };

const SignatureTextDialog = createCallable<{ minLength?: number }, string | null>(({ call, minLength = 1 }) => {
  const form = useForm3<TSignatureTextForm>({
    defaultValues: { text: '' },
  });

  return (
    <Dialog2 open onOpenChange={(val: boolean) => (!val ? call.end(null) : null)}>
      <DialogContent2>
        <DialogHeader2>
          <DialogTitle2>Enter Signature Text</DialogTitle2>
        </DialogHeader2>
      </DialogContent2>
    </Dialog2>
  );
});



// --- argument-type-mismatch shape: Array.map with Draggable using composite key ---
declare const DragDropContext: any;
declare const Droppable: any;
declare const Draggable: any;
declare function cn3(...args: any[]): string;

interface Participant { id: string; name: string; signingOrder?: number }

function ParticipantList({ participants }: { participants: Participant[] }) {
  return (
    <DragDropContext onDragEnd={() => {}}>
      <Droppable droppableId="participants">
        {(provided: any) => (
          <div {...provided.droppableProps} ref={provided.innerRef} className="flex flex-col gap-y-2">
            {participants.map((participant, index) => (
              <Draggable
                key={`${participant.id}-${participant.signingOrder}`}
                draggableId={participant.id}
                index={index}
              >
                {(provided: any, snapshot: any) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    className={cn3('py-1', { 'bg-muted rounded': snapshot.isDragging })}
                  >
                    {participant.name}
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}



// --- argument-type-mismatch shape: ts-pattern match({tab, config}).with({tab: literal}, ...) object pattern matching ---
declare function match<T>(value: T): { with: (pattern: any, handler: () => any) => any; otherwise: (handler: () => any) => any };
declare const P: { literal: (v: any) => any };

type ConfigTab = 'general' | 'notifications' | 'security';
interface AppConfig { allowEmailNotifications: boolean; requireMfa: boolean }

function renderConfigSection(activeTab: ConfigTab, config: AppConfig): string {
  return match({ activeTab, config })
    .with({ activeTab: 'notifications' }, () => 'NotificationsPanel')
    .with({ activeTab: 'security' }, () => 'SecurityPanel')
    .otherwise(() => 'GeneralPanel');
}



// --- argument-type-mismatch shape: React.forwardRef with ElementRef/ComponentPropsWithoutRef — NavigationMenu Radix wrapper ---
declare namespace NavMenuPrimitive {
  const List: any;
  const Trigger: any;
  const Content: any;
}
declare function cn4(...args: any[]): string;
declare const ChevronDown2: any;
declare const React: any;

const NavMenuList = React.forwardRef<
  React.ElementRef<typeof NavMenuPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof NavMenuPrimitive.List>
>(({ className, ...props }, ref) => (
  <NavMenuPrimitive.List
    ref={ref}
    className={cn4('group flex list-none items-center space-x-1', className)}
    {...props}
  />
));

NavMenuList.displayName = NavMenuPrimitive.List.displayName;

const NavMenuTrigger = React.forwardRef<
  React.ElementRef<typeof NavMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof NavMenuPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <NavMenuPrimitive.Trigger
    ref={ref}
    className={cn4('inline-flex items-center justify-center rounded-md text-sm', className)}
    {...props}
  >
    {children}
    <ChevronDown2 className="ml-1 h-3 w-3" aria-hidden="true" />
  </NavMenuPrimitive.Trigger>
));

NavMenuTrigger.displayName = NavMenuPrimitive.Trigger.displayName;



// --- argument-type-mismatch shape: Array.map with index as key rendering validation error messages ---
interface ValidationErrors { required: string[]; format: string[] }

function ValidationErrorDisplay({ errors }: { errors: ValidationErrors }) {
  const hasErrors = errors.required.length > 0 || errors.format.length > 0;
  if (!hasErrors) return null;

  return (
    <div className="text-sm">
      {errors.required.map((error, index) => (
        <p key={index} className="text-red-500">{error}</p>
      ))}
      {errors.format.map((error, index) => (
        <p key={index} className="text-amber-500">{error}</p>
      ))}
    </div>
  );
}



// --- argument-type-mismatch shape: Array.map with index in JSX list rendering signers with DnD ---
declare const Draggable2: any;
declare const Droppable2: any;
declare const DragDropContext2: any;
declare function cn5(...args: any[]): string;

interface Signer { nativeId: string; name: string; email: string; signingOrder?: number }

function SignersList({ signers, isSubmitting }: { signers: Signer[]; isSubmitting: boolean }) {
  return (
    <DragDropContext2 onDragEnd={() => {}}>
      <Droppable2 droppableId="signers">
        {(provided: any) => (
          <div {...provided.droppableProps} ref={provided.innerRef} className="flex w-full flex-col gap-y-2">
            {signers.map((signer, index) => (
              <Draggable2
                key={`${signer.nativeId}-${signer.signingOrder}`}
                draggableId={signer.nativeId}
                index={index}
                isDragDisabled={isSubmitting}
              >
                {(provided: any, snapshot: any) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    className={cn5('py-1', { 'bg-widget-foreground rounded': snapshot.isDragging })}
                  >
                    <span>{signer.name}</span>
                    <span className="text-muted-foreground text-sm ml-2">{signer.email}</span>
                  </div>
                )}
              </Draggable2>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable2>
    </DragDropContext2>
  );
}



// --- argument-type-mismatch shape: setInterval callback (prev) => (prev+1) % N as React state updater ---
declare function useState5<T>(init: T): [T, (fn: ((prev: T) => T) | T) => void];
declare function useEffect(fn: () => (() => void) | void, deps: any[]): void;

const LOADING_MESSAGES = ['Analyzing...', 'Processing...', 'Almost done...', 'Finalizing...'];

function ProgressIndicator({ isActive }: { isActive: boolean }) {
  const [messageIndex, setMessageIndex] = useState5(0);

  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive) return null;

  return <p className="text-muted-foreground text-sm">{LOADING_MESSAGES[messageIndex]}</p>;
}



// --- shape da9600604ce6: useCallback wrapping Set.add for pending mutation tracking ---
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare const pendingSetRef: { current: Set<Promise<unknown>> };

const registerPendingMutation = useCallback((promise: Promise<unknown>) => {
  pendingSetRef.current.add(promise);
  void promise.finally(() => {
    pendingSetRef.current.delete(promise);
  });
}, []);



// --- shape dae326f92651: useMemo with filter on required fields ---
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare const formFields: Array<{ id: string; required: boolean; inserted: boolean }>;
declare function isFieldRequired(f: { required: boolean }): boolean;

const fieldsRequiringValidation = useMemo(
  () => formFields.filter(isFieldRequired),
  [formFields],
);

const uninsertedFields = useMemo(
  () => fieldsRequiringValidation.filter((field) => !field.inserted),
  [fieldsRequiringValidation],
);



// --- shape db4631b2bbfa: onChange handler passing null when input is empty ---
declare function onChange(val: string | null): void;

function handleMinValueChange(e: React.ChangeEvent<HTMLInputElement>): void {
  onChange(e.target.value === '' ? null : e.target.value);
}



// --- shape db9f6f023ad1: Object.values().map() rendering JSX SelectItem children ---
declare const DISTRIBUTION_METHODS: Record<string, { value: string; description: string }>;
declare function t(desc: string): string;
declare const SelectItem: (props: { key: string; value: string; children: string }) => JSX.Element;

const distributionOptions = Object.values(DISTRIBUTION_METHODS).map(({ value, description }) => (
  <SelectItem key={value} value={value}>
    {t(description)}
  </SelectItem>
));



// --- shape dc1e33d748a9: virtualItems.map with destructured index for virtual list rendering ---
declare const virtualItems: Array<{ index: number; key: string | number; size: number; start: number }>;
declare const pages: Array<{ width: number; height: number }>;
declare const constraintWidth: number;

const renderedPages = virtualItems.map((virtualItem) => {
  const index = virtualItem.index;
  const pageMeta = pages[index];
  const pageNumber = index + 1;
  const scale = constraintWidth / pageMeta.width;
  const scaledHeight = Math.floor(pageMeta.height * scale);
  return (
    <div
      key={virtualItem.key}
      style={{
        position: 'absolute',
        top: 0,
        transform: `translateY(${virtualItem.start}px)`,
        height: `${virtualItem.size}px`,
      }}
      data-page={pageNumber}
    />
  );
});



// --- shape dc5cfabc5972: Textarea onChange setting context state ---
declare function useState<T>(initial: T): [T, (val: T) => void];
declare const Textarea: (props: {
  id?: string;
  placeholder?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  rows?: number;
}) => JSX.Element;

function AiContextInput() {
  const [context, setContext] = useState('');
  return (
    <Textarea
      id="context"
      placeholder="Enter context here"
      value={context}
      onChange={(e) => setContext(e.target.value)}
      rows={2}
    />
  );
}



// --- shape dc8a4e059a6c: row.getVisibleCells().map() in data table rendering ---
declare const TableCell: (props: { key: string; style?: Record<string, string>; children: unknown }) => JSX.Element;
declare function flexRender(component: unknown, context: unknown): unknown;

declare const row: {
  id: string;
  getIsSelected: () => boolean;
  getVisibleCells: () => Array<{
    id: string;
    column: { getSize: () => number; columnDef: { cell: unknown } };
    getContext: () => unknown;
  }>;
  original: unknown;
};

const rowCells = row.getVisibleCells().map((cell) => (
  <TableCell
    key={cell.id}
    style={{ width: `${cell.column.getSize()}px` }}
  >
    {flexRender(cell.column.columnDef.cell, cell.getContext())}
  </TableCell>
));



// --- shape dc90c4b250c9: Array.map with numeric index as JSX key ---
declare const RadioGroup: (props: { onValueChange?: (v: string) => void; className?: string; children: unknown }) => JSX.Element;
declare const RadioGroupItem: (props: { value: string; id: string; checked?: boolean; disabled?: boolean; className?: string }) => JSX.Element;
declare const Label: (props: { htmlFor: string; className?: string; children: string }) => JSX.Element;

declare const fieldId: string;
declare const isReadOnly: boolean;
declare const options: Array<{ id: string; value: string; checked: boolean }>;
declare function handleSelectItem(val: string): void;

const radioButtons = (
  <RadioGroup onValueChange={(value) => handleSelectItem(value)} className="gap-y-1">
    {options.map((item, index) => (
      <div key={index} className="flex items-center">
        <RadioGroupItem
          value={item.value}
          id={`option-${fieldId}-${item.id}`}
          checked={item.checked}
          disabled={isReadOnly}
        />
        {item.value && (
          <Label htmlFor={`option-${fieldId}-${item.id}`} className="ml-1.5">
            {item.value}
          </Label>
        )}
      </div>
    ))}
  </RadioGroup>
);



// --- shape dccd8254e91b: React.forwardRef wrapping a primitive component ---
declare namespace React {
  function forwardRef<T, P>(render: (props: P, ref: React.Ref<T>) => JSX.Element): (props: P & { ref?: React.Ref<T> }) => JSX.Element;
  type Ref<T> = { current: T | null };
  type ElementRef<T> = T extends { prototype: infer P } ? P : never;
  type ComponentPropsWithoutRef<T> = Record<string, unknown>;
}

declare const AccordionPrimitive: {
  Item: { prototype: HTMLDivElement; displayName?: string };
};
declare function cn(...classes: (string | undefined)[]): string;

const AccordionItem = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }: { className?: string; [key: string]: unknown }, ref) => (
  <AccordionPrimitive.Item ref={ref} className={cn('border-b', className)} {...props} />
));



// --- shape dd362ab47798: onCheckedChange handler coercing value to Boolean ---
declare function setShowAdvancedSettings(val: boolean): void;
declare const Checkbox: (props: {
  id?: string;
  checked?: boolean;
  onCheckedChange?: (val: boolean | 'indeterminate') => void;
}) => JSX.Element;

const advancedSettingsCheckbox = (
  <Checkbox
    id="showAdvancedSettings"
    checked={false}
    onCheckedChange={(value) => setShowAdvancedSettings(Boolean(value))}
  />
);



// --- shape ddf63b5b5801: useCallback calling setState with boolean literal false ---
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function setShowSigningOrderConfirmation(val: boolean): void;
declare function setValue(field: string, val: unknown, opts?: Record<string, boolean>): void;

const handleSigningOrderDisable = useCallback(() => {
  setShowSigningOrderConfirmation(false);
  setValue('signingOrder', 'PARALLEL', { shouldValidate: true, shouldDirty: true });
  setValue('allowDictateNextSigner', false, { shouldValidate: true, shouldDirty: true });
}, []);



// --- shape de076f964f20: form.handleSubmit calling call.end(data.email) ---
declare const call: { end: (result: string | null) => void };
declare const form: {
  handleSubmit: (fn: (data: { email: string }) => void) => (e: unknown) => void;
  formState: { isSubmitting: boolean };
  control: unknown;
};

const onSubmit = form.handleSubmit((data) => call.end(data.email));



// --- shape dea00031799e: onOpenChange={(value) => setOpen(value)} passthrough ---
declare function setOpen(val: boolean): void;
declare const Dialog: (props: {
  open: boolean;
  onOpenChange: (val: boolean) => void;
  children?: unknown;
}) => JSX.Element;
declare const open: boolean;
declare const trigger: JSX.Element;

const emailDeleteDialog = (
  <Dialog open={open} onOpenChange={(value) => setOpen(value)}>
    {trigger}
  </Dialog>
);



// --- shape def8efd46fdf: onChange e => setTerm(e.target.value) on search input ---
declare function useState<T>(initial: T): [T, (val: T) => void];
declare const Input: (props: {
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) => JSX.Element;

function DocumentSearchBar() {
  const [term, setTerm] = useState('');
  return (
    <Input
      type="search"
      placeholder="Search by document title"
      value={term}
      onChange={(e) => setTerm(e.target.value)}
    />
  );
}



// --- shape df9ebb4bffc2: onCheckedChange row.toggleSelected(!!value) ---
declare const Checkbox: (props: {
  checked?: boolean;
  onCheckedChange?: (val: boolean | 'indeterminate') => void;
  'aria-label'?: string;
}) => JSX.Element;

declare const row: {
  getIsSelected: () => boolean;
  toggleSelected: (val: boolean) => void;
};

const rowSelectCheckbox = (
  <Checkbox
    checked={row.getIsSelected()}
    onCheckedChange={(value) => row.toggleSelected(!!value)}
    aria-label="Select row"
  />
);



// --- shape dfaca1729b73: form.handleSubmit(onFormSubmit) in JSX onSubmit ---
declare function onFormSubmit(data: { invitations: Array<{ email: string; role: string }> }): Promise<void>;
declare const form: {
  handleSubmit: (fn: (data: unknown) => Promise<void>) => (e: unknown) => void;
  formState: { isSubmitting: boolean };
  control: unknown;
};
declare const fieldset: (props: { disabled: boolean; children: unknown }) => JSX.Element;

const inviteFormSubmit = form.handleSubmit(onFormSubmit);



// --- shape dfc49fa95905: onOpenChange boolean guard callback !isPending && setOpen(value) ---
declare const Dialog: (props: {
  open: boolean;
  onOpenChange: (val: boolean) => void;
  children?: unknown;
}) => JSX.Element;
declare function useState<T>(initial: T): [T, (val: T) => void];

function DeleteConfirmDialog({ trigger }: { trigger: JSX.Element }) {
  const [open, setOpen] = useState(false);
  const isPending = false;
  return (
    <Dialog open={open} onOpenChange={(value) => !isPending && setOpen(value)}>
      {trigger}
    </Dialog>
  );
}



// --- shape e0a6cc397018: useMemo with new URL(path, base) ternary returning URL or string ---
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare const rawUrl: string;

const resolvedUrl = useMemo(() => {
  const fullUrl =
    typeof window !== 'undefined' ? new URL(rawUrl, window.location.origin) : 'loading';
  return `Read ${fullUrl}, I want to ask questions about it.`;
}, [rawUrl]);



// --- shape e0b0e6520901: translation call _(language.full) as JSX child in SelectItem ---
declare function useLingui(): { _: (msg: unknown) => string };
declare const SUPPORTED_LANGUAGES: Record<string, { full: string; short: string }>;
declare const SelectItem: (props: { key: string; value: string; children: string }) => JSX.Element;

function LanguageSelector() {
  const { _ } = useLingui();
  return (
    <>
      {Object.entries(SUPPORTED_LANGUAGES).map(([code, language]) => (
        <SelectItem key={code} value={code}>
          {_(language.full)}
        </SelectItem>
      ))}
    </>
  );
}



// --- shape e0d73fe4f4ba: Array.from({ length: N }).map((_,i) => skeleton JSX ---
declare const Skeleton: (props: { className: string }) => JSX.Element;
declare const isLoading: boolean;

const skeletonItems = isLoading
  ? Array.from({ length: 3 }).map((_, index) => (
      <div key={index} className="flex items-center gap-2 rounded-lg border p-4">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-28 rounded-lg" />
          <Skeleton className="h-4 w-20 rounded-lg" />
        </div>
      </div>
    ))
  : null;



// React.forwardRef with cn() className merge and spread props
declare function cn(...classes: (string | undefined | false | null)[]): string;

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'outlined';
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('rounded-lg border bg-white shadow-sm', variant === 'outlined' && 'border-2', className)}
        {...props}
      />
    );
  },
);
Card.displayName = 'Card';



// Array.map with index key for rendering error list items
declare const validationErrors: { required: string[]; format: string[] };

function ValidationErrorList({ errors }: { errors: { required: string[]; format: string[] } }) {
  return (
    <div className="text-sm">
      {errors.required.map((error, index) => (
        <p key={index} className="text-red-500">{error}</p>
      ))}
      {errors.format.map((error, index) => (
        <p key={index} className="text-amber-500">{error}</p>
      ))}
    </div>
  );
}



// Standard array.map in JSX rendering recipients
declare interface RecipientEntry { id: string; email: string; name: string; }
declare function getAbbreviation(r: RecipientEntry): string;

function RecipientAvatarList({ recipients }: { recipients: RecipientEntry[] }) {
  return (
    <div className="flex gap-1">
      {recipients.map((recipient) => (
        <div key={recipient.id} className="my-1 flex items-center gap-2">
          <span>{getAbbreviation(recipient)}</span>
          <p>{recipient.email || recipient.name}</p>
        </div>
      ))}
    </div>
  );
}



// Dialog onOpenChange with isPending guard
declare let isPending: boolean;

function ConfirmationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div>
      <dialog
        open={open}
        onClose={!isPending ? onClose : undefined}
      >
        <p>Confirm action?</p>
        <button onClick={onClose} disabled={isPending}>Close</button>
      </dialog>
    </div>
  );
}



// React.forwardRef SpinnerBox with spread props
declare function cn(...classes: (string | undefined | false | null)[]): string;

interface LoadingBoxProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg';
}

const LoadingBox = React.forwardRef<HTMLDivElement, LoadingBoxProps>(
  ({ className, size = 'md', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('flex items-center justify-center rounded-lg', className)}
        {...props}
      >
        <span className={cn('animate-spin', size === 'sm' ? 'h-4 w-4' : 'h-8 w-8')} />
      </div>
    );
  },
);
LoadingBox.displayName = 'LoadingBox';



// Array.map on split newlines rendering React.Fragment
function MessageBody({ text }: { text: string }) {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n{2,}/g, '\n\n');
  const paragraphs = normalized.split('\n\n');

  return (
    <div>
      {paragraphs.map((paragraph, i) => (
        <p key={`p-${i}`} className="whitespace-pre-line">
          {paragraph.split('\n').map((line, j) => (
            <React.Fragment key={`line-${i}-${j}`}>
              {j > 0 && <br />}
              {line}
            </React.Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}



// React setState functional update with spread
declare interface UploadFile { id: string; name: string; progress: number; isError: boolean; }
declare function useState<T>(init: T): [T, (updater: T | ((prev: T) => T)) => void];

function useUploadQueue() {
  const [localFiles, setLocalFiles] = useState<UploadFile[]>([]);

  function addFiles(newFiles: UploadFile[]): void {
    setLocalFiles((prev) => [...prev, ...newFiles]);
  }

  return { localFiles, addFiles };
}



// Array.map with (_, index) pattern
declare const STEP_INDICATORS: string[];

function ProgressIndicator({ activeStep }: { activeStep: number }) {
  return (
    <div className="flex gap-1">
      {STEP_INDICATORS.map((_, index) => (
        <div
          key={index}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            index === activeStep ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/30'
          }`}
        />
      ))}
    </div>
  );
}



// Array.map with conditional spread object update
declare interface UploadItem { id: string; documentDataId: string; title: string; }
declare const currentItems: UploadItem[];
declare const updatedItem: { id: string; documentDataId: string };

function updateItemInList(items: UploadItem[], update: { id: string; documentDataId: string }): UploadItem[] {
  return items.map((item) =>
    item.id === update.id
      ? { ...item, documentDataId: update.documentDataId }
      : item,
  );
}



// Input onChange converting empty string to null
declare interface TextInputProps {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
}

function NullableTextInput({ value, onChange, placeholder }: TextInputProps) {
  return (
    <input
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
      placeholder={placeholder}
      type="text"
    />
  );
}



// setRecipients with mapped array
declare interface SignerConfig { nativeId?: number; email: string; name: string; actionAuth: string[] | null; }
declare interface RecipientUpdate { id?: number; email: string; name: string; actionAuth: string[]; }
declare function setRecipients(opts: { documentId: string; recipients: RecipientUpdate[] }): Promise<void>;

async function syncRecipients(documentId: string, signers: SignerConfig[]): Promise<void> {
  await setRecipients({
    documentId,
    recipients: signers.map((signer) => ({
      ...signer,
      id: signer.nativeId,
      actionAuth: signer.actionAuth ?? [],
    })),
  });
}



// Array.map with explicit typed index parameter
declare interface ContactEntry { id: string; email: string; name: string; }

function ContactAvatarRow({ contacts }: { contacts: ContactEntry[] }) {
  const maxVisible = 5;
  const visible = contacts.slice(0, maxVisible);
  const remaining = contacts.length - visible.length;

  return (
    <div className="flex items-center">
      {visible.map((contact, index: number) => (
        <span
          key={contact.id}
          style={{ zIndex: 50 - index * 10, marginLeft: index === 0 ? 0 : -8 }}
          title={contact.email}
        >
          {contact.name.charAt(0).toUpperCase()}
        </span>
      ))}
      {remaining > 0 && <span>+{remaining}</span>}
    </div>
  );
}



// Array.map over enum values rendering SelectItem - valid React list (argument-type-mismatch FP)
declare const React: any;
declare function SelectItem(props: { value: string; children: React.ReactNode }): any;

enum UserRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
}

const roleHierarchy = [UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER, UserRole.VIEWER];

function RoleSelector() {
  return (
    <div>
      {roleHierarchy.map((role) => (
        <SelectItem key={role} value={role}>
          {role.charAt(0) + role.slice(1).toLowerCase()}
        </SelectItem>
      ))}
    </div>
  );
}



// React state toggle using functional update - standard pattern (argument-type-mismatch FP)
declare const React: any;
declare function useState<T>(init: T): [T, (updater: ((prev: T) => T) | T) => void];

function ApiKeyCard({ apiKey }: { apiKey: string }) {
  const [isVisible, setIsVisible] = useState(false);
  const maskedKey = isVisible ? apiKey : apiKey.slice(0, 8) + '••••••••';
  return (
    <div>
      <span>{maskedKey}</span>
      <button onClick={() => setIsVisible((prev) => !prev)}>
        {isVisible ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}



// SelectValue with tagged template literal placeholder (argument-type-mismatch FP)
declare const React: any;
declare function SelectValue(props: { placeholder?: string }): any;
declare function t(strings: TemplateStringsArray, ...values: any[]): string;

function DateFormatSelector() {
  return (
    <div>
      <SelectValue placeholder={t`Select date format`} />
    </div>
  );
}



// TanStack Table row selection handler with !! cast (argument-type-mismatch FP)
declare const React: any;
declare function Checkbox(props: { checked: boolean; onCheckedChange: (v: boolean | 'indeterminate') => void }): any;

function DataTableRow({ row }: { row: { toggleSelected: (v: boolean) => void; getIsSelected: () => boolean } }) {
  return (
    <Checkbox
      checked={row.getIsSelected()}
      onCheckedChange={(value) => row.toggleSelected(!!value)}
    />
  );
}



// React.forwardRef wrapping HTML textarea with cn() - standard component wrapper (argument-type-mismatch FP)
declare const React: any;
declare function cn(...classes: (string | undefined | null | false)[]): string;

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm',
      className
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';



// React.forwardRef Spinner component wrapping Loader icon (argument-type-mismatch FP)
declare const React: any;
declare function cn(...classes: (string | undefined | null | false)[]): string;
declare function Loader(props: any): any;

const Spinner = React.forwardRef<
  SVGSVGElement,
  React.SVGProps<SVGSVGElement> & { size?: 'sm' | 'md' | 'lg' }
>(({ size = 'md', className, ...props }, ref) => (
  <Loader
    ref={ref}
    className={cn('animate-spin', size === 'sm' && 'h-4 w-4', size === 'md' && 'h-6 w-6', size === 'lg' && 'h-8 w-8', className)}
    {...props}
  />
));
Spinner.displayName = 'Spinner';



// Radix UI RadioGroup forwardRef wrapper (argument-type-mismatch FP)
declare const React: any;
declare const RadioGroupPrimitive: any;
declare function cn(...classes: (string | undefined | null | false)[]): string;

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root
    className={cn('grid gap-2', className)}
    {...props}
    ref={ref}
  />
));
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;



// Standard React.map over typed billing plan array (argument-type-mismatch FP)
declare const React: any;
declare function PlanCard(props: { plan: BillingPlan; isCurrent: boolean }): any;

interface BillingPlan {
  id: string;
  name: string;
  priceMonthly: number;
  features: string[];
}

function BillingPlansGrid({ plans, currentPlanId }: { plans: BillingPlan[]; currentPlanId: string }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} isCurrent={plan.id === currentPlanId} />
      ))}
    </div>
  );
}



// onChange handler with nullish coalescing to default string (argument-type-mismatch FP)
declare const React: any;
declare function useState<T>(init: T): [T, (v: T) => void];
declare function SignatureInput(props: { onChange: (v: string | null) => void; value: string }): any;

function SignatureCapture({ onComplete }: { onComplete: (sig: string) => void }) {
  const [signature, setSignature] = React.useState('');
  return (
    <SignatureInput
      value={signature}
      onChange={(v) => setSignature(v ?? '')}
    />
  );
}



// Optional-chained array.map for breadcrumb list rendering (argument-type-mismatch FP)
declare const React: any;

interface Breadcrumb { id: string; label: string; href: string }

function BreadcrumbNav({ breadcrumbs }: { breadcrumbs?: Breadcrumb[] }) {
  return (
    <nav>
      <ol>
        {breadcrumbs?.map((crumb) => (
          <li key={crumb.id}>
            <a href={crumb.href}>{crumb.label}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}



// Select onValueChange with ternary string-to-bool normalization (argument-type-mismatch FP)
declare const React: any;
declare function Select(props: any): any;
declare function SelectTrigger(props: any): any;
declare function SelectValue(props: any): any;
declare function SelectContent(props: any): any;
declare function SelectItem(props: any): any;

function NotificationsPreferenceSelect({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  return (
    <Select
      value={value === null ? 'default' : value ? 'enabled' : 'disabled'}
      onValueChange={(v: string) =>
        onChange(v === 'default' ? null : v === 'enabled' ? true : false)
      }
    >
      <SelectTrigger>
        <SelectValue placeholder="Select preference" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="default">Default</SelectItem>
        <SelectItem value="enabled">Enabled</SelectItem>
        <SelectItem value="disabled">Disabled</SelectItem>
      </SelectContent>
    </Select>
  );
}



// react-hook-form handleSubmit - standard form submission pattern (argument-type-mismatch FP)
declare const React: any;
declare function useForm<T>(opts?: any): any;

interface GroupUpdateFormValues { name: string; description: string; permissions: string[] }

function GroupUpdateForm({ onSuccess }: { onSuccess: () => void }) {
  const form = useForm<GroupUpdateFormValues>();

  async function onFormSubmit(values: GroupUpdateFormValues) {
    console.log('Submitting group update:', values.name);
    onSuccess();
  }

  return (
    <form onSubmit={form.handleSubmit(onFormSubmit)}>
      <button type="submit">Save Changes</button>
    </form>
  );
}



// Checkbox onCheckedChange with checked === true boolean normalization (argument-type-mismatch FP)
declare const React: any;
declare function Checkbox(props: {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean | 'indeterminate') => void;
}): any;

function IncludeAttachmentsCheckbox({
  field,
}: {
  field: { value: boolean; onChange: (v: boolean) => void };
}) {
  return (
    <Checkbox
      id="include-attachments"
      checked={field.value}
      onCheckedChange={(checked) => field.onChange(checked === true)}
    />
  );
}



// SelectValue with i18n tagged template placeholder (argument-type-mismatch FP)
declare const React: any;
declare function SelectValue(props: { placeholder?: string }): any;
declare function t(strings: TemplateStringsArray, ...values: any[]): string;

function VisibilitySelector() {
  return (
    <div>
      <SelectValue placeholder={t`Select visibility level`} />
    </div>
  );
}



// forwardRef component spreading SVG props with cn() class merge (argument-type-mismatch FP)
declare const React: any;
declare function cn(...classes: (string | undefined | null | false)[]): string;
declare function cva(base: string, config?: any): (...args: any[]) => string;

const iconVariants = cva('', {
  variants: { size: { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' } },
  defaultVariants: { size: 'md' },
});

declare function LoaderIcon(props: any): any;

const AnimatedLoader = React.forwardRef<
  SVGSVGElement,
  React.SVGProps<SVGSVGElement> & { size?: 'sm' | 'md' | 'lg' }
>(({ size, className, ...props }, ref) => (
  <LoaderIcon
    ref={ref}
    className={cn('animate-spin', iconVariants({ size }), className)}
    {...props}
  />
));
AnimatedLoader.displayName = 'AnimatedLoader';



// react-hook-form form.watch() for watching field value (argument-type-mismatch FP)
declare const React: any;
declare function useForm<T>(opts?: any): { watch: (field: keyof T) => any; handleSubmit: any; register: any };

interface ConfirmationFormValues { email: string; confirmEmail: string }

function ConfirmationDialog({ expectedEmail }: { expectedEmail: string }) {
  const form = useForm<ConfirmationFormValues>();
  const watchedEmail = form.watch('email');
  const isMatch = watchedEmail === expectedEmail;
  return (
    <div>
      <input {...form.register('email')} />
      {!isMatch && <p>Email does not match</p>}
    </div>
  );
}



// Standard React input onChange handler - sets state from e.target.value (argument-type-mismatch FP)
declare const React: any;
declare function useState<T>(init: T): [T, (v: T) => void];

function SearchInput({ onSearch }: { onSearch: (query: string) => void }) {
  const [query, setQuery] = React.useState('');
  return (
    <input
      type="text"
      value={query}
      placeholder="Search..."
      onChange={(e) => setQuery(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && onSearch(query)}
    />
  );
}



// Array.map with index as React key in JSX list (argument-type-mismatch FP)
declare const React: any;

interface DirectLinkOption { label: string; url: string; isActive: boolean }

function DirectLinkList({ options }: { options: DirectLinkOption[] }) {
  return (
    <ul>
      {options.map((option, index) => (
        <li key={index} className={option.isActive ? 'active' : ''}>
          <a href={option.url}>{option.label}</a>
        </li>
      ))}
    </ul>
  );
}



// argument-type-mismatch FP: React.forwardRef with correctly typed generic params
import * as React from 'react';

interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  isSelected?: boolean;
}

const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ isSelected, className, ...props }, ref) => (
    <tr ref={ref} data-selected={isSelected} className={className} {...props} />
  )
);

TableRow.displayName = 'TableRow';
export { TableRow };



// argument-type-mismatch FP: dropzone hook with config object containing callbacks
declare function useDropzone(config: {
  accept: Record<string, string[]>;
  onDrop: (files: File[]) => void;
  maxSize?: number;
}): { getRootProps: () => Record<string, unknown>; isDragActive: boolean };

function FileUploadZone({ onFileSelected }: { onFileSelected: (file: File) => void }) {
  const { getRootProps, isDragActive } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    onDrop: (files) => { if (files[0]) onFileSelected(files[0]); },
    maxSize: 10 * 1024 * 1024,
  });
  return <div {...getRootProps()}>{isDragActive ? 'Drop here' : 'Upload'}</div>;
}

export { FileUploadZone };



// argument-type-mismatch FP: react-hook-form handleSubmit onSubmit handler
import * as React from 'react';
interface FormValues { bannerText: string; bannerEnabled: boolean }
declare function useForm<T>(): { handleSubmit: (fn: (data: T) => void) => React.FormEventHandler };

function SiteSettingsForm() {
  const form = useForm<FormValues>();
  const onBannerUpdate = (data: FormValues) => {
    console.log('saving banner', data.bannerText);
  };
  return <form onSubmit={form.handleSubmit(onBannerUpdate)}><button type="submit">Save</button></form>;
}

export { SiteSettingsForm };



// argument-type-mismatch FP: enum key access for display label in table cell
import * as React from 'react';
enum TeamRole { OWNER = 'OWNER', MEMBER = 'MEMBER', VIEWER = 'VIEWER' }
const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  [TeamRole.OWNER]: 'Owner',
  [TeamRole.MEMBER]: 'Member',
  [TeamRole.VIEWER]: 'Viewer',
};
interface TeamMember { id: string; teamRole: TeamRole }

function RoleBadge({ member }: { member: TeamMember }) {
  return <span>{TEAM_ROLE_LABELS[member.teamRole]}</span>;
}

export { RoleBadge };



// argument-type-mismatch FP: useMemo returning explicitly typed column definitions
import * as React from 'react';
interface ColumnDef<T> { id: string; header: string; accessor: (row: T) => unknown }
interface TemplateRow { id: string; title: string; createdAt: string }
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;

function useTemplateColumns(): ColumnDef<TemplateRow>[] {
  return useMemo<ColumnDef<TemplateRow>[]>(
    () => [
      { id: 'title', header: 'Title', accessor: (row) => row.title },
      { id: 'created', header: 'Created', accessor: (row) => row.createdAt },
    ],
    []
  );
}

export { useTemplateColumns };



// argument-type-mismatch FP: React.forwardRef component using i18n hook
import * as React from 'react';
declare function useLingui(): { _: (descriptor: { id: string }) => string };

interface TypeSelectProps {
  value: string;
  onChange: (value: string) => void;
}

const TypeSelect = React.forwardRef<HTMLSelectElement, TypeSelectProps>(
  ({ value, onChange }, ref) => {
    const { _ } = useLingui();
    return (
      <select ref={ref} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="standard">{_({ id: 'type.standard' })}</option>
        <option value="template">{_({ id: 'type.template' })}</option>
      </select>
    );
  }
);

TypeSelect.displayName = 'TypeSelect';
export { TypeSelect };



// argument-type-mismatch FP: array.map with item and index in JSX
import * as React from 'react';
interface CheckboxOption { label: string; checked: boolean }
interface FieldMeta { values: CheckboxOption[] }
declare const fieldMeta: FieldMeta;

function CheckboxGroup({ meta }: { meta: FieldMeta }) {
  return (
    <div>
      {meta.values.map((item, index) => (
        <label key={index}>
          <input type="checkbox" defaultChecked={item.checked} />
          {item.label}
        </label>
      ))}
    </div>
  );
}

export { CheckboxGroup };



// argument-type-mismatch FP: truthy guard before calling field.onChange
import * as React from 'react';
interface SelectOption { value: string; label: string }
interface FieldControl { onChange: (value: string) => void }
declare function useFieldControl(name: string): FieldControl;

function SafeSelect({ name, options }: { name: string; options: SelectOption[] }) {
  const field = useFieldControl(name);
  return (
    <select onChange={(e) => { const v = e.target.value; v && field.onChange(v); }}>
      {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
    </select>
  );
}

export { SafeSelect };



// argument-type-mismatch FP: useMemo returning filtered array result
import * as React from 'react';
interface Plan { id: string; name: string; isActive: boolean; price: number }
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare const allPlans: Plan[];

function useActivePlans(plans: Plan[]): Plan[] {
  return useMemo(
    () => plans.filter((plan) => plan.isActive),
    [plans]
  );
}

export const activePlans = useActivePlans(allPlans);



// argument-type-mismatch FP: dialog onOpenChange with isSubmitting guard
import * as React from 'react';
declare function Dialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}): JSX.Element;

function ConfirmDialog({
  open,
  onOpenChange,
  isSubmitting,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSubmitting: boolean;
  children: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => !isSubmitting && onOpenChange(value)}
    >
      {children}
    </Dialog>
  );
}

export { ConfirmDialog };


// Array.map over combobox options rendering CommandItem with index key — standard React list.
declare function CommandItem(props: { key: number; onSelect(): void; children: unknown }): JSX.Element;
declare function CheckIcon(props: { className: string }): JSX.Element;
declare function cn(...args: (string | boolean | undefined)[]): string;

interface SelectOption { label: string; value: string; }

function OptionList({ options, selectedValues }: { options: SelectOption[]; selectedValues: string[] }) {
  return (
    <div>
      {options.map((option, i) => (
        <CommandItem key={i} onSelect={() => {}}>
          <CheckIcon className={cn('mr-2 h-4 w-4', selectedValues.includes(option.value) ? 'opacity-100' : 'opacity-0')} />
          {option.label}
        </CommandItem>
      ))}
    </div>
  );
}


// useMemo returning filtered array with enum comparison — valid memo with typed filter.
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;

enum FieldStatus { SIGNED = 'SIGNED', PENDING = 'PENDING' }
interface FormField { id: string; status: FieldStatus; }

function useSignedFields(fields: FormField[], status: FieldStatus) {
  const filteredFields = useMemo(
    () => fields.filter((f) => f.status === status),
    [fields, status],
  );
  return filteredFields;
}


// setLocalFields(localFields.map(field => ...)) — standard React setter with array map.
declare function useState<T>(initial: T): [T, (val: T) => void];

interface FormField { id: string; value: string; touched: boolean; }

function useFieldEditor(initial: FormField[]) {
  const [localFields, setLocalFields] = useState<FormField[]>(initial);

  function markAllTouched() {
    setLocalFields(localFields.map((field) => ({ ...field, touched: true })));
  }

  return { localFields, markAllTouched };
}


// Form onSubmit={form.handleSubmit(onSubmit)} — standard react-hook-form pattern.
declare const form: { handleSubmit(fn: (values: unknown) => void): (e: unknown) => void };

function onSubmit(values: unknown) {
  console.log(values);
}

function BulkSendForm() {
  return <form onSubmit={form.handleSubmit(onSubmit)}><button type="submit">Send</button></form>;
}


// cn() call with ternary class — valid cn() usage.
declare function cn(...args: (string | boolean | undefined)[]): string;

interface ComboboxOption { label: string; value: string; }

function CheckIcon({ selected, current }: { selected: ComboboxOption; current: ComboboxOption }) {
  return (
    <span className={cn('mr-2 h-4 w-4', current.value === selected.value ? 'opacity-100' : 'opacity-0')}>
      ✓
    </span>
  );
}


// useState<NodeJS.Timeout | null>(null) — valid typed useState initialization.
declare function useState<T>(initial: T): [T, (v: T | null) => void];

function useCopyTimeout() {
  const [copyTimer, setCopyTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  function startCopy() {
    const timer = setTimeout(() => setCopyTimer(null), 2000);
    setCopyTimer(timer);
  }

  return { copyTimer, startCopy };
}


// Array.map over fields with index as key in JSX — standard React list rendering.
declare function FieldItem(props: { key: number; fieldId: string; label: string }): JSX.Element;

interface FormField { id: string; label: string; }

function FieldList({ fields }: { fields: FormField[] }) {
  return (
    <div>
      {fields.map((field, index) => (
        <FieldItem key={index} fieldId={field.id} label={field.label} />
      ))}
    </div>
  );
}


// useMemo with array.filter and type predicate — valid typed filter in memo.
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;

interface BaseTemplate { id: string; isPublic: boolean; }
interface DirectTemplate extends BaseTemplate { directLink: string; }

function isDirectTemplate(t: BaseTemplate): t is DirectTemplate {
  return 'directLink' in t;
}

function useDirectTemplates(templates: BaseTemplate[]) {
  return useMemo(
    () => templates.filter((template): template is DirectTemplate => isDirectTemplate(template)),
    [templates],
  );
}


// Input onChange updating state with computed key — valid React controlled input.
declare function useState<T>(init: T): [T, (fn: (prev: T) => T) => void];

function useCssVarEditor(initialVars: Record<string, string>) {
  const [cssVars, setCssVars] = useState<Record<string, string>>(initialVars);

  function handleChange(key: string, value: string) {
    setCssVars((prev) => ({ ...prev, [key]: value }));
  }

  return { cssVars, handleChange };
}


// useState with lazy initializer calling array.map — valid lazy state initialization.
declare function useState<T>(init: () => T): [T, (v: T | null) => void];

interface DocumentField { id: string; label: string; value: string; }
interface FormSchema { fields: DocumentField[] }

function useFieldForm(document: { fields: DocumentField[] }) {
  const [formState, setFormState] = useState<FormSchema | null>(() => ({
    fields: document.fields.map((f) => ({ id: f.id, label: f.label, value: f.value })),
  }));
  return { formState, setFormState };
}


// img with spread props and cn() className — valid JSX prop spread.
declare function cn(...args: unknown[]): string;
declare const React: { forwardRef: Function };

interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  className?: string;
}

const PageImage = React.forwardRef<HTMLImageElement, ImageProps>(
  ({ className, ...props }, ref) => (
    <img ref={ref} className={cn('block max-w-full', className)} draggable={false} alt="" {...props} />
  ),
);


// React.forwardRef with spread props and className forwarding — Radix UI pattern.
declare const React: {
  forwardRef<T, P>(fn: (props: P, ref: React.Ref<T>) => JSX.Element): React.ForwardRefExoticComponent<P>;
  ElementRef: any;
  ComponentPropsWithoutRef: any;
  Ref: any;
  ForwardRefExoticComponent: any;
  ImgHTMLAttributes: any;
};

const AlertTitle = React.forwardRef<
  HTMLHeadingElement,
  React.ImgHTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5 ref={ref} className={`alert-title ${className ?? ''}`} {...props} />
));


// assistantForm.handleSubmit(onAssistantFormSubmit) — react-hook-form pattern.
declare const assistantForm: { handleSubmit(fn: (values: unknown) => Promise<void>): (e: unknown) => void };

async function onAssistantFormSubmit(values: unknown) {
  console.log('submitted', values);
}

function AssistantForm() {
  return <form onSubmit={assistantForm.handleSubmit(onAssistantFormSubmit)}><button type="submit">Submit</button></form>;
}


// Standard Radix UI forwardRef — not a type mismatch.
declare const React: {
  forwardRef<T, P>(fn: (props: P, ref: React.Ref<T>) => JSX.Element): React.ForwardRefExoticComponent<P>;
  ElementRef: any;
  ComponentPropsWithoutRef: any;
  Ref: any;
  ForwardRefExoticComponent: any;
};

declare const DialogPrimitive: {
  Title: React.ForwardRefExoticComponent<{ className?: string }>;
};

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={`dialog-title ${className ?? ''}`} {...props} />
));


// row.getValue() with type assertion — expected pattern for typed react-table cells.
type DocumentStatus = 'DRAFT' | 'PENDING' | 'COMPLETED' | 'CANCELLED';
interface TableRow { getValue(key: string): unknown; }
declare function StatusBadge(props: { status: DocumentStatus }): JSX.Element;

function StatusCell({ row }: { row: TableRow }) {
  const status = row.getValue('status') as DocumentStatus;
  return <StatusBadge status={status} />;
}



// --- FP shape: hook called unconditionally, return value drives ternary (SSR hydration pattern) ---
declare function useIsHydrated(): boolean;
declare const ServerPlaceholder: React.ComponentType;
declare const ClientContent: React.ComponentType<{ data: string }>;
declare const React: { createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown };

function ClientOnly({ data }: { data: string }): unknown {
  const isHydrated = useIsHydrated();
  // eslint-disable-next-line react/no-danger-with-children
  return isHydrated
    ? React.createElement(ClientContent, { data })
    : React.createElement(ServerPlaceholder);
}



// FP shape: void handleAutoSave() in onBlur JSX prop (fire-and-forget autosave)
declare function useFormAutoSave(): { handleAutoSave: () => Promise<void>; setLastActiveField: (f: unknown) => void };
declare function ResizableField(props: {
  onFocus: () => void;
  onBlur: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}): JSX.Element;

export function FieldEditorCanvas(): JSX.Element {
  const { handleAutoSave, setLastActiveField } = useFormAutoSave();
  const field = { id: 'f1' };
  return (
    <ResizableField
      onFocus={() => setLastActiveField(field)}
      onBlur={() => {
        setLastActiveField(null);
        void handleAutoSave();
      }}
      onMouseEnter={() => setLastActiveField(field)}
      onMouseLeave={() => setLastActiveField(null)}
    />
  );
}



// FP shape: void onEnableClick() in JSX Button onClick prop (fire-and-forget async handler)
declare function Button(props: {
  type: string;
  onClick: () => void;
  loading?: boolean;
  children?: unknown;
}): JSX.Element;

declare function onEnableFeatureClick(): Promise<void>;
declare const isSubmitting: boolean;
declare const canEnableFeature: boolean;

export function FeatureEnableDialogFooter(): JSX.Element {
  return canEnableFeature ? (
    <Button type="button" onClick={() => void onEnableFeatureClick()} loading={isSubmitting}>
      Enable feature
    </Button>
  ) : null!;
}



// FP shape: void handleAutoSave() in onValueChange callback prop (fire-and-forget autosave)
declare function RoleSelect(props: {
  onValueChange: (value: string) => void;
  disabled?: boolean;
}): JSX.Element;
declare function handleRoleChange(index: number, value: string): void;
declare function handleAutoSave(): Promise<void>;
declare const index: number;

export function SignerRoleField(): JSX.Element {
  return (
    <RoleSelect
      onValueChange={(value) => {
        handleRoleChange(index, value);
        void handleAutoSave();
      }}
      disabled={false}
    />
  );
}



// FP shape: void handleAutoSave() inside Select onValueChange after field.onChange (fire-and-forget)
declare function Select(props: { onValueChange: (v: string) => void; children?: unknown }): JSX.Element;
declare const field: { onChange: (v: string) => void };
declare function handleAutoSave(): Promise<void>;

export function LanguageSelectField(): JSX.Element {
  return (
    <Select
      onValueChange={(value) => {
        field.onChange(value);
        void handleAutoSave();
      }}
    />
  );
}



// FP shape: void handleAutoSave() in onBlur inside template field editor (fire-and-forget)
declare function TemplateResizableField(props: {
  onFocus: () => void;
  onBlur: () => void;
  onResize: (opts: unknown) => void;
}): JSX.Element;
declare function setCurrentTemplateField(f: unknown): void;
declare function handleAutoSave(): Promise<void>;
declare const templateField: unknown;

export function TemplateFieldCanvas(): JSX.Element {
  return (
    <TemplateResizableField
      onFocus={() => setCurrentTemplateField(templateField)}
      onBlur={() => {
        setCurrentTemplateField(null);
        void handleAutoSave();
      }}
      onResize={() => {}}
    />
  );
}



// FP shape: void handleAutoSave() in DocumentEmailCheckboxes onChange callback (fire-and-forget)
declare function DocumentEmailCheckboxes(props: {
  value: unknown;
  onChange: (value: unknown) => void;
}): JSX.Element;
declare function handleAutoSave(): Promise<void>;
declare const form: { setValue: (key: string, value: unknown, opts?: object) => void };
declare const emailSettings: unknown;

export function EmailSettingsSection(): JSX.Element {
  return (
    <DocumentEmailCheckboxes
      value={emailSettings}
      onChange={(value) => {
        form.setValue('meta.emailSettings', value, { shouldDirty: true });
        void handleAutoSave();
      }}
    />
  );
}



// FP shape: void handleAutoSave() in onRemove JSX prop (fire-and-forget after remove)
declare function EditableField(props: {
  onBlur: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}): JSX.Element;
declare function handleAutoSave(): Promise<void>;
declare function setLastActive(f: unknown): void;
declare function removeField(index: number): void;
declare const fieldIndex: number;

export function FieldCard(): JSX.Element {
  return (
    <EditableField
      onBlur={() => {
        setLastActive(null);
        void handleAutoSave();
      }}
      onRemove={() => {
        removeField(fieldIndex);
        void handleAutoSave();
      }}
      onDuplicate={() => {
        void handleAutoSave();
      }}
    />
  );
}



// FP shape: void handleAutoSave() in input onChange and onBlur callbacks (fire-and-forget)
declare function TextInput(props: {
  onChange: (e: { target: { value: string } }) => void;
  onBlur: (e: { target: { value: string } }) => void;
}): JSX.Element;
declare function handleSigningOrderChange(index: number, value: string): void;
declare function handleAutoSave(): Promise<void>;
declare const signerIndex: number;
declare const signerField: { onChange: (e: unknown) => void; onBlur: () => void };

export function SigningOrderInput(): JSX.Element {
  return (
    <TextInput
      onChange={(e) => {
        signerField.onChange(e);
        handleSigningOrderChange(signerIndex, e.target.value);
        void handleAutoSave();
      }}
      onBlur={(e) => {
        signerField.onBlur();
        handleSigningOrderChange(signerIndex, e.target.value);
        void handleAutoSave();
      }}
    />
  );
}



// FP shape: void handleAutoSave() in onSave callback prop of AdvancedSettings (fire-and-forget)
declare function FieldAdvancedSettings(props: {
  field: unknown;
  fields: unknown[];
  onSave: (fieldState: unknown) => void;
  onAutoSave: (fieldState: unknown) => Promise<void>;
}): JSX.Element;
declare function handleSavedFieldSettings(state: unknown): void;
declare function handleAutoSave(): Promise<void>;
declare const currentField: unknown;
declare const localFields: unknown[];

export function FieldSettingsPanel(): JSX.Element {
  return (
    <FieldAdvancedSettings
      field={currentField}
      fields={localFields}
      onSave={(fieldState) => {
        handleSavedFieldSettings(fieldState);
        void handleAutoSave();
      }}
      onAutoSave={async (fieldState) => {
        handleSavedFieldSettings(fieldState);
        await handleAutoSave();
      }}
    />
  );
}



// FP shape: void copyToken(value) in Button onClick prop (fire-and-forget clipboard copy)
declare function Button(props: {
  variant: string;
  onClick: () => void;
  children?: unknown;
}): JSX.Element;
declare function copyToken(token: string): Promise<void>;
declare const newlyCreatedToken: { token: string };

export function TokenCopyButton(): JSX.Element {
  return (
    <Button variant="outline" onClick={() => void copyToken(newlyCreatedToken.token)}>
      Copy token
    </Button>
  );
}



// FP shape: void onClearCheckBoxValues(type) in button onClick (fire-and-forget clear action)
declare function onClearCheckBoxValues(type: string): Promise<void>;
declare const fieldType: string;
declare const isInserted: boolean;

export function CheckboxFieldOverlay(): JSX.Element {
  return isInserted ? (
    <button
      className="absolute flex items-center rounded-md border"
      onClick={() => void onClearCheckBoxValues(fieldType)}
    >
      <span className="p-1">Clear</span>
    </button>
  ) : null!;
}



// FP shape: void handleAutoSave() in Checkbox onCheckedChange callback (fire-and-forget)
declare function Checkbox(props: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}): JSX.Element;
declare const checkboxField: { onChange: (v: unknown) => void; value: boolean };
declare function handleAutoSave(): Promise<void>;

export function DictateSignerCheckbox(): JSX.Element {
  return (
    <Checkbox
      checked={checkboxField.value}
      onCheckedChange={(checked) => {
        checkboxField.onChange(checked);
        void handleAutoSave();
      }}
      disabled={false}
    />
  );
}



// FP shape: void onDownloadAuditLogsClick() in Button onClick prop (fire-and-forget download)
declare function Button(props: {
  variant: string;
  loading: boolean;
  onClick: () => void;
  children?: unknown;
}): JSX.Element;
declare function onDownloadAuditLogsClick(): Promise<void>;
declare const isDownloadLoading: boolean;

export function AuditLogDownloadButton(): JSX.Element {
  return (
    <Button
      variant="outline"
      loading={isDownloadLoading}
      onClick={() => void onDownloadAuditLogsClick()}
    >
      Download Audit Logs
    </Button>
  );
}



// FP shape: void handleAutoSave() in MultiSelectCombobox onChange after field.onChange (fire-and-forget)
declare function MultiSelectCombobox(props: {
  options: { label: string; value: string }[];
  selectedValues: string[];
  onChange: (value: string[]) => void;
  className?: string;
}): JSX.Element;
declare const signatureField: { value: string[]; onChange: (v: string[]) => void };
declare function handleAutoSave(): Promise<void>;

export function SignatureTypesSelector(): JSX.Element {
  return (
    <MultiSelectCombobox
      options={[{ label: 'Draw', value: 'draw' }, { label: 'Type', value: 'type' }]}
      selectedValues={signatureField.value}
      onChange={(value) => {
        signatureField.onChange(value);
        void handleAutoSave();
      }}
      className="w-full"
    />
  );
}



// FP shape: void handleAutoSave() in onDuplicate JSX prop (fire-and-forget after field duplicate)
declare function EditableDocField(props: {
  onRemove: () => void;
  onDuplicate: () => void;
  onDuplicateAllPages: () => void;
}): JSX.Element;
declare function removeDocField(index: number): void;
declare function copyDocField(opts: { duplicate?: boolean; duplicateAll?: boolean }): void;
declare function handleAutoSave(): Promise<void>;
declare const docFieldIndex: number;

export function DocumentFieldItem(): JSX.Element {
  return (
    <EditableDocField
      onRemove={() => {
        removeDocField(docFieldIndex);
        void handleAutoSave();
      }}
      onDuplicate={() => {
        copyDocField({ duplicate: true });
        void handleAutoSave();
      }}
      onDuplicateAllPages={() => {
        copyDocField({ duplicateAll: true });
        void handleAutoSave();
      }}
    />
  );
}



// FP shape: void onCopyRecoveryCodeClick(code) in button onClick (fire-and-forget copy)
declare function onCopyRecoveryCodeClick(code: string): Promise<void>;
declare const recoveryCodes: string[];

export function RecoveryCodeList(): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-4">
      {recoveryCodes.map((code) => (
        <div key={code} className="relative rounded-lg bg-muted p-4 font-mono">
          <span>{code}</span>
          <div className="absolute inset-y-0 right-4 flex items-center">
            <button className="opacity-60 hover:opacity-80" onClick={() => void onCopyRecoveryCodeClick(code)}>
              Copy
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}



// Single-expression predicate callback (findIndex) inside a className
// utility call inside JSX — trivial, no branching, depth <= 1.
declare function cn(...args: (string | undefined | null | false)[]): string;
declare function getRecipientColorStyles(index: number): { comboBoxItem?: string } | undefined;
declare const recipients: Array<{ id: string; name: string }>;
declare const RecipientItem: (props: { className?: string; children?: React.ReactNode }) => JSX.Element;

const RecipientList = () => (
  <ul>
    {recipients.map((recipient) => (
      <RecipientItem
        key={recipient.id}
        className={cn(
          'px-2',
          getRecipientColorStyles(recipients.findIndex((r) => r.id === recipient.id))?.comboBoxItem,
        )}
      >
        {recipient.name}
      </RecipientItem>
    ))}
  </ul>
);



// Within-file structural repetition: 'vertical' and 'horizontal' as direction literals in one useState
declare function useState<T>(initial: T): [T, (v: T) => void];

export function AlignmentPicker({ initialDirection }: { initialDirection?: 'vertical' | 'horizontal' }) {
  const [direction, setDirection] = useState<'vertical' | 'horizontal'>(initialDirection ?? 'vertical');
  const toggleDirection = () => setDirection(direction === 'vertical' ? 'horizontal' : 'vertical');
  return { direction, toggleDirection };
}



// Single 2FA form uses 'method-selection' as the initial step literal; one usage
declare function useState<T>(initial: T): [T, (v: T) => void];
type FormStep = 'method-selection' | 'verify-code' | 'complete';

export function TwoFactorFlow() {
  const [step, setStep] = useState<FormStep>('method-selection');
  const advance = () => setStep('verify-code');
  return { step, advance };
}



// Single insights table defines accessorKey: 'name' for a column; one usage
declare function createColumnHelper<T>(): { accessor: (key: string, opts: object) => object };
type OrgRecord = { name: string; members: number };

const colHelper = createColumnHelper<OrgRecord>();
export const orgInsightsColumns = [
  colHelper.accessor('name', { header: 'Organisation' }),
  colHelper.accessor('members', { header: 'Members' }),
];



// Single dialog file uses 'billing' and 'create' as step literals in one useState
declare function useState<T>(initial: T): [T, (v: T) => void];
type OrgStep = 'create' | 'billing' | 'confirm';

export function OrgCreateWizard() {
  const [step, setStep] = useState<OrgStep>('create');
  const goToBilling = () => setStep('billing');
  const goToConfirm = () => setStep('confirm');
  return { step, goToBilling, goToConfirm };
}



// Single webhook-logs sheet uses 'request' and 'response' as tab literals in one useState
declare function useState<T>(initial: T): [T, (v: T) => void];
type WebhookTab = 'request' | 'response';

export function WebhookLogsPanel() {
  const [activeTab, setActiveTab] = useState<WebhookTab>('request');
  const switchToResponse = () => setActiveTab('response');
  const switchToRequest = () => setActiveTab('request');
  return { activeTab, switchToRequest, switchToResponse };
}



// Single dialog file uses 'SELECT' and 'MEMBERS' as step literals; distinct step names, not extractable
declare function useState<T>(initial: T): [T, (v: T) => void];
type InviteStep = 'SELECT' | 'MEMBERS' | 'REVIEW';

export function TeamMemberInviteWizard() {
  const [step, setStep] = useState<InviteStep>('SELECT');
  const goToMembers = () => setStep('MEMBERS');
  const goToReview = () => setStep('REVIEW');
  return { step, goToMembers, goToReview };
}



// FP shape: toast variant string in a single component error handler (protocol-api-vocabulary)
declare function useToast(): { toast: (opts: { title: string; description: string; variant: string }) => void };

function CheckboxSigningField({ fieldId }: { fieldId: string }) {
  const { toast } = useToast();

  const onSign = async () => {
    try {
      await performSigning(fieldId);
    } catch (err) {
      toast({
        title: 'Error',
        description: 'An error occurred while signing the document.',
        variant: 'destructive',
      });
    }
  };

  return null;
}

declare function performSigning(id: string): Promise<void>;



// FP shape: useState initialized to a status string literal in a single component (single-usage-false-trigger)
declare function useState<T>(initial: T): [T, (val: T) => void];

type RenderState = 'idle' | 'loading' | 'ready' | 'error';

function PdfPreviewWidget() {
  const [renderState, setRenderState] = useState<RenderState>('loading');

  const onPageReady = () => setRenderState('ready');
  const onError = () => setRenderState('error');

  return null;
}



// FP shape: toast variant string in a standalone signup error handler (protocol-api-vocabulary)
declare function useNotify(): { notify: (opts: { title: string; description: string; variant: string }) => void };
declare const SIGNUP_ERRORS: Record<string, string>;

function SignupFormWidget() {
  const { notify } = useNotify();

  const onSubmit = async (data: { email: string; password: string }) => {
    try {
      await createAccount(data);
    } catch (err) {
      const code = getErrorCode(err);
      const message = SIGNUP_ERRORS[code] ?? SIGNUP_ERRORS['INVALID_REQUEST'];

      notify({
        title: 'An error occurred',
        description: message,
        variant: 'destructive',
      });
    }
  };

  return null;
}

declare function createAccount(data: { email: string; password: string }): Promise<void>;
declare function getErrorCode(err: unknown): string;



// FP shape: form field name string in a single form.getValues() call (single-usage-false-trigger)
declare function useFormContext<T>(): {
  getValues: (field: keyof T) => T[keyof T];
  watch: (field: keyof T) => T[keyof T];
};

interface RecipientFormValues {
  signers: Array<{ actionAuth: string[] }>;
  subject: string;
}

function useRecipientFormAuthCheck() {
  const form = useFormContext<RecipientFormValues>();

  const hasActionAuth = form.getValues('signers').find((signer) => signer.actionAuth.length > 0);

  return hasActionAuth !== undefined;
}



// FP shape: URL search param name string in a single table filter component (single-usage-false-trigger)
declare function useSearchParams(): [URLSearchParams, (p: URLSearchParams) => void];
declare function useNavigate(): (path: string) => void;

function SenderFilterDropdown({ teamId }: { teamId: string }) {
  const [searchParams] = useSearchParams();

  const senderIds = (searchParams?.get('senderIds') ?? '').split(',').filter(Boolean);

  const onFilterChange = (newIds: string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('senderIds', newIds.join(','));
    window.history.pushState(null, '', `?${params.toString()}`);
  };

  return null;
}



// FP shape: URL search param key string in a single search component handler (single-usage-false-trigger)
declare function useSearchParams(): [URLSearchParams, (p: URLSearchParams) => void];

function DocumentSearchWidget() {
  const [searchParams, setSearchParams] = useSearchParams();

  const handleSearch = (term: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (term) {
      params.set('query', term);
    } else {
      params.delete('query');
    }
    setSearchParams(params);
  };

  return null;
}



// FP shape: animation ease string in a single animation call (single-usage-false-trigger)
declare function animate(target: unknown, value: number, opts: { duration: number; ease: string }): Promise<void>;

function resetCardPosition(cardX: unknown, cardY: unknown, sheenOpacity: unknown) {
  void animate(cardX, 0, { duration: 2, ease: 'backInOut' });
  void animate(cardY, 0, { duration: 2, ease: 'backInOut' });
  void animate(sheenOpacity, 0, { duration: 2, ease: 'backInOut' });
}



// FP shape: prop default string in three separate independent components (parallel-independent-call-sites)
type AuthTarget = 'FIELD' | 'DOCUMENT';

interface Auth2FAProps {
  actionTarget?: AuthTarget;
  onSubmit: (token: string) => void;
}

function SignatureField2FAAuth({ actionTarget = 'FIELD', onSubmit }: Auth2FAProps) {
  return null;
}

function InitialsField2FAAuth({ actionTarget = 'FIELD', onSubmit }: Auth2FAProps) {
  return null;
}

function DateField2FAAuth({ actionTarget = 'FIELD', onSubmit }: Auth2FAProps) {
  return null;
}



// FP shape: union-type step literals in a single dialog's useState (within-file-structural-repetition)
declare function useState<T>(init: T): [T, (v: T) => void];

function GroupMemberAddDialog() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'SELECT' | 'ROLES'>('SELECT');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  const onNext = () => setStep('ROLES');
  const onBack = () => setStep('SELECT');

  return null;
}



// FP shape: toast variant in two independent component error handlers (parallel-independent-call-sites)
declare function useToast(): { toast: (opts: { title: string; description: string; variant: string; duration?: number }) => void };

function PrimaryDocumentUploader() {
  const { toast } = useToast();

  const onUploadError = (message: string) => {
    toast({
      title: 'Error',
      description: message,
      variant: 'destructive',
      duration: 7500,
    });
  };

  return null;
}

function SecondaryAttachmentUploader() {
  const { toast } = useToast();

  const onUploadError = (message: string) => {
    toast({
      title: 'Upload failed',
      description: message,
      variant: 'destructive',
      duration: 7500,
    });
  };

  return null;
}



// FP shape: form field name string in a single form.watch() call (single-usage-false-trigger)
declare function useFormContext<T>(): {
  watch: (field: keyof T) => T[keyof T];
};

interface EmbedConfigForm {
  documentData: string | null;
  title: string;
  redirectUrl: string;
}

function DocumentUploadSection() {
  const form = useFormContext<EmbedConfigForm>();

  const documentData = form.watch('documentData');

  const hasDocument = documentData !== null && documentData !== undefined;

  return null;
}



// FP shape: toast variant string in an envelope editor autosave error handler (protocol-api-vocabulary)
declare function useToast(): { toast: (opts: { title: string; description: string; variant: string; duration?: number }) => void };

function useEnvelopeEditorAutosave(envelopeId: string) {
  const { toast } = useToast();

  const handleSaveError = () => {
    toast({
      title: 'Save failed',
      description: 'We encountered an error while attempting to save your changes.',
      variant: 'destructive',
      duration: 7500,
    });
  };

  return { handleSaveError };
}



// FP shape: default period string in a single period-selector hook (single-usage-false-trigger)
declare function useSearchParams(): [URLSearchParams | null, (p: URLSearchParams) => void];
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;

type PeriodValue = 'all' | '7d' | '30d' | '90d';

function isPeriodValue(v: string): v is PeriodValue {
  return ['all', '7d', '30d', '90d'].includes(v);
}

function usePeriodSelector() {
  const [searchParams] = useSearchParams();

  const period = useMemo(() => {
    const p = searchParams?.get('period') ?? 'all';
    return isPeriodValue(p) ? p : 'all';
  }, [searchParams]);

  return period;
}



// --- expression-complexity shape: jsx-structural-elements ---
// Folder delete dialog conditionally renders a warning when the folder is non-empty.
// The compound boolean in the JSX condition is idiomatic — it checks three counts.
declare const Trans: (props: { children: string }) => JSX.Element;
declare const Alert: (props: { variant: string; children: JSX.Element }) => JSX.Element;
declare const AlertDescription: (props: { children: JSX.Element }) => JSX.Element;

export function FolderDeleteWarning(props: {
  folder: { _count: { documents: number; templates: number; subfolders: number } };
}) {
  const { folder } = props;
  return (
    <div>
      {(folder._count.documents > 0 || folder._count.templates > 0 || folder._count.subfolders > 0) && (
        <Alert variant="destructive">
          <AlertDescription>
            <Trans>
              This folder contains items. Deleting it will remove all subfolders and move nested
              documents and templates to the root folder.
            </Trans>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}



// --- expression-complexity shape: component-body-hook-and-var-setup ---
// Dialog component sets up hooks and derives state variables at the top of the
// component body. The derived booleans use logical operators but each expression
// is independently readable — not a complexity smell.
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare function useState<T>(init: T): [T, (v: T) => void];
declare const trpc: { document: { getById: { useQuery: (id: string) => { data: unknown } } } };

export function DocumentSigningCompleteDialog(props: {
  isOpen: boolean;
  documentId: string;
  onClose: () => void;
}) {
  const { isOpen, documentId } = props;
  const { data: document } = trpc.document.getById.useQuery(documentId);
  const [hasCopiedLink, setHasCopiedLink] = useState(false);

  const isCompletedByAll = useMemo(
    () => !!(document && typeof document === 'object' && 'completedAt' in document && document.completedAt),
    [document],
  );

  const canDownload = useMemo(
    () => isCompletedByAll && !!document,
    [isCompletedByAll, document],
  );

  return (
    <div>
      {isOpen && (
        <div>
          <p>{isCompletedByAll ? 'All signed' : 'Pending'}</p>
          {canDownload && <button onClick={() => setHasCopiedLink(true)}>Download</button>}
          {hasCopiedLink && <span>Link copied!</span>}
        </div>
      )}
    </div>
  );
}



// --- expression-complexity shape: object-literal-and-call-arguments ---
// SignaturePadDraw loads an existing signature image onto the canvas.
// The call to drawImage with Math.min args is idiomatic image rendering — not complex.
declare function useRef<T>(init: T | null): { current: T | null };
declare function useLayoutEffect(fn: () => void, deps: unknown[]): void;

export function useSignatureImageLoader(
  canvasRef: { current: HTMLCanvasElement | null },
  imageDataRef: { current: ImageData | null },
  value: string,
): void {
  useLayoutEffect(() => {
    if (canvasRef.current && value) {
      const ctx = canvasRef.current.getContext('2d');
      const { width, height } = canvasRef.current;
      const img = new Image();
      img.onload = () => {
        ctx?.drawImage(
          img,
          0,
          0,
          Math.min(width, img.width),
          Math.min(height, img.height),
        );
        imageDataRef.current = ctx?.getImageData(0, 0, width, height) ?? null;
      };
      img.src = value;
    }
  }, [value]);
}



// --- expression-complexity shape: destructured-parameter-lists ---
// ReminderSettingsPicker accepts a large options object with nested value shape.
// Destructuring with defaults is idiomatic for controlled form pickers.
declare function Select(props: {
  value: string;
  onValueChange: (v: string) => void;
  disabled?: boolean;
  children: JSX.Element;
}): JSX.Element;
declare function SelectTrigger(props: { className?: string; children: JSX.Element }): JSX.Element;
declare function SelectValue(props?: {}): JSX.Element;
declare function SelectContent(props: { children: JSX.Element }): JSX.Element;
declare function SelectItem(props: { value: string; children: string }): JSX.Element;

export function ReminderSettingsPicker(props: {
  value?: {
    sendAfter?: { unit: string; amount: number };
    repeatEvery?: { disabled?: boolean; unit?: string; amount?: number };
  };
  onChange: (v: NonNullable<typeof props.value>) => void;
  disabled?: boolean;
  inheritLabel?: string;
}) {
  const { value, onChange, disabled, inheritLabel } = props;

  const sendAfterUnit = value?.sendAfter?.unit ?? 'days';
  const sendAfterAmount = value?.sendAfter?.amount ?? 3;
  const repeatEveryUnit = value?.repeatEvery && !('disabled' in value.repeatEvery) ? value.repeatEvery.unit ?? 'days' : 'days';
  const repeatEveryAmount = value?.repeatEvery && !('disabled' in value.repeatEvery) ? value.repeatEvery.amount ?? 7 : 7;

  const mode = value === undefined ? 'inherit' : 'enabled';
  const repeatMode = value?.repeatEvery && 'disabled' in value.repeatEvery ? 'disabled' : 'enabled';

  const onModeChange = (newMode: string) => {
    if (newMode === 'disabled') {
      onChange({ sendAfter: undefined, repeatEvery: undefined });
      return;
    }
    onChange({ sendAfter: { unit: sendAfterUnit, amount: sendAfterAmount } });
  };

  const onRepeatModeChange = (newMode: string) => {
    if (newMode === 'disabled') {
      onChange({
        sendAfter: value?.sendAfter ?? { unit: sendAfterUnit, amount: sendAfterAmount },
        repeatEvery: { disabled: true },
      });
      return;
    }
    onChange({
      sendAfter: value?.sendAfter ?? { unit: sendAfterUnit, amount: sendAfterAmount },
      repeatEvery: { unit: repeatEveryUnit, amount: repeatEveryAmount },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Select value={mode} onValueChange={onModeChange} disabled={disabled}>
        <SelectTrigger className="bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <>
            <SelectItem value="enabled">Enabled</SelectItem>
            <SelectItem value="disabled">No reminders</SelectItem>
            {inheritLabel !== undefined && <SelectItem value="inherit">{inheritLabel}</SelectItem>}
          </>
        </SelectContent>
      </Select>
    </div>
  );
}



// FP: component body with multiple hook destructurings — not a complex expression
declare function useCurrentWorkflowEditor(): { workflowId: string; steps: any[]; metadata: Record<string, unknown>; isDirty: boolean; selectedStepId: string | null };
declare function useTeamContext(): { teamId: string; teamName: string; role: string };
declare function useFeatureFlags(): { flags: Record<string, boolean> };

function WorkflowEditorRecipientForm() {
  const {
    workflowId,
    steps,
    metadata,
    isDirty,
    selectedStepId,
  } = useCurrentWorkflowEditor();

  const { teamId, teamName, role } = useTeamContext();
  const { flags } = useFeatureFlags();

  return null;
}



// FP: inner function with a single guard-return — not a complex expression
function MultiSelectDropdown({ creatable }: { creatable?: boolean }) {
  function AddNewItem() {
    if (!creatable) return undefined;
    return <div>Add new item</div>;
  }

  return <div>{AddNewItem()}</div>;
}



// FP: component with useState and simple destructured props — no complex expression
declare function useState<T>(init: T): [T, (v: T) => void];

function TeamEmailDeleteDialog({ emailId, teamId, onSuccess }: { emailId: string; teamId: string; onSuccess?: () => void }) {
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    onSuccess?.();
  }

  return null;
}



// FP: component body with single hook destructuring — not a complex expression
declare function useSession(): { user: { id: string; email: string; name: string } | null };

function DocumentPageViewDropdown() {
  const { user } = useSession();

  if (!user) return null;

  return <div>{user.name}</div>;
}



// FP: component with destructured params — standard props destructuring
declare const fieldTypes: string[];

function FieldContentRenderer({
  fieldClassName,
  field,
  isReadOnly,
  onValueChange,
}: {
  fieldClassName?: string;
  field: { id: string; type: string; value: string };
  isReadOnly?: boolean;
  onValueChange?: (val: string) => void;
}) {
  return <div className={fieldClassName}>{field.value}</div>;
}



// FP: component with single destructured-object prop — not a complex expression
function FolderDeleteDialog({ folderId }: { folderId: string }) {
  async function handleDelete() {
    // delete folder
  }

  return null;
}



// FP: component body with single hook call assignment — not a complex expression
declare function useRouteParams(): { teamSlug?: string; documentId?: string };

function AppHeaderNav() {
  const params = useRouteParams();

  return <nav>{params.teamSlug}</nav>;
}



// FP: component with default param value in destructuring — not a complex expression
function SigningAuthPasskey({
  onSuccess,
  actionTarget = 'FIELD',
}: {
  onSuccess?: () => void;
  actionTarget?: 'FIELD' | 'DOCUMENT';
}) {
  return null;
}



// FP: component body with hook result destructuring — not a complex expression
declare function useLocalization(): { translate: (key: string) => string; locale: string };

function InboxTable() {
  const { translate, locale } = useLocalization();

  return <div lang={locale}>{translate('inbox.title')}</div>;
}



// FP: function call with object literal argument — not a complex expression
declare function nanoid(size?: number): string;
declare function appendSigner(signer: { formId: string; name: string; email: string; role: string }): void;

function addNewSigner() {
  appendSigner({
    formId: nanoid(12),
    name: '',
    email: '',
    role: 'SIGNER',
  });
}



// FP: component with destructured props and hook calls — standard component setup
declare function useTranslation(): { t: (key: string) => string };
declare function useNotification(): { show: (msg: string) => void };

function EmbeddingEnvelopeEditor({
  envelopeId,
  onSave,
  readOnly,
}: {
  envelopeId: string;
  onSave?: () => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const { show } = useNotification();

  return <div>{t('editor.title')}</div>;
}



// FP shape: destructured parameter with default value (boolean) in React component
declare function useResizeObserver(ref: React.RefObject<HTMLElement>, cb: (d: { width: number; height: number }) => void): void;
declare const React: { useRef: <T>(v: T | null) => { current: T | null } };

type BannerProps = {
  message: string;
  dismissible?: boolean;
  hideRecipients?: boolean;
};

function NotificationBanner({ message, dismissible = true, hideRecipients = false }: BannerProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  useResizeObserver(containerRef, ({ width }) => {
    if (width < 480 && !hideRecipients) {
      console.log('compact mode');
    }
  });
  return null;
}



// FP shape: component with multiple boolean default params in destructuring
declare function useLingui(): { _: (d: unknown) => string };

type WizardActionsProps = {
  onBack?: () => void;
  onNext?: () => void;
  canGoBack?: boolean;
  canGoNext?: boolean;
  isLoading?: boolean;
};

export const WizardActions = ({
  onBack,
  onNext,
  canGoBack = true,
  canGoNext = true,
  isLoading = false,
}: WizardActionsProps) => {
  const { _ } = useLingui();
  return null;
};



// FP shape: component body with multiple hook calls
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useSession(): { user: { id: string; email: string } };
declare function useCurrentTeam(): { id: number; url: string };

export const TeamTemplatesTable = () => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const { user } = useSession();
  const team = useCurrentTeam();
  return null;
};



// FP shape: handler function body starting with const from form.getValues
declare const useFormValues: () => { getValues: (field: string) => unknown[] };

const FormWithAiDetection = () => {
  const form = useFormValues();

  const onAiDetectionComplete = (detectedItems: Array<{ name: string; email: string }>) => {
    const currentItems = form.getValues('recipients');

    const nextOrder =
      (currentItems as Array<{ order?: number }>).length > 0
        ? Math.max(...(currentItems as Array<{ order?: number }>).map((s) => s.order ?? 0)) + 1
        : 1;

    console.log(nextOrder, detectedItems);
  };

  return null;
};



// FP shape: component with destructured props (multiple fields from object)
declare type FieldConfig = { id: string; type: string; label: string };
declare type DocumentSettings = { language: string; timezone: string; signingOrder: string };

type FlowStepProps = {
  field: FieldConfig;
  documentMeta: DocumentSettings;
  onUpdate: (field: FieldConfig) => void;
  isReadOnly?: boolean;
};

export const FlowStepEditor = ({ field, documentMeta, onUpdate, isReadOnly }: FlowStepProps) => {
  return null;
};



// FP shape: JSX return with Form wrapper and form element with className and onSubmit handler
declare function cn(...classes: string[]): string;
declare const Form: React.FC<{ children: React.ReactNode } & Record<string, unknown>>;
declare const useSignInForm: () => {
  handleSubmit: (fn: (data: unknown) => void) => (e: React.FormEvent) => void;
  control: unknown;
};

const SignInForm = ({ className }: { className?: string }) => {
  const form = useSignInForm();

  const onFormSubmit = (data: unknown) => {
    console.log(data);
  };

  return (
    <Form>
      <form className={cn('flex w-full flex-col gap-y-4', className ?? '')} onSubmit={form.handleSubmit(onFormSubmit)}>
        <fieldset className="flex w-full flex-col gap-y-4">
          <input type="email" />
        </fieldset>
      </form>
    </Form>
  );
};



// FP shape: JSX return with Provider wrapper component
declare const RecipientContextProvider: React.FC<{ recipient: unknown; children: React.ReactNode }>;
declare const LoadingSpinner: React.FC;

type SigningPageProps = {
  recipient: { id: string; email: string };
  token: string;
  isLoading: boolean;
};

const DocumentSigningPage = ({ recipient, token, isLoading }: SigningPageProps) => {
  return (
    <RecipientContextProvider recipient={recipient}>
      <div className="relative mx-auto flex min-h-screen max-w-screen-lg flex-col items-center justify-center p-6">
        {isLoading && <LoadingSpinner />}
        <div className="relative flex w-full flex-col gap-6">
          <span>{token}</span>
        </div>
      </div>
    </RecipientContextProvider>
  );
};



// FP shape: React component with many destructured props (idiomatic React props handling)
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;

type FieldDetectionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (fields: unknown[]) => void;
  envelopeId: string;
  teamId: number;
  recipientId?: string;
  pageCount?: number;
  allowMultiPage?: boolean;
  confidenceThreshold?: number;
  onError?: (err: Error) => void;
};

export const FieldDetectionDialog = ({
  open,
  onOpenChange,
  onComplete,
  envelopeId,
  teamId,
  recipientId,
  pageCount,
  allowMultiPage,
  confidenceThreshold,
  onError,
}: FieldDetectionDialogProps) => {
  const [state, setState] = useState<'PROMPT' | 'PROCESSING' | 'DONE'>('PROMPT');
  const [fields, setFields] = useState<unknown[]>([]);

  const handleDetect = useCallback(async () => {
    setState('PROCESSING');
    try {
      const result: unknown[] = [];
      setFields(result);
      onComplete(result);
      setState('DONE');
    } catch (err) {
      onError?.(err as Error);
    }
  }, [envelopeId, teamId, onComplete, onError]);

  return null;
};



// FP shape: JSX fragment return with single ternary conditional rendering
declare const AdvancedPanel: React.FC<{ field: unknown }>;
declare const BasicPanel: React.FC;

type StepPanelProps = {
  showAdvanced: boolean;
  currentField: unknown | null;
};

const StepPanel = ({ showAdvanced, currentField }: StepPanelProps) => {
  return (
    <>
      {showAdvanced && currentField ? (
        <AdvancedPanel field={currentField} />
      ) : (
        <BasicPanel />
      )}
    </>
  );
};



// FP shape: component body with two useState calls
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];

type AuthStep = 'method-selection' | 'code-input';
type AuthMethod = 'email' | 'authenticator' | null;

const TwoFactorAuthForm = ({ onVerify }: { onVerify: (code: string) => void }) => {
  const [step, setStep] = useState<AuthStep>('method-selection');
  const [selectedMethod, setSelectedMethod] = useState<AuthMethod>(null);

  return null;
};



// FP shape: JSX return with div and className string (structural JSX element)
declare const Avatar: React.FC<{ className?: string; children?: React.ReactNode }>;
declare const AvatarImage: React.FC<{ src: string }>;
declare const AvatarFallback: React.FC<{ className?: string; children?: React.ReactNode }>;
declare function formatAvatarUrl(id: string): string;
declare function extractInitials(name: string): string;

type ProfilePageProps = {
  profile: { name: string; avatarImageId?: string; bio?: string };
  templates: unknown[];
};

const PublicProfilePage = ({ profile, templates }: ProfilePageProps) => {
  return (
    <div className="flex flex-col items-center justify-center py-4 sm:py-32">
      <div className="flex flex-col items-center">
        <Avatar className="h-24 w-24 border-2 border-solid">
          {profile.avatarImageId && <AvatarImage src={formatAvatarUrl(profile.avatarImageId)} />}
          <AvatarFallback className="text-gray-400 text-sm">{extractInitials(profile.name)}</AvatarFallback>
        </Avatar>
        <h2 className="font-semibold text-xl">{profile.name}</h2>
      </div>
    </div>
  );
};



// FP shape: useForm hook call with config object argument (object literal argument is not complex)
declare function useForm<T>(config: {
  resolver?: unknown;
  defaultValues?: Partial<T>;
  mode?: 'onChange' | 'onBlur' | 'onSubmit';
}): { control: unknown; handleSubmit: (fn: (d: T) => void) => (e: unknown) => void };

declare function zodResolver(schema: unknown): unknown;
declare const ZFieldsFormSchema: unknown;

type TFieldsFormSchema = { fields: Array<{ type: string; pageNumber: number }> };

const AddFieldsForm = () => {
  const form = useForm<TFieldsFormSchema>({
    resolver: zodResolver(ZFieldsFormSchema),
    defaultValues: {
      fields: [],
    },
  });

  return null;
};



// FP shape: JSX return with Dialog component (JSX tree depth, not complex expression)
declare const Dialog: React.FC<{ open: boolean; children?: React.ReactNode }>;
declare const DialogContent: React.FC<{ className?: string; children?: React.ReactNode }>;
declare const DialogHeader: React.FC<{ children?: React.ReactNode }>;
declare const DialogTitle: React.FC<{ children?: React.ReactNode }>;

type StatusDialogProps = {
  open: boolean;
  title: string;
  children?: React.ReactNode;
};

const StatusDialog = ({ open, title, children }: StatusDialogProps) => {
  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
};



// FP shape: component with many destructured params
declare function useState<T>(init: T): [T, (v: T) => void];

type CheckboxFieldSettingsProps = {
  value: string | Array<{ checked: boolean; value: string }> | boolean;
  onChange: (val: string | Array<{ checked: boolean; value: string }> | boolean) => void;
  onError?: (errors: string[]) => void;
  readOnly?: boolean;
  required?: boolean;
  direction?: 'vertical' | 'horizontal';
  validationRule?: string;
  validationLength?: number;
};

export const CheckboxFieldSettings = ({
  value,
  onChange,
  onError,
  readOnly,
  required,
  direction,
  validationRule,
  validationLength,
}: CheckboxFieldSettingsProps) => {
  const { _ } = useLingui();
  const [showValidation, setShowValidation] = useState(false);
  return null;
};



// FP shape: component with single destructured object prop
declare function useState<T>(init: T): [T, (v: T) => void];

type FieldWithSignature = {
  id: string;
  type: string;
  fieldMeta?: unknown;
  signature?: { value: string } | null;
};

type SigningFieldProps = {
  field: FieldWithSignature;
  onSign?: (value: string) => void;
  onUnsign?: () => void;
};

export const SigningNumberField = ({ field, onSign, onUnsign }: SigningFieldProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [localValue, setLocalValue] = useState('');
  return null;
};



// FP shape: JSX fragment with &&-chained conditional rendering (idiomatic JSX)
declare const FieldActionButtons: React.FC<{
  onDelete: () => void;
  onDuplicate: () => void;
  selectedIds: string[];
  style?: React.CSSProperties;
}>;
declare const interactiveTransformerRef: { current: { x: () => number; y: () => number; getClientRect: () => { width: number; height: number } } | null };

const FieldsPageRenderer = ({
  selectedGroups,
  isChanging,
  onDelete,
  onDuplicate,
}: {
  selectedGroups: Array<{ id: () => string }>;
  isChanging: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
}) => {
  return (
    <>
      {selectedGroups.length > 0 && interactiveTransformerRef.current && !isChanging && (
        <FieldActionButtons
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          selectedIds={selectedGroups.map((g) => g.id())}
          style={{
            position: 'absolute',
            top: interactiveTransformerRef.current.y() + interactiveTransformerRef.current.getClientRect().height + 5 + 'px',
            left: interactiveTransformerRef.current.x() + interactiveTransformerRef.current.getClientRect().width / 2 + 'px',
          }}
        />
      )}
    </>
  );
};



// FP shape: JSX return with Dialog component and handler reference prop
declare const Dialog: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void; children?: React.ReactNode }>;
declare const DialogContent: React.FC<{ children?: React.ReactNode }>;
declare const DialogHeader: React.FC<{ children?: React.ReactNode }>;
declare const DialogTitle: React.FC<{ children?: React.ReactNode }>;

const AuthDialog = ({
  open,
  onOpenChange,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}) => {
  const handleOnOpenChange = (value: boolean) => {
    onOpenChange(value);
  };

  return (
    <Dialog open={open} onOpenChange={handleOnOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title ?? 'Authenticate'}</DialogTitle>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
};



// FP shape: JSX return with template literal in JSX prop (not complex)
declare const SettingsHeader: React.FC<{ title: string; subtitle?: string; children?: React.ReactNode }>;
declare function useLingui(): { t: (strings: TemplateStringsArray, ...values: unknown[]) => string };

type ManagePageProps = {
  entityName: string;
  entityId: string;
};

const ManageEntityPage = ({ entityName, entityId }: ManagePageProps) => {
  const { t } = useLingui();

  return (
    <div>
      <SettingsHeader
        title={t`Manage entity`}
        subtitle={t`Manage the ${entityName} entity`}
      />
      <span>{entityId}</span>
    </div>
  );
};



// Step-based conditional JSX rendering
declare const currentStep: number;
declare const StepOnePanel: React.FC;
declare const StepTwoPanel: React.FC;
declare const StepThreePanel: React.FC;

function WizardView() {
  return (
    <div className="wizard-container">
      {currentStep === 1 && <StepOnePanel />}
      {currentStep === 2 && <StepTwoPanel />}
      {currentStep === 3 && <StepThreePanel />}
    </div>
  );
}



// JSX element with many props — structural element, not complex expression
declare const DataTable: React.FC<{ data: unknown[]; columns: string[]; onSort: (col: string) => void; onFilter: (val: string) => void; className?: string; loading?: boolean }>;
declare const rows: unknown[];
declare const columnDefs: string[];
declare function handleSort(col: string): void;
declare function handleFilter(val: string): void;

function ReportView() {
  return (
    <DataTable
      data={rows}
      columns={columnDefs}
      onSort={handleSort}
      onFilter={handleFilter}
      className="report-table"
      loading={false}
    />
  );
}



// Component with single useRef initialization — not a complex expression
declare function useRef<T>(initial: T | null): { current: T | null };

function CanvasEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  return <canvas ref={canvasRef} className="editor-canvas" />;
}



// JSX with single equality-check render guard
declare const status: string;
declare const SuccessBanner: React.FC;

function StatusPanel() {
  return (
    <div className="status-panel">
      {status === 'success' && <SuccessBanner />}
    </div>
  );
}



// Component with children and onComplete callback destructuring
declare function useFlowContext(): { isComplete: boolean };

function FlowWrapper({
  children,
  onComplete,
}: {
  children: React.ReactNode;
  onComplete: () => void;
}) {
  const { isComplete } = useFlowContext();

  return (
    <div className="flow-wrapper">
      {children}
      {isComplete && <button onClick={onComplete}>Done</button>}
    </div>
  );
}



// Component body with hook result destructuring — standard setup
declare function useAuthSession(): { user: { id: string; name: string } | null; isLoading: boolean };

function ProfileCard() {
  const { user, isLoading } = useAuthSession();

  if (isLoading) {
    return <div className="skeleton" />;
  }

  return (
    <div className="profile-card">
      <span>{user?.name}</span>
    </div>
  );
}



// Component body with multiple standard hook calls
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useEffect(fn: () => void, deps?: unknown[]): void;
declare function useRouter(): { push: (path: string) => void };

function SettingsPage() {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    setError(null);
  }, []);

  return (
    <div className="settings-page">
      {error && <p className="error">{error}</p>}
      <button disabled={isSaving} onClick={() => router.push('/')}>Cancel</button>
    </div>
  );
}



// JSX with OR-expression in prop: trigger={children || <DefaultTrigger />}
declare const Popover: React.FC<{ trigger: React.ReactNode; children: React.ReactNode }>;
declare const DefaultMenuTrigger: React.FC;

function ContextMenu({ children, menuContent }: { children?: React.ReactNode; menuContent: React.ReactNode }) {
  return (
    <Popover trigger={children || <DefaultMenuTrigger />}>
      {menuContent}
    </Popover>
  );
}



// JSX element with inline object literal as prop
declare const CommandInput: React.FC<{ placeholder: string; commandProps: { shouldFilter: boolean; loop: boolean } }>;

function SearchBar({ placeholder }: { placeholder: string }) {
  return (
    <CommandInput
      placeholder={placeholder}
      commandProps={{ shouldFilter: true, loop: false }}
    />
  );
}



// React component with standard props destructuring
function AlertBanner({
  title,
  message,
  variant,
  onDismiss,
}: {
  title: string;
  message: string;
  variant: 'info' | 'warning' | 'error';
  onDismiss?: () => void;
}) {
  return (
    <div className={`alert alert--${variant}`}>
      <strong>{title}</strong>
      <p>{message}</p>
      {onDismiss && <button onClick={onDismiss}>Dismiss</button>}
    </div>
  );
}



// Component with single destructured prop and hook calls
declare function useTeamContext(): { teamId: string; role: string };
declare function usePermissions(teamId: string): { canEdit: boolean };

function TeamBadge({ label }: { label: string }) {
  const { teamId } = useTeamContext();
  const { canEdit } = usePermissions(teamId);

  return (
    <span className={`badge ${canEdit ? 'badge--editable' : ''}`}>{label}</span>
  );
}



// Component body with optional chaining variable assignment
declare function useLicenseInfo(): { license: { derivedStatus: string; expiresAt: string } | null };

function LicenseStatusChip() {
  const { license } = useLicenseInfo();
  const status = license?.derivedStatus;

  return <span className="license-chip">{status ?? 'No license'}</span>;
}



// Component with single i18n hook destructure — standard setup
declare function useI18n(): { t: (msg: string) => string; locale: string };

function LocalizedLabel({ messageKey }: { messageKey: string }) {
  const { t } = useI18n();

  return <span>{t(messageKey)}</span>;
}



// useMemo with 3-clause OR validation — idiomatic boolean expression
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare const title: string;
declare const recipientEmail: string;
declare const dueDate: string | null;

function useFormReadiness() {
  const isReady = useMemo(
    () => !title || !recipientEmail || !dueDate,
    [title, recipientEmail, dueDate]
  );
  return isReady;
}



// Async handler with single negated property guard
declare function useSurfaceContext(): { surface: { isEmbedded: boolean } };
declare function redirectToHome(): void;

function useNavigationGuard() {
  const { surface } = useSurfaceContext();

  const handleNavigation = async () => {
    if (!surface.isEmbedded) {
      redirectToHome();
    }
  };

  return { handleNavigation };
}



// Context.Provider with inline object literal as value prop
declare const ThemeContext: { Provider: React.FC<{ value: { mode: string; accent: string }; children: React.ReactNode }> };
declare const colorMode: string;
declare const accentColor: string;

function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeContext.Provider value={{ mode: colorMode, accent: accentColor }}>
      {children}
    </ThemeContext.Provider>
  );
}



// Component with children, type, className destructuring and hook calls
declare function useDropzone(opts: { onDrop: (files: File[]) => void }): { getRootProps: () => object; getInputProps: () => object; isDragActive: boolean };
declare function cn(...classes: (string | boolean | undefined)[]): string;

function FileDropZone({
  children,
  variant,
  className,
}: {
  children: React.ReactNode;
  variant: 'primary' | 'compact';
  className?: string;
}) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => { void files; },
  });

  return (
    <div
      {...getRootProps()}
      className={cn('drop-zone', `drop-zone--${variant}`, isDragActive && 'drop-zone--active', className)}
    >
      <input {...getInputProps()} />
      {children}
    </div>
  );
}



declare type AuthOptions = { method: string; required: boolean };
declare type Participant = { id: string; email: string; role: string };
export function SigningAuthProvider({
  documentAuthOptions: initialDocumentAuthOptions,
  recipient: initialRecipient,
  onComplete,
}: {
  documentAuthOptions: AuthOptions;
  recipient: Participant;
  onComplete: () => void;
}): JSX.Element {
  return <div data-auth={initialDocumentAuthOptions.method}>{initialRecipient.email}</div>;
}



declare function Dialog(props: Record<string, unknown>): JSX.Element;
export function SettingsDialog({ trigger, ...props }: { trigger: JSX.Element; [key: string]: unknown }): JSX.Element {
  return <Dialog {...props}>{trigger}</Dialog>;
}



declare function useLocale(): { locale: string; t: (key: string) => string };
declare function useNotification(): { show: (msg: string) => void; dismiss: () => void };
export function BillingBanner(): JSX.Element {
  const { t } = useLocale();
  const { show } = useNotification();
  return <div onClick={() => show(t('billing.upgrade'))}>{t('billing.message')}</div>;
}



export function CompletionDialog({
  isSubmitting,
  documentTitle,
  recipientName,
  onClose,
}: {
  isSubmitting: boolean;
  documentTitle: string;
  recipientName: string;
  onClose: () => void;
}): JSX.Element {
  return (
    <div role='dialog' aria-label={documentTitle}>
      <p>{recipientName}</p>
      <button disabled={isSubmitting} onClick={onClose}>Close</button>
    </div>
  );
}



declare type CheckboxDirection = 'vertical' | 'horizontal';
declare type CheckboxFieldValue = { type: 'checkbox'; direction: CheckboxDirection };
export function CheckboxFieldEditor({
  value = { type: 'checkbox', direction: 'vertical' },
  onChange,
}: {
  value?: CheckboxFieldValue;
  onChange: (v: CheckboxFieldValue) => void;
}): JSX.Element {
  return (
    <div>
      <label>Direction: {value.direction}</label>
      <button onClick={() => onChange({ type: 'checkbox', direction: 'horizontal' })}>Flip</button>
    </div>
  );
}



declare function Modal(props: { open: boolean; onOpenChange: (open: boolean) => void; children?: unknown }): JSX.Element;
declare function useState2<T>(init: T): [T, (v: T) => void];
export function CompletionModal(): JSX.Element {
  const [showDialog, setShowDialog] = useState2(false);
  const handleOpenChange = (open: boolean) => setShowDialog(open);
  return (
    <Modal open={showDialog} onOpenChange={handleOpenChange}>
      <span>Done!</span>
    </Modal>
  );
}



declare function CommandPalette(props: { ref: unknown; className?: string; children?: unknown }): JSX.Element;
declare const paletteRef: unknown;
export function MultiSelectDropdown(): JSX.Element {
  return (
    <CommandPalette ref={paletteRef} className='rounded-lg border shadow-md'>
      <span>Options</span>
    </CommandPalette>
  );
}



declare function Dialog2(props: Record<string, unknown>): JSX.Element;
export function TeamMemberCreateDialog(props: Record<string, unknown>): JSX.Element {
  return <Dialog2 {...props} />;
}



export function BillingPlanCard({
  priceId,
  planName,
  monthlyPrice,
  isCurrentPlan,
  onSelect,
}: {
  priceId: string;
  planName: string;
  monthlyPrice: number;
  isCurrentPlan: boolean;
  onSelect: (priceId: string) => void;
}): JSX.Element {
  return (
    <div className='rounded border p-4'>
      <h3>{planName}</h3>
      <p>${monthlyPrice}/mo</p>
      <button disabled={isCurrentPlan} onClick={() => onSelect(priceId)}>Select</button>
    </div>
  );
}



declare function Sheet(props: { open: boolean; onOpenChange: (v: boolean) => void; children?: unknown }): JSX.Element;
declare const activeCall: { end: (reason: null) => void };
export function WebhookLogsSheet(): JSX.Element {
  return (
    <Sheet open={true} onOpenChange={(value) => (!value ? activeCall.end(null) : null)}>
      <span>Webhook Logs</span>
    </Sheet>
  );
}



declare type FieldEntry = { id: string; label: string };
declare function FieldWarning(props: { field: FieldEntry }): JSX.Element;
export function SigningForm({ uninsertedFields, validateUninserted }: { uninsertedFields: FieldEntry[]; validateUninserted: boolean }): JSX.Element {
  return (
    <div className='flex h-full flex-col'>
      {validateUninserted && uninsertedFields[0] && (
        <FieldWarning field={uninsertedFields[0]} />
      )}
      <div className='flex-1 overflow-auto'>
        <slot />
      </div>
    </div>
  );
}



declare function FieldTooltip(props: { message: string }): JSX.Element;
export function SignerPageRenderer({ showPendingFieldTooltip, pendingMessage }: { showPendingFieldTooltip: boolean; pendingMessage: string }): JSX.Element {
  return (
    <>
      <div className='relative h-full w-full overflow-auto'>
        <slot />
      </div>
      {showPendingFieldTooltip && (
        <FieldTooltip message={pendingMessage} />
      )}
    </>
  );
}



// JSX return with div wrapper — structural JSX element triggers expression-complexity FP
declare const React: { createElement: Function };
declare function cn(...args: unknown[]): string;

type DataGridProps = { rows: unknown[]; columns: string[] };

function DataGrid({ rows, columns }: DataGridProps) {
  return (
    <div className='rounded-md border'>
      <div className='overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col} className='px-4 py-2 text-left font-medium'>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className='border-t'>
                <td className='px-4 py-2'>{String(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}



// Single hook destructuring in component body — triggers expression-complexity FP
declare function useRouter(): { pathname: string; push: (path: string) => void };

function NavItem({ label, href }: { label: string; href: string }) {
  const { pathname } = useRouter();
  const isActive = pathname === href;
  return (
    <a href={href} className={isActive ? 'font-bold' : ''}>
      {label}
    </a>
  );
}



// JSX return with section wrapper — structural JSX element triggers FP
type ActivityEntry = { id: string; message: string; timestamp: string };

function RecentActivityPanel({ entries }: { entries: ActivityEntry[] }) {
  return (
    <section className='flex flex-col rounded-xl border bg-card p-4'>
      <h2 className='mb-2 text-sm font-semibold text-muted-foreground'>Recent Activity</h2>
      <ul className='space-y-2'>
        {entries.map((entry) => (
          <li key={entry.id} className='text-sm'>
            <span className='text-foreground'>{entry.message}</span>
            <span className='ml-2 text-xs text-muted-foreground'>{entry.timestamp}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}



// Multiple useState declarations in component body — triggers expression-complexity FP
declare function useState<T>(initial: T): [T, (v: T) => void];

function MultiStepForm() {
  const [step, setStep] = useState<'details' | 'review' | 'confirm'>('details');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleNext() {
    if (step === 'details') setStep('review');
    else if (step === 'review') setStep('confirm');
  }

  return (
    <div>
      <p>Step: {step}</p>
      <button onClick={handleNext} disabled={isSubmitting}>Next</button>
      {errorMessage && <p className='text-red-500'>{errorMessage}</p>}
    </div>
  );
}



// Component with destructured props and hook calls — triggers expression-complexity FP
declare function useToast(): { toast: (opts: { title: string }) => void };
declare function useLocale(): { t: (key: string) => string };

function CreateWorkspaceForm({
  onSuccess,
  defaultName,
}: {
  onSuccess: () => void;
  defaultName?: string;
}) {
  const { toast } = useToast();
  const { t } = useLocale();

  function handleSubmit(name: string) {
    toast({ title: t('workspace.created') });
    onSuccess();
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(defaultName ?? ''); }}>
      <button type='submit'>{t('create')}</button>
    </form>
  );
}



// JSX structural provider wrapper — triggers expression-complexity FP
declare function ThemeProvider(props: { theme: string; children: unknown }): JSX.Element;
declare function LayoutShell(props: { children: unknown }): JSX.Element;

function PreviewPane({ theme, children }: { theme: string; children: JSX.Element }) {
  return (
    <ThemeProvider theme={theme}>
      <LayoutShell>
        {children}
      </LayoutShell>
    </ThemeProvider>
  );
}



// JSX structural wrapper with enum prop — triggers expression-complexity FP
declare function UploadDropZone(props: { type: string; children: unknown }): JSX.Element;

const AssetType = { TEMPLATE: 'template', DOCUMENT: 'document' } as const;

function TemplateIndexPage({ children }: { children: JSX.Element }) {
  return (
    <UploadDropZone type={AssetType.TEMPLATE}>
      {children}
    </UploadDropZone>
  );
}



// JSX prop with inline arrow containing single && guard — triggers expression-complexity FP
declare function useState<T>(v: T): [T, (v: T) => void];
declare function Modal(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: unknown;
}): JSX.Element;

function ConfirmationModal({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <Modal
      open={open}
      onOpenChange={(value) => !isSubmitting && setOpen(value)}
    >
      <button onClick={() => { setIsSubmitting(true); onConfirm(); }}>Confirm</button>
    </Modal>
  );
}



// JSX structural wrapper with typed enum prop — triggers expression-complexity FP
declare function FileDropZone(props: { uploadType: string; children: unknown }): JSX.Element;

const UploadType = { DOCUMENT: 'document', IMAGE: 'image' } as const;

function DocumentsIndexPage({ children }: { children: JSX.Element }) {
  return (
    <FileDropZone uploadType={UploadType.DOCUMENT}>
      {children}
    </FileDropZone>
  );
}



// JSX structural element with multiple props — triggers expression-complexity FP
declare function FieldContainer(props: {
  field: unknown;
  onPreSign?: () => void;
  onSign?: () => void;
  children: unknown;
}): JSX.Element;

function TextInputField({
  field,
  onPreSign,
  onSign,
}: {
  field: unknown;
  onPreSign?: () => void;
  onSign?: () => void;
}) {
  return (
    <FieldContainer
      field={field}
      onPreSign={onPreSign}
      onSign={onSign}
    >
      <input type='text' className='w-full border rounded px-2 py-1' />
    </FieldContainer>
  );
}



// JSX fragment return with header components — triggers expression-complexity FP
declare function StepFormHeader(props: { title: string; description?: string }): JSX.Element;
declare function StepFormFooter(props: { onBack?: () => void; onNext?: () => void }): JSX.Element;

function SettingsStepView({
  title,
  onBack,
  onNext,
  children,
}: {
  title: string;
  onBack?: () => void;
  onNext?: () => void;
  children: JSX.Element;
}) {
  return (
    <>
      <StepFormHeader title={title} />
      {children}
      <StepFormFooter onBack={onBack} onNext={onNext} />
    </>
  );
}



// Single useState in component body — triggers expression-complexity FP
declare function useState<T>(v: T): [T, (v: T) => void];

function CollapsiblePanel({ title, children }: { title: string; children: JSX.Element }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className='border rounded'>
      <button
        className='w-full px-4 py-2 text-left font-medium'
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {title}
      </button>
      {isExpanded && <div className='p-4'>{children}</div>}
    </div>
  );
}



// Simple JSX structure with header component — triggers expression-complexity FP
declare function PageHeader(props: { title: string; subtitle?: string }): JSX.Element;

function AccountSettingsPage({ title }: { title: string }) {
  return (
    <div className='max-w-2xl'>
      <PageHeader title={title} subtitle='Manage your account preferences' />
      <div className='mt-6'>
        <p>Settings content here.</p>
      </div>
    </div>
  );
}



// JSX DropdownMenu structural element — triggers expression-complexity FP
declare function DropdownMenu(props: { children: unknown }): JSX.Element;
declare function DropdownMenuTrigger(props: { children: unknown }): JSX.Element;
declare function DropdownMenuContent(props: { children: unknown }): JSX.Element;
declare function DropdownMenuItem(props: { onClick?: () => void; children: unknown }): JSX.Element;

function AssetActionsDropdown({ onDelete, onArchive }: { onDelete: () => void; onArchive: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <button>Actions</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={onArchive}>Archive</DropdownMenuItem>
        <DropdownMenuItem onClick={onDelete}>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}



// Component with destructured data/isLoading props — triggers expression-complexity FP
interface AssetRow { id: string; name: string; status: string }

function AssetsTable({ data, isLoading }: { data: AssetRow[]; isLoading: boolean }) {
  if (isLoading) return <div>Loading...</div>;
  return (
    <table className='w-full text-sm'>
      <tbody>
        {data.map((row) => (
          <tr key={row.id}>
            <td>{row.name}</td>
            <td>{row.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}



// Multiple hook calls in component body — triggers expression-complexity FP
declare function useCurrentUser(): { id: string; role: string } | null;
declare function useActiveWorkspace(): { id: string; name: string } | null;

function WorkspaceActionsMenu({ onLeave }: { onLeave: () => void }) {
  const currentUser = useCurrentUser();
  const workspace = useActiveWorkspace();

  const canManage = currentUser?.role === 'admin';

  return (
    <div>
      <p>Workspace: {workspace?.name}</p>
      {canManage && <button onClick={onLeave}>Leave</button>}
    </div>
  );
}



// Structural JSX with nested divs — triggers expression-complexity FP
function BillingSettingsPage({ planName, amount }: { planName: string; amount: number }) {
  return (
    <div>
      <div className='flex flex-row items-center justify-between rounded-lg border p-4'>
        <div>
          <p className='font-semibold'>{planName}</p>
          <p className='text-sm text-muted-foreground'>${amount}/month</p>
        </div>
        <button className='ml-4'>Upgrade</button>
      </div>
    </div>
  );
}



// Structural JSX grid with nested divs — triggers expression-complexity FP
type FolderItem = { id: string; name: string; itemCount: number };

function FolderGrid({ folders, onSelect }: { folders: FolderItem[]; onSelect: (id: string) => void }) {
  return (
    <div>
      <div className='mb-4 flex flex-col gap-2'>
        {folders.map((folder) => (
          <button
            key={folder.id}
            className='flex items-center gap-2 rounded-lg border p-3 text-left hover:bg-muted'
            onClick={() => onSelect(folder.id)}
          >
            <span className='font-medium'>{folder.name}</span>
            <span className='text-xs text-muted-foreground'>{folder.itemCount} items</span>
          </button>
        ))}
      </div>
    </div>
  );
}



// JSX nesting with cn() helper call — triggers expression-complexity FP
declare function cn(...args: unknown[]): string;
declare function TooltipProvider(props: { children: unknown }): JSX.Element;
declare function Tooltip(props: { content: string; children: unknown }): JSX.Element;

function UploadButtonWithTooltip({
  className,
  disabled,
  tooltipText,
}: {
  className?: string;
  disabled?: boolean;
  tooltipText: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <TooltipProvider>
        <Tooltip content={tooltipText}>
          <button
            className='rounded bg-primary px-4 py-2 text-sm text-primary-foreground'
            disabled={disabled}
          >
            Upload
          </button>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}



// Full-screen structural JSX layout — triggers expression-complexity FP
function ErrorLayout({ title, message }: { title: string; message: string }) {
  return (
    <div className='fixed inset-0 z-0 flex h-screen w-screen flex-col items-center justify-center bg-background'>
      <h1 className='text-4xl font-bold'>{title}</h1>
      <p className='mt-2 text-muted-foreground'>{message}</p>
      <a href='/' className='mt-6 text-primary hover:underline'>Go home</a>
    </div>
  );
}



// Component with many destructured props — triggers expression-complexity FP
declare function cn(...args: unknown[]): string;

function AttachmentPopover({
  buttonClassName,
  buttonSize,
  disabled,
  maxFiles,
  onAttach,
}: {
  buttonClassName?: string;
  buttonSize?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  maxFiles?: number;
  onAttach: (files: File[]) => void;
}) {
  return (
    <button
      className={cn('rounded border px-3', buttonClassName)}
      disabled={disabled}
      onClick={() => onAttach([])}
    >
      Attach ({maxFiles ?? 'unlimited'})
    </button>
  );
}



// Component with destructured props and multiple hook calls — triggers expression-complexity FP
declare function useLocale(): { t: (key: string) => string; i18n: { locale: string } };

function RecentActivitySection({
  resourceId,
  viewerId,
}: {
  resourceId: string;
  viewerId: string;
}) {
  const { t, i18n } = useLocale();

  return (
    <section>
      <h2 className='font-semibold'>{t('activity.recent')}</h2>
      <p className='text-xs text-muted-foreground'>
        {t('activity.viewedBy')} {viewerId} ({i18n.locale})
      </p>
    </section>
  );
}



// JSX prop with ternary as argument to helper — triggers expression-complexity FP
declare function getStatusColor(status: string | number): string;
declare function FieldCard(props: {
  color: string;
  readOnly?: boolean;
  children: unknown;
}): JSX.Element;

interface FieldData { meta?: { readOnly?: boolean }; status: number }

function StatusField({ field, readOnly }: { field: FieldData; readOnly?: boolean }) {
  return (
    <FieldCard
      color={getStatusColor(field.meta?.readOnly ? 'locked' : field.status)}
      readOnly={readOnly}
    >
      <span>Field content</span>
    </FieldCard>
  );
}



// Simple JSX heading structure — triggers expression-complexity FP
function AdvancedSettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: JSX.Element;
}) {
  return (
    <div>
      <h3 className='mb-1 font-medium text-foreground'>{title}</h3>
      {description && (
        <p className='mb-4 text-sm text-muted-foreground'>{description}</p>
      )}
      {children}
    </div>
  );
}



declare function generateId(length: number): string;
declare function useFieldArray(opts: { control: unknown; name: string }): { append: (v: unknown) => void; fields: unknown[]; remove: (i: number) => void };
declare const control: unknown;

function RecipientListEditor() {
  const { append: appendRecipient, fields: recipients, remove: removeRecipient } = useFieldArray({
    control,
    name: 'recipients',
  });

  const onAddSelfRecipient = () => {
    appendRecipient({
      formId: generateId(12),
      name: 'Self',
      email: 'self@example.com',
      role: 'SIGNER',
      order: recipients.length + 1,
      permissions: [],
    });
  };

  return null;
}



declare type WidgetType = { type: string; label: string; icon: unknown };
declare const widgetTypes: WidgetType[];
declare function onWidgetSelect(type: string): void;
declare const selectedWidget: string;
declare const isDisabled: boolean;
declare function cn(...args: unknown[]): string;

function WidgetPicker() {
  return (
    <div className="grid grid-cols-3 gap-2">
      {widgetTypes.map((widget) => {
        const Icon = widget.icon as React.ElementType;
        return (
          <button
            key={widget.type}
            type="button"
            className="group w-full"
            onPointerDown={() => onWidgetSelect(widget.type)}
            disabled={isDisabled}
            data-selected={selectedWidget === widget.type ? true : undefined}
          >
            <span className={cn('text-sm', widget.type === 'text' && 'font-bold')}>
              {widget.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}



declare function createPortal(children: unknown, container: Element): unknown;
declare const containerEl: Element;
declare type Coords = { pageX: number; pageY: number; pageWidth: number; pageHeight: number };
declare const coords: Coords;
declare function DraggableBox(props: { key: string; x: number; y: number; width: number; height: number; children?: unknown }): unknown;

function FieldOverlayRenderer() {
  const portal = createPortal(
    <DraggableBox
      key={coords.pageX + coords.pageY + coords.pageHeight + coords.pageWidth}
      x={coords.pageX}
      y={coords.pageY}
      width={coords.pageWidth}
      height={coords.pageHeight}
    />,
    containerEl,
  );
  return portal;
}



function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 md:px-6 lg:px-8">
      <header className="sticky top-0 z-10 border-b bg-white py-3">
        <nav className="flex items-center gap-4">
          <a href="/admin" className="text-sm font-semibold">Admin</a>
        </nav>
      </header>
      <main className="py-6">{children}</main>
    </div>
  );
}



declare type EnvelopeItem = { id: number; title: string; status: string; createdAt: Date };

function EnvelopeEditDialog({
  envelopeItem,
  allowRenaming,
  allowStatusChange,
  onSave,
  onClose,
}: {
  envelopeItem: EnvelopeItem;
  allowRenaming?: boolean;
  allowStatusChange?: boolean;
  onSave?: (item: EnvelopeItem) => void;
  onClose?: () => void;
}) {
  return (
    <dialog open>
      <h2>{envelopeItem.title}</h2>
      <button onClick={onClose}>Close</button>
    </dialog>
  );
}


declare function DialogTrigger(props: any): any;
declare const openEditDialog: () => void;
declare const openDeleteDialog: () => void;

const ActionDropdown = () => {
  return (
    <div>
      <DialogTrigger asChild onSelect={(e: any) => e.preventDefault()}>
        <span>Edit</span>
      </DialogTrigger>
      <DialogTrigger asChild onSelect={(e: any) => e.preventDefault()}>
        <span>Delete</span>
      </DialogTrigger>
    </div>
  );
};


declare const document: Document;
declare const window: Window;

const ActivityPanel = () => {
  return (
    <div>
      <button
        onClick={() => {
          window.scrollTo({
            top: document.getElementById('activity-feed')?.offsetTop,
            behavior: 'smooth',
          });
        }}
        className="flex items-center text-foreground/70 text-xs hover:text-muted-foreground"
      >
        View more
      </button>
    </div>
  );
};


declare function useState<T>(v: T): [T, (v: T) => void];

const RecordDeleteDialog = ({ trigger }: { trigger: any }) => {
  const [open, setOpen] = useState(false);

  return (
    <div>
      {trigger}
      <div>
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit">Delete</button>
      </div>
    </div>
  );
};


declare function DropdownMenuItem(props: any): any;
declare function DownloadDialog(props: any): any;
declare function DuplicateDialog(props: any): any;
declare const itemId: string;

const ItemDropdown = () => {
  return (
    <div>
      <DownloadDialog
        itemId={itemId}
        trigger={
          <DropdownMenuItem asChild onSelect={(e: any) => e.preventDefault()}>
            <div>Download</div>
          </DropdownMenuItem>
        }
      />
      <DuplicateDialog
        itemId={itemId}
        trigger={
          <DropdownMenuItem asChild onSelect={(e: any) => e.preventDefault()}>
            <div>Duplicate</div>
          </DropdownMenuItem>
        }
      />
    </div>
  );
};



// SVG circular progress indicator — 2 * Math.PI * radius is the circumference
// of the track circle (radius=24px). The rule must not flag this numeric literal.
declare const uploadProgress: number;

export function UploadProgressRing(): JSX.Element {
  const circumference = 2 * Math.PI * 24;
  const offset = 2 * Math.PI * 24 * (1 - uploadProgress / 100);
  return (
    <svg width="56" height="56" viewBox="0 0 56 56">
      <circle cx="28" cy="28" r="24" fill="none" stroke="#e5e7eb" strokeWidth="4" />
      <circle
        cx="28"
        cy="28"
        r="24"
        fill="none"
        stroke="#6366f1"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 28 28)"
      />
    </svg>
  );
}



declare function useState<T>(initialState: T): [T, React.Dispatch<React.SetStateAction<T>>];
declare function useRef<T>(initialValue: T | null): { current: T | null };
declare function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
declare const Math: { max(a: number, b: number): number };

// ResizableTextInput: auto-expands its width to fit its content.
// Initial width (200) is the default pixel width before measurement.
export function ResizableTextInput({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
  const [inputWidth, setInputWidth] = useState(200);
  const inputRef = useRef<HTMLInputElement>(null);
  const rulerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (rulerRef.current) {
      const measured = rulerRef.current.offsetWidth;
      setInputWidth(Math.max(measured + 12, 80));
    }
  }, [value]);

  return (
    <div style={{ display: 'inline-block' }}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
        style={{ width: inputWidth }}
      />
      <span ref={rulerRef} style={{ visibility: 'hidden', position: 'absolute', whiteSpace: 'pre' }}>{value}</span>
    </div>
  );
}


declare const z: { object: (s: Record<string, any>) => any; string: () => { length: (n: number, opts: { message: string }) => any } };

const ZTotpVerifySchema = z.object({
  code: z.string().length(6, { message: 'Verification code must be exactly 6 digits' }),
});


declare function useDebouncedValue<T>(value: T, delay: number): T;
declare const searchQuery: string;

function useRecipientSearch() {
  const debouncedQuery = useDebouncedValue(searchQuery, 500);
  return debouncedQuery;
}


declare function setTimeout(fn: () => void, delay: number): number;
declare const isMouseOver: { current: boolean };
declare function setOpen(val: boolean): void;

function onPopoverMouseLeave() {
  isMouseOver.current = false;
  setTimeout(() => {
    setOpen(isMouseOver.current);
  }, 200);
}


declare function setState(s: string): void;
declare class AiApiError extends Error { status: number; }

function handleAiDetectionError(err: unknown) {
  if (err instanceof AiApiError && err.status === 429) {
    setState('RATE_LIMITED');
    return;
  }
  setState('ERROR');
}


declare const notificationCount: number;

function formatNotificationBadge(count: number): string {
  return count > 99 ? '99+' : String(count);
}

const badgeLabel = notificationCount > 0 ? formatNotificationBadge(notificationCount) : null;



// Short stabilization delay in UI component - 200ms is standard debounce for display sync
export function scheduleLocalTimeUpdate(callback: () => void): ReturnType<typeof setTimeout> {
  return setTimeout(callback, 200);
}



// useDebouncedValue with 200ms is standard UI debounce for command menu search
declare function useDebouncedValue<T>(value: T, delay: number): [T];

export function useCommandSearch(query: string): string {
  const [debouncedQuery] = useDebouncedValue(query, 200);
  return debouncedQuery;
}



// canvasWidth * 0.85 — 85% of canvas width; intent is documented inline
export function computeSignatureRenderWidth(canvasWidth: number): number {
  return canvasWidth * 0.85; // 85% of canvas width
}

export function computeSignatureRenderHeight(canvasHeight: number): number {
  return canvasHeight * 0.85; // 85% of canvas height
}



// useDebouncedValue with 500ms is standard UI debounce delay for signer search
declare function useDebouncedValue<T>(value: T, delay: number): [T];

export function useDebouncedSignerSearch(query: string): string {
  const [debouncedQuery] = useDebouncedValue(query, 500);
  return debouncedQuery;
}



// Editor field ID generation hook - nanoid(12) is the standard ID length convention
declare function nanoid(size: number): string;

export function useEditorFieldId(): string {
  return nanoid(12);
}



// --- magic-string FP shape: typed-discriminant-union (UI component prop literal) ---
declare function showNotification(opts: { title: string; variant: 'default' | 'destructive' | 'success' }): void;

function handleUploadError(message: string): void {
  showNotification({ title: message, variant: 'destructive' });
}



// --- magic-string FP shape: typed-discriminant-union (variant prop in template edit form) ---
declare function useToast(): { toast: (opts: { title: string; description?: string; variant: 'default' | 'destructive' }) => void };

function TemplateEditActions({ onSave }: { onSave: () => Promise<void> }): null {
  const { toast } = useToast();
  async function handleSave() {
    try {
      await onSave();
      toast({ title: 'Template saved', variant: 'default' });
    } catch {
      toast({ title: 'Failed to save template', variant: 'destructive' });
    }
  }
  handleSave();
  return null;
}



// --- magic-string FP shape: typed-discriminant-union (color value in style generation) ---
type RecipientStatus = 'active' | 'readOnly' | 'pending';
type RecipientColors = { baseRing: string; highlight: string; text: string };

function getRecipientColors(status: RecipientStatus): RecipientColors {
  if (status === 'readOnly') {
    return { baseRing: 'rgba(176, 176, 176, 1)', highlight: 'rgba(176, 176, 176, 0.15)', text: '#9ca3af' };
  }
  if (status === 'active') {
    return { baseRing: 'rgba(59, 130, 246, 1)', highlight: 'rgba(59, 130, 246, 0.15)', text: '#3b82f6' };
  }
  return { baseRing: 'rgba(251, 191, 36, 1)', highlight: 'rgba(251, 191, 36, 0.15)', text: '#fbbf24' };
}



// --- magic-string FP shape: typed-discriminant-union (useState with inline union type) ---
declare function useState<S>(initial: S): [S, (val: S) => void];

function OrganisationSetupDialog() {
  const [step, setStep] = useState<'billing' | 'create'>('billing');
  function advance() { setStep('create'); }
  return { step, advance };
}



// --- magic-string FP shape: typed-discriminant-union (shadcn toast variant enum) ---
declare function useToast2(): { toast: (opts: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void };
declare function moveDocumentToFolder(docId: string, folderId: string): Promise<void>;

function DocumentMoveActions({ docId, folderId }: { docId: string; folderId: string }): void {
  const { toast } = useToast2();
  moveDocumentToFolder(docId, folderId)
    .then(() => toast({ title: 'Document moved', variant: 'default' }))
    .catch(() => toast({ title: 'Failed to move document', variant: 'destructive' }));
}



// --- magic-string FP shape: typed-discriminant-union (toast variant prop in signing flow) ---
declare function useToast3(): { toast: (opts: { title: string; description?: string; variant: 'default' | 'destructive' }) => void };
declare function submitCheckboxField(fieldId: string, checked: boolean): Promise<void>;

function CheckboxFieldSigner({ fieldId, onComplete }: { fieldId: string; onComplete: () => void }) {
  const { toast } = useToast3();
  async function handleSubmit(checked: boolean) {
    try {
      await submitCheckboxField(fieldId, checked);
      onComplete();
    } catch {
      toast({ title: 'Could not sign field', description: 'Please try again', variant: 'destructive' });
    }
  }
  return { handleSubmit };
}



// Typed react-hook-form field name passed to getValues — the string refers to a known schema key.
declare function useForm<T>(): { getValues: <K extends keyof T>(field: K) => T[K] };

type RecipientFormValues = {
  signers: Array<{ email: string; name: string; actionAuth: string[] }>;
  signingOrder: string;
};

export function useRecipientAuthCheck() {
  const form = useForm<RecipientFormValues>();

  const formHasActionAuth = form.getValues('signers').find((signer) => signer.actionAuth.length > 0);

  return formHasActionAuth !== undefined;
}



// 'window' is a typed discriminant string distinguishing a window scroll container from an element ref.
declare function useState<T>(initial: T): [T, (v: T) => void];
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;

export function useViewportDimensions(scrollRef: 'window' | React.RefObject<HTMLElement>) {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (scrollRef === 'window') {
      const handleResize = () => setHeight(window.innerHeight);
      window.addEventListener('resize', handleResize);
      setHeight(window.innerHeight);
      return () => window.removeEventListener('resize', handleResize);
    }

    const el = scrollRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRef]);

  return height;
}



// Typed union step literals define a multi-step form workflow — the type IS the constant definition.
type UploadStep = 'upload' | 'recipients' | 'fields' | 'review';
const UploadSteps: UploadStep[] = ['upload', 'recipients', 'fields', 'review'];

declare function useState<T>(initial: T): [T, (v: T) => void];

export function useUploadWizard() {
  const [currentStep, setCurrentStep] = useState<UploadStep>('upload');

  const advanceStep = () => {
    const idx = UploadSteps.indexOf(currentStep);
    if (idx < UploadSteps.length - 1) {
      setCurrentStep(UploadSteps[idx + 1]!);
    }
  };

  return { currentStep, advanceStep };
}



// 'backInOut' is a named easing function from the Framer Motion/popmotion library API — not a magic string.
declare function animate(value: unknown, target: number, options: { duration: number; ease: string }): Promise<void>;
declare const cardX: unknown;
declare const cardY: unknown;
declare const sheenOpacity: unknown;

function revertCardToCenter() {
  void animate(cardX, 0, { duration: 2, ease: 'backInOut' });
  void animate(cardY, 0, { duration: 2, ease: 'backInOut' });
  void animate(sheenOpacity, 0, { duration: 2, ease: 'backInOut' });
}



// actionTarget = 'FIELD' is a typed prop default value in a union discriminant — not an arbitrary magic string.
declare function useState<T>(initial: T): [T, (v: T) => void];

type AuthActionTarget = 'FIELD' | 'DOCUMENT';

interface AuthDialogProps {
  actionTarget?: AuthActionTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values?: { token: string }) => Promise<void> | void;
}

export function AuthDialog({
  actionTarget = 'FIELD',
  open,
  onOpenChange,
  onSubmit,
}: AuthDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (values: { token: string }) => {
    setIsSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setIsSubmitting(false);
    }
  };

  return null; // placeholder — real rendering handled by caller
}



// useState<'SELECT' | 'ROLES'>('SELECT') — typed discriminant union state initialization, not a magic string.
declare function useState<T>(initial: T): [T, (v: T) => void];

export function useGroupAssignmentWizard() {
  const [step, setStep] = useState<'SELECT' | 'ROLES'>('SELECT');

  const advance = () => {
    if (step === 'SELECT') setStep('ROLES');
  };

  const reset = () => {
    setStep('SELECT');
  };

  return { step, advance, reset };
}



// variant: 'destructive' is a typed UI component prop literal from the design system — not a magic string.
declare function useToast(): { toast: (opts: { title: string; description: string; variant: 'default' | 'destructive'; duration?: number }) => void };

export function useUploadErrorHandler() {
  const { toast } = useToast();

  const handleUploadError = (message: string) => {
    toast({
      title: 'Upload failed',
      description: message,
      variant: 'destructive',
      duration: 7500,
    });
  };

  return { handleUploadError };
}



// form.watch('documentData') — 'documentData' is a typed react-hook-form field name, not a magic string.
declare function useFormContext<T>(): { watch: <K extends keyof T>(field: K) => T[K]; setValue: (field: keyof T, value: unknown) => void };

type ConfigureUploadFormValues = {
  documentData: { name: string; type: string; size: number; data: Uint8Array } | null;
  title: string;
};

export function useConfigureUpload() {
  const form = useFormContext<ConfigureUploadFormValues>();
  const documentData = form.watch('documentData');

  const clearDocument = () => {
    form.setValue('documentData', null);
  };

  return { documentData, clearDocument };
}



// variant: 'destructive' typed UI component prop from the design system — not an arbitrary magic string.
declare function useToast(): { toast: (opts: { title: string; description: string; variant: 'default' | 'destructive'; duration?: number }) => void };

export function useEnvelopeEditorErrorNotifier() {
  const { toast } = useToast();

  const notifySaveFailure = () => {
    toast({
      title: 'Save failed',
      description: 'We encountered an error while attempting to save your changes.',
      variant: 'destructive',
      duration: 7500,
    });
  };

  return { notifySaveFailure };
}



// form.getValues('values') — 'values' is a typed react-hook-form schema key, not a magic string.
declare function useForm<T>(): {
  getValues: <K extends keyof T>(field: K) => T[K];
  setValue: (field: keyof T, value: unknown) => void;
};

type CheckboxFieldValues = {
  values: Array<{ id: number; checked: boolean; value: string }>;
  required: boolean;
  readOnly: boolean;
};

export function useCheckboxFieldEditor() {
  const form = useForm<CheckboxFieldValues>();

  const addCheckboxOption = () => {
    const currentValues = form.getValues('values') || [];
    const maxId = Math.max(...currentValues.map((v) => v.id), 0);
    form.setValue('values', [...currentValues, { id: maxId + 1, checked: false, value: '' }]);
  };

  return { addCheckboxOption };
}



// actionTarget = 'FIELD' typed prop default — union discriminant value, not an arbitrary magic string.
type SigningActionTarget = 'FIELD' | 'DOCUMENT';

interface AccountAuthProps {
  actionTarget?: SigningActionTarget;
  onOpenChange: (open: boolean) => void;
}

declare function useState<T>(initial: T): [T, (v: T) => void];

export function AccountAuthPrompt({
  actionTarget = 'FIELD',
  onOpenChange,
}: AccountAuthProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      // Perform account-level re-authentication
    } finally {
      setIsLoading(false);
      onOpenChange(false);
    }
  };

  return null;
}



// useState<'totp' | 'backup'>('totp') — typed discriminant union state, 'totp'/'backup' are the valid 2FA method types.
declare function useState<T>(initial: T): [T, (v: T) => void];

export function useDisable2FAWizard() {
  const [method, setMethod] = useState<'totp' | 'backup'>('totp');

  const toggleMethod = () => {
    const next = method === 'totp' ? 'backup' : 'totp';
    setMethod(next);
  };

  return { method, toggleMethod };
}




// --- magic-string shape: css-property-value-literal (drag interaction style) ---
declare function useRef<T>(init: T | null): { current: T | null };

function DragHandle({ onDrag }: { onDrag: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const style = {
    touchAction: 'none',
    userSelect: 'none',
    cursor: 'grab',
  } as const;
  return <div ref={ref} style={style} onPointerDown={onDrag} />;
}




// --- magic-string shape: typed-union-state-literal (useState with string union) ---
declare function useState<T>(init: T): [T, (v: T) => void];

function DomainVerificationPanel() {
  const [activeTab, setActiveTab] = useState<'domain' | 'verification'>('domain');

  return (
    <div>
      <button onClick={() => setActiveTab('domain')}>Domain</button>
      <button onClick={() => setActiveTab('verification')}>Verification</button>
      {activeTab === 'domain' && <div>Domain setup</div>}
      {activeTab === 'verification' && <div>Verification steps</div>}
    </div>
  );
}




// --- max-statements-per-function shape: large-react-component-with-hooks ---
declare function useState<T>(init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function useRef<T>(init: T): { current: T };
declare function useForm<T>(opts: { defaultValues: Partial<T> }): { register: (name: keyof T) => object; handleSubmit: (fn: (data: T) => void) => (e: Event) => void; watch: (name: keyof T) => unknown; reset: () => void };
declare function useFieldArray<T>(opts: { name: string }): { fields: T[]; append: (val: T) => void; remove: (index: number) => void };
declare function toast(opts: { title: string; variant?: 'default' | 'destructive' }): void;

type FieldEntry = { label: string; required: boolean; type: string };
type FieldsFormData = { title: string; fields: FieldEntry[] };

const ConfigureFieldsPanel = ({ onSubmit, onBack, presignToken }: {
  onSubmit: (data: FieldsFormData) => void;
  onBack?: (data: FieldsFormData) => void;
  presignToken?: string;
}) => {
  const [isMobile, setIsMobile] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeFieldIndex, setActiveFieldIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pdfScale, setPdfScale] = useState(1);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { register, handleSubmit, watch, reset } = useForm<FieldsFormData>({
    defaultValues: { title: '', fields: [] },
  });
  const { fields, append, remove } = useFieldArray<FieldEntry>({ name: 'fields' });

  const watchedTitle = watch('title');

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (presignToken) {
      reset();
    }
  }, [presignToken]);

  const activeField = useMemo(
    () => (activeFieldIndex !== null ? fields[activeFieldIndex] : null),
    [fields, activeFieldIndex],
  );

  const handleAddField = useCallback(
    (type: string) => {
      append({ label: '', required: false, type });
      setActiveFieldIndex(fields.length);
      if (isMobile) setIsDrawerOpen(true);
    },
    [fields.length, isMobile],
  );

  const handleRemoveField = useCallback(
    (index: number) => {
      remove(index);
      setActiveFieldIndex(null);
      toast({ title: 'Field removed' });
    },
    [],
  );

  const handleScaleChange = useCallback((scale: number) => {
    setPdfScale(scale);
  }, []);

  const handleDragStart = () => setIsDragging(true);
  const handleDragEnd = () => setIsDragging(false);

  const onFormSubmit = handleSubmit((data) => {
    onSubmit(data);
  });

  return (
    <div ref={containerRef} style={{ transform: `scale(${pdfScale})` }}>
      <form onSubmit={onFormSubmit as unknown as React.FormEventHandler}>
        <input {...(register('title') as object)} />
        {activeField && <span>{activeField.label}</span>}
        {isDragging && <div>Dragging...</div>}
        <button type="button" onClick={() => handleAddField('text')}>Add Text Field</button>
        <button type="button" onClick={onBack ? () => onBack({ title: String(watchedTitle), fields }) : undefined}>Back</button>
        <button type="submit">Next</button>
      </form>
      <button onClick={() => setIsDrawerOpen(!isDrawerOpen)}>Toggle Fields</button>
      {isMobile && isDrawerOpen && (
        <div>
          {fields.map((f, i) => (
            <div key={i}>
              <span>{f.label}</span>
              <button onClick={() => handleRemoveField(i)}>Remove</button>
              <button onClick={() => handleScaleChange(pdfScale + 0.1)}>Zoom</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};




// --- max-statements-per-function shape: react-provider-with-many-hooks ---
declare function useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: unknown[]): T;
declare function useRef<T>(init: T): { current: T };
declare const DocumentEditorCtx: React.Context<unknown>;
declare function toast(opts: { title: string; variant?: string }): void;

interface EditorDoc {
  title: string;
  recipients: Array<{ id: string; email: string }>;
  fields: Array<{ id: string; type: string }>;
}

export const DocumentEditorProvider = ({
  children,
  initialDoc,
}: {
  children: React.ReactNode;
  initialDoc: EditorDoc;
}) => {
  const [doc, _setDoc] = useState<EditorDoc>(initialDoc);
  const [isSaving, setIsSaving] = useState(false);
  const [autosaveError, setAutosaveError] = useState(false);
  const docRef = useRef(initialDoc);
  const flushCallbacksRef = useRef(new Map<string, () => Promise<void>>());
  const pendingRef = useRef(new Set<Promise<unknown>>());

  const setDoc: typeof _setDoc = (action) => {
    _setDoc((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      docRef.current = next;
      return next;
    });
  };

  const setTitle = useCallback((title: string) => {
    setDoc((prev) => ({ ...prev, title }));
  }, []);

  const addRecipient = useCallback((email: string) => {
    const id = String(Date.now());
    setDoc((prev) => ({ ...prev, recipients: [...prev.recipients, { id, email }] }));
  }, []);

  const removeRecipient = useCallback((id: string) => {
    setDoc((prev) => ({ ...prev, recipients: prev.recipients.filter((r) => r.id !== id) }));
  }, []);

  const addField = useCallback((type: string) => {
    const id = String(Date.now());
    setDoc((prev) => ({ ...prev, fields: [...prev.fields, { id, type }] }));
  }, []);

  const removeField = useCallback((id: string) => {
    setDoc((prev) => ({ ...prev, fields: prev.fields.filter((f) => f.id !== id) }));
    toast({ title: 'Field removed' });
  }, []);

  const registerFlush = useCallback((key: string, fn: () => Promise<void>) => {
    flushCallbacksRef.current.set(key, fn);
    return () => { flushCallbacksRef.current.delete(key); };
  }, []);

  const trackMutation = useCallback((promise: Promise<unknown>) => {
    pendingRef.current.add(promise);
    setIsSaving(true);
    void promise.finally(() => {
      pendingRef.current.delete(promise);
      if (pendingRef.current.size === 0) setIsSaving(false);
    });
  }, []);

  void setAutosaveError;

  const value = { doc, isSaving, setTitle, addRecipient, removeRecipient, addField, removeField, registerFlush, trackMutation };

  return (
    <DocumentEditorCtx.Provider value={value}>
      {children}
    </DocumentEditorCtx.Provider>
  );
};




// --- missing-return-type shape: react-component-function-jsx (signature tab component) ---
type SignatureMethod = 'draw' | 'type' | 'upload';

function SignatureMethodTab({
  method,
  label,
  isActive,
  onClick,
}: {
  method: SignatureMethod;
  label: string;
  isActive: boolean;
  onClick: (method: SignatureMethod) => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={isActive}
      onClick={() => onClick(method)}
    >
      {label}
    </button>
  );
}




// --- missing-return-type shape: react-provider-component-jsx (i18n provider) ---
declare function useState<T>(init: T | (() => T)): [T, (v: T) => void];
declare const I18nCtx: React.Context<unknown>;

interface LocaleData {
  lang: string;
  locales: string[];
}

export function LocaleProvider({
  children,
  initialLocale,
  initialMessages,
}: {
  children: React.ReactNode;
  initialLocale: LocaleData;
  initialMessages: Record<string, string>;
}) {
  const { lang, locales } = initialLocale;

  const [i18n] = useState(() => ({
    locale: lang,
    locales,
    messages: { [lang]: initialMessages },
  }));

  return (
    <I18nCtx.Provider value={i18n}>
      {children}
    </I18nCtx.Provider>
  );
}




// --- missing-return-type shape: react-component-returning-portal ---
declare function createPortal(children: React.ReactNode, container: Element): React.ReactPortal;
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare function useRef<T>(init: T | null): { current: T | null };

interface FieldOverlayPortalProps {
  pageNumber: number;
  x: number;
  y: number;
  children: React.ReactNode;
  className?: string;
}

export function FieldOverlayPortal({ pageNumber, x, y, children, className = '' }: FieldOverlayPortalProps) {
  const portalRoot = document.getElementById('field-portal-root');

  const style = useMemo(
    () => ({
      position: 'absolute' as const,
      top: `${y}px`,
      left: `${x}px`,
    }),
    [x, y, pageNumber],
  );

  return createPortal(
    <div className={className} style={style}>
      {children}
    </div>,
    portalRoot ?? document.body,
  );
}




// --- missing-return-type shape: custom-react-hook-returning-object ---
declare const analyticsLib: { track: (event: string, props?: Record<string, unknown>) => void; trackError: (err: Error, props?: Record<string, unknown>) => void };
declare const isAnalyticsEnabled: boolean;

export function useAnalytics() {
  const capture = (event: string, properties?: Record<string, unknown>) => {
    if (!isAnalyticsEnabled) return;
    analyticsLib.track(event, properties);
  };

  const captureException = (error: Error, properties?: Record<string, unknown>) => {
    if (!isAnalyticsEnabled) return;
    analyticsLib.trackError(error, properties);
  };

  const startSessionRecording = (_eventFlag?: string) => {
    return;
  };

  const stopSessionRecording = () => {
    return;
  };

  return { capture, captureException, startSessionRecording, stopSessionRecording };
}



declare const DayPicker: React.FC<{
  mode?: 'single' | 'range';
  selected?: Date;
  onSelect?: (date: Date | undefined) => void;
  className?: string;
  classNames?: Record<string, string>;
  showOutsideDays?: boolean;
}>;

function DatePickerField({
  selected,
  onSelect,
  showOutsideDays = true,
}: {
  selected?: Date;
  onSelect?: (date: Date | undefined) => void;
  showOutsideDays?: boolean;
}) {
  return (
    <DayPicker
      mode="single"
      selected={selected}
      onSelect={onSelect}
      showOutsideDays={showOutsideDays}
      className="rounded-md border p-3"
      classNames={{
        day_selected: 'bg-primary text-primary-foreground',
        day_today: 'font-bold',
      }}
    />
  );
}



declare const createPortal: (children: unknown, container: Element) => unknown;
declare const document: { getElementById: (id: string) => Element | null };

function DocumentPortal({ children }: { children: unknown }) {
  const container = document.getElementById('portal-root');
  if (!container) return null;
  return createPortal(children, container);
}



declare const useState: <T>(init: T) => [T, (v: T) => void];

function PdfViewer({ url }: { url: string }) {
  const [page, setPage] = useState(1);
  return (
    <div className="pdf-viewer">
      <button onClick={() => setPage(page - 1)}>Prev</button>
      <span>{url} - Page {page}</span>
      <button onClick={() => setPage(page + 1)}>Next</button>
    </div>
  );
}



declare const cva: (base: string, config: unknown) => (props: unknown) => string;

const badgeVariants = cva('badge', {
  variants: {
    variant: {
      default: 'badge-default',
      secondary: 'badge-secondary',
    },
  },
});

function Badge({ variant, children }: { variant?: 'default' | 'secondary'; children: unknown }) {
  return <span className={badgeVariants({ variant })}>{children as any}</span>;
}



declare const Spinner: (props: { size?: string }) => unknown;
declare const EmailBadge: (props: { email: string }) => unknown;

function RecipientStatusCell({
  isSyncing,
  distributionMethod,
  email,
}: {
  isSyncing: boolean;
  distributionMethod: 'email' | 'link' | null;
  email: string | null;
}) {
  return (
    <span>
      {isSyncing
        ? Spinner({ size: 'sm' })
        : distributionMethod === 'email'
          ? EmailBadge({ email: email ?? '' })
          : null}
    </span>
  );
}



function parseBooleanSelectValue(value: string): boolean | null {
  return value === 'true' ? true : value === 'false' ? false : null;
}

function parseVisibilitySelectValue(value: string): 'public' | 'private' | null {
  return value === 'public' ? 'public' : value === 'private' ? 'private' : null;
}



declare const DataTable: (props: {
  data: unknown[];
  columns: unknown[];
  totalPages: number;
  currentPage: number;
  onPageChange: (page: number) => void;
}) => unknown;

function SinglePageAdminTable({ data, columns }: { data: unknown[]; columns: unknown[] }) {
  // totalPages=1, currentPage=1 means pagination never fires; no-op is intentional
  return DataTable({
    data,
    columns,
    totalPages: 1,
    currentPage: 1,
    onPageChange: () => {},
  });
}



declare const useSyncExternalStore: <T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T,
  getServerSnapshot?: () => T
) => T;

function useIsHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}



declare const useDropzone: (opts: { onDrop: (files: File[]) => void }) => { getRootProps: () => unknown; getInputProps: () => unknown };

declare const onAutoSave: ((data: unknown) => Promise<void>) | undefined;

function AttachmentDropzone({ data }: { data: unknown }) {
  const { getRootProps, getInputProps } = useDropzone({
    onDrop: (files) => void (onAutoSave ?? (async () => {}))(files),
  });
  return { getRootProps, getInputProps };
}



declare const copyToClipboard: (value: string) => Promise<void>;

function RecordValueCell({ value }: { value: string }) {
  return (
    <button onClick={() => void copyToClipboard(value)}>
      {value}
    </button>
  );
}



declare const copyText: (label: string, value: string) => Promise<void>;

function TimezoneDisplay({ utc, local }: { utc: string; local: string }) {
  return (
    <div>
      <span onCopy={() => void copyText('UTC', utc)}>{utc}</span>
      <span onCopy={() => void copyText('Local', local)}>{local}</span>
    </div>
  );
}



declare const enableFeature: () => Promise<void>;

function FeatureEnableButton() {
  return (
    <button onClick={() => void enableFeature()}>
      Enable Feature
    </button>
  );
}



declare const autoSaveSettings: () => Promise<void>;

function TemplateSettingsForm() {
  return (
    <select onChange={() => void autoSaveSettings()}>
      <option value="draft">Draft</option>
      <option value="active">Active</option>
    </select>
  );
}

function onSignatureTypeChange(_value: string) {
  void autoSaveSettings();
}

function onFontChange(_font: string) {
  void autoSaveSettings();
}



// --- no-void shape: fire-and-forget-use-effect (void inside useEffect callback, exec fn passed to void) ---
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function onSearchSync(term: string): string[];
declare function transToGroupOption(res: string[], groupBy: string): string[];
declare function setOptions(opts: string[]): void;

function ComboboxWithSyncSearch({ groupBy }: { groupBy: string }) {
  const debouncedSearchTerm = '';
  const open = true;
  const triggerSearchOnFocus = true;

  useEffect(() => {
    const doSearchSync = () => {
      const res = onSearchSync(debouncedSearchTerm);
      setOptions(transToGroupOption(res || [], groupBy));
    };

    // eslint-disable-next-line @typescript-eslint/require-await
    const exec = async () => {
      if (!open) {
        return;
      }

      if (triggerSearchOnFocus) {
        doSearchSync();
      }

      if (debouncedSearchTerm) {
        doSearchSync();
      }
    };

    void exec();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchTerm, groupBy, open, triggerSearchOnFocus]);

  return null;
}



// --- no-void shape: fire-and-forget-sync-event-callback (void handleAutoSave in onChange JSX prop) ---
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function handleAutoSave_0dd7(): Promise<void>;
declare function setValue_0dd7(key: string, value: unknown, opts?: object): void;

function EmailSettingsCheckboxes({ emailSettings }: { emailSettings: Record<string, boolean> }) {
  const handleAutoSave = handleAutoSave_0dd7;

  return (
    <DocumentEmailCheckboxes_0dd7
      value={emailSettings}
      onChange={(value: Record<string, boolean>) => {
        setValue_0dd7('meta.emailSettings', value, { shouldDirty: true });
        void handleAutoSave();
      }}
    />
  );
}

declare function DocumentEmailCheckboxes_0dd7(props: { value: Record<string, boolean>; onChange: (v: Record<string, boolean>) => void }): JSX.Element;



// --- no-void shape: fire-and-forget-use-effect (void refetch inside useMutation onSuccess callback) ---
declare function useMutation_105b<TData, TVars>(opts: {
  mutationFn?: (vars: TVars) => Promise<TData>;
  onSuccess?: (data: TData) => void;
  onError?: () => void;
}): { mutateAsync: (vars: TVars) => Promise<TData>; isPending: boolean };
declare function useQuery_105b<T>(params: object, opts?: object): { data: T | undefined; isPending: boolean; refetch: () => Promise<unknown> };
declare function toast_105b(opts: { title: string; variant?: string }): void;

function UnsealedDocumentsPanel() {
  const { data, isPending, refetch } = useQuery_105b<{ items: unknown[] }>({ page: 1, perPage: 20 }, { placeholderData: (prev: unknown) => prev });

  const { mutateAsync: triggerReseal, isPending: isResealing } = useMutation_105b<void, { id: number }>({
    onSuccess: () => {
      toast_105b({ title: 'Reseal job triggered', variant: 'default' });
      void refetch();
    },
    onError: () => {
      toast_105b({ title: 'Failed to trigger reseal', variant: 'destructive' });
    },
  });

  return null;
}



// --- no-void shape: void-with-promise-chain (.finally() discards Promise in useCallback) ---
declare function useCallback_10bf<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare const pendingMutationsRef_10bf: { current: Set<Promise<unknown>> };

const registerPendingMutation_10bf = (promise: Promise<unknown>) => {
  pendingMutationsRef_10bf.current.add(promise);

  void promise.finally(() => {
    pendingMutationsRef_10bf.current.delete(promise);
  });
};



// --- no-void shape: fire-and-forget-use-effect (void refreshLimits() immediately after async operation in event handler) ---
declare function refreshLimits_11da(): Promise<void>;
declare function createDocument_11da(formData: FormData): Promise<{ envelopeId: number }>;
declare function navigate_11da(path: string): Promise<void>;

async function handleDocumentUpload_11da(file: File, teamUrl: string) {
  const formData = new FormData();
  formData.append('file', file);

  const { envelopeId: id } = await createDocument_11da(formData);

  void refreshLimits_11da();

  await navigate_11da(`/documents/${teamUrl}/${id}/edit`);
}



// --- no-void shape: void-with-promise-chain (.then() chain — discards chained Promise in onDropAccepted) ---
declare function useDropzone_1213(opts: {
  onDropAccepted?: (files: File[]) => void;
}): { getRootProps: () => object; getInputProps: () => object };
declare const base64_1213: { encode: (data: Uint8Array) => string };
declare function setFormValue_1213(key: string, val: string): void;
declare function submitForm_1213(): Promise<void>;

function ProfileImageDropzone_1213() {
  const { getRootProps, getInputProps } = useDropzone_1213({
    onDropAccepted: ([file]) => {
      void file.arrayBuffer().then((buffer) => {
        const contents = base64_1213.encode(new Uint8Array(buffer));
        setFormValue_1213('bytes', contents);
        void submitForm_1213();
      });
    },
  });

  return <div {...getRootProps()}><input {...getInputProps()} /></div>;
}



// --- no-void shape: fire-and-forget-use-effect (void flush in beforeunload addEventListener callback) ---
declare function useEffect_1a7c(fn: () => void | (() => void), deps?: unknown[]): void;
declare const timeoutRef_1a7c: { current: ReturnType<typeof setTimeout> | null };
declare const pendingPromiseRef_1a7c: { current: Promise<unknown> | null };
declare function flush_1a7c(): Promise<void>;

function useAutosaveWithBeforeUnload_1a7c() {
  useEffect_1a7c(() => {
    const handleBeforeUnload = () => {
      if (timeoutRef_1a7c.current || pendingPromiseRef_1a7c.current) {
        void flush_1a7c();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [flush_1a7c]);
}



// --- no-void shape: module-level-or-non-react-async-init (void handleAutoSave at end of callback, not in JSX prop) ---
declare function handleAutoSave_1b69(): Promise<void>;
declare function setValue_1b69(key: string, value: unknown, opts?: object): void;
declare const RecipientRole_1b69: { ASSISTANT: string; SIGNER: string };
declare const DocumentSigningOrder_1b69: { PARALLEL: string; SEQUENTIAL: string };

const resetToParallelSigning_1b69 = () => {
  const updatedSigners: Array<{ role: string }> = [];

  setValue_1b69('signers', updatedSigners, { shouldValidate: true, shouldDirty: true });
  setValue_1b69('signingOrder', DocumentSigningOrder_1b69.PARALLEL, { shouldValidate: true, shouldDirty: true });
  setValue_1b69('allowDictateNextSigner', false, { shouldValidate: true, shouldDirty: true });

  void handleAutoSave_1b69();
};



// --- no-void shape: fire-and-forget-use-effect (void launchEmbed in useEffect on mount with token from query params) ---
declare function useEffect_279d(fn: () => void | (() => void), deps?: unknown[]): void;
declare const hasAutoLaunched_279d: { current: boolean };
declare function launchEmbed_279d(token: string): Promise<void>;
declare const searchParams_279d: { get: (key: string) => string | null };

function EmbedPlaygroundAutoLaunch_279d() {
  useEffect_279d(() => {
    if (hasAutoLaunched_279d.current) {
      return;
    }

    const initialToken = searchParams_279d.get('token');

    if (initialToken) {
      hasAutoLaunched_279d.current = true;
      void launchEmbed_279d(initialToken);
    }
  }, []);

  return null;
}



// --- no-void shape: fire-and-forget-use-effect (void saveFormData in setTimeout callback) ---
declare function useCallback_28f4<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare const saveTimeoutRef_28f4: { current: ReturnType<typeof setTimeout> | undefined };
declare function saveFormData_28f4(data: unknown, onResponse?: (r: unknown) => void): Promise<void>;

const scheduleSave_28f4 = (data: unknown, onResponse?: (r: unknown) => void, delay = 1000) => {
  if (saveTimeoutRef_28f4.current) {
    clearTimeout(saveTimeoutRef_28f4.current);
  }

  saveTimeoutRef_28f4.current = setTimeout(() => void saveFormData_28f4(data, onResponse), delay);
};



// --- no-void shape: fire-and-forget-navigation (void revalidator.revalidate() in sync event handler) ---
declare const revalidator_2b7a: { revalidate: () => Promise<void> };

function MultiSignDocumentList_2b7a() {
  const onBackToDocumentList = () => {
    // Revalidate to fetch fresh data when returning to document list
    void revalidator_2b7a.revalidate();
  };

  return <button onClick={onBackToDocumentList}>Back to list</button>;
}



// --- no-void shape: fire-and-forget-use-effect (void executeActionAuthProcedure in useEffect, auto-sign checkbox) ---
declare function useEffect_4050(fn: () => void | (() => void), deps?: unknown[]): void;
declare function executeActionAuthProcedure_4050(opts: { onReauthFormSubmit: (authOptions: unknown) => Promise<void>; actionTarget: string }): Promise<void>;
declare function onSign_4050(authOptions: unknown): Promise<void>;

function CheckboxAutoSign_4050({ shouldAutoSign, fieldType }: { shouldAutoSign: boolean; fieldType: string }) {
  useEffect_4050(() => {
    if (shouldAutoSign) {
      void executeActionAuthProcedure_4050({
        onReauthFormSubmit: async (authOptions) => await onSign_4050(authOptions),
        actionTarget: fieldType,
      });
    }
  }, [shouldAutoSign, fieldType]);

  return null;
}



// --- no-void shape: fire-and-forget-use-effect (void createOrGetShareLink in onOpenChange handler) ---
declare function createOrGetShareLink_4a9c(opts: { token: string; documentId: number }): Promise<{ slug: string }>;

function DocumentShareButton_4a9c({ token, documentId }: { token: string; documentId: number }) {
  const onOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      void createOrGetShareLink_4a9c({
        token,
        documentId,
      });
    }
  };

  return (
    <Dialog_4a9c onOpenChange={onOpenChange}>
      <button>Share</button>
    </Dialog_4a9c>
  );
}

declare function Dialog_4a9c(props: { onOpenChange: (open: boolean) => void; children: unknown }): JSX.Element;



// --- no-void shape: fire-and-forget-navigation (void navigate() in useEffect on mount) ---
declare function useEffect_4ea6(fn: () => void | (() => void), deps?: unknown[]): void;
declare function navigate_4ea6(path: string): Promise<void>;
declare const isPersonalLayoutMode_4ea6: boolean;
declare const team_4ea6: object | null;

function PersonalSettingsLayout_4ea6() {
  useEffect_4ea6(() => {
    if (!isPersonalLayoutMode_4ea6 || !team_4ea6) {
      void navigate_4ea6('/settings/profile');
    }
  }, []);

  return null;
}



// --- no-void shape: fire-and-forget-use-effect (void asyncFn() as statement in useEffect callback) ---
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function useState<T>(init: T): [T, (v: T) => void];
declare function verifyEmailToken(token: string): Promise<{ success: boolean }>;

function EmailVerificationPage({ token }: { token: string }): JSX.Element {
  const [verified, setVerified] = useState(false);
  async function verifyToken(): Promise<void> {
    const result = await verifyEmailToken(token);
    setVerified(result.success);
  }
  useEffect(() => {
    void verifyToken();
  }, [token]);
  return <div>{verified ? 'Verified' : 'Verifying...'}</div>;
}



// --- no-void shape: void-with-promise-chain (void asyncFn(arg) in callback constrained to non-Promise return) ---
declare function useDropzone(opts: { onDropRejected: (rejections: { file: File; errors: string[] }[]) => void }): { getRootProps: () => object };
declare function showRejectionToast(rejections: { file: File; errors: string[] }[]): Promise<void>;

function FileUploadZone(): JSX.Element {
  const { getRootProps } = useDropzone({
    onDropRejected: (fileRejections) => void showRejectionToast(fileRejections),
  });
  return <div {...getRootProps()} />;
}



// --- no-void shape: void-with-promise-chain (void copy(...).then() discards outer Promise while chaining) ---
declare function copyTextToClipboard(text: string): Promise<void>;
declare function toast(msg: string): void;
declare const span: unknown;

function CopyableRecipientAvatar({ email, name }: { email: string; name: string }): JSX.Element {
  function handleCopy(): void {
    void copyTextToClipboard(email).then(() => {
      toast(`Copied ${name}`);
    });
  }
  return <button onClick={handleCopy}>{name[0]}</button>;
}



// --- no-void shape: fire-and-forget-use-effect (void render() in useEffect to avoid async effect) ---
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function useState<T>(init: T): [T, (v: T) => void];
declare const mermaid: { initialize: (opts: object) => void; render: (id: string, def: string) => Promise<{ svg: string }> };

function DiagramRenderer({ definition }: { definition: string }): JSX.Element {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    async function render(): Promise<void> {
      mermaid.initialize({ startOnLoad: false });
      const { svg: rendered } = await mermaid.render('diagram', definition);
      setSvg(rendered);
    }
    void render();
  }, [definition]);
  return <div dangerouslySetInnerHTML={{ __html: svg }} />;
}

declare const dangerouslySetInnerHTML: unknown;



// --- no-void shape: void-with-promise-chain (void trpcUtils.some.query.invalidate() discards cache invalidation Promise) ---
declare const trpcUtils: { organisation: { member: { list: { invalidate: () => Promise<void> } } } };
declare function useMutation<T>(opts: { mutationFn: (v: T) => Promise<void>; onSuccess?: () => void }): { mutate: (v: T) => void };
declare function inviteTeamMember(email: string): Promise<void>;

function TeamMemberInviteDialog(): JSX.Element {
  const { mutate: invite } = useMutation({
    mutationFn: inviteTeamMember,
    onSuccess() {
      void trpcUtils.organisation.member.list.invalidate();
    },
  });
  return <button onClick={() => invite('user@example.com')}>Invite</button>;
}



// --- no-void shape: fire-and-forget-sync-event-callback (onGoNextClick prop = arrow => void asyncSubmit()) ---
declare function onFormSubmit(): Promise<void>;
declare const WizardNavigation: (props: { onGoNextClick: () => void; children?: unknown }) => JSX.Element;

function TemplateFieldsStep(): JSX.Element {
  return (
    <WizardNavigation onGoNextClick={() => void onFormSubmit()}>
      Configure Fields
    </WizardNavigation>
  );
}



// --- no-void shape: void-with-promise-chain (void onFormSubmit().catch(console.error) in sync callback) ---
declare function useForm<T>(): { handleSubmit: (fn: (data: T) => Promise<void>) => () => Promise<void> };
declare function submitDocumentSettings(data: { notifySigners: boolean }): Promise<void>;
declare const Button: (props: { onClick: () => void; children?: unknown }) => JSX.Element;

function DocumentSettingsForm(): JSX.Element {
  const form = useForm<{ notifySigners: boolean }>();
  const onFormSubmit = form.handleSubmit(submitDocumentSettings);
  return (
    <Button
      onClick={() => {
        void onFormSubmit().catch(console.error);
      }}
    >
      Save Settings
    </Button>
  );
}



// --- no-void shape: fire-and-forget-use-effect (void import('...').then() dynamic import in useEffect) ---
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function useState<T>(init: T | (() => T)): [T, (v: T) => void];

function LocalePreviewPanel(): JSX.Element {
  const [fakerModule, setFakerModule] = useState<{ faker: { name: { fullName: () => string } } } | null>(null);
  useEffect(() => {
    void import('@faker-js/faker/locale/en').then((mod) => {
      setFakerModule(mod as never);
    });
  }, []);
  return <div>{fakerModule?.faker.name.fullName() ?? 'Loading...'}</div>;
}



// --- no-void shape: fire-and-forget-use-effect (void in useEffect callback) ---
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;

declare function refreshAuthToken(): Promise<void>;

function AuthTokenRefresher() {
  useEffect(() => {
    void refreshAuthToken();
  }, []);
  return null;
}



// --- no-void shape: module-level (void form.trigger in synchronous callback) ---
declare const form: { trigger: (field: string) => Promise<boolean> };
declare function useWatch(opts: { control: unknown; name: string }): string;
declare const control: unknown;

function RecipientForm() {
  const signerEmail = useWatch({ control, name: 'signers' });
  function onSignerBlur() {
    void form.trigger('signers');
  }
  return <input onBlur={onSignerBlur} />;
}



// --- no-void shape: fire-and-forget-use-effect (void handleStepChange in useEffect) ---
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function handleStepTransition(step: string): Promise<void>;

function WizardStepManager({ currentStep }: { currentStep: string }) {
  useEffect(() => {
    void handleStepTransition(currentStep);
  }, [currentStep]);
  return null;
}



// --- no-void shape: fire-and-forget-navigation (void executeAuthProcedure in nested callback) ---
declare function executeSigningAuthProcedure(opts: { actionId: string }): Promise<void>;
declare function Button(props: { onClick: () => void; children: string }): JSX.Element;

function SignFieldButton({ fieldId }: { fieldId: string }) {
  function handleSign() {
    void executeSigningAuthProcedure({ actionId: fieldId });
  }
  return <Button onClick={handleSign}>Sign</Button>;
}



// --- no-void shape: void-with-promise-chain (void cache.invalidate()) ---
declare const queryCache: { attachments: { list: { invalidate: () => Promise<void> } } };

function AttachmentUploader() {
  function onUploadSuccess() {
    void queryCache.attachments.list.invalidate();
  }
  return <button onClick={onUploadSuccess}>Upload</button>;
}



// --- no-void shape: void-with-promise-chain (void asyncInit().finally() in useEffect) ---
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function loadLocaleData(locale: string): Promise<void>;
declare function setLoading(v: boolean): void;

function LocaleInitializer({ locale }: { locale: string }) {
  useEffect(() => {
    void loadLocaleData(locale).finally(() => {
      setLoading(false);
    });
  }, [locale]);
  return null;
}



// --- no-void shape: void-with-promise-chain (void onFileDrop in sync onDrop callback) ---
declare function onFileDrop(files: File[]): Promise<void>;
declare function useDropzone(opts: { onDrop: (files: File[]) => void }): { getRootProps: () => object };

function DocumentUploadZone() {
  const { getRootProps } = useDropzone({
    onDrop: (files) => void onFileDrop(files),
  });
  return <div {...getRootProps()} />;
}



// --- no-void shape: void-with-promise-chain (void replacePdf in sync drop callback) ---
declare function replacePdfDocument(slotId: string, file: File): Promise<void>;
declare function useDropzone(opts: { onDrop: (files: File[]) => void }): { getRootProps: () => object };

function PdfReplaceDropzone({ slotId }: { slotId: string }) {
  const { getRootProps } = useDropzone({
    onDrop: (files) => void replacePdfDocument(slotId, files[0]),
  });
  return <div {...getRootProps()} />;
}



// --- no-void shape: void-with-promise-chain (void asyncHandler in object method callback) ---
declare function processDroppedFiles(files: File[]): Promise<void>;

const dropzoneConfig = {
  onDrop: (files: File[]) => void processDroppedFiles(files),
  accept: { 'application/pdf': ['.pdf'] },
};



// --- no-void shape: void-with-promise-chain (void onDrop(acceptedFiles) in dropzone onDrop) ---
declare function handleFilesDrop(acceptedFiles: File[]): Promise<void>;
declare function useDropzone(opts: { onDrop: (files: File[]) => void }): { open: () => void };

function FileDropzone() {
  const { open } = useDropzone({
    onDrop: (acceptedFiles) => void handleFilesDrop(acceptedFiles),
  });
  return <button onClick={open}>Upload</button>;
}



// --- no-void shape: void-with-promise-chain (void fontsReady.then() in useEffect) ---
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare const fontsReady: Promise<FontFaceSet>;
interface FontFaceSet {}
declare function redrawCanvas(): void;

function CanvasRenderer() {
  useEffect(() => {
    void fontsReady.then(() => {
      redrawCanvas();
    });
  }, []);
  return null;
}



// --- no-void shape: void-with-promise-chain (void initLocale(lang).finally() in useEffect) ---
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function initializeLocale(language: string): Promise<void>;
declare function markLocaleReady(): void;

function AuthoringLayoutLocale({ language }: { language: string }) {
  useEffect(() => {
    void initializeLocale(language).finally(() => {
      markLocaleReady();
    });
  }, [language]);
  return null;
}



// FP: optional array prop in controlled component — mutable array props without readonly is standard React idiom
interface AccessLevelSelectProps {
  value?: string[];
  onChange: (value: string[]) => void;
  options: Array<{ label: string; value: string }>;
}

declare function AccessLevelSelect(props: AccessLevelSelectProps): JSX.Element;



// FP: server-side async function parameter interface — rule misapplied to non-React code
interface SendNotificationOptions {
  recipientId: string;
  subject: string;
  body: string;
  replyTo?: string;
}

declare function sendNotificationEmail(opts: SendNotificationOptions): Promise<void>;



// FP: string primitive prop in email template component — string primitives are immutable, readonly adds no correctness benefit
interface EmailHeaderProps {
  assetBaseUrl: string;
  logoAlt: string;
}

declare function EmailHeader(props: EmailHeaderProps): JSX.Element;



// FP: children: React.ReactNode prop — idiomatic React; readonly on children is not standard practice
interface ApiProviderProps {
  children: React.ReactNode;
  baseUrl: string;
}

declare function ApiProvider(props: ApiProviderProps): JSX.Element;



// FP: optional Option[] array prop for controlled multi-select — mutable array controlled props are standard React idiom
interface SelectOption {
  label: string;
  value: string;
}

interface MultiSelectProps {
  value?: SelectOption[];
  options: SelectOption[];
  onChange: (selected: SelectOption[]) => void;
  placeholder?: string;
}

declare function MultiSelect(props: MultiSelectProps): JSX.Element;



// FP: ReactNode children and string props without readonly — standard React/TypeScript idiom
interface DropZoneWrapperProps {
  children: React.ReactNode;
  documentName: string;
  onDrop?: (files: File[]) => void;
}

declare function DropZoneWrapper(props: DropZoneWrapperProps): JSX.Element;



// FP: object prop typed as a Prisma/ORM entity — components conventionally do not mutate received object props
interface FieldTooltipProps {
  field: {
    id: string;
    type: string;
    label: string;
    required: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
  };
  recipientName?: string;
}

declare function FieldTooltip(props: FieldTooltipProps): JSX.Element;



// FP: react-hook-form Control object prop — third-party library type, readonly enforcement is not idiomatic
declare const Control: unique symbol;
type FormControl<T> = { [Control]: T };

interface RecipientConfigProps {
  control: FormControl<{ name: string; email: string }>;
  isSubmitting: boolean;
}

declare function RecipientConfig(props: RecipientConfigProps): JSX.Element;



// FP: ColumnDef array prop — mutable array props are idiomatic React (TanStack Table pattern)
type ColumnDef<T> = {
  id: string;
  header: string;
  accessorKey: keyof T;
};

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
}

declare function DataTable<T>(props: DataTableProps<T>): JSX.Element;



// FP: string prop 'documentName' in email template — string primitives are immutable, readonly adds no benefit
interface DocumentPendingEmailProps {
  documentName: string;
  signerName: string;
  signerEmail: string;
  assetBaseUrl: string;
}

declare function DocumentPendingEmail(props: DocumentPendingEmailProps): JSX.Element;



// FP: primitive props in email template component — React guarantees props are never mutated; omitting readonly is idiomatic
interface DocumentCancelEmailProps {
  documentName: string;
  ownerName: string;
  assetBaseUrl: string;
  cancelledAt: string;
}

declare function DocumentCancelEmail(props: DocumentCancelEmailProps): JSX.Element;



// FP: numeric primitive prop 'documentId' — readonly on number props adds no safety (numbers are immutable by value)
interface RejectDialogProps {
  documentId: number;
  token: string;
  onRejected?: (reason: string) => void;
  trigger?: React.ReactNode;
}

declare function RejectDialog(props: RejectDialogProps): JSX.Element;



// FP: boolean primitive prop 'isLoading' — boolean primitives cannot be mutated by reference, readonly adds no safety
interface UploadFormProps {
  isLoading?: boolean;
  onUpload: (file: File) => Promise<void>;
  maxSizeBytes?: number;
}

declare function UploadForm(props: UploadFormProps): JSX.Element;



// FP: array prop 'envelopes' without readonly — standard React; components conventionally do not mutate received arrays
interface Envelope {
  id: string;
  title: string;
  status: string;
}

interface EnvelopeListProps {
  envelopes: Envelope[];
  onSelect: (envelope: Envelope) => void;
  currentEnvelopeId?: string;
}

declare function EnvelopeList(props: EnvelopeListProps): JSX.Element;



// FP: optional string 'className' prop — strings are primitives and immutable in JS, readonly is superfluous
interface RecipientSelectorProps {
  className?: string;
  selectedId?: string;
  onSelect: (id: string) => void;
  placeholder?: string;
}

declare function RecipientSelector(props: RecipientSelectorProps): JSX.Element;



// require-await FP: onClick async arrow delegates to mutation fn; async to match event handler returning Promise<void>
declare function submitFormMutation(payload: { name: string }): Promise<void>;

function SubmitButton() {
  const onClick: () => Promise<void> = async () => submitFormMutation({ name: 'example' });
  return onClick;
}



// require-await FP: onClick async arrow calls onDownload returning Promise; async for event handler Promise<void> type conformance
declare function triggerFileDownload(fileId: string): Promise<void>;

function DownloadButton({ fileId, onDownload }: { fileId: string; onDownload: (id: string) => Promise<void> }) {
  const onClick: () => Promise<void> = async () => onDownload(fileId);
  return onClick;
}



// require-await FP: onDelete async arrow calls navigate() which is synchronous; async to satisfy callback type expecting Promise<void>
declare function navigateTo(path: string): void;

function TemplateRow({ onDelete }: { onDelete: () => Promise<void> }) {
  const handleDelete: () => Promise<void> = async () => navigateTo('/templates');
  return handleDelete;
}



// require-await FP: onClick async arrow delegates to a mutation fn returning Promise; async used to match event handler returning Promise<void>
declare function removeMemberMutation(memberId: string): Promise<void>;

function AdminMemberRow({ memberId }: { memberId: string }) {
  const onClick: () => Promise<void> = async () => removeMemberMutation(memberId);
  return onClick;
}



// require-await FP: onUpdate async arrow delegates to updateRecord returning Promise; async for callback type conformance
declare function updateEmbeddedRecord(id: string, data: Record<string, unknown>): Promise<void>;

function EmbeddedEditor({ recordId }: { recordId: string }) {
  const onUpdate: (data: Record<string, unknown>) => Promise<void> = async (data) =>
    updateEmbeddedRecord(recordId, data);
  return onUpdate;
}



// require-await FP: onSignatureComplete async arrow delegates to handleSubmit returning Promise; async for callback signature conformance
declare function handleFormSubmit(signature: string): Promise<void>;

function SignatureField({ onSignatureComplete }: { onSignatureComplete: (sig: string) => Promise<void> }) {
  const onComplete: (sig: string) => Promise<void> = async (sig) => handleFormSubmit(sig);
  return onComplete;
}



// require-await FP: onClick async arrow calls onMethodSelect returning Promise; async for event handler Promise<void> type conformance
declare function selectAuthMethod(method: string): Promise<void>;

function AuthMethodButton({ method }: { method: string }) {
  const onClick: () => Promise<void> = async () => selectAuthMethod(method);
  return onClick;
}



// require-await FP: onClick async arrow calls mutation fn returning Promise; async for event handler Promise<void> type conformance
declare function acceptInvitationMutation(inviteCode: string): Promise<void>;

function InvitationCard({ inviteCode }: { inviteCode: string }) {
  const onClick: () => Promise<void> = async () => acceptInvitationMutation(inviteCode);
  return onClick;
}



// require-await FP: onClick async arrow calls createBillingCustomer mutation returning Promise; async for event handler Promise<void> conformance
declare function createBillingCustomerMutation(orgId: string): Promise<{ customerId: string }>;

function BillingSetupButton({ orgId }: { orgId: string }) {
  const onClick: () => Promise<void> = async () => { createBillingCustomerMutation(orgId); };
  return onClick;
}



// require-await FP: onClick async arrow calls handleCreatePortal returning Promise; async for event handler Promise<void> conformance
declare function openBillingPortal(): Promise<void>;

function BillingBanner() {
  const onClick: () => Promise<void> = async () => openBillingPortal();
  return onClick;
}



// require-await FP: onClick async arrow calls onCopyClick returning Promise; async for event handler Promise<void> type conformance
declare function copyToClipboard(text: string): Promise<void>;

function CopyLinkButton({ shareUrl }: { shareUrl: string }) {
  const onClick: () => Promise<void> = async () => copyToClipboard(shareUrl);
  return onClick;
}



// require-await FP: onClick async arrow calls authClient.signOut() returning Promise; async for event handler Promise<void> conformance
declare const authClient: { signOut: () => Promise<void> };

function NavSignOutButton() {
  const onClick: () => Promise<void> = async () => authClient.signOut();
  return onClick;
}



// require-await FP: React.lazy requires () => Promise<module>; async arrow satisfies the type - import() already returns a Promise
declare function lazyImportPdfViewer(): Promise<{ default: unknown }>;

const LazyPdfViewer = {
  load: async () => lazyImportPdfViewer(),
};



// require-await FP: onClick async arrow calls navigate(-1) which is synchronous; async to satisfy typed event handler expecting Promise<void>
declare function navigateBack(delta: number): void;

function SigningBackButton() {
  const onClick: () => Promise<void> = async () => { navigateBack(-1); };
  return onClick;
}



// --- react-readonly-props shape: primitive-props-immutable-by-nature (string prop) ---
interface NotificationBannerProps {
  title: string;
  message: string;
  variant: string;
}

declare function NotificationBanner(props: NotificationBannerProps): JSX.Element;

function AlertPanel({ title, message, variant }: NotificationBannerProps) {
  return (
    <div className={`alert alert-${variant}`}>
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}



// --- react-readonly-props shape: array-and-object-props-idiomatic-without-readonly (object prop) ---
interface AuthOptions {
  method: string;
  redirectUrl: string;
  scopes: string[];
}

interface SignInFormProps {
  authOptions: AuthOptions;
  onComplete: () => void;
}

function SignInForm({ authOptions, onComplete }: SignInFormProps) {
  return (
    <form onSubmit={onComplete}>
      <input type="hidden" name="method" value={authOptions.method} />
      <button type="submit">Sign In</button>
    </form>
  );
}



// --- react-readonly-props shape: children-reactnode-canonical-pattern ---
declare namespace React { type ReactNode = unknown; }

interface CardLayoutProps {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

function CardLayout({ title, children, footer }: CardLayoutProps) {
  return (
    <div className="card">
      <div className="card-header">{title}</div>
      <div className="card-body">{children}</div>
      {footer && <div className="card-footer">{footer}</div>}
    </div>
  );
}



// --- require-await shape: event-handler-type-conformance (async onClick delegates to Promise-returning fn) ---
declare function copyToClipboard(text: string): Promise<void>;

interface CopyButtonProps {
  text: string;
  onCopied?: () => void;
}

function CopyButton({ text, onCopied }: CopyButtonProps) {
  const handleClick = async () => {
    copyToClipboard(text);
    onCopied?.();
  };
  return <button onClick={handleClick}>Copy</button>;
}



type RecipientStatusType = 'NOT_OPENED' | 'OPENED' | 'SIGNED' | 'DECLINED' | 'COMPLETED' | 'PENDING';

function getRecipientStatusStyles(status: RecipientStatusType): {
  bgClass: string;
  textClass: string;
  borderClass: string;
} {
  let bgClass: string;
  let textClass: string;
  let borderClass: string;

  switch (status) {
    case 'NOT_OPENED':
      bgClass = 'bg-slate-100';
      textClass = 'text-slate-500';
      borderClass = 'border-slate-200';
      break;
    case 'OPENED':
      bgClass = 'bg-blue-50';
      textClass = 'text-blue-600';
      borderClass = 'border-blue-200';
      break;
    case 'SIGNED':
      bgClass = 'bg-green-50';
      textClass = 'text-green-600';
      borderClass = 'border-green-200';
      break;
    case 'DECLINED':
      bgClass = 'bg-red-50';
      textClass = 'text-red-600';
      borderClass = 'border-red-200';
      break;
    case 'COMPLETED':
      bgClass = 'bg-emerald-50';
      textClass = 'text-emerald-600';
      borderClass = 'border-emerald-200';
      break;
    default:
      bgClass = 'bg-yellow-50';
      textClass = 'text-yellow-600';
      borderClass = 'border-yellow-200';
      break;
  }

  return { bgClass, textClass, borderClass };
}

export { getRecipientStatusStyles };



// --- too-many-lines shape: react-tsx-component with useMemo + inline SVG icons + JSX popover structure ---
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare function cn(...classes: string[]): string;
declare function buttonVariants(opts: { color?: string; size?: string; className?: string }): string;
declare const Popover: (props: { children: React.ReactNode }) => JSX.Element;
declare const PopoverTrigger: (props: { className?: string; children: React.ReactNode }) => JSX.Element;
declare const PopoverContent: (props: { className?: string; children: React.ReactNode }) => JSX.Element;
declare const ChevronDown: (props: { className?: string }) => JSX.Element;
declare const ExternalLinkIcon: (props: { className?: string }) => JSX.Element;
declare const MessageCircleIcon: () => JSX.Element;

export function PageShareOptions({
  rawContentUrl,
  sourceUrl,
}: {
  /**
   * URL pointing to the raw Markdown content of the page
   */
  rawContentUrl: string;

  /**
   * Source file URL on the version control platform
   */
  sourceUrl: string;
}) {
  const items = useMemo(() => {
    const absoluteUrl =
      typeof window !== 'undefined'
        ? new URL(rawContentUrl, window.location.origin)
        : 'loading';
    const prompt = `Read ${absoluteUrl}, I want to ask questions about it.`;

    return [
      {
        title: 'Open in GitHub',
        href: sourceUrl,
        icon: (
          <svg fill="currentColor" role="img" viewBox="0 0 24 24">
            <title>GitHub</title>
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
        ),
      },
      {
        title: 'Open in ChatGPT',
        href: `https://chatgpt.com/?${new URLSearchParams({ hints: 'search', q: prompt })}`,
        icon: (
          <svg role="img" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <title>ChatGPT</title>
            <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729z" />
          </svg>
        ),
      },
      {
        title: 'Open in Claude',
        href: `https://claude.ai/new?${new URLSearchParams({ q: prompt })}`,
        icon: (
          <svg fill="currentColor" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <title>Anthropic</title>
            <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
          </svg>
        ),
      },
      {
        title: 'Open in Gemini',
        href: `https://gemini.google.com/app?${new URLSearchParams({ q: prompt })}`,
        icon: <MessageCircleIcon />,
      },
    ];
  }, [sourceUrl, rawContentUrl]);

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          buttonVariants({
            color: 'secondary',
            size: 'sm',
            className: 'gap-2',
          }),
        )}
      >
        Share
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="flex flex-col">
        {items.map((item) => (
          <a
            key={item.href}
            href={item.href}
            rel="noreferrer noopener"
            target="_blank"
            className="inline-flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-accent hover:text-accent-foreground [&_svg]:size-4"
          >
            {item.icon}
            {item.title}
            <ExternalLinkIcon className="ms-auto size-3.5 text-muted-foreground" />
          </a>
        ))}
      </PopoverContent>
    </Popover>
  );
}




// --- too-many-lines shape: react-tsx-component (JSX markup and hooks inflate line count) ---
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useForm<T>(opts: { defaultValues: Partial<T>; resolver?: unknown }): {
  handleSubmit: (fn: (data: T) => void | Promise<void>) => (e: unknown) => void;
  reset: () => void;
  setValue: (field: keyof T, value: unknown) => void;
  control: unknown;
  formState: { isSubmitting: boolean };
};
declare function zodResolver(schema: unknown): unknown;
declare const z: {
  object: (shape: Record<string, unknown>) => { infer: unknown };
  string: () => { trim: () => { optional: () => unknown } };
};
declare function useNotification(): { notify: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useCurrentUser(): { reload: () => Promise<void> };
declare function flushSync(fn: () => void): void;

type TRevokeSessionForm = {
  confirmationCode: string;
  recoveryKey: string;
};

export const RevokeSessionDialog = () => {
  const { notify } = useNotification();
  const { reload } = useCurrentUser();

  const [isOpen, setIsOpen] = useState(false);
  const [verifyMethod, setVerifyMethod] = useState<'code' | 'recovery'>('code');

  const revokeForm = useForm<TRevokeSessionForm>({
    defaultValues: {
      confirmationCode: '',
      recoveryKey: '',
    },
    resolver: zodResolver({}),
  });

  const onCloseDialog = () => {
    revokeForm.reset();
    setIsOpen(!isOpen);
  };

  const onToggleVerifyMethod = () => {
    const next = verifyMethod === 'code' ? 'recovery' : 'code';

    if (next === 'code') {
      revokeForm.setValue('recoveryKey', '');
    }

    if (next === 'recovery') {
      revokeForm.setValue('confirmationCode', '');
    }

    setVerifyMethod(next);
  };

  const { isSubmitting: isRevoking } = revokeForm.formState;

  const onSubmit = async ({ confirmationCode, recoveryKey }: TRevokeSessionForm) => {
    try {
      await revokeActiveSession({ confirmationCode, recoveryKey });

      notify({
        title: 'Session revoked',
        description:
          'Your active session has been revoked. You will need to sign in again on other devices.',
      });

      flushSync(() => {
        onCloseDialog();
      });

      await reload();
    } catch (_err) {
      notify({
        title: 'Unable to revoke session',
        description:
          'We were unable to revoke the session. Please check your confirmation code and try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onCloseDialog}>
      <DialogTrigger asChild={true}>
        <Button variant="destructive">Revoke Session</Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke Active Session</DialogTitle>
          <DialogDescription>
            Enter a confirmation code from your authenticator app, or use a recovery key to revoke
            this session. If you have lost access to both, please contact support.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={revokeForm.handleSubmit(onSubmit)}>
          <fieldset disabled={isRevoking} className="flex flex-col gap-y-4">
            {verifyMethod === 'code' && (
              <div className="form-field">
                <label htmlFor="confirmationCode">Confirmation Code</label>
                <input
                  id="confirmationCode"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  autoComplete="one-time-code"
                />
              </div>
            )}

            {verifyMethod === 'recovery' && (
              <div className="form-field">
                <label htmlFor="recoveryKey">Recovery Key</label>
                <input
                  id="recoveryKey"
                  type="text"
                  placeholder="XXXX-XXXX-XXXX"
                  autoComplete="off"
                />
              </div>
            )}

            <div className="flex flex-col gap-y-4">
              <Button type="submit" disabled={isRevoking}>
                {isRevoking ? 'Revoking...' : 'Revoke Session'}
              </Button>

              <Button type="button" variant="ghost" onClick={onToggleVerifyMethod}>
                {verifyMethod === 'code'
                  ? 'Use a recovery key instead'
                  : 'Use confirmation code instead'}
              </Button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
};

declare function revokeActiveSession(opts: { confirmationCode?: string; recoveryKey?: string }): Promise<void>;
declare function Dialog(props: { open: boolean; onOpenChange: () => void; children: unknown }): JSX.Element;
declare function DialogTrigger(props: { asChild?: boolean; children: unknown }): JSX.Element;
declare function DialogContent(props: { children: unknown }): JSX.Element;
declare function DialogHeader(props: { children: unknown }): JSX.Element;
declare function DialogTitle(props: { children: unknown }): JSX.Element;
declare function DialogDescription(props: { children: unknown }): JSX.Element;
declare function Button(props: { type?: string; variant?: string; disabled?: boolean; onClick?: () => void; children: unknown }): JSX.Element;



declare function useLingui(): { t: (s: TemplateStringsArray, ...v: unknown[]) => string };
declare function useCurrentFormEditor(): {
  form: { id: string; title: string; status: string; type: string; teamId: string; directLink?: { token: string; enabled: boolean } };
  isDocument: boolean;
  isTemplate: boolean;
  isEmbedded: boolean;
  updateForm: (opts: { data: Record<string, unknown> }) => void;
  autosaveError: Error | null;
  relativePath: { documentRootPath: string };
  editorConfig: {
    embedded?: { customBrandingLogo?: boolean; onCreate?: (f: unknown) => void; onUpdate?: (f: unknown) => void };
    general: { allowConfigureFormTitle: boolean };
    actions: { allowAttachments: boolean; allowDistributing: boolean };
    settings?: boolean;
  };
  flushAutosave: () => Promise<unknown>;
};
declare function getFormItemPermissions(form: unknown, recipients: unknown[]): { canTitleBeChanged: boolean };
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare const FormStatus: { DRAFT: string; PENDING: string; COMPLETED: string; REJECTED: string };
declare const FormType: { TEMPLATE: string; DOCUMENT: string };
declare const TemplateKind: { PRIVATE: string; ORGANISATION: string; PUBLIC: string };
declare function match<T>(val: T): any;

export default function FormEditorHeader(): JSX.Element {
  const { t } = useLingui();

  const {
    form,
    isDocument,
    isTemplate,
    isEmbedded,
    updateForm,
    autosaveError,
    relativePath,
    editorConfig,
    flushAutosave,
  } = useCurrentFormEditor();

  const {
    embedded,
    general: { allowConfigureFormTitle },
    actions: { allowAttachments, allowDistributing },
  } = editorConfig;

  const formItemPermissions = useMemo(
    () => getFormItemPermissions(form, (form as any).recipients),
    [form, (form as any).recipients],
  );

  const handleCreateEmbeddedForm = async () => {
    const latestForm = await flushAutosave();
    embedded?.onCreate?.(latestForm);
  };

  const handleUpdateEmbeddedForm = async () => {
    const latestForm = await flushAutosave();
    embedded?.onUpdate?.(latestForm);
  };

  return (
    <nav className="w-full border-border border-b bg-background px-4 py-3 md:px-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center space-x-4">
          {editorConfig.embedded?.customBrandingLogo ? (
            <img src={`/api/branding/logo/team/${form.teamId}`} alt="Logo" className="h-6 w-auto" />
          ) : (
            <a href="/">
              <span className="h-6 w-auto font-bold">FormBuilder</span>
            </a>
          )}
          <hr className="h-6 border-l shrink-0" />

          <div className="flex min-w-0 items-center space-x-2">
            <input
              data-testid="form-title-input"
              disabled={!formItemPermissions.canTitleBeChanged || !allowConfigureFormTitle}
              value={form.title}
              onChange={(e) => {
                updateForm({
                  data: {
                    title: e.target.value,
                  },
                });
              }}
              placeholder={`Form Title`}
            />

            {form.type === FormType.TEMPLATE && (
              <>
                {(form as any).templateKind === TemplateKind.PRIVATE && (
                  <span className="shrink-0 badge badge-secondary">
                    <span className="mr-2 h-4 w-4 text-blue-600 dark:text-blue-300" />
                    Private Template
                  </span>
                )}
                {(form as any).templateKind === TemplateKind.ORGANISATION && (
                  <span className="shrink-0 badge badge-orange">
                    <span className="mr-2 size-4" />
                    Organisation Template
                  </span>
                )}
                {(form as any).templateKind === TemplateKind.PUBLIC && (
                  <span className="shrink-0 badge badge-default">
                    <span className="mr-2 h-4 w-4 text-green-500 dark:text-green-300" />
                    Public Template
                  </span>
                )}

                {form.directLink?.token && (
                  <span className="shrink-0 py-1 badge">
                    Direct Link: {form.directLink.enabled ? 'active' : 'inactive'}
                  </span>
                )}
              </>
            )}

            {form.type === FormType.DOCUMENT &&
              match(form.status)
                .with(FormStatus.DRAFT, () => (
                  <span className="shrink-0 badge badge-warning">Draft</span>
                ))
                .with(FormStatus.PENDING, () => (
                  <span className="shrink-0 badge badge-secondary">Pending</span>
                ))
                .with(FormStatus.COMPLETED, () => (
                  <span className="shrink-0 badge badge-default">Completed</span>
                ))
                .with(FormStatus.REJECTED, () => (
                  <span className="shrink-0 badge badge-destructive">Rejected</span>
                ))
                .exhaustive()}

            {autosaveError && (
              <>
                <span className="shrink-0 badge badge-destructive">
                  <span className="mr-2 h-4 w-4" />
                  Sync failed, changes not saved
                </span>

                <button
                  onClick={() => {
                    window.location.reload();
                  }}
                >
                  <span className="shrink-0 badge badge-destructive">
                    <span className="mr-2 h-4 w-4" />
                    Reload
                  </span>
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center space-x-2">
          {allowAttachments &&
            (isEmbedded ? (
              <button className="btn btn-sm">Embedded Attachments</button>
            ) : (
              <button className="btn btn-sm">Attachments for {form.id}</button>
            ))}

          {editorConfig.settings && (
            <button className="btn btn-outline btn-sm">
              <span className="h-4 w-4" />
            </button>
          )}

          {match({ isEmbedded, isDocument, isTemplate, allowDistributing })
            .with({ isEmbedded: false, isDocument: true, allowDistributing: true }, () => (
              <>
                <button className="btn btn-sm" onClick={() => {}}>
                  <span className="mr-2 h-4 w-4" />
                  Send Document
                </button>

                <button className="btn btn-outline btn-sm" onClick={() => {}}>
                  <span className="mr-2 h-4 w-4" />
                  Resend
                </button>
              </>
            ))
            .with({ isEmbedded: true, isDocument: true }, () => (
              <button className="btn btn-sm" onClick={handleUpdateEmbeddedForm}>
                Update
              </button>
            ))
            .with({ isEmbedded: true, isTemplate: false }, () => (
              <button className="btn btn-sm" onClick={handleCreateEmbeddedForm}>
                Create
              </button>
            ))
            .otherwise(() => null)}
        </div>
      </div>
    </nav>
  );
}



// --- too-many-lines positive fixture: large React TSX component (react-tsx-component shape) ---

declare function useState<T>(initial: T): [T, (v: T) => void];
declare function useEffect(fn: () => (() => void) | void, deps?: unknown[]): void;
declare function useCallback<F extends (...args: unknown[]) => unknown>(fn: F, deps: unknown[]): F;
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare function useRef<T>(initial: T): { current: T };
declare function useForm<T>(opts?: { defaultValues?: Partial<T>; resolver?: unknown }): {
  handleSubmit: (fn: (data: T) => void) => () => void;
  getValues: () => T;
  setValue: (key: keyof T, val: unknown) => void;
  control: unknown;
};
declare function useFieldArray<T>(opts: { control: unknown; name: string }): {
  append: (item: T) => void;
  remove: (index: number) => void;
  update: (index: number, item: T) => void;
  fields: T[];
};
declare function useToast(): { toast: (opts: { title: string; description?: string }) => void };
declare function useHotkeys(keys: string | string[], handler: (e: KeyboardEvent) => void): void;
declare function useDocumentElement(): {
  isWithinCanvasBounds: (e: MouseEvent, sel: string, w: number, h: number) => boolean;
  getAnnotationPosition: (page: HTMLElement, node: HTMLElement) => { x: number; y: number; width: number; height: number };
  getPage: (e: MouseEvent, sel: string) => HTMLElement | null;
};
declare function useStep(): { currentStep: number; totalSteps: number; previousStep: () => void };
declare function zodResolver(schema: unknown): unknown;
declare const ZAnnotationSchema: { parse: (v: unknown) => unknown };
declare const ZAddAnnotationsSchema: { parse: (v: unknown) => AnnotationFormValues };
declare const CANVAS_PAGE_SELECTOR: string;
declare const ADVANCED_ANNOTATION_TYPES: string[];
declare function nanoid(size: number): string;
declare function getPageCount(): number;
declare function getBoundingRect(el: HTMLElement): { top: number; left: number; height: number; width: number };
declare function getRecipientStyles(index: number): { base: string };
declare function cn(...args: unknown[]): string;

type AnnotationMeta = Record<string, unknown>;
type RecipientInfo = { id: number; email: string; role: string; sendStatus: string };
type AnnotationType = 'SIGNATURE' | 'INITIALS' | 'TEXT' | 'DATE' | 'CHECKBOX' | 'RADIO' | 'DROPDOWN';

type AnnotationField = {
  nativeId?: number;
  formId: string;
  pageNumber: number;
  type: AnnotationType;
  pageX: number;
  pageY: number;
  pageWidth: number;
  pageHeight: number;
  signerEmail: string;
  recipientId: number;
  meta?: AnnotationMeta;
};

type AnnotationFormValues = {
  annotations: AnnotationField[];
};

type CanvasStepProps = {
  stepConfig: { title: string; description: string; onBackStep?: () => void };
  hideAssignees?: boolean;
  recipients: RecipientInfo[];
  existingAnnotations: AnnotationField[];
  onSubmit: (data: AnnotationFormValues) => void;
  onAutoSave: (data: AnnotationFormValues) => Promise<void>;
  canGoBack?: boolean;
  isCanvasLoaded: boolean;
  workspaceId: number;
};

const MIN_ANNOTATION_HEIGHT = 12;
const MIN_ANNOTATION_WIDTH = 36;
const DEFAULT_ANNOTATION_HEIGHT = MIN_ANNOTATION_HEIGHT * 2.5;
const DEFAULT_ANNOTATION_WIDTH = MIN_ANNOTATION_WIDTH * 2.5;

export const AddAnnotationsPanel = ({
  stepConfig,
  hideAssignees = false,
  recipients,
  existingAnnotations,
  onSubmit,
  onAutoSave,
  canGoBack = false,
  isCanvasLoaded,
  workspaceId,
}: CanvasStepProps) => {
  const { toast } = useToast();

  const [isWarningDialogOpen, setIsWarningDialogOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [currentAnnotation, setCurrentAnnotation] = useState<AnnotationField | undefined>(undefined);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);

  const { isWithinCanvasBounds, getAnnotationPosition, getPage } = useDocumentElement();
  const { currentStep, totalSteps, previousStep } = useStep();

  const canShowBackAsRemove =
    currentStep === 1 &&
    typeof stepConfig.onBackStep === 'function' &&
    canGoBack;

  const form = useForm<AnnotationFormValues>({
    defaultValues: {
      annotations: existingAnnotations.map((ann) => ({
        nativeId: ann.nativeId,
        formId: ann.formId,
        pageNumber: ann.pageNumber,
        type: ann.type,
        pageX: ann.pageX,
        pageY: ann.pageY,
        pageWidth: ann.pageWidth,
        pageHeight: ann.pageHeight,
        signerEmail:
          recipients.find((r) => r.id === ann.recipientId)?.email ?? '',
        recipientId: ann.recipientId,
        meta: ann.meta,
      })),
    },
    resolver: zodResolver(ZAddAnnotationsSchema),
  });

  useHotkeys(['ctrl+c', 'meta+c'], (evt) => onAnnotationCopy(evt));
  useHotkeys(['ctrl+v', 'meta+v'], (evt) => onAnnotationPaste(evt));
  useHotkeys(['ctrl+d', 'meta+d'], (evt) => onAnnotationCopy(evt, { duplicate: true }));

  const onFormSubmit = form.handleSubmit(onSubmit);

  const handleSavedAnnotationSettings = (metaState: AnnotationMeta) => {
    const current = form.getValues();
    const updated = current.annotations.map((ann) => {
      if (ann.formId === currentAnnotation?.formId) {
        const parsed = ZAnnotationSchema.parse(metaState);
        return { ...ann, meta: parsed as AnnotationMeta };
      }
      return ann;
    });
    form.setValue('annotations', updated);
  };

  const {
    append,
    remove,
    update,
    fields: localAnnotations,
  } = useFieldArray<AnnotationField>({
    control: form.control,
    name: 'annotations',
  });

  const [selectedType, setSelectedType] = useState<AnnotationType | null>(null);
  const [selectedAssignee, setSelectedAssignee] = useState<RecipientInfo | null>(null);
  const [lastActiveAnnotation, setLastActiveAnnotation] = useState<AnnotationField | null>(null);
  const [annotationClipboard, setAnnotationClipboard] = useState<AnnotationField | null>(null);

  const selectedAssigneeIndex = recipients.findIndex((r) => r.id === selectedAssignee?.id);
  const selectedAssigneeStyles = getRecipientStyles(selectedAssigneeIndex);

  const [validateEmptyFields, setValidateEmptyFields] = useState(false);

  const filterByType = (anns: typeof localAnnotations, type: string) =>
    anns
      .filter((a) => a.type === type)
      .filter((a) => {
        if (a.meta && 'values' in a.meta) {
          return (a.meta.values as unknown[])?.length === 0;
        }
        return true;
      });

  const emptyCheckboxAnnotations = useMemo(
    () => filterByType(localAnnotations, 'CHECKBOX'),
    [localAnnotations],
  );

  const emptyRadioAnnotations = useMemo(
    () => filterByType(localAnnotations, 'RADIO'),
    [localAnnotations],
  );

  const emptyDropdownAnnotations = useMemo(
    () => filterByType(localAnnotations, 'DROPDOWN'),
    [localAnnotations],
  );

  const hasValidationErrors =
    emptyCheckboxAnnotations.length > 0 ||
    emptyRadioAnnotations.length > 0 ||
    emptyDropdownAnnotations.length > 0;

  const annotationsWithErrors = useMemo(() => {
    const flagged = localAnnotations.filter((ann) => {
      const hasIssue =
        (ann.type === 'CHECKBOX' || ann.type === 'RADIO' || ann.type === 'DROPDOWN') &&
        ann.meta === undefined;
      const hasEmptyValues =
        ann.meta && 'values' in ann.meta && (ann.meta.values as unknown[])?.length === 0;
      return hasIssue || hasEmptyValues;
    });
    return flagged.map((ann) => ({
      id: ann.nativeId ?? 0,
      secondaryId: ann.formId,
      recipientId: ann.recipientId,
      type: ann.type,
      page: ann.pageNumber,
      pageX: ann.pageX,
      pageY: ann.pageY,
      pageWidth: ann.pageWidth,
      pageHeight: ann.pageHeight,
    }));
  }, [localAnnotations]);

  const isAnnotationsDisabled = useMemo(() => {
    if (!selectedAssignee) return true;
    return selectedAssignee.role === 'VIEWER';
  }, [selectedAssignee]);

  const [isWithinBounds, setIsWithinBounds] = useState(false);
  const [cursorCoords, setCursorCoords] = useState({ x: 0, y: 0 });
  const annotationBounds = useRef({ height: 0, width: 0 });

  const onMouseMove = useCallback(
    (event: MouseEvent) => {
      setIsWithinBounds(
        isWithinCanvasBounds(
          event,
          CANVAS_PAGE_SELECTOR,
          annotationBounds.current.width,
          annotationBounds.current.height,
        ),
      );
      setCursorCoords({
        x: event.clientX - annotationBounds.current.width / 2,
        y: event.clientY - annotationBounds.current.height / 2,
      });
    },
    [isWithinCanvasBounds],
  );

  const onMouseClick = useCallback(
    (event: MouseEvent) => {
      if (!selectedType || !selectedAssignee) return;

      const $page = getPage(event, CANVAS_PAGE_SELECTOR);
      if (
        !$page ||
        !isWithinCanvasBounds(
          event,
          CANVAS_PAGE_SELECTOR,
          annotationBounds.current.width,
          annotationBounds.current.height,
        )
      ) {
        setSelectedType(null);
        return;
      }

      const { top, left, height, width } = getBoundingRect($page);
      const pageNumber = parseInt(
        $page.getAttribute('data-page-number') ?? '1',
        10,
      );

      let pageX = ((event.pageX - left) / width) * 100;
      let pageY = ((event.pageY - top) / height) * 100;
      const annPageWidth = (annotationBounds.current.width / width) * 100;
      const annPageHeight = (annotationBounds.current.height / height) * 100;
      pageX -= annPageWidth / 2;
      pageY -= annPageHeight / 2;

      const newAnnotation: AnnotationField = {
        formId: nanoid(12),
        nativeId: undefined,
        type: selectedType,
        pageNumber,
        pageX,
        pageY,
        pageWidth: annPageWidth,
        pageHeight: annPageHeight,
        signerEmail: selectedAssignee.email,
        recipientId: selectedAssignee.id,
        meta: undefined,
      };

      append(newAnnotation);

      if (ADVANCED_ANNOTATION_TYPES.includes(selectedType)) {
        setCurrentAnnotation(newAnnotation);
        setShowSettings(true);
      }

      setIsWithinBounds(false);
      setSelectedType(null);
    },
    [append, isWithinCanvasBounds, selectedType, selectedAssignee, getPage],
  );

  const onAnnotationResize = useCallback(
    (node: HTMLElement, index: number) => {
      const ann = localAnnotations[index];
      const $page = window.document.querySelector<HTMLElement>(
        `${CANVAS_PAGE_SELECTOR}[data-page-number="${ann.pageNumber}"]`,
      );
      if (!$page) return;
      const { x: pageX, y: pageY, width: pageWidth, height: pageHeight } =
        getAnnotationPosition($page, node);
      update(index, { ...ann, pageX, pageY, pageWidth, pageHeight });
    },
    [getAnnotationPosition, localAnnotations, update],
  );

  const onAnnotationMove = useCallback(
    (node: HTMLElement, index: number) => {
      const ann = localAnnotations[index];
      const $page = window.document.querySelector<HTMLElement>(
        `${CANVAS_PAGE_SELECTOR}[data-page-number="${ann.pageNumber}"]`,
      );
      if (!$page) return;
      const { x: pageX, y: pageY } = getAnnotationPosition($page, node);
      update(index, { ...ann, pageX, pageY });
    },
    [getAnnotationPosition, localAnnotations, update],
  );

  const onAnnotationCopy = useCallback(
    (event?: KeyboardEvent | null, options?: { duplicate?: boolean; duplicateAll?: boolean }) => {
      const { duplicate = false, duplicateAll = false } = options ?? {};
      if (!lastActiveAnnotation) return;
      event?.preventDefault();

      if (duplicate) {
        append({
          ...structuredClone(lastActiveAnnotation),
          nativeId: undefined,
          formId: nanoid(12),
          signerEmail: selectedAssignee?.email ?? lastActiveAnnotation.signerEmail,
          recipientId: selectedAssignee?.id ?? lastActiveAnnotation.recipientId,
          pageX: lastActiveAnnotation.pageX + 3,
          pageY: lastActiveAnnotation.pageY + 3,
        });
        return;
      }

      if (duplicateAll) {
        const totalPages = getPageCount();
        if (totalPages < 1) return;
        for (let page = 1; page <= totalPages; page++) {
          if (page === lastActiveAnnotation.pageNumber) continue;
          append({
            ...structuredClone(lastActiveAnnotation),
            nativeId: undefined,
            formId: nanoid(12),
            signerEmail: selectedAssignee?.email ?? lastActiveAnnotation.signerEmail,
            recipientId: selectedAssignee?.id ?? lastActiveAnnotation.recipientId,
            pageNumber: page,
          });
        }
        return;
      }

      setAnnotationClipboard(lastActiveAnnotation);
      toast({ title: 'Copied annotation', description: 'Annotation copied to clipboard' });
    },
    [append, lastActiveAnnotation, selectedAssignee, toast],
  );

  const onAnnotationPaste = useCallback(
    (event: KeyboardEvent) => {
      if (!annotationClipboard) return;
      event.preventDefault();
      const copied = structuredClone(annotationClipboard);
      append({
        ...copied,
        nativeId: undefined,
        formId: nanoid(12),
        signerEmail: selectedAssignee?.email ?? copied.signerEmail,
        recipientId: selectedAssignee?.id ?? copied.recipientId,
        pageX: copied.pageX + 3,
        pageY: copied.pageY + 3,
      });
    },
    [append, annotationClipboard, selectedAssignee],
  );

  useEffect(() => {
    if (selectedType) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseClick);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseClick);
    };
  }, [onMouseClick, onMouseMove, selectedType]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const $page = document.querySelector(CANVAS_PAGE_SELECTOR);
      if (!$page) return;
      annotationBounds.current = {
        height: Math.max(DEFAULT_ANNOTATION_HEIGHT),
        width: Math.max(DEFAULT_ANNOTATION_WIDTH),
      };
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (selectedType) {
      const $page = document.querySelector(CANVAS_PAGE_SELECTOR);
      if ($page) {
        annotationBounds.current = {
          height: DEFAULT_ANNOTATION_HEIGHT,
          width: DEFAULT_ANNOTATION_WIDTH,
        };
      }
    }
  }, [selectedType]);

  return (
    <div className="flex flex-col h-full">
      <div className="canvas-step-header">
        <h2>{stepConfig.title}</h2>
        <p>{stepConfig.description}</p>
        <span>{currentStep} / {totalSteps}</span>
      </div>

      <div className="canvas-step-content flex flex-1 flex-col">
        {!hideAssignees && (
          <div className="assignee-selector mb-4">
            <label className="text-sm font-medium">Assign to</label>
            <div className="flex gap-2 mt-1">
              {recipients.map((recipient) => (
                <button
                  key={recipient.id}
                  className={cn(
                    'px-3 py-1 rounded border text-sm',
                    selectedAssignee?.id === recipient.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-300',
                  )}
                  onClick={() => setSelectedAssignee(recipient)}
                >
                  {recipient.email}
                </button>
              ))}
            </div>
          </div>
        )}

        {hasValidationErrors && (
          <div className="validation-alert bg-red-50 border border-red-200 rounded p-3 mb-4">
            <p className="text-sm text-red-700">
              Some annotations are missing required configuration.
            </p>
          </div>
        )}

        <div className="annotation-type-toolbar flex gap-2 mb-4">
          {(['SIGNATURE', 'INITIALS', 'TEXT', 'DATE', 'CHECKBOX', 'RADIO', 'DROPDOWN'] as AnnotationType[]).map(
            (type) => (
              <button
                key={type}
                disabled={isAnnotationsDisabled}
                className={cn(
                  'px-3 py-2 rounded text-xs font-medium border',
                  selectedType === type
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
                )}
                onClick={() =>
                  setSelectedType((prev) => (prev === type ? null : type))
                }
              >
                {type}
              </button>
            ),
          )}
        </div>

        <div className="canvas-viewport flex-1 relative overflow-hidden">
          {isCanvasLoaded &&
            localAnnotations.map((ann, index) => {
              const recipientIdx = recipients.findIndex(
                (r) => r.id === ann.recipientId,
              );
              const hasError =
                emptyCheckboxAnnotations.find((a) => a.formId === ann.formId) ||
                emptyRadioAnnotations.find((a) => a.formId === ann.formId) ||
                emptyDropdownAnnotations.find((a) => a.formId === ann.formId);

              return (
                <div
                  key={ann.formId}
                  className={cn(
                    'annotation-item absolute border rounded',
                    selectedAssigneeStyles?.base,
                    {
                      'border-red-500': !!hasError,
                      'opacity-50': ann.recipientId !== selectedAssignee?.id,
                    },
                  )}
                  style={{
                    top: `${ann.pageY}%`,
                    left: `${ann.pageX}%`,
                    width: `${ann.pageWidth}%`,
                    height: `${ann.pageHeight}%`,
                  }}
                  onClick={() => {
                    setLastActiveAnnotation(ann);
                    setActiveAnnotationId(ann.formId);
                  }}
                >
                  <span className="annotation-label text-xs">{ann.type}</span>
                  <button
                    className="annotation-remove absolute top-0 right-0 text-xs text-red-500"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(index);
                    }}
                  >
                    x
                  </button>
                  {activeAnnotationId === ann.formId && (
                    <div className="annotation-toolbar flex gap-1 absolute bottom-full left-0">
                      <button
                        className="text-xs px-1 bg-white border rounded"
                        onClick={() => {
                          setCurrentAnnotation(ann);
                          setShowSettings(true);
                        }}
                      >
                        Settings
                      </button>
                      <button
                        className="text-xs px-1 bg-white border rounded"
                        onClick={() =>
                          onAnnotationCopy(null, { duplicateAll: true })
                        }
                      >
                        Duplicate all pages
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

          {selectedType && isWithinBounds && (
            <div
              className={cn(
                'annotation-preview absolute pointer-events-none border-2 border-dashed rounded opacity-70',
                selectedAssigneeStyles?.base,
              )}
              style={{
                top: cursorCoords.y,
                left: cursorCoords.x,
                height: annotationBounds.current.height,
                width: annotationBounds.current.width,
              }}
            >
              <span className="text-xs">{selectedType}</span>
            </div>
          )}
        </div>

        {showSettings && currentAnnotation && (
          <div className="settings-panel border-t pt-4">
            <h3 className="text-sm font-semibold mb-2">Annotation Settings</h3>
            <div className="settings-form">
              <label className="text-xs text-gray-500">Annotation type</label>
              <p className="text-sm font-medium">{currentAnnotation.type}</p>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded"
                onClick={() => {
                  handleSavedAnnotationSettings({ savedAt: Date.now() });
                  setShowSettings(false);
                }}
              >
                Save
              </button>
              <button
                className="px-3 py-1 text-sm border rounded"
                onClick={() => setShowSettings(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {isWarningDialogOpen && (
          <div className="warning-dialog fixed inset-0 flex items-center justify-center bg-black/40 z-50">
            <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-lg">
              <h4 className="font-semibold mb-2">Missing required annotations</h4>
              <p className="text-sm text-gray-600 mb-4">
                Some recipients are missing required signature fields. Do you want to continue anyway?
              </p>
              <div className="flex justify-end gap-2">
                <button
                  className="px-3 py-1 text-sm border rounded"
                  onClick={() => setIsWarningDialogOpen(false)}
                >
                  Go back
                </button>
                <button
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded"
                  onClick={() => {
                    setIsWarningDialogOpen(false);
                    onFormSubmit();
                  }}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="canvas-step-footer flex items-center justify-between border-t pt-3">
        <button
          className="px-4 py-2 text-sm border rounded"
          onClick={() => {
            if (canShowBackAsRemove) {
              stepConfig.onBackStep?.();
            } else {
              previousStep();
            }
          }}
        >
          {canShowBackAsRemove ? 'Remove step' : 'Back'}
        </button>

        <button
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded disabled:opacity-50"
          onClick={() => {
            const missing = localAnnotations.filter(
              (ann) =>
                (ann.type === 'SIGNATURE' || ann.type === 'INITIALS') &&
                !recipients.some((r) => r.id === ann.recipientId),
            );
            if (missing.length > 0) {
              setIsWarningDialogOpen(true);
            } else {
              onFormSubmit();
            }
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
};




// FP shape 621d5c42bb28: React TSX arrow-function component with hooks + mutations + JSX — line count inflated by framework structure, not decomposable logic
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void };
declare function useLingui(): { _: (msg: string) => string };
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useForm<T>(opts: { resolver?: unknown; defaultValues?: Partial<T> }): {
  handleSubmit: (fn: (data: T) => void | Promise<void>) => (e?: unknown) => void;
  control: unknown;
  reset: () => void;
};
declare function zodResolver(schema: unknown): unknown;
declare const z: {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => { min: (n: number, msg?: string) => unknown; url: (msg?: string) => unknown };
};
declare function useUtils(): { contract: { link: { find: { invalidate: (opts: { contractId: string }) => Promise<void> } } } };
declare function useQuery<T>(key: unknown, opts?: unknown): { data: T | undefined };
declare function useMutation<T>(opts: { onSuccess: () => void }): { mutateAsync: (args: T) => Promise<void>; isPending: boolean };
declare const AppError: { parseError: (err: unknown) => { message: string } };
declare function cn(...args: (string | undefined | null | boolean)[]): string;

type TLinkFormSchema = { label: string; url: string };

export const ContractLinksPopover = ({
  contractId,
  buttonClassName,
  buttonSize,
}: {
  contractId: string;
  buttonClassName?: string;
  buttonSize?: 'sm' | 'default';
}) => {
  const { toast } = useToast();
  const { _ } = useLingui();

  const [isOpen, setIsOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  const utils = useUtils();

  const { data: links } = useQuery<{ data: Array<{ id: string; label: string; href: string }> }>(
    ['contract', 'link', 'find', contractId],
    { enabled: isOpen },
  );

  const { mutateAsync: createLink, isPending: isCreating } = useMutation<{
    contractId: string;
    data: { label: string; href: string };
  }>({
    onSuccess: () => {
      void utils.contract.link.find.invalidate({ contractId });
    },
  });

  const { mutateAsync: deleteLink } = useMutation<{ id: string }>({
    onSuccess: () => {
      void utils.contract.link.find.invalidate({ contractId });
    },
  });

  const linkSchema = z.object({
    label: z.string().min(1, 'Label is required'),
    url: z.string().url('Must be a valid URL'),
  });

  const form = useForm<TLinkFormSchema>({
    resolver: zodResolver(linkSchema),
    defaultValues: { label: '', url: '' },
  });

  const onSubmit = async (data: TLinkFormSchema) => {
    try {
      await createLink({
        contractId,
        data: { label: data.label, href: data.url },
      });

      form.reset();
      setIsAdding(false);

      toast({
        title: _('Success'),
        description: _('Link added successfully.'),
      });
    } catch (err) {
      const error = AppError.parseError(err);
      toast({
        title: _('Error'),
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const onDeleteLink = async (id: string) => {
    try {
      await deleteLink({ id });
      toast({
        title: _('Success'),
        description: _('Link removed successfully.'),
      });
    } catch (err) {
      const error = AppError.parseError(err);
      toast({
        title: _('Error'),
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  return (
    <div data-state={isOpen ? 'open' : 'closed'}>
      <button
        className={cn('gap-2 border rounded', buttonClassName)}
        data-size={buttonSize}
        onClick={() => setIsOpen((v) => !v)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0z" /></svg>
        <span>
          Links
          {links && links.data.length > 0 && <span className="ml-1">({links.data.length})</span>}
        </span>
      </button>

      {isOpen && (
        <div className="w-96 p-4 space-y-4 border rounded shadow-md">
          <div>
            <h4 className="font-medium">Contract Links</h4>
            <p className="mt-1 text-sm text-gray-500">Attach links to related resources or documents.</p>
          </div>

          {links && links.data.length > 0 && (
            <div className="space-y-2">
              {links.data.map((link) => (
                <div
                  key={link.id}
                  className="flex items-center justify-between rounded border p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">{link.label}</p>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-xs text-gray-400 underline hover:text-gray-700"
                    >
                      {link.href}
                    </a>
                  </div>
                  <button
                    onClick={() => void onDeleteLink(link.id)}
                    className="ml-2 h-8 w-8 p-0 rounded hover:bg-gray-100"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16"><line x1="12" y1="4" x2="4" y2="12" /><line x1="4" y1="4" x2="12" y2="12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {!isAdding && (
            <button
              className="w-full border rounded text-sm py-1"
              onClick={() => setIsAdding(true)}
            >
              + Add Link
            </button>
          )}

          {isAdding && (
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <div>
                <input
                  className="w-full border rounded px-2 py-1 text-sm"
                  placeholder={_('Label')}
                />
              </div>
              <div>
                <input
                  type="url"
                  className="w-full border rounded px-2 py-1 text-sm"
                  placeholder={_('URL')}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 border rounded text-sm py-1"
                  onClick={() => {
                    setIsAdding(false);
                    form.reset();
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white rounded text-sm py-1"
                  disabled={isCreating}
                >
                  {isCreating ? 'Saving...' : 'Add'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};



declare function useState<T>(initial: T | null): [T | null, (v: T | null) => void];
declare function useLayoutEffect(fn: () => void, deps: unknown[]): void;
declare const useLocale: () => { t: (s: string) => string };
declare const useNotify: () => { show: (opts: { variant?: string; title: string; description: string }) => void };
declare const useRouter: () => { push: (path: string) => Promise<void> };
declare const apiClient: { forms: { createSubmission: { mutateAsync: (args: unknown) => Promise<{ submissionId: string }> } } };
declare const SchemaParser: { safeParse: (data: unknown) => { success: boolean; data?: { locale?: string; externalRef?: string; features?: Record<string, boolean> } } };
declare const uploadFile: (opts: { arrayBuffer: () => Promise<ArrayBuffer>; name: string; type: string }) => Promise<{ id: string }>;
declare const StepWizard: (props: { currentStep: number; setCurrentStep: (n: number) => void; children: unknown }) => JSX.Element;
declare const FormConfigView: (props: { defaultValues?: unknown; onSubmit: (data: TFormConfigSchema) => void }) => JSX.Element;
declare const FieldLayoutView: (props: { configData: TFormConfigSchema; defaultValues?: unknown; onBack: (data: TFieldLayoutSchema) => void; onSubmit: (data: TFieldLayoutSchema) => Promise<void> }) => JSX.Element;
declare const FormConfigProvider: (props: { locale: string; features: Record<string, boolean>; children: unknown }) => JSX.Element;

type TFormConfigSchema = {
  title: string;
  formData?: { data: { buffer: ArrayBuffer }; name: string; type: string } | null;
  meta: {
    externalRef?: string;
    allowDraw?: boolean;
    allowType?: boolean;
    allowUpload?: boolean;
  };
  recipients: Array<{ name: string; email: string; role: string }>;
};

type TFieldLayoutSchema = {
  fields: Array<{
    recipientEmail: string;
    pageX: number;
    pageY: number;
    pageWidth: number;
    pageHeight: number;
    [key: string]: unknown;
  }>;
};

export default function FormSubmissionCreatePage() {
  const { t } = useLocale();
  const { show: notify } = useNotify();
  const router = useRouter();

  const [formConfig, setFormConfig] = useState<TFormConfigSchema>(null);
  const [fieldLayout, setFieldLayout] = useState<TFieldLayoutSchema>(null);
  const [features, setFeatures] = useState<Record<string, boolean>>(null);
  const [externalRef, setExternalRef] = useState<string>(null);
  const [currentStep, setCurrentStep] = useState<number>(1);

  const { mutateAsync: createSubmission } = apiClient.forms.createSubmission;

  const handleFormConfigSubmit = (data: TFormConfigSchema) => {
    setFormConfig(data);
    setCurrentStep(2);
  };

  const handleBackToFormConfig = (data: TFieldLayoutSchema) => {
    setFieldLayout(data);
    setCurrentStep(1);
  };

  const handleFieldLayoutSubmit = async (data: TFieldLayoutSchema) => {
    try {
      if (!formConfig || !formConfig.formData) {
        notify({
          variant: 'destructive',
          title: t('Error'),
          description: t('Please complete form configuration before placing fields'),
        });
        return;
      }

      const { fields } = data;

      const uploadedFile = await uploadFile({
        arrayBuffer: async () => Promise.resolve(formConfig.formData!.data.buffer),
        name: formConfig.formData.name,
        type: formConfig.formData.type,
      });

      const resolvedRef = externalRef || formConfig.meta.externalRef;

      const createResult = await createSubmission({
        title: formConfig.title,
        fileId: uploadedFile.id,
        externalRef: resolvedRef,
        meta: {
          ...formConfig.meta,
          allowDraw: formConfig.meta.allowDraw ?? true,
          allowType: formConfig.meta.allowType ?? true,
          allowUpload: formConfig.meta.allowUpload ?? true,
        },
        recipients: formConfig.recipients.map((recipient) => ({
          name: recipient.name,
          email: recipient.email,
          role: recipient.role,
          fields: fields
            .filter((field) => field.recipientEmail === recipient.email)
            .map((f) => ({
              ...f,
              pageX: f.pageX,
              pageY: f.pageY,
              width: f.pageWidth,
              height: f.pageHeight,
            })),
        })),
      });

      notify({
        title: t('Success'),
        description: t('Form submission created successfully'),
      });

      if (window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'submission-created',
            submissionId: createResult.submissionId,
            externalRef: resolvedRef,
          },
          '*',
        );
      }

      const hash = window.location.hash.slice(1);

      await router.push(
        `/embed/v1/forms/completed/create?submissionId=${createResult.submissionId}&externalRef=${resolvedRef}#${hash}`,
      );
    } catch (err) {
      console.error('Error creating form submission:', err);

      notify({
        variant: 'destructive',
        title: t('Error'),
        description: t('Failed to create form submission'),
      });
    }
  };

  useLayoutEffect(() => {
    try {
      const hash = window.location.hash.slice(1);
      const result = SchemaParser.safeParse(JSON.parse(decodeURIComponent(atob(hash))));

      if (!result.success) {
        return;
      }

      if (result.data!.features) {
        setFeatures(result.data!.features!);
      }

      if (result.data!.externalRef) {
        setExternalRef(result.data!.externalRef!);
      }
    } catch (err) {
      console.error('Error parsing embed params:', err);
    }
  }, []);

  return (
    <div className="relative mx-auto flex min-h-screen max-w-screen-lg p-6">
      <FormConfigProvider locale="en" features={features ?? {}}>
        <StepWizard currentStep={currentStep} setCurrentStep={setCurrentStep}>
          <FormConfigView defaultValues={formConfig ?? undefined} onSubmit={handleFormConfigSubmit} />
          <FieldLayoutView
            configData={formConfig!}
            defaultValues={fieldLayout ?? undefined}
            onBack={handleBackToFormConfig}
            onSubmit={handleFieldLayoutSubmit}
          />
        </StepWizard>
      </FormConfigProvider>
    </div>
  );
}




// --- too-many-lines shape: React TSX component with JSX markup and hooks inflating line count ---
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useForm<T>(opts: { resolver: unknown; values: T }): {
  handleSubmit: (fn: (data: T) => void) => (e: unknown) => void;
  control: unknown;
  formState: { isSubmitting: boolean };
};
declare function zodResolver(schema: unknown): unknown;
declare const ZEditNotificationFormSchema: unknown;
declare function useMutation<T, R>(opts: { mutationFn: (data: T) => Promise<R> }): {
  mutateAsync: (data: T) => Promise<R>;
};
declare function useToast(): { toast: (opts: { title: string; description: string; duration?: number; variant?: string }) => void };
declare function Dialog(props: { open: boolean; onOpenChange: (v: boolean) => void; children: unknown }): JSX.Element;
declare function DialogTrigger(props: { onClick?: (e: unknown) => void; asChild?: boolean; children: unknown }): JSX.Element;
declare function DialogContent(props: { className?: string; children: unknown }): JSX.Element;
declare function DialogHeader(props: { children: unknown }): JSX.Element;
declare function DialogTitle(props: { children: unknown }): JSX.Element;
declare function DialogDescription(props: { children: unknown }): JSX.Element;
declare function DialogFooter(props: { children: unknown }): JSX.Element;
declare function DialogClose(props: { asChild?: boolean; children: unknown }): JSX.Element;
declare function Form(props: { children: unknown; [k: string]: unknown }): JSX.Element;
declare function FormField(props: { control: unknown; name: string; render: (args: { field: unknown }) => JSX.Element }): JSX.Element;
declare function FormItem(props: { className?: string; children: unknown }): JSX.Element;
declare function FormLabel(props: { required?: boolean; children: unknown }): JSX.Element;
declare function FormControl(props: { children: unknown }): JSX.Element;
declare function FormDescription(props: { children: unknown }): JSX.Element;
declare function FormMessage(props?: {}): JSX.Element;
declare function Input(props: { className?: string; [k: string]: unknown }): JSX.Element;
declare function Switch(props: { className?: string; checked: boolean; onCheckedChange: (v: boolean) => void }): JSX.Element;
declare function Button(props: { type?: string; variant?: string; loading?: boolean; children: unknown }): JSX.Element;
declare function MultiSelectCombobox(props: { listValues: string[]; onChange: (values: string[]) => void }): JSX.Element;

type TNotificationEditForm = {
  endpointUrl: string;
  eventTypes: string[];
  signingSecret: string;
  active: boolean;
};

type NotificationRecord = {
  id: string;
  endpointUrl: string;
  eventTypes: string[];
  signingSecret: string | null;
  active: boolean;
};

export type NotificationEditDialogProps = {
  trigger?: unknown;
  notification: NotificationRecord;
};

export const NotificationEditDialog = ({ trigger, notification }: NotificationEditDialogProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { mutateAsync: updateNotification } = useMutation<TNotificationEditForm, void>({
    mutationFn: async (data) => {
      await saveNotificationEndpoint({ id: notification.id, ...data });
    },
  });

  const form = useForm<TNotificationEditForm>({
    resolver: zodResolver(ZEditNotificationFormSchema),
    values: {
      endpointUrl: notification.endpointUrl ?? '',
      eventTypes: notification.eventTypes ?? [],
      signingSecret: notification.signingSecret ?? '',
      active: notification.active ?? true,
    },
  });

  const onSubmit = async (data: TNotificationEditForm) => {
    try {
      await updateNotification(data);
      toast({
        title: 'Notification endpoint updated',
        description: 'Your notification endpoint has been saved successfully.',
        duration: 5000,
      });
    } catch (err) {
      toast({
        title: 'Failed to update endpoint',
        description: 'An error occurred while saving the notification endpoint. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !form.formState.isSubmitting && setOpen(value)}>
      <DialogTrigger onClick={(e: unknown) => (e as MouseEvent).stopPropagation()} asChild>
        {trigger as JSX.Element}
      </DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Notification Endpoint</DialogTitle>
          <DialogDescription>{notification.id}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <fieldset className="flex h-full flex-col gap-y-6" disabled={form.formState.isSubmitting}>
              <div className="flex flex-col-reverse gap-4 md:flex-row">
                <FormField
                  control={form.control}
                  name="endpointUrl"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel required>Endpoint URL</FormLabel>
                      <FormControl>
                        <Input className="bg-background" {...(field as object)} />
                      </FormControl>
                      <FormDescription>
                        The URL where notification events will be delivered.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Active</FormLabel>
                      <div>
                        <FormControl>
                          <Switch
                            className="bg-background"
                            checked={(field as { value: boolean }).value}
                            onCheckedChange={(field as { onChange: (v: boolean) => void }).onChange}
                          />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="eventTypes"
                render={({ field: { onChange, value } }) => (
                  <FormItem className="flex flex-col gap-2">
                    <FormLabel required>Event Types</FormLabel>
                    <FormControl>
                      <MultiSelectCombobox
                        listValues={value as string[]}
                        onChange={(values: string[]) => {
                          (onChange as (v: string[]) => void)(values);
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      Select the event types that will trigger a notification to your endpoint.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="signingSecret"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Signing Secret</FormLabel>
                    <FormControl>
                      <Input
                        className="bg-background"
                        {...(field as object)}
                        value={(field as { value: string }).value ?? ''}
                      />
                    </FormControl>
                    <FormDescription>
                      An optional secret used to verify that incoming requests originated from this service.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary">Close</Button>
                </DialogClose>
                <Button type="submit" loading={form.formState.isSubmitting}>
                  Update
                </Button>
              </DialogFooter>
            </fieldset>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

declare function saveNotificationEndpoint(opts: { id: string } & TNotificationEditForm): Promise<void>;



declare function useCurrentWorkspace(): { id: string; slug: string; name: string };
declare function useLocale(): { t: (s: TemplateStringsArray) => string };
declare const trpc: { workspace: { emailDomain: { get: { useQuery: (args: any, opts?: any) => { data: any; isLoading: boolean } } } } };
declare function generateDomainRecords(selector: string, publicKey: string): Array<{ type: string; name: string; value: string }>;
declare function isFeatureEnabled(flag: string): boolean;
declare function useMemo<T>(factory: () => T, deps: any[]): T;
declare const React: { createElement: Function };

declare function DropdownMenu(props: any): JSX.Element;
declare function DropdownMenuTrigger(props: any): JSX.Element;
declare function DropdownMenuContent(props: any): JSX.Element;
declare function DropdownMenuLabel(props: any): JSX.Element;
declare function DropdownMenuItem(props: any): JSX.Element;
declare function DataTable(props: any): JSX.Element;
declare function SpinnerBox(props: any): JSX.Element;
declare function Alert(props: any): JSX.Element;
declare function AlertTitle(props: any): JSX.Element;
declare function AlertDescription(props: any): JSX.Element;
declare function Button(props: any): JSX.Element;
declare function PageHeader(props: any): JSX.Element;
declare function Link(props: any): JSX.Element;
declare function EditIcon(props: any): JSX.Element;
declare function TrashIcon(props: any): JSX.Element;
declare function MoreHorizontalIcon(props: any): JSX.Element;
declare function WorkspaceEmailCreateDialog(props: any): JSX.Element;
declare function WorkspaceEmailDeleteDialog(props: any): JSX.Element;
declare function WorkspaceEmailUpdateDialog(props: any): JSX.Element;
declare function WorkspaceDomainDeleteDialog(props: any): JSX.Element;
declare function WorkspaceDomainRecordsDialog(props: any): JSX.Element;
declare function ErrorLayout(props: any): JSX.Element;

type RouteProps = { params: { id: string; workspaceSlug: string } };
type ColumnDef<T> = { header: string; accessorKey?: string; cell?: (ctx: { row: { original: T } }) => JSX.Element };

export default function WorkspaceEmailDomainSettingsPage({ params }: RouteProps) {
  const { t } = useLocale();
  const workspace = useCurrentWorkspace();
  const domainId = params.id;

  const { data: domain, isLoading: isLoadingDomain } = trpc.workspace.emailDomain.get.useQuery(
    { domainId },
    { enabled: !!domainId },
  );

  const emailColumns = useMemo(() => {
    return [
      {
        header: t`Name`,
        accessorKey: 'displayName',
      },
      {
        header: t`Address`,
        accessorKey: 'address',
      },
      {
        header: t`Actions`,
        cell: ({ row }: { row: { original: any } }) => (
          <DropdownMenu>
            <DropdownMenuTrigger>
              <MoreHorizontalIcon className="h-5 w-5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-52" align="start" forceMount>
              <DropdownMenuLabel>
                Actions
              </DropdownMenuLabel>
              <WorkspaceEmailUpdateDialog
                email={row.original}
                trigger={
                  <DropdownMenuItem onSelect={(e: Event) => e.preventDefault()}>
                    <EditIcon className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                }
              />
              <WorkspaceEmailDeleteDialog
                emailId={row.original.id}
                address={row.original.address}
                trigger={
                  <DropdownMenuItem onSelect={(e: Event) => e.preventDefault()}>
                    <TrashIcon className="mr-2 h-4 w-4" />
                    Remove
                  </DropdownMenuItem>
                }
              />
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ] as ColumnDef<any>[];
  }, [workspace]);

  if (!isFeatureEnabled('email-domains')) {
    return null;
  }

  if (isLoadingDomain) {
    return <SpinnerBox className="py-32" />;
  }

  if (!domain) {
    return (
      <ErrorLayout
        errorCode={404}
        errorCodeMap={{
          404: {
            heading: 'Email domain not found',
            subHeading: '404 Email domain not found',
            message: 'The email domain you are looking for may have been removed or never existed.',
          },
        }}
        primaryButton={
          <Button asChild>
            <Link to={`/w/${workspace.slug}/settings/email-domains`}>
              Go back
            </Link>
          </Button>
        }
        secondaryButton={null}
      />
    );
  }

  const dnsRecords = generateDomainRecords(domain.selector, domain.publicKey);

  return (
    <div>
      <PageHeader title={t`Email Domain Settings`} subtitle={t`Manage your workspace email domain.`}>
        <WorkspaceEmailCreateDialog domain={domain} />
      </PageHeader>

      <div className="mt-4">
        <label className="font-medium text-sm leading-none">
          Emails
        </label>
        <div className="my-2">
          <DataTable columns={emailColumns} data={domain.emails} />
        </div>
      </div>

      <Alert className="mt-6 flex flex-col justify-between p-6 sm:flex-row sm:items-center" variant="neutral">
        <div className="mb-4 sm:mb-0">
          <AlertTitle>DNS Records</AlertTitle>
          <AlertDescription className="mr-2">
            View the DNS records required for this email domain
          </AlertDescription>
        </div>
        <WorkspaceDomainRecordsDialog
          records={dnsRecords}
          trigger={
            <Button variant="outline">
              View DNS Records
            </Button>
          }
        />
      </Alert>

      <Alert className="mt-6 flex flex-col justify-between p-6 sm:flex-row sm:items-center" variant="neutral">
        <div className="mb-4 sm:mb-0">
          <AlertTitle>Delete email domain</AlertTitle>
          <AlertDescription className="mr-2">
            This will remove all emails associated with this domain
          </AlertDescription>
        </div>
        <WorkspaceDomainDeleteDialog
          domainId={domainId}
          domainName={domain.domain}
          trigger={
            <Button variant="destructive" title={t`Delete domain`}>
              Delete Email Domain
            </Button>
          }
        />
      </Alert>
    </div>
  );
}



declare const cn: (...args: string[]) => string;
declare const NotificationEvents: {
  RecipientAcknowledged: string;
  RecipientInvited: string;
  RecipientRemoved: string;
  TaskCompleted: string;
  TaskCancelled: string;
  TaskAssigned: string;
  OwnerTaskCompleted: string;
  OwnerTaskCreated: string;
  OwnerRecipientExpired: string;
};
declare function Checkbox(props: {
  id: string;
  className: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}): JSX.Element;
declare function Tooltip(props: { children: React.ReactNode }): JSX.Element;
declare function TooltipTrigger(props: { children: React.ReactNode }): JSX.Element;
declare function TooltipContent(props: { className: string; children: React.ReactNode }): JSX.Element;
declare function InfoIcon(props: { className: string }): JSX.Element;

type NotificationSettings = {
  recipientAcknowledged: boolean;
  recipientInvited: boolean;
  recipientRemoved: boolean;
  taskCompleted: boolean;
  taskCancelled: boolean;
  taskAssigned: boolean;
  ownerTaskCompleted: boolean;
  ownerTaskCreated: boolean;
  ownerRecipientExpired: boolean;
};

type NotificationSettingsCheckboxesProps = {
  value: NotificationSettings;
  onChange: (value: NotificationSettings) => void;
  className?: string;
};

export const NotificationSettingsCheckboxes = ({ value, onChange, className }: NotificationSettingsCheckboxesProps) => {
  return (
    <div className={cn('space-y-3', className ?? '')}>
      <div className="flex flex-row items-center">
        <Checkbox
          id={NotificationEvents.RecipientAcknowledged}
          className="h-5 w-5"
          checked={value.recipientAcknowledged}
          onCheckedChange={(checked) =>
            onChange({ ...value, [NotificationEvents.RecipientAcknowledged]: Boolean(checked) })
          }
        />
        <label
          className="ml-2 flex flex-row items-center text-muted-foreground text-sm"
          htmlFor={NotificationEvents.RecipientAcknowledged}
        >
          Email the owner when a recipient acknowledges
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon className="mx-2 h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent className="max-w-md space-y-2 p-4 text-foreground">
              <h2><strong>Recipient acknowledged email</strong></h2>
              <p>This email is sent to the task owner when a recipient has acknowledged the task.</p>
            </TooltipContent>
          </Tooltip>
        </label>
      </div>

      <div className="flex flex-row items-center">
        <Checkbox
          id={NotificationEvents.RecipientInvited}
          className="h-5 w-5"
          checked={value.recipientInvited}
          onCheckedChange={(checked) =>
            onChange({ ...value, [NotificationEvents.RecipientInvited]: Boolean(checked) })
          }
        />
        <label
          className="ml-2 flex flex-row items-center text-muted-foreground text-sm"
          htmlFor={NotificationEvents.RecipientInvited}
        >
          Email recipients with an invitation
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon className="mx-2 h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent className="max-w-md space-y-2 p-4 text-foreground">
              <h2><strong>Recipient invitation email</strong></h2>
              <p>This email is sent to the recipient requesting them to participate in the task.</p>
            </TooltipContent>
          </Tooltip>
        </label>
      </div>

      <div className="flex flex-row items-center">
        <Checkbox
          id={NotificationEvents.RecipientRemoved}
          className="h-5 w-5"
          checked={value.recipientRemoved}
          onCheckedChange={(checked) =>
            onChange({ ...value, [NotificationEvents.RecipientRemoved]: Boolean(checked) })
          }
        />
        <label
          className="ml-2 flex flex-row items-center text-muted-foreground text-sm"
          htmlFor={NotificationEvents.RecipientRemoved}
        >
          Email recipients when they are removed from a pending task
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon className="mx-2 h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent className="max-w-md space-y-2 p-4 text-foreground">
              <h2><strong>Recipient removed email</strong></h2>
              <p>This email is sent to the recipient if they are removed from a pending task.</p>
            </TooltipContent>
          </Tooltip>
        </label>
      </div>

      <div className="flex flex-row items-center">
        <Checkbox
          id={NotificationEvents.TaskCompleted}
          className="h-5 w-5"
          checked={value.taskCompleted}
          onCheckedChange={(checked) =>
            onChange({ ...value, [NotificationEvents.TaskCompleted]: Boolean(checked) })
          }
        />
        <label
          className="ml-2 flex flex-row items-center text-muted-foreground text-sm"
          htmlFor={NotificationEvents.TaskCompleted}
        >
          Email recipients when the task is completed
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon className="mx-2 h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent className="max-w-md space-y-2 p-4 text-foreground">
              <h2><strong>Task completed email</strong></h2>
              <p>This will be sent to all recipients once the task has been fully completed.</p>
            </TooltipContent>
          </Tooltip>
        </label>
      </div>

      <div className="flex flex-row items-center">
        <Checkbox
          id={NotificationEvents.TaskCancelled}
          className="h-5 w-5"
          checked={value.taskCancelled}
          onCheckedChange={(checked) =>
            onChange({ ...value, [NotificationEvents.TaskCancelled]: Boolean(checked) })
          }
        />
        <label
          className="ml-2 flex flex-row items-center text-muted-foreground text-sm"
          htmlFor={NotificationEvents.TaskCancelled}
        >
          Email recipients when a pending task is cancelled
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon className="mx-2 h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent className="max-w-md space-y-2 p-4 text-foreground">
              <h2><strong>Task cancelled email</strong></h2>
              <p>This will be sent to all recipients if a pending task has been cancelled.</p>
            </TooltipContent>
          </Tooltip>
        </label>
      </div>

      <div className="flex flex-row items-center">
        <Checkbox
          id={NotificationEvents.TaskAssigned}
          className="h-5 w-5"
          checked={value.taskAssigned}
          onCheckedChange={(checked) =>
            onChange({ ...value, [NotificationEvents.TaskAssigned]: Boolean(checked) })
          }
        />
        <label
          className="ml-2 flex flex-row items-center text-muted-foreground text-sm"
          htmlFor={NotificationEvents.TaskAssigned}
        >
          Email recipient when they are assigned to a task
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon className="mx-2 h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent className="max-w-md space-y-2 p-4 text-foreground">
              <h2><strong>Task assigned email</strong></h2>
              <p>This email is sent to the recipient when they are assigned to a new task.</p>
            </TooltipContent>
          </Tooltip>
        </label>
      </div>

      <div className="flex flex-row items-center">
        <Checkbox
          id={NotificationEvents.OwnerTaskCompleted}
          className="h-5 w-5"
          checked={value.ownerTaskCompleted}
          onCheckedChange={(checked) =>
            onChange({ ...value, [NotificationEvents.OwnerTaskCompleted]: Boolean(checked) })
          }
        />
        <label
          className="ml-2 flex flex-row items-center text-muted-foreground text-sm"
          htmlFor={NotificationEvents.OwnerTaskCompleted}
        >
          Email the owner when the task is completed
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon className="mx-2 h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent className="max-w-md space-y-2 p-4 text-foreground">
              <h2><strong>Owner task completed email</strong></h2>
              <p>This will be sent to the task owner once the task has been fully completed.</p>
            </TooltipContent>
          </Tooltip>
        </label>
      </div>

      <div className="flex flex-row items-center">
        <Checkbox
          id={NotificationEvents.OwnerTaskCreated}
          className="h-5 w-5"
          checked={value.ownerTaskCreated}
          onCheckedChange={(checked) =>
            onChange({ ...value, [NotificationEvents.OwnerTaskCreated]: Boolean(checked) })
          }
        />
        <label
          className="ml-2 flex flex-row items-center text-muted-foreground text-sm"
          htmlFor={NotificationEvents.OwnerTaskCreated}
        >
          Email the owner when a task is created from a direct template
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon className="mx-2 h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent className="max-w-md space-y-2 p-4 text-foreground">
              <h2><strong>Task created from template email</strong></h2>
              <p>This email is sent to the task owner when a recipient creates a task via a direct template link.</p>
            </TooltipContent>
          </Tooltip>
        </label>
      </div>

      <div className="flex flex-row items-center">
        <Checkbox
          id={NotificationEvents.OwnerRecipientExpired}
          className="h-5 w-5"
          checked={value.ownerRecipientExpired}
          onCheckedChange={(checked) =>
            onChange({ ...value, [NotificationEvents.OwnerRecipientExpired]: Boolean(checked) })
          }
        />
        <label
          className="ml-2 flex flex-row items-center text-muted-foreground text-sm"
          htmlFor={NotificationEvents.OwnerRecipientExpired}
        >
          Send recipient expired notification to the owner
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon className="mx-2 h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent className="max-w-md space-y-2 p-4 text-foreground">
              <h2><strong>Recipient expired email</strong></h2>
              <p>This will be sent to the task owner when a recipient's participation window has expired.</p>
            </TooltipContent>
          </Tooltip>
        </label>
      </div>
    </div>
  );
};



// React custom hook - line count inflated by type definitions and return boilerplate
declare const useState: any;
declare const navigator: any;

export type StoredValue = string | null;
export type StoreFn = (_data: StoreValue, _format?: string) => Promise<boolean>;

type StoreValue = Promise<string> | string;

export function useLocalStorage(): [StoredValue, StoreFn] {
  const [storedData, setStoredData] = useState<StoredValue>(null);

  const store: StoreFn = async (data, format = "application/json") => {
    if (!window?.localStorage) {
      console.warn("LocalStorage not supported");
      return false;
    }

    const isStorageApiSupported = Boolean(typeof Storage && window.localStorage.setItem);

    // Try to save to storage then update state if successful
    try {
      isStorageApiSupported ? await handleStorageApiSave(data, format) : await handleDirectSave(data);

      setStoredData(await data);
      return true;
    } catch (error) {
      console.warn("Save failed", error);
      setStoredData(null);
      return false;
    }
  };

  /**
   * Handle saving values to localStorage using the Storage API.
   *
   * Works in all modern browsers with storage support.
   *
   * https://developer.mozilla.org/en-US/docs/Web/API/Storage
   */
  const handleStorageApiSave = async (value: StoreValue, format = "application/json") => {
    try {
      await window.localStorage.setItem("data", JSON.stringify({ value, format }));
    } catch (e) {
      // Fallback attempt.
      await handleDirectSave(value);
    }
  };

  /**
   * Handle saving values directly to localStorage.
   *
   * Simplified fallback for legacy environments.
   */
  const handleDirectSave = async (value: StoreValue) => {
    await window.localStorage.setItem("data", await value);
  };

  return [storedData, store];
}



declare function useState<T>(initial: T | (() => T)): [T, (v: T) => void];
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare function useForm<T = unknown>(opts?: { resolver?: unknown; defaultValues?: Partial<T> }): { control: unknown; handleSubmit: (fn: (v: T) => void) => (e?: unknown) => void; reset: (v?: Partial<T>) => void; formState: { isSubmitting: boolean; errors: Record<string, unknown> } };
declare function zodResolver(schema: unknown): unknown;
declare const z: { object: (s: Record<string, unknown>) => unknown; string: () => { min: (n: number, opts?: { message: string }) => ReturnType<typeof z.string>; max: (n: number, opts?: { message: string }) => ReturnType<typeof z.string> } };
declare function useNotification(): { show: (opts: { title: string; description?: string; variant?: string; duration?: number }) => void };
declare const WorkflowStatusIcon: (props: { selected: boolean; className?: string }) => JSX.Element;
declare const EmptyIcon: (props: { className?: string }) => JSX.Element;

declare const Modal: (props: { open: boolean; onOpenChange: (v: boolean) => void; children?: React.ReactNode; [k: string]: unknown }) => JSX.Element;
declare const ModalTrigger: (props: { asChild?: boolean; children?: React.ReactNode }) => JSX.Element;
declare const ModalContent: (props: { className?: string; children?: React.ReactNode }) => JSX.Element;
declare const ModalHeader: (props: { children?: React.ReactNode }) => JSX.Element;
declare const ModalTitle: (props: { children?: React.ReactNode }) => JSX.Element;
declare const ModalDescription: (props: { children?: React.ReactNode }) => JSX.Element;
declare const ModalFooter: (props: { children?: React.ReactNode }) => JSX.Element;
declare const ModalClose: (props: { asChild?: boolean; children?: React.ReactNode }) => JSX.Element;
declare const DataTable: (props: { overflowHidden?: boolean; children?: React.ReactNode }) => JSX.Element;
declare const DataTableHeader: (props: { children?: React.ReactNode }) => JSX.Element;
declare const DataTableBody: (props: { children?: React.ReactNode }) => JSX.Element;
declare const DataTableRow: (props: { className?: string; key?: unknown; onClick?: () => void; children?: React.ReactNode }) => JSX.Element;
declare const DataTableCell: (props: { colSpan?: number; className?: string; children?: React.ReactNode }) => JSX.Element;
declare const DataTableHead: (props: { children?: React.ReactNode }) => JSX.Element;
declare const FormRoot: (props: { children?: React.ReactNode; [k: string]: unknown }) => JSX.Element;
declare const FormField: (props: { control: unknown; name: string; render: (args: { field: { value: string; [k: string]: unknown } }) => JSX.Element }) => JSX.Element;
declare const FormItem: (props: { children?: React.ReactNode }) => JSX.Element;
declare const FormLabel: (props: { required?: boolean; children?: React.ReactNode }) => JSX.Element;
declare const FormControl: (props: { children?: React.ReactNode }) => JSX.Element;
declare const FormMessage: (props?: {}) => JSX.Element;
declare const TextInput: (props: { placeholder?: string; className?: string; [k: string]: unknown }) => JSX.Element;
declare const TextArea: (props: { placeholder?: string; className?: string; [k: string]: unknown }) => JSX.Element;
declare const ActionButton: (props: { type?: string; variant?: string; disabled?: boolean; loading?: boolean; className?: string; onClick?: () => void; children?: React.ReactNode }) => JSX.Element;
declare const FadeTransition: (props: { motionKey: string; children?: React.ReactNode }) => JSX.Element;

const MAX_WORKFLOW_NAME_LENGTH = 120;
const MAX_WORKFLOW_DESC_LENGTH = 300;

type WorkflowStep = 'SELECT' | 'CONFIGURE' | 'CONFIRM_REMOVE';

export type ManageWorkflowTemplateDialogProps = {
  templates: Array<{ id: number; name: string; description: string | null; publicName: string | null; publicDescription: string | null; isPublic: boolean; createdAt: Date }>;
  initialTemplateId?: number | null;
  initialStep?: WorkflowStep;
  trigger?: React.ReactNode;
  isOpen?: boolean;
  onIsOpenChange?: (value: boolean) => void;
};

const ZWorkflowFormSchema = z.object({
  publicName: z.string().min(1, { message: 'Name is required' }).max(MAX_WORKFLOW_NAME_LENGTH, { message: `Name cannot exceed ${MAX_WORKFLOW_NAME_LENGTH} characters` }),
  publicDescription: z.string().min(1, { message: 'Description is required' }).max(MAX_WORKFLOW_DESC_LENGTH, { message: `Description cannot exceed ${MAX_WORKFLOW_DESC_LENGTH} characters` }),
});

type TWorkflowFormSchema = { publicName: string; publicDescription: string };

export const ManageWorkflowTemplateDialog = ({
  templates,
  trigger,
  initialTemplateId = null,
  initialStep = 'SELECT',
  isOpen = false,
  onIsOpenChange,
}: ManageWorkflowTemplateDialogProps) => {
  const { show: notify } = useNotification();

  const [open, setOpen] = useState(isOpen);
  const [selectedId, setSelectedId] = useState<number | null>(initialTemplateId);
  const [currentStep, setCurrentStep] = useState<WorkflowStep>(() => {
    if (initialStep) return initialStep;
    return selectedId ? 'CONFIGURE' : 'SELECT';
  });

  const form = useForm<TWorkflowFormSchema>({
    resolver: zodResolver(ZWorkflowFormSchema),
    defaultValues: { publicName: '', publicDescription: '' },
  });

  const isSubmitting = form.formState.isSubmitting;

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedId),
    [templates, selectedId],
  );

  const onConfigureStep = () => {
    if (!selectedTemplate) return;
    form.reset({
      publicName: selectedTemplate.publicName ?? '',
      publicDescription: selectedTemplate.publicDescription ?? '',
    });
    setCurrentStep('CONFIGURE');
  };

  const removeFromPublic = async (templateId: number) => {
    try {
      // simulate async call
      await Promise.resolve(templateId);
      notify({ title: 'Template removed from public profile.', duration: 5000 });
      handleOpenChange(false);
    } catch {
      notify({ title: 'Failed to remove template.', variant: 'destructive' });
    }
  };

  const onFormSubmit = async ({ publicName, publicDescription }: TWorkflowFormSchema) => {
    if (!selectedId) return;
    try {
      await Promise.resolve({ selectedId, publicName, publicDescription });
      notify({ title: 'Template updated successfully.', duration: 5000 });
      setOpen(false);
    } catch {
      notify({ title: 'Failed to update template.', variant: 'destructive' });
    }
  };

  useEffect(() => {
    const match = templates.find((t) => t.id === initialTemplateId);
    if (match) {
      setSelectedId(match.id);
      form.reset({ publicName: match.publicName ?? '', publicDescription: match.publicDescription ?? '' });
    } else {
      setSelectedId(null);
    }
    const step = initialStep || (selectedId ? 'CONFIGURE' : 'SELECT');
    setCurrentStep(step);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTemplateId, initialStep, open, isOpen]);

  const handleOpenChange = (value: boolean) => {
    if (isSubmitting || typeof value !== 'boolean') return;
    setOpen(value);
    onIsOpenChange?.(value);
  };

  const remainingNameChars = MAX_WORKFLOW_NAME_LENGTH - ((form as unknown as { getValues: () => TWorkflowFormSchema }).getValues?.()?.publicName ?? '').length;
  const remainingDescChars = MAX_WORKFLOW_DESC_LENGTH - ((form as unknown as { getValues: () => TWorkflowFormSchema }).getValues?.()?.publicDescription ?? '').length;

  return (
    <Modal open={isOpen || open} onOpenChange={handleOpenChange}>
      <fieldset disabled={isSubmitting} className="relative flex-shrink-0">
        <ModalTrigger asChild>{trigger}</ModalTrigger>

        <FadeTransition motionKey={currentStep}>
          {currentStep === 'SELECT' && (
            <ModalContent>
              <ModalHeader>
                <ModalTitle>Select a workflow template</ModalTitle>
                <ModalDescription>
                  Choose a template to display on your public profile page.
                </ModalDescription>
              </ModalHeader>

              <div className="custom-scrollbar max-h-[60vh] overflow-y-auto rounded-md border">
                <DataTable overflowHidden>
                  <DataTableHeader>
                    <DataTableRow>
                      <DataTableHead>Template</DataTableHead>
                      <DataTableHead>Created</DataTableHead>
                      <DataTableHead></DataTableHead>
                    </DataTableRow>
                  </DataTableHeader>
                  <DataTableBody>
                    {templates.length === 0 && (
                      <DataTableRow>
                        <DataTableCell colSpan={3} className="h-16 text-center">
                          <p className="text-muted-foreground">No workflow templates found.</p>
                        </DataTableCell>
                      </DataTableRow>
                    )}
                    {templates.map((row) => (
                      <DataTableRow
                        className="w-full cursor-pointer"
                        key={row.id}
                        onClick={() => setSelectedId(row.id)}
                      >
                        <DataTableCell className="max-w-[30ch] text-muted-foreground text-sm">{row.name}</DataTableCell>
                        <DataTableCell className="text-muted-foreground text-sm">{row.createdAt.toLocaleDateString()}</DataTableCell>
                        <DataTableCell>
                          {selectedId === row.id ? (
                            <WorkflowStatusIcon selected={true} className="h-5 w-5 text-neutral-600 dark:text-neutral-200" />
                          ) : (
                            <EmptyIcon className="h-5 w-5 text-neutral-300 dark:text-neutral-600" />
                          )}
                        </DataTableCell>
                      </DataTableRow>
                    ))}
                  </DataTableBody>
                </DataTable>
              </div>

              <ModalFooter>
                <ModalClose asChild>
                  <ActionButton type="button" variant="secondary">Cancel</ActionButton>
                </ModalClose>
                <ActionButton type="button" disabled={selectedId === null} onClick={() => onConfigureStep()}>
                  Continue
                </ActionButton>
              </ModalFooter>
            </ModalContent>
          )}

          {currentStep === 'CONFIGURE' && selectedTemplate && (
            <ModalContent className="relative">
              <ModalHeader>
                <ModalTitle>Configure template</ModalTitle>
                <ModalDescription>Set the public-facing details for this workflow template.</ModalDescription>
              </ModalHeader>

              <FormRoot {...form}>
                <form
                  className="flex h-full flex-col space-y-4"
                  onSubmit={form.handleSubmit(onFormSubmit)}
                >
                  <FormField
                    control={form.control}
                    name="publicName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>Public name</FormLabel>
                        <FormControl>
                          <TextInput
                            placeholder="The public name shown on your profile"
                            {...field}
                          />
                        </FormControl>
                        {remainingNameChars >= 0 ? (
                          <p className="text-muted-foreground text-sm">{remainingNameChars} characters remaining</p>
                        ) : (
                          <p className="text-destructive text-sm">{Math.abs(remainingNameChars)} characters over the limit</p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="publicDescription"
                    render={({ field }) => {
                      const remDesc = MAX_WORKFLOW_DESC_LENGTH - (field.value || '').length;
                      return (
                        <FormItem>
                          <FormLabel required>Public description</FormLabel>
                          <FormControl>
                            <TextArea
                              placeholder="A short description displayed alongside this template"
                              {...field}
                            />
                          </FormControl>
                          {!form.formState.errors.publicDescription && (
                            <p className="text-muted-foreground text-sm">
                              {remDesc >= 0
                                ? `${remDesc} characters remaining`
                                : `${Math.abs(remDesc)} characters over the limit`}
                            </p>
                          )}
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />

                  <ModalFooter>
                    {selectedTemplate.isPublic && (
                      <ActionButton
                        variant="destructive"
                        className="mr-auto w-full sm:w-auto"
                        onClick={() => setCurrentStep('CONFIRM_REMOVE')}
                      >
                        Remove from profile
                      </ActionButton>
                    )}
                    <ModalClose asChild>
                      <ActionButton variant="secondary">Close</ActionButton>
                    </ModalClose>
                    <ActionButton type="submit" loading={isSubmitting}>
                      Save changes
                    </ActionButton>
                  </ModalFooter>
                </form>
              </FormRoot>
            </ModalContent>
          )}

          {currentStep === 'CONFIRM_REMOVE' && selectedTemplate && (
            <ModalContent className="relative">
              <ModalHeader>
                <ModalTitle>Remove from public profile?</ModalTitle>
                <ModalDescription>
                  This template will no longer appear on your public profile page.
                  You can re-enable it at any time.
                </ModalDescription>
              </ModalHeader>
              <ModalFooter>
                <ModalClose asChild>
                  <ActionButton type="button" variant="secondary">Cancel</ActionButton>
                </ModalClose>
                <ActionButton
                  type="button"
                  variant="destructive"
                  onClick={() => removeFromPublic(selectedTemplate.id)}
                >
                  Yes, remove it
                </ActionButton>
              </ModalFooter>
            </ModalContent>
          )}
        </FadeTransition>
      </fieldset>
    </Modal>
  );
};



declare function useCurrentWorkspace(): { id: string; name: string };
declare function useCurrentProject(): { id: string; teamId: string };
declare function useNotify(): { toast: (opts: { title: string; description?: string; variant?: string; duration?: number }) => void };
declare function useMutation(opts: { onSuccess?: () => void; onError?: () => void }): { mutateAsync: (args: unknown) => Promise<void>; isPending: boolean };
declare function useQuery(args: unknown): { data?: { items: Array<{ id: string }> }; isPending: boolean };
declare const Dialog: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogTrigger: (props: { asChild?: boolean; children: React.ReactNode }) => JSX.Element;
declare const DialogContent: (props: { position?: string; children: React.ReactNode }) => JSX.Element;
declare const DialogHeader: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogDescription: (props: { className?: string; children: React.ReactNode }) => JSX.Element;
declare const DialogFooter: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogClose: (props: { asChild?: boolean; children: React.ReactNode }) => JSX.Element;
declare const Button: (props: { type?: string; variant?: string; disabled?: boolean; loading?: boolean; onClick?: () => void; children: React.ReactNode }) => JSX.Element;
declare const WorkspaceMemberRole: { MEMBER: string; ADMIN: string };
declare const ProjectGroupType: { INTERNAL: string };

export const ProjectMemberAccessEnableDialog = () => {
  const workspace = useCurrentWorkspace();
  const project = useCurrentProject();
  const { toast } = useNotify();

  const { mutateAsync: createProjectGroups, isPending } = useMutation({
    onSuccess: () => {
      toast({
        title: 'Access enabled',
        duration: 5000,
      });
    },
    onError: () => {
      toast({
        title: 'Something went wrong',
        description: 'We encountered an unknown error while attempting to enable access.',
        variant: 'destructive',
        duration: 5000,
      });
    },
  });

  const workspaceGroupQuery = useQuery({
    workspaceId: workspace.id,
    perPage: 1,
    types: [ProjectGroupType.INTERNAL],
    roles: [WorkspaceMemberRole.MEMBER],
  });

  const enableAccess = async () => {
    if (!workspaceGroupQuery.data?.items[0]?.id) {
      return;
    }

    await createProjectGroups({
      projectId: project.id,
      groups: [
        {
          workspaceGroupId: workspaceGroupQuery.data?.items[0]?.id,
          projectRole: WorkspaceMemberRole.MEMBER,
        },
      ],
    });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          Enable access
        </Button>
      </DialogTrigger>

      <DialogContent position="center">
        <DialogHeader>
          <DialogTitle>
            Are you sure?
          </DialogTitle>

          <DialogDescription className="mt-4">
            You are about to give all workspace members access to this project under their workspace role.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>

          <Button
            type="submit"
            disabled={workspaceGroupQuery.isPending}
            loading={isPending}
            onClick={enableAccess}
          >
            Enable
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};



declare function useSearchParams(): [URLSearchParams];
declare function useCurrentUser(): { id: string; preferences: { aiEnabled: boolean } };
declare function useRef<T>(init: T | null): { current: T | null };
declare function useCurrentFormEditor(): { form: FormState; editorFields: EditorFields; navigateToStep: (step: string) => void; editorConfig: EditorConfig };
declare function useCurrentFormRender(): { currentFormItem: FormItem | null };
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare function useEffect(fn: () => void, deps: unknown[]): void;
declare function useRevalidator(): { revalidate: () => Promise<void> };
declare function getFormItemPermissions(form: FormState, recipients: Recipient[]): { canFileBeChanged: boolean };
declare function isDeepEqual(a: unknown, b: unknown): boolean;
declare function structuredClone<T>(v: T): T;
declare function cn(...args: unknown[]): string;
declare const FIELD_DEFAULT_VALUES: Record<string, FieldMeta>;
declare const RecipientRole: { SIGNER: string; APPROVER: string };
declare function canRecipientFieldsBeModified(r: Recipient, fields: Field[]): boolean;

interface FormState { id: string; recipients: Recipient[]; fields: Field[] }
interface Recipient { id: string; role: string }
interface Field { id: string; formId: string; type: string; fieldMeta: FieldMeta }
interface FieldMeta { [key: string]: unknown }
interface FormItem { id: string }
interface EditorConfig { formItems: { allowReplace: boolean; allowConfigureTitle: boolean } | null }
interface EditorFields {
  localFields: Field[];
  selectedField: Field | null;
  selectedRecipient: Recipient | null;
  updateFieldByFormId: (id: string, patch: Partial<Field>) => void;
  addField: (f: Partial<Field>) => void;
  setSelectedRecipient: (id: string | null) => void;
}

interface NormalizedFieldWithContext {
  height: number;
  width: number;
  positionX: number;
  positionY: number;
  type: string;
  formItemId: string;
  recipientId: string;
  pageNumber: number;
}

export const FormEditorFieldsPage = () => {
  const [searchParams] = useSearchParams();

  const user = useCurrentUser();

  const scrollableContainerRef = useRef<HTMLDivElement>(null);

  const { form, editorFields, navigateToStep, editorConfig } = useCurrentFormEditor();

  const { currentFormItem } = useCurrentFormRender();

  const [isAiFieldDialogOpen, setIsAiFieldDialogOpen] = useState(false);
  const [isAiEnableDialogOpen, setIsAiEnableDialogOpen] = useState(false);
  const { revalidate } = useRevalidator();

  const formItemPermissions = useMemo(
    () => getFormItemPermissions(form, form.recipients),
    [form, form.recipients],
  );

  const selectedField = useMemo(
    () => structuredClone(editorFields.selectedField),
    [editorFields.selectedField],
  );

  const updateSelectedFieldMeta = (fieldMeta: FieldMeta) => {
    if (!selectedField) {
      return;
    }

    const isMetaSame = isDeepEqual(selectedField.fieldMeta, fieldMeta);

    if (!isMetaSame) {
      editorFields.updateFieldByFormId(selectedField.formId, {
        fieldMeta,
      });
    }
  };

  const onFieldDetectionComplete = (fields: NormalizedFieldWithContext[]) => {
    for (const field of fields) {
      editorFields.addField({
        height: field.height,
        width: field.width,
        positionX: field.positionX,
        positionY: field.positionY,
        type: field.type,
        formItemId: field.formItemId,
        recipientId: field.recipientId,
        page: field.pageNumber,
        fieldMeta: structuredClone(FIELD_DEFAULT_VALUES[field.type]),
      });
    }

    setIsAiFieldDialogOpen(false);
  };

  useEffect(() => {
    const firstSelectableRecipient = form.recipients.find(
      (recipient) =>
        recipient.role === RecipientRole.SIGNER || recipient.role === RecipientRole.APPROVER,
    );

    editorFields.setSelectedRecipient(firstSelectableRecipient?.id ?? null);
  }, []);

  const onDetectClick = () => {
    if (!user.preferences.aiEnabled) {
      setIsAiEnableDialogOpen(true);
      return;
    }

    setIsAiFieldDialogOpen(true);
  };

  const onAiFeaturesEnabled = () => {
    void revalidate().then(() => {
      setIsAiEnableDialogOpen(false);
      setIsAiFieldDialogOpen(true);
    });
  };

  return (
    <div className="relative flex h-full">
      <div
        className="flex h-full w-full flex-col overflow-y-auto px-2"
        ref={scrollableContainerRef}
      >
        <div className="form-item-selector px-0">
          {editorConfig.formItems !== null &&
            editorConfig.formItems.allowReplace &&
            formItemPermissions.canFileBeChanged ? (
            <div className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center">
              <div
                className={cn('h-2 w-2 rounded-full transition-opacity duration-150 group-hover:opacity-0', {
                  'bg-green-500': currentFormItem !== null,
                })}
              />
              <button
                className="absolute inset-0 flex cursor-pointer items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="h-3.5 w-3.5">Edit</span>
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex h-full flex-col items-center justify-center">
          {form.recipients.length === 0 && (
            <div className="mb-4 flex max-w-xl flex-row items-center justify-between rounded-sm border bg-background p-4">
              <div className="flex flex-col gap-1">
                <h4 className="font-semibold">Missing Recipients</h4>
                <p className="text-sm text-muted-foreground">
                  You need at least one recipient to add fields
                </p>
              </div>
              <button
                className="rounded border px-3 py-1 text-sm"
                onClick={() => void navigateToStep('upload')}
              >
                Add Recipients
              </button>
            </div>
          )}

          {currentFormItem !== null ? (
            <div className="form-pdf-viewer w-full h-full" />
          ) : (
            <div className="flex flex-col items-center justify-center py-32">
              <span className="h-10 w-10 text-muted-foreground">File</span>
              <p className="mt-1 text-sm text-foreground">No documents found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Please upload a document to continue
              </p>
            </div>
          )}
        </div>
      </div>

      {currentFormItem && form.recipients.length > 0 && (
        <div className="sticky top-0 h-full w-80 flex-shrink-0 overflow-y-auto border-l border-border bg-background py-4">
          <section className="px-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Selected Recipient</h3>
            <div className="w-full">
              {form.recipients.map((r) => (
                <button
                  key={r.id}
                  className="block w-full text-left px-2 py-1 text-sm hover:bg-muted"
                  onClick={() => editorFields.setSelectedRecipient(r.id)}
                >
                  {r.role}
                </button>
              ))}
            </div>

            {editorFields.selectedRecipient &&
              !canRecipientFieldsBeModified(editorFields.selectedRecipient, form.fields) && (
                <div className="mt-4 rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
                  This recipient can no longer be modified as they have signed a field, or completed
                  the document.
                </div>
              )}
          </section>

          <hr className="my-4" />

          <section className="px-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Add Fields</h3>
            <button
              className="mb-2 w-full rounded bg-primary px-3 py-2 text-sm text-primary-foreground"
              onClick={onDetectClick}
            >
              Detect Fields with AI
            </button>
          </section>

          {isAiFieldDialogOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="rounded bg-background p-6 shadow-lg">
                <h2 className="mb-4 text-lg font-semibold">Detect Fields</h2>
                <p className="mb-4 text-sm text-muted-foreground">
                  AI will scan the document and suggest fields for each recipient.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    className="rounded border px-3 py-1 text-sm"
                    onClick={() => setIsAiFieldDialogOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
                    onClick={() => onFieldDetectionComplete([])}
                  >
                    Detect
                  </button>
                </div>
              </div>
            </div>
          )}

          {isAiEnableDialogOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="rounded bg-background p-6 shadow-lg">
                <h2 className="mb-4 text-lg font-semibold">Enable AI Features</h2>
                <p className="mb-4 text-sm text-muted-foreground">
                  Enable AI features to use field detection.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    className="rounded border px-3 py-1 text-sm"
                    onClick={() => setIsAiEnableDialogOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
                    onClick={onAiFeaturesEnabled}
                  >
                    Enable
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};



declare function useLocale(): { locale: string; locales: string[] };
declare function formatDate(date: Date, locale: string): string;
declare const ChevronLeftIcon: (props: { className?: string }) => JSX.Element;
declare const Link: (props: { to: string; className?: string; children: any }) => JSX.Element;
declare const Card: (props: { className?: string; children: any }) => JSX.Element;
declare const StatusBadge: (props: { status: string; className?: string }) => JSX.Element;
declare const AuditLogTable: (props: { contractId: number; userId: number }) => JSX.Element;
declare const DownloadCertificateButton: (props: { contractId: number; status: string; className?: string }) => JSX.Element;
declare const DownloadAuditButton: (props: { contractId: number }) => JSX.Element;

interface Signatory {
  id: number;
  email: string;
  name?: string;
  role: string;
}

interface ContractLoaderData {
  contract: {
    id: number;
    envelopeId: number;
    title: string;
    status: string;
    owner: { name?: string; email: string };
    createdAt: Date;
    updatedAt: Date;
    meta?: { timezone?: string };
  };
  signatories: Signatory[];
  contractRootPath: string;
  userId: number;
}

export default function ContractAuditLogsPage({ loaderData }: { loaderData: ContractLoaderData }) {
  const { contract, signatories, contractRootPath, userId } = loaderData;

  const { locale, locales } = useLocale();

  const contractInformation: { label: string; value: string }[] = [
    {
      label: 'Contract title',
      value: contract.title,
    },
    {
      label: 'Contract ID',
      value: contract.id.toString(),
    },
    {
      label: 'Status',
      value: contract.status,
    },
    {
      label: 'Created by',
      value: contract.owner.name
        ? `${contract.owner.name} (${contract.owner.email})`
        : contract.owner.email,
    },
    {
      label: 'Date created',
      value: formatDate(contract.createdAt, locales?.[0] ?? locale),
    },
    {
      label: 'Last updated',
      value: formatDate(contract.updatedAt, locales?.[0] ?? locale),
    },
    {
      label: 'Time zone',
      value: contract.meta?.timezone ?? 'N/A',
    },
  ];

  const formatSignatoryText = (signatory: Signatory) => {
    let text = signatory.email;

    if (signatory.name) {
      text = `${signatory.name} (${signatory.email})`;
    }

    return `[${signatory.role}] ${text}`;
  };

  return (
    <div className="mx-auto -mt-4 w-full max-w-screen-xl px-4 md:px-8">
      <Link
        to={`${contractRootPath}/${contract.envelopeId}`}
        className="flex items-center text-brand-700 hover:opacity-80"
      >
        <ChevronLeftIcon className="mr-2 inline-block h-5 w-5" />
        Contract
      </Link>

      <div className="flex flex-col">
        <div>
          <h1
            className="mt-4 block max-w-[20rem] truncate font-semibold text-2xl md:max-w-[30rem] md:text-3xl"
            title={contract.title}
          >
            {contract.title}
          </h1>
        </div>
        <div className="mt-1 flex flex-col justify-between sm:flex-row">
          <div className="mt-2.5 flex items-center gap-x-6">
            <StatusBadge status={contract.status} className="text-muted-foreground" />
          </div>
          <div className="mt-4 flex w-full flex-row sm:mt-0 sm:w-auto sm:self-end">
            <DownloadCertificateButton
              className="mr-2"
              contractId={contract.id}
              status={contract.status}
            />
            <DownloadAuditButton contractId={contract.id} />
          </div>
        </div>
      </div>

      <section className="mt-6">
        <Card className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          {contractInformation.map((info, i) => (
            <div className="text-foreground text-sm" key={i}>
              <h3 className="font-semibold">{info.label}</h3>
              <p className="truncate text-muted-foreground">{info.value}</p>
            </div>
          ))}

          <div className="text-foreground text-sm">
            <h3 className="font-semibold">Signatories</h3>
            <ul className="list-inside list-disc text-muted-foreground">
              {signatories.map((signatory) => (
                <li key={`signatory-${signatory.id}`}>
                  <span>{formatSignatoryText(signatory)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </section>

      <section className="mt-6">
        <AuditLogTable contractId={contract.id} userId={userId} />
      </section>
    </div>
  );
}



declare function useFormEditor(): { form: any; formFields: { localFields: any[]; updateFieldByFormId: (id: string, updates: any) => void }; getParticipantColorKey: (id: number) => string };
declare function useCurrentFormRender(): { currentFormItem: any; setRenderError: (v: boolean) => void };
declare function usePageCanvas(onCreate: (stage: any, layer: any) => void, pageData: any): { stage: any; pageLayer: any; canvasContainer: any; scaledViewport: { width: number; height: number }; unscaledViewport: { width: number; height: number } };
declare function renderFormField(opts: any): { fieldGroup: any };
declare function canParticipantFieldsBeModified(participant: any, fields: any[]): boolean;
declare function createInteractiveTransformer(stage: any, layer: any): any;
declare function removePendingField(): void;
declare function getI18nFieldLabels(locale: any): Record<string, string>;
declare const React: { useEffect: any; useMemo: any; useRef: any; useState: any };
const { useEffect, useMemo, useRef, useState } = React;

export const FormPageFieldRenderer = ({ pageData }: { pageData: { scale: number; pageNumber: number } }) => {
  const { form, formFields, getParticipantColorKey } = useFormEditor();
  const { currentFormItem, setRenderError } = useCurrentFormRender();

  const interactiveTransformer = useRef<any>(null);

  const [selectedFieldGroups, setSelectedFieldGroups] = useState<any[]>([]);
  const [isFieldChanging, setIsFieldChanging] = useState(false);
  const [pendingFieldRect, setPendingFieldRect] = useState<any>(null);

  const { stage, pageLayer, canvasContainer, scaledViewport, unscaledViewport } = usePageCanvas(
    (stage: any, layer: any) => initCanvas(stage, layer),
    pageData,
  );

  const { scale, pageNumber } = pageData;

  const localPageFields = useMemo(
    () =>
      formFields.localFields.filter(
        (field: any) => field.page === pageNumber && field.formItemId === currentFormItem?.id,
      ),
    [formFields.localFields, pageNumber, currentFormItem?.id],
  );

  const setSelectedFields = (groups: any[]) => {
    setSelectedFieldGroups(groups);
    if (interactiveTransformer.current) {
      interactiveTransformer.current.nodes(groups);
    }
  };

  const handleResizeOrMove = (event: any) => {
    const isDragEvent = event.type === 'dragend';
    const fieldGroup = event.target;
    const fieldFormId = fieldGroup.id();

    const {
      width: fieldPixelWidth,
      height: fieldPixelHeight,
      x: fieldX,
      y: fieldY,
    } = fieldGroup.getClientRect({ skipStroke: true, skipShadow: true });

    const pageHeight = scaledViewport.height;
    const pageWidth = scaledViewport.width;

    const positionPercentX = (fieldX / pageWidth) * 100;
    const positionPercentY = (fieldY / pageHeight) * 100;
    const fieldPageWidth = (fieldPixelWidth / pageWidth) * 100;
    const fieldPageHeight = (fieldPixelHeight / pageHeight) * 100;

    const fieldUpdates: any = {
      positionX: positionPercentX,
      positionY: positionPercentY,
    };

    if (!isDragEvent) {
      fieldUpdates.width = fieldPageWidth;
      fieldUpdates.height = fieldPageHeight;
    }

    formFields.updateFieldByFormId(fieldFormId, fieldUpdates);

    if (isDragEvent && interactiveTransformer.current?.nodes().length === 0) {
      setSelectedFields([fieldGroup]);
    }

    pageLayer.current?.batchDraw();
  };

  const unsafeRenderFieldOnLayer = (field: any) => {
    if (!pageLayer.current) {
      return;
    }

    const participant = form.participants.find((p: any) => p.id === field.participantId);
    const isEditable = participant !== undefined && canParticipantFieldsBeModified(participant, form.fields);

    const { fieldGroup } = renderFormField({
      scale,
      pageLayer: pageLayer.current,
      field: {
        renderId: field.formId,
        ...field,
        customText: '',
        inserted: false,
        fieldMeta: field.fieldMeta,
      },
      labels: getI18nFieldLabels(null),
      pageWidth: unscaledViewport.width,
      pageHeight: unscaledViewport.height,
      color: getParticipantColorKey(field.participantId),
      editable: isEditable,
      mode: 'edit',
    });

    if (!isEditable) {
      return;
    }

    fieldGroup.off('click');
    fieldGroup.off('transformend');
    fieldGroup.off('dragend');

    fieldGroup.on('click', () => {
      removePendingField();
      setSelectedFields([fieldGroup]);
      pageLayer.current?.batchDraw();
    });

    fieldGroup.on('transformend', handleResizeOrMove);
    fieldGroup.on('dragend', handleResizeOrMove);
  };

  const renderFieldOnLayer = (field: any) => {
    try {
      unsafeRenderFieldOnLayer(field);
    } catch (err) {
      console.error(err);
      setRenderError(true);
    }
  };

  const initCanvas = (currentStage: any, currentPageLayer: any) => {
    interactiveTransformer.current = createInteractiveTransformer(currentStage, currentPageLayer);

    for (const field of localPageFields) {
      renderFieldOnLayer(field);
    }

    currentStage.on('mousedown', (e: any) => {
      removePendingField();
      if (e.target === stage.current) {
        setSelectedFields([]);
        currentPageLayer.batchDraw();
      }
    });

    const onDragStartOrEnd = (e: any) => {
      removePendingField();
      if (!e.target.hasName('field-group')) {
        return;
      }
      setIsFieldChanging(e.type === 'dragstart');
    };

    currentStage.on('dragstart', onDragStartOrEnd);
    currentStage.on('dragend', onDragStartOrEnd);
  };

  useEffect(() => {
    if (!stage.current || !pageLayer.current) {
      return;
    }
    pageLayer.current.destroyChildren();
    initCanvas(stage.current, pageLayer.current);
    pageLayer.current.batchDraw();
  }, [localPageFields, scale]);

  return (
    <div className="relative" ref={canvasContainer}>
      {isFieldChanging && (
        <div className="pointer-events-none absolute inset-0 z-10" />
      )}
      {pendingFieldRect && (
        <div className="absolute z-20 rounded border-2 border-dashed border-blue-500" />
      )}
      {selectedFieldGroups.length > 0 && (
        <div className="absolute bottom-2 right-2 z-30 flex gap-2">
          <button type="button" className="rounded bg-white p-1 shadow" onClick={() => setSelectedFields([])}>
            Deselect
          </button>
        </div>
      )}
    </div>
  );
};



// --- too-many-lines FP fixture: large React dialog component with hooks + JSX ---

declare function useState<T>(initial: T): [T, (v: T) => void];
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;
declare const useToast: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const useCurrentWorkspace: () => { slug: string; planName: string };
declare const useLinkLimits: () => { quota: { shareLinks: number }; remaining: { shareLinks: number } };
declare const useCopyToClipboard: () => [boolean, (text: string) => Promise<void>];
declare const useRevalidator: () => { revalidate: () => void };
declare const apiClient: {
  shareable: {
    createShareableLink: {
      useMutation: (opts: { onSuccess: (data: { token: string; enabled: boolean }) => void; onError: () => void }) => { mutateAsync: (args: unknown) => Promise<{ token: string; enabled: boolean }>; isPending: boolean; reset: () => void };
    };
    toggleShareableLink: {
      useMutation: (opts: { onSuccess: (data: { enabled: boolean }) => void; onError: () => void }) => { mutateAsync: (args: unknown) => Promise<{ enabled: boolean }>; isPending: boolean };
    };
    deleteShareableLink: {
      useMutation: (opts: { onSuccess: () => void; onError: () => void }) => { mutateAsync: (args: unknown) => Promise<void>; isPending: boolean };
    };
  };
};
declare function formatSharePath(token: string): string;
declare const RecipientRole: { CC: string; VIEWER: string };
declare const P: { nullish: unique symbol };
declare const match: (val: unknown) => {
  with: (pattern: unknown, fn: () => JSX.Element) => { with: (p2: unknown, fn2: () => JSX.Element) => { with: (p3: unknown, fn3: () => JSX.Element) => { with: (p4: unknown, fn4: () => JSX.Element) => { exhaustive: () => JSX.Element } } } };
};

type ShareLinkStep = 'ONBOARD' | 'SELECT_RECIPIENT' | 'MANAGE' | 'CONFIRM_DELETE';

type RecipientLite = { id: number; name: string; email: string; role: string };

type ShareLinkDialogProps = {
  resourceId: number;
  shareLink?: { token: string; enabled: boolean } | null;
  recipients: RecipientLite[];
  trigger?: React.ReactNode;
  onCreateSuccess?: () => Promise<void> | void;
  onDeleteSuccess?: () => Promise<void> | void;
};

export const ShareLinkDialog = ({
  resourceId,
  shareLink,
  recipients,
  trigger,
  onCreateSuccess,
  onDeleteSuccess,
}: ShareLinkDialogProps) => {
  const { toast } = useToast();
  const { quota, remaining } = useLinkLimits();
  const { revalidate } = useRevalidator();
  const [, copy] = useCopyToClipboard();
  const workspace = useCurrentWorkspace();

  const [open, setOpen] = useState(false);
  const [isEnabled, setIsEnabled] = useState(shareLink?.enabled ?? false);
  const [token, setToken] = useState<string | null>(shareLink?.token ?? null);
  const [selectedRecipientId, setSelectedRecipientId] = useState<number | null>(null);
  const [currentStep, setCurrentStep] = useState<ShareLinkStep>(token ? 'MANAGE' : 'ONBOARD');

  const validRecipients = useMemo(
    () => recipients.filter((r) => r.role !== RecipientRole.CC && r.role !== RecipientRole.VIEWER),
    [recipients],
  );

  const {
    mutateAsync: createLink,
    isPending: isCreatingLink,
    reset: resetCreate,
  } = apiClient.shareable.createShareableLink.useMutation({
    onSuccess: async (data) => {
      revalidate();
      await onCreateSuccess?.();
      setToken(data.token);
      setIsEnabled(data.enabled);
      setCurrentStep('MANAGE');
    },
    onError: () => {
      setSelectedRecipientId(null);
      toast({
        title: 'Something went wrong',
        description: 'Unable to create share link. Please try again later.',
        variant: 'destructive',
      });
    },
  });

  const { mutateAsync: toggleLink, isPending: isTogglingLink } =
    apiClient.shareable.toggleShareableLink.useMutation({
      onSuccess: async (data) => {
        revalidate();
        setIsEnabled(data.enabled);
        toast({
          title: data.enabled ? 'Share link enabled' : 'Share link disabled',
          description: data.enabled
            ? 'Anyone with the link can now access this resource.'
            : 'The link has been disabled.',
        });
      },
      onError: () => {
        toast({
          title: 'Something went wrong',
          description: 'Unable to toggle share link. Please try again later.',
          variant: 'destructive',
        });
      },
    });

  const { mutateAsync: deleteLink, isPending: isDeletingLink } =
    apiClient.shareable.deleteShareableLink.useMutation({
      onSuccess: async () => {
        revalidate();
        await onDeleteSuccess?.();
        setToken(null);
        setIsEnabled(false);
        setCurrentStep('ONBOARD');
        resetCreate();
        setOpen(false);
      },
      onError: () => {
        toast({
          title: 'Something went wrong',
          description: 'Unable to delete share link. Please try again later.',
          variant: 'destructive',
        });
      },
    });

  useEffect(() => {
    if (!open) {
      setCurrentStep(token ? 'MANAGE' : 'ONBOARD');
      setSelectedRecipientId(null);
    }
  }, [open, token]);

  const handleCreateLink = async () => {
    if (selectedRecipientId === null) {
      toast({ title: 'No recipient selected', description: 'Please select a recipient to continue.', variant: 'destructive' });
      return;
    }
    await createLink({ resourceId, recipientId: selectedRecipientId });
  };

  const handleToggleLink = async (checked: boolean) => {
    if (!token) return;
    await toggleLink({ token, enabled: checked });
  };

  const handleDeleteLink = async () => {
    if (!token) return;
    await deleteLink({ token });
  };

  const sharePath = token ? formatSharePath(token) : '';
  const shareUrl = token ? `https://app.example.com${sharePath}` : '';

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        {trigger ?? <span>Share</span>}
      </button>

      {open && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />

          <div className="relative z-10 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
            {match({ token, currentStep })
              .with({ token: P.nullish, currentStep: 'ONBOARD' as ShareLinkStep }, () => (
                <div>
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold">Enable Share Link</h2>
                    <p className="text-sm text-gray-500 mt-1">
                      Allow anyone with a link to access this resource directly.
                    </p>
                  </div>

                  {remaining.shareLinks === 0 && (
                    <div role="alert" className="rounded border border-yellow-300 bg-yellow-50 p-4 mb-4">
                      <p className="font-medium text-yellow-800">Limit reached</p>
                      <p className="text-sm text-yellow-700 mt-1">
                        You have used all {quota.shareLinks} share links on your current plan.{' '}
                        <a href={`/workspaces/${workspace.slug}/settings/billing`} className="underline">
                          Upgrade your plan to continue.
                        </a>
                      </p>
                    </div>
                  )}

                  {remaining.shareLinks !== 0 && (
                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                        onClick={() => setCurrentStep('SELECT_RECIPIENT')}
                      >
                        Enable share link
                      </button>
                    </div>
                  )}
                </div>
              ))
              .with({ token: P.nullish, currentStep: 'SELECT_RECIPIENT' as ShareLinkStep }, () => (
                <div className="relative">
                  {isCreatingLink && validRecipients.length !== 0 && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center rounded bg-white/50 dark:bg-black/50">
                      <span className="h-6 w-6 animate-spin">...</span>
                    </div>
                  )}

                  <div className="mb-4">
                    <h2 className="text-lg font-semibold">Choose Recipient</h2>
                    <p className="text-sm text-gray-500 mt-1">Select an existing recipient to continue.</p>
                  </div>

                  <div className="max-h-60 overflow-y-auto rounded border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50">
                          <th className="px-4 py-2 text-left font-medium">Name</th>
                          <th className="px-4 py-2 text-left font-medium">Email</th>
                          <th className="px-4 py-2 text-left font-medium">Role</th>
                          <th className="px-4 py-2 text-left font-medium">Select</th>
                        </tr>
                      </thead>
                      <tbody>
                        {validRecipients.map((r) => (
                          <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="px-4 py-2">{r.name}</td>
                            <td className="px-4 py-2">{r.email}</td>
                            <td className="px-4 py-2">{r.role}</td>
                            <td className="px-4 py-2">
                              <button
                                type="button"
                                onClick={() => setSelectedRecipientId(r.id)}
                                className="flex h-5 w-5 items-center justify-center rounded-full border"
                              >
                                {selectedRecipientId === r.id ? (
                                  <span className="h-3 w-3 rounded-full bg-blue-600" />
                                ) : (
                                  <span className="h-3 w-3 rounded-full" />
                                )}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 flex justify-between">
                    <button
                      type="button"
                      className="text-sm text-gray-500 hover:text-gray-700"
                      onClick={() => setCurrentStep('ONBOARD')}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      disabled={selectedRecipientId === null || isCreatingLink}
                      onClick={handleCreateLink}
                    >
                      {isCreatingLink ? 'Creating...' : 'Create link'}
                    </button>
                  </div>
                </div>
              ))
              .with({ currentStep: 'MANAGE' as ShareLinkStep }, () => (
                <div>
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold">Manage Share Link</h2>
                    <p className="text-sm text-gray-500 mt-1">Your share link is active. Copy or disable it below.</p>
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium mb-1" htmlFor="share-link-toggle">
                      Link enabled
                    </label>
                    <input
                      id="share-link-toggle"
                      type="checkbox"
                      checked={isEnabled}
                      disabled={isTogglingLink}
                      onChange={(e) => handleToggleLink(e.target.checked)}
                    />
                  </div>

                  {isEnabled && (
                    <div className="mb-4">
                      <label className="block text-sm font-medium mb-1" htmlFor="share-url">
                        Share URL
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="share-url"
                          type="text"
                          readOnly
                          value={shareUrl}
                          className="flex-1 rounded border px-3 py-2 text-sm font-mono"
                        />
                        <button
                          type="button"
                          className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
                          onClick={() => copy(shareUrl)}
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex justify-between">
                    <button
                      type="button"
                      className="text-sm text-red-500 hover:text-red-700"
                      onClick={() => setCurrentStep('CONFIRM_DELETE')}
                    >
                      Delete link
                    </button>
                    <button
                      type="button"
                      className="text-sm text-gray-500 hover:text-gray-700"
                      onClick={() => setOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                </div>
              ))
              .with({ currentStep: 'CONFIRM_DELETE' as ShareLinkStep }, () => (
                <div>
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold text-red-600">Delete Share Link?</h2>
                    <p className="text-sm text-gray-500 mt-1">
                      This will permanently remove the share link. Anyone who had the link will no longer be able to access this resource.
                    </p>
                  </div>

                  <div className="mt-4 flex justify-between">
                    <button
                      type="button"
                      className="text-sm text-gray-500 hover:text-gray-700"
                      onClick={() => setCurrentStep('MANAGE')}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      disabled={isDeletingLink}
                      onClick={handleDeleteLink}
                    >
                      {isDeletingLink ? 'Deleting...' : 'Yes, delete link'}
                    </button>
                  </div>
                </div>
              ))
              .exhaustive()}
          </div>
        </div>
      )}
    </div>
  );
};



// --- opengraph loader (Remix route) ---
// Long async arrow function assigned to an exported const; JSX markup and
// async data fetching inflate line count. This is standard Remix/React
// framework structure and should NOT be flagged by too-many-lines.

declare function fetchFonts(baseUrl: string): Promise<[ArrayBuffer, ArrayBuffer, ArrayBuffer]>;
declare function fetchShareTarget(slug: string): Promise<{ name: string; email: string; signatureImage: string | null } | { error: string }>;
declare function renderToSvg(node: unknown, opts: unknown): Promise<string>;
declare function svgToPngBuffer(svg: string): Promise<Buffer>;

const PREVIEW_CARD_TOP = 173;
const PREVIEW_CARD_LEFT = 307;
const PREVIEW_CARD_W = 590;
const PREVIEW_CARD_H = 337;
const PREVIEW_IMAGE_SIZE = { width: 1200, height: 630 };

export const loader = async ({ params }: { params: { slug: string } }): Promise<Response> => {
  const { slug } = params;

  if (slug.startsWith('qr_')) {
    return new Response('Not found', { status: 404 });
  }

  const baseUrl = 'https://example.com';

  const [boldFont, regularFont, scriptFont] = await fetchFonts(baseUrl);

  const shareTarget = await fetchShareTarget(slug);

  if ('error' in shareTarget) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const { name, email, signatureImage } = shareTarget;
  const displayName = name || email;
  const fontSize = Math.max(Math.min((PREVIEW_CARD_W * 1.5) / displayName.length, 80), 36);

  const svg = await renderToSvg(
    <div
      style={{
        display: 'flex',
        height: '100%',
        width: '100%',
        backgroundColor: 'white',
        position: 'relative',
      }}
    >
      <img
        src={`${baseUrl}/static/preview-frame.png`}
        alt="preview-frame"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
        }}
      />

      {signatureImage ? (
        <div
          style={{
            position: 'absolute',
            padding: '24px 48px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            top: PREVIEW_CARD_TOP,
            left: PREVIEW_CARD_LEFT,
            width: PREVIEW_CARD_W,
            height: PREVIEW_CARD_H,
          }}
        >
          <img
            src={signatureImage}
            alt="signature"
            style={{
              opacity: 0.6,
              height: '100%',
              maxWidth: '100%',
            }}
          />
        </div>
      ) : (
        <p
          style={{
            position: 'absolute',
            padding: '24px 48px',
            marginTop: '-8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            color: '#64748b',
            fontFamily: 'Script',
            fontSize,
            top: PREVIEW_CARD_TOP,
            left: PREVIEW_CARD_LEFT,
            width: PREVIEW_CARD_W,
            height: PREVIEW_CARD_H,
          }}
        >
          {displayName}
        </p>
      )}

      <div
        style={{
          position: 'absolute',
          display: 'flex',
          width: '100%',
          top: PREVIEW_CARD_TOP - 78,
          left: PREVIEW_CARD_LEFT,
        }}
      >
        <h2
          style={{
            fontSize: '20px',
            color: '#828282',
            fontFamily: 'Sans',
            fontWeight: 700,
          }}
        >
          Document Shared
        </h2>
      </div>
    </div>,
    {
      width: PREVIEW_IMAGE_SIZE.width,
      height: PREVIEW_IMAGE_SIZE.height,
      fonts: [
        { name: 'Script', data: scriptFont, weight: 400, style: 'italic' },
        { name: 'Sans', data: regularFont, weight: 400, style: 'normal' },
        { name: 'Sans', data: boldFont, weight: 600, style: 'normal' },
      ],
    },
  );

  const pngBuffer = await svgToPngBuffer(svg);

  return new Response(pngBuffer, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': pngBuffer.length.toString(),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });
};



// React component with hooks and canvas manipulation - framework structure inflates line count
declare const useRef: <T>(initial: T) => { current: T };
declare const useEffect: (effect: () => void, deps: unknown[]) => void;
declare const useState: <T>(initial: T) => [T, (val: T) => void];

interface ChartVisualizerProps {
  className?: string;
  dataPoints: number[];
  width?: number;
  height?: number;
}

export const ChartVisualizer = ({ className, dataPoints, width = 800, height = 600 }: ChartVisualizerProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const calculateBezierPath = () => {
    if (!canvasRef.current || dataPoints.length < 2) {
      return;
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

    const canvasWidth = canvasRef.current.width;
    const canvasHeight = canvasRef.current.height;
    const padding = 40;

    const maxValue = Math.max(...dataPoints);
    const minValue = Math.min(...dataPoints);
    const valueRange = maxValue - minValue || 1;

    const xStep = (canvasWidth - 2 * padding) / (dataPoints.length - 1);

    ctx.beginPath();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;

    dataPoints.forEach((point, index) => {
      const x = padding + index * xStep;
      const y = canvasHeight - padding - ((point - minValue) / valueRange) * (canvasHeight - 2 * padding);

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        const prevX = padding + (index - 1) * xStep;
        const prevY = canvasHeight - padding - ((dataPoints[index - 1] - minValue) / valueRange) * (canvasHeight - 2 * padding);
        
        const cpX1 = prevX + xStep / 3;
        const cpY1 = prevY;
        const cpX2 = x - xStep / 3;
        const cpY2 = y;
        
        ctx.bezierCurveTo(cpX1, cpY1, cpX2, cpY2, x, y);
      }
    });

    ctx.stroke();
  };

  const renderGridLines = () => {
    if (!canvasRef.current) {
      return;
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) {
      return;
    }

    const canvasWidth = canvasRef.current.width;
    const canvasHeight = canvasRef.current.height;
    const padding = 40;

    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 5; i++) {
      const y = padding + (i * (canvasHeight - 2 * padding)) / 5;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(canvasWidth - padding, y);
      ctx.stroke();
    }

    for (let i = 0; i < dataPoints.length; i++) {
      const xStep = (canvasWidth - 2 * padding) / (dataPoints.length - 1);
      const x = padding + i * xStep;
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, canvasHeight - padding);
      ctx.stroke();
    }
  };

  useEffect(() => {
    if (canvasRef.current) {
      const dpr = window.devicePixelRatio || 1;
      canvasRef.current.width = (width || canvasRef.current.clientWidth) * dpr;
      canvasRef.current.height = (height || canvasRef.current.clientHeight) * dpr;
      
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
    }
  }, [width, height]);

  useEffect(() => {
    renderGridLines();
    calculateBezierPath();
  }, [dataPoints]);

  useEffect(() => {
    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        className="w-full h-full rounded-lg shadow-md"
        style={{ 
          touchAction: 'none',
          maxWidth: width ? `${width}px` : undefined,
          maxHeight: height ? `${height}px` : undefined
        }}
      />
    </div>
  );
};


declare const React: typeof import('react');
declare function cn(...classes: (string | undefined | null | false)[]): string;

const loadImageFromFile = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };
    img.src = objectUrl;
  });

const drawImageOnCanvas = (
  image: HTMLImageElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): ImageData => {
  const scale = Math.min(
    (canvas.width * 0.8) / image.width,
    (canvas.height * 0.8) / image.height,
  );
  const x = (canvas.width - image.width * scale) / 2;
  const y = (canvas.height - image.height * scale) / 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, x, y, image.width * scale, image.height * scale);
  ctx.restore();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
};

type AvatarUploadProps = {
  className?: string;
  disabled?: boolean;
  onUpload: (dataUrl: string) => void;
};

export function AvatarUpload({ className, disabled, onUpload }: AvatarUploadProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Only image files are allowed');
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    try {
      const img = await loadImageFromFile(file);
      drawImageOnCanvas(img, canvas, ctx);
      onUpload(canvas.toDataURL('image/png'));
    } catch {
      setError('Failed to load image');
    }
  };

  return (
    <div
      className={cn(
        'relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors',
        isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) void handleFile(file);
      }}
    >
      <canvas ref={canvasRef} width={300} height={150} className="hidden" />
      <p className="text-muted-foreground text-sm">Drop an image here or click to upload</p>
      {error && <p className="mt-2 text-destructive text-xs">{error}</p>}
    </div>
  );
}


declare function useElementBounds(selector: string): { width: number; height: number; top: number; left: number } | null;
declare function useFieldPageCoords(field: unknown): { x: number; y: number; width: number; height: number };
declare function useIsPageInDom(page: number): boolean;
declare function createPortal(children: React.ReactNode, container: Element): React.ReactPortal;

export type DocumentFieldPortalProps = {
  field: { id: string; page: number; type: string };
  className?: string;
  children: React.ReactNode;
};

export function DocumentFieldPortal({ field, children, className = '' }: DocumentFieldPortalProps) {
  const alternativePortalRoot = document.getElementById('document-field-portal-root');

  const coords = useFieldPageCoords(field);
  const pageBounds = useElementBounds(`[data-page-number="${field.page}"]`);

  const maxWidth = pageBounds?.width ? pageBounds.width - coords.x : undefined;

  const isCheckboxField = field.type === 'CHECKBOX' || field.type === 'RADIO';

  const style = React.useMemo(() => {
    const portalBounds = alternativePortalRoot?.getBoundingClientRect();

    const bounds: Record<string, string> = {
      top: `${coords.y}px`,
      left: `${coords.x}px`,
      ...(!isCheckboxField
        ? { height: `${coords.height}px`, width: `${coords.width}px` }
        : { maxWidth: `${maxWidth}px` }),
    };

    if (portalBounds) {
      bounds.top = `${coords.y - portalBounds.top}px`;
      bounds.left = `${coords.x - portalBounds.left}px`;
    }

    return bounds;
  }, [coords, isCheckboxField, maxWidth, alternativePortalRoot]);

  const isPageInDom = useIsPageInDom(field.page);

  React.useEffect(() => {
    if (!isPageInDom) return;
    // Re-trigger layout recalculation when page enters DOM
  }, [isPageInDom]);

  if (!isPageInDom) return null;

  const portalTarget = alternativePortalRoot ?? document.body;

  return createPortal(
    <div
      className={cn('absolute z-10', className)}
      style={style}
      data-field-id={field.id}
    >
      {children}
    </div>,
    portalTarget,
  );
}


declare const useNavigate: () => (path: string) => Promise<void>;
declare const useCurrentTeam: () => { url: string; id: number };
declare const useToast: () => { toast: (opts: { title: string; description?: string; duration?: number; variant?: string }) => void };
declare const useLingui: () => { t: (s: TemplateStringsArray, ...args: unknown[]) => string };
declare const trpc: { document: { duplicate: { useMutation: (opts: { onSuccess: (data: { id: number }) => void }) => { mutateAsync: (opts: { documentId: number }) => Promise<{ id: number }>; isPending: boolean } } } };
declare function formatDocumentsPath(teamUrl: string): string;

export type DocumentDuplicateDialogProps = {
  documentId: number;
  trigger?: React.ReactNode;
};

export const DocumentDuplicateDialog = ({ documentId, trigger }: DocumentDuplicateDialogProps) => {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const { toast } = useToast();
  const { t } = useLingui();
  const team = useCurrentTeam();

  const { mutateAsync: duplicateDocument, isPending: isDuplicating } =
    trpc.document.duplicate.useMutation({
      onSuccess: async ({ id }) => {
        toast({
          title: t`Document Duplicated`,
          description: t`Your document has been successfully duplicated.`,
          duration: 5000,
        });
        await navigate(`${formatDocumentsPath(team.url)}/${id}/edit`);
        setOpen(false);
      },
    });

  const onDuplicate = async () => {
    try {
      await duplicateDocument({ documentId });
    } catch {
      toast({
        title: t`Something went wrong`,
        description: t`This document could not be duplicated at this time. Please try again.`,
        variant: 'destructive',
      });
    }
  };

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        {trigger ?? t`Duplicate`}
      </button>
      {open && (
        <div role="dialog" aria-modal="true" className="dialog-overlay">
          <div className="dialog-content">
            <h2 className="font-semibold text-lg">{t`Duplicate Document`}</h2>
            <p className="mt-2 text-muted-foreground text-sm">
              {t`Are you sure you want to duplicate this document? A new draft will be created.`}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={isDuplicating}>
                {t`Cancel`}
              </button>
              <button
                type="button"
                onClick={() => void onDuplicate()}
                disabled={isDuplicating}
                className="btn-primary"
              >
                {isDuplicating ? t`Duplicating...` : t`Duplicate`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


declare const useRequiredSigningAuthContext: () => { executeActionAuth: (fn: () => Promise<void>) => Promise<void> };
declare const useNavigate: () => (path: string) => void;
declare const useLingui: () => { t: (s: TemplateStringsArray, ...args: unknown[]) => string };
declare const useToast: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const useMemo: <T>(fn: () => T, deps: unknown[]) => T;
declare const useState: <T>(initial: T) => [T, (v: T | ((prev: T) => T)) => void];

declare const CheckboxSigningField: React.FC<{ field: SignableField; onSign: (v: string) => Promise<void> }>;
declare const TextSigningField: React.FC<{ field: SignableField; onSign: (v: string) => Promise<void> }>;
declare const SignatureSigningField: React.FC<{ field: SignableField; onSign: (v: string) => Promise<void> }>;
declare const DateSigningField: React.FC<{ field: SignableField; onSign: (v: string) => Promise<void> }>;
declare const NumberSigningField: React.FC<{ field: SignableField; onSign: (v: string) => Promise<void> }>;
declare const DropdownSigningField: React.FC<{ field: SignableField; onSign: (v: string) => Promise<void> }>;
declare const PdfViewer: React.FC<{ documentId: number; className?: string }>;
declare const SigningCompleteDialog: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }>;
declare const SigningRejectDialog: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }>;
declare const match: <T>(value: T) => { with: (pattern: unknown, fn: () => unknown) => unknown; exhaustive: () => unknown };

type SignableField = {
  id: number;
  type: 'SIGNATURE' | 'TEXT' | 'CHECKBOX' | 'DATE' | 'NUMBER' | 'DROPDOWN';
  customText: string;
  inserted: boolean;
};

type SigningPageRecipient = { id: number; name: string; email: string; role: string };
type SigningPageDocument = { id: number; title: string; status: string };

export type ContractSigningPageViewProps = {
  recipient: SigningPageRecipient;
  document: SigningPageDocument;
  fields: SignableField[];
  isRecipientsTurn: boolean;
  includeSenderDetails: boolean;
};

export const ContractSigningPageView = ({
  recipient,
  document,
  fields,
  isRecipientsTurn,
  includeSenderDetails,
}: ContractSigningPageViewProps) => {
  const { t } = useLingui();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { executeActionAuth } = useRequiredSigningAuthContext();

  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedFieldIds, setCompletedFieldIds] = useState<number[]>([]);

  const pendingFields = useMemo(
    () => fields.filter((f) => !completedFieldIds.includes(f.id)),
    [fields, completedFieldIds],
  );

  const allFieldsCompleted = pendingFields.length === 0;

  const handleSignField = async (fieldId: number, value: string) => {
    await executeActionAuth(async () => {
      setCompletedFieldIds((prev) => [...prev, fieldId]);
    });
  };

  const handleComplete = async () => {
    if (!allFieldsCompleted) {
      toast({ title: t`Please complete all required fields`, variant: 'destructive' });
      return;
    }
    setIsSubmitting(true);
    try {
      setShowCompleteDialog(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isRecipientsTurn) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-muted-foreground">{t`It's not your turn to sign yet.`}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border px-4 py-3">
        <h1 className="font-semibold text-lg">{document.title}</h1>
        {includeSenderDetails && (
          <p className="text-muted-foreground text-sm">{t`Signing as`} {recipient.email}</p>
        )}
      </header>
      <main className="flex flex-1 overflow-hidden">
        <div className="relative flex-1 overflow-auto">
          <PdfViewer documentId={document.id} />
          {fields.map((field) => (
            <div key={field.id}>
              {field.type === 'SIGNATURE' && <SignatureSigningField field={field} onSign={(v) => handleSignField(field.id, v)} />}
              {field.type === 'TEXT' && <TextSigningField field={field} onSign={(v) => handleSignField(field.id, v)} />}
              {field.type === 'CHECKBOX' && <CheckboxSigningField field={field} onSign={(v) => handleSignField(field.id, v)} />}
              {field.type === 'DATE' && <DateSigningField field={field} onSign={(v) => handleSignField(field.id, v)} />}
              {field.type === 'NUMBER' && <NumberSigningField field={field} onSign={(v) => handleSignField(field.id, v)} />}
              {field.type === 'DROPDOWN' && <DropdownSigningField field={field} onSign={(v) => handleSignField(field.id, v)} />}
            </div>
          ))}
        </div>
        <aside className="w-80 overflow-y-auto border-l border-border p-4">
          <div className="space-y-4">
            <div>
              <h2 className="font-semibold">{t`Fields remaining`}</h2>
              <p className="text-muted-foreground text-sm">{pendingFields.length} {t`of`} {fields.length}</p>
            </div>
            <button
              type="button"
              onClick={() => void handleComplete()}
              disabled={!allFieldsCompleted || isSubmitting}
              className="btn-primary w-full"
            >
              {t`Complete signing`}
            </button>
            <button type="button" onClick={() => setShowRejectDialog(true)} className="btn-ghost w-full">
              {t`Decline to sign`}
            </button>
          </div>
        </aside>
      </main>
      <SigningCompleteDialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog} />
      <SigningRejectDialog open={showRejectDialog} onOpenChange={setShowRejectDialog} />
    </div>
  );
};


// BrandingPreferencesForm — react-tsx FP shape
declare const useCurrentWorkspace: () => { id: string; name: string };
declare const useOptionalCurrentTeam: () => { id: string; slug: string } | null;
declare const useToast: () => { toast: (opts: { title?: string; description?: string; variant?: string }) => void };
declare function useForm<T>(opts: { defaultValues: Partial<T>; resolver: unknown }): {
  watch: (field: keyof T) => unknown;
  control: unknown;
  handleSubmit: (fn: (data: T) => void) => (e: unknown) => void;
  formState: { isSubmitting: boolean; isDirty: boolean };
  reset: (vals?: Partial<T>) => void;
  setValue: (field: keyof T, val: unknown) => void;
};
declare const zodResolver: (schema: unknown) => unknown;
declare const useLingui: () => { t: (s: TemplateStringsArray, ...args: unknown[]) => string };
declare const z: {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => { url: () => unknown; optional: () => unknown; max: (n: number) => unknown };
  boolean: () => { nullable: () => unknown };
  instanceof: (cls: unknown) => { refine: (fn: (v: unknown) => boolean, msg: string) => { refine: (fn: (v: unknown) => boolean, msg: string) => { nullish: () => unknown } } };
  literal: (v: unknown) => unknown;
  infer: unknown;
};
declare const WEBAPP_BASE_URL: () => string;
declare const cn: (...args: unknown[]) => string;

const MAX_LOGO_SIZE = 5 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const ZThemePreferencesSchema = z.object({
  themingEnabled: z.boolean().nullable(),
  logoFile: z
    .instanceof(File)
    .refine((f) => (f as File).size <= MAX_LOGO_SIZE, 'File too large')
    .refine((f) => ALLOWED_LOGO_TYPES.includes((f as File).type), 'Unsupported file type')
    .nullish(),
  websiteUrl: z.string().url().optional(),
  companyTagline: z.string().max(300).optional(),
});

type TThemePreferencesSchema = { themingEnabled: boolean | null; logoFile?: File | null; websiteUrl?: string; companyTagline?: string };

type ThemeSettingsSubset = {
  themingEnabled: boolean | null;
  logoFile: string | null;
  websiteUrl: string | null;
  companyTagline: string | null;
};

type ThemePreferencesFormProps = {
  canInherit?: boolean;
  settings: ThemeSettingsSubset;
  onFormSubmit: (data: TThemePreferencesSchema) => Promise<void>;
  context: 'Team' | 'Workspace';
};

export function ThemePreferencesForm({
  canInherit = false,
  settings,
  onFormSubmit,
  context,
}: ThemePreferencesFormProps) {
  const { t } = useLingui();
  const team = useOptionalCurrentTeam();
  const workspace = useCurrentWorkspace();
  const { toast } = useToast();
  const [previewUrl, setPreviewUrl] = (useState as unknown as <T>(v: T) => [T, (v: T) => void])('');
  const [hasLoadedPreview, setHasLoadedPreview] = (useState as unknown as <T>(v: T) => [T, (v: T) => void])(false);

  const form = useForm<TThemePreferencesSchema>({
    defaultValues: {
      themingEnabled: settings.themingEnabled ?? null,
      websiteUrl: settings.websiteUrl ?? '',
      logoFile: undefined,
      companyTagline: settings.companyTagline ?? '',
    },
    resolver: zodResolver(ZThemePreferencesSchema),
  });

  const isThemingEnabled = form.watch('themingEnabled');

  (useEffect as unknown as (fn: () => void | (() => void), deps: unknown[]) => void)(() => {
    if (settings.logoFile) {
      const parsed = JSON.parse(settings.logoFile);
      if ('type' in parsed && 'data' in parsed) {
        const logoUrl =
          context === 'Team'
            ? `${WEBAPP_BASE_URL()}/api/theming/logo/team/${team?.id}`
            : `${WEBAPP_BASE_URL()}/api/theming/logo/workspace/${workspace.id}`;
        setPreviewUrl(logoUrl);
        setHasLoadedPreview(true);
      }
    }
  }, [settings.logoFile, context, team?.id, workspace.id]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    form.setValue('logoFile', file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setHasLoadedPreview(true);
  };

  const handleSubmit = async (data: TThemePreferencesSchema) => {
    try {
      await onFormSubmit(data);
      toast({ description: t`Theme preferences saved.` });
    } catch {
      toast({
        title: t`Failed to save theme preferences`,
        description: t`An unexpected error occurred.`,
        variant: 'destructive',
      });
    }
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          {hasLoadedPreview && previewUrl && (
            <img src={previewUrl} alt="Logo preview" className="h-12 w-12 rounded object-contain" />
          )}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">{t`Logo`}</label>
            <input
              type="file"
              accept={ALLOWED_LOGO_TYPES.join(',')}
              onChange={handleLogoChange}
              className="text-sm"
            />
          </div>
        </div>

        <div className={cn('space-y-2', !isThemingEnabled && 'opacity-50 pointer-events-none')}>
          <label className="text-sm font-medium">{t`Website URL`}</label>
          <input
            type="url"
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="https://example.com"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{t`Company Tagline`}</label>
          <textarea
            className="w-full rounded border px-3 py-2 text-sm"
            rows={3}
            maxLength={300}
            placeholder={t`Enter a short description...`}
          />
        </div>

        {canInherit && (
          <div className="text-sm text-muted-foreground">
            {t`Inherit branding from the parent organisation when not configured here.`}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => form.reset()}
          className="rounded border px-4 py-2 text-sm"
          disabled={!form.formState.isDirty}
        >
          {t`Discard`}
        </button>
        <button
          type="submit"
          className="rounded bg-primary px-4 py-2 text-sm text-white"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? t`Saving...` : t`Save Changes`}
        </button>
      </div>
    </form>
  );
}


// FolderCreateDialog — react-tsx FP shape
declare const useToast_folderCreate: () => { toast: (opts: { title?: string; description?: string; variant?: string }) => void };
declare const useLingui_folderCreate: () => { t: (s: TemplateStringsArray, ...args: unknown[]) => string };
declare const useParams_folderCreate: () => Record<string, string | undefined>;
declare function useForm_folderCreate<T>(opts: { defaultValues: Partial<T>; resolver: unknown }): {
  control: unknown;
  handleSubmit: (fn: (data: T) => void | Promise<void>) => (e?: unknown) => void;
  formState: { isSubmitting: boolean };
  reset: () => void;
};
declare const zodResolver_folderCreate: (schema: unknown) => unknown;
declare const z_fc: {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => { min: (n: number, opts: { message: string }) => unknown };
  infer: unknown;
};
declare const trpc_folders: {
  folder: { createFolder: { useMutation: () => { mutateAsync: (data: { name: string; parentId?: string | null; type: string }) => Promise<void> } } };
};
declare const useState_fc: <T>(v: T) => [T, (v: T) => void];
declare const useEffect_fc: (fn: () => void | (() => void), deps: unknown[]) => void;

const ZNewFolderSchema = z_fc.object({
  folderName: z_fc.string().min(1, { message: 'Name is required' }),
});
type TNewFolderSchema = { folderName: string };

type NewFolderDialogProps = {
  folderCategory: string;
  defaultParentId?: string | null;
  triggerElement?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const NewFolderDialog = ({
  folderCategory,
  defaultParentId,
  triggerElement,
  open: controlledOpen,
  onOpenChange,
}: NewFolderDialogProps) => {
  const { t } = useLingui_folderCreate();
  const { toast } = useToast_folderCreate();
  const { folderId: routeFolderId } = useParams_folderCreate();

  const resolvedParentId = defaultParentId ?? routeFolderId;

  const [isOpen, setIsOpen] = useState_fc(controlledOpen ?? false);

  const { mutateAsync: createFolder } = trpc_folders.folder.createFolder.useMutation();

  const form = useForm_folderCreate<TNewFolderSchema>({
    resolver: zodResolver_folderCreate(ZNewFolderSchema),
    defaultValues: { folderName: '' },
  });

  const handleOpenChange = (val: boolean) => {
    setIsOpen(val);
    onOpenChange?.(val);
  };

  const onSubmit = async (data: TNewFolderSchema) => {
    try {
      await createFolder({
        name: data.folderName,
        parentId: resolvedParentId,
        type: folderCategory,
      });
      handleOpenChange(false);
      toast({ description: t`Folder created` });
    } catch {
      toast({
        title: t`Error`,
        description: t`Could not create folder.`,
        variant: 'destructive',
      });
    }
  };

  useEffect_fc(() => {
    if (!isOpen) {
      form.reset();
    }
  }, [isOpen, form]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={`fixed inset-0 z-50 flex items-center justify-center ${isOpen ? '' : 'hidden'}`}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
        <h2 className="mb-1 text-lg font-semibold">{t`Create New Folder`}</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {t`Give your folder a descriptive name to keep things organised.`}
        </p>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">{t`Folder Name`}</label>
            <input
              type="text"
              className="rounded border px-3 py-2 text-sm"
              placeholder={t`My Documents`}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded border px-4 py-2 text-sm"
              onClick={() => handleOpenChange(false)}
            >
              {t`Cancel`}
            </button>
            <button
              type="submit"
              className="rounded bg-primary px-4 py-2 text-sm text-white"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? t`Creating...` : t`Create`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};


// ContractSignerForm — react-tsx FP shape
declare const isSignatureType: (type: string) => boolean;
declare const useRequiredContractSigningCtx: () => {
  displayName: string;
  signatureData: string;
  setDisplayName: (v: string) => void;
  setSignatureData: (v: string) => void;
  contract: { id: number };
  signerFields: Array<{ id: number; type: string; inserted: boolean }>;
  signer: { id: number; role: string; name: string };
  helperFields: Array<{ id: number; type: string }>;
  helperRecipients: Array<{ id: number; name: string; fields: unknown[] }>;
  selectedHelperRecipient: { id: number } | null;
  setSelectedHelperRecipientId: (id: number) => void;
};
declare const useEmbedContractCtx: () => { isNameLocked?: boolean; isEmailLocked?: boolean } | null;
declare const useMemo_signerForm: <T>(fn: () => T, deps: unknown[]) => T;
declare const SignerRole_form: { VIEWER: string; ASSISTANT: string; SIGNER: string };

export default function ContractSignerForm() {
  const {
    displayName,
    signatureData,
    setDisplayName,
    setSignatureData,
    contract,
    signerFields,
    signer,
    helperFields,
    helperRecipients,
    selectedHelperRecipient,
    setSelectedHelperRecipientId,
  } = useRequiredContractSigningCtx();

  const { isNameLocked, isEmailLocked } = useEmbedContractCtx() || {};

  const hasSignatureField = useMemo_signerForm(() => {
    return signerFields.some((f) => isSignatureType(f.type));
  }, [signerFields]);

  if (signer.role === SignerRole_form.VIEWER) {
    return null;
  }

  if (signer.role === SignerRole_form.ASSISTANT) {
    return (
      <fieldset className="rounded-2xl border border-border p-3">
        <div className="space-y-2">
          {helperRecipients
            .filter((r) => r.fields.length > 0)
            .map((r) => (
              <div key={r.id} className="relative flex flex-col gap-4 rounded-lg border border-border bg-white p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      id={String(r.id)}
                      name="helperRecipient"
                      value={String(r.id)}
                      checked={selectedHelperRecipient?.id === r.id}
                      onChange={() => setSelectedHelperRecipientId(r.id)}
                      className="after:absolute after:inset-0"
                    />
                    <div>
                      <label htmlFor={String(r.id)} className="text-sm font-medium">
                        {r.name}
                        {r.id === signer.id && (
                          <span className="ml-2 text-muted-foreground">(You)</span>
                        )}
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </fieldset>
    );
  }

  return (
    <fieldset className="space-y-4 rounded-2xl border border-border p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="displayName" className="text-sm font-medium">
          Full Name
        </label>
        <input
          id="displayName"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={!!isNameLocked}
          className="rounded border px-3 py-2 text-sm"
          placeholder="Your full name"
        />
      </div>

      {hasSignatureField && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Signature</label>
          <div className="flex min-h-[80px] items-center justify-center rounded border border-dashed border-border bg-gray-50 p-2 text-sm text-muted-foreground">
            {signatureData ? (
              <img src={signatureData} alt="Signature" className="max-h-16 object-contain" />
            ) : (
              <span>Click to add signature</span>
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}


// ContractEditForm — react-tsx FP shape (multi-step wizard)
declare const useToast_editForm: () => { toast: (opts: { title?: string; description?: string; variant?: string }) => void };
declare const useLingui_editForm: () => { _: (msg: unknown) => string };
declare const useNavigate_editForm: () => (path: string) => void;
declare const useSearchParams_editForm: () => [URLSearchParams, (p: URLSearchParams) => void];
declare const useState_editForm: <T>(v: T) => [T, (v: T) => void];
declare const useEffect_editForm: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useCurrentTeam_editForm: () => { id: number; url: string };
declare const trpc_editForm: {
  contract: {
    get: { useQuery: (opts: { contractId: number }, meta: unknown) => { data: { id: number; title: string; status: string; recipients: unknown[]; fields: unknown[] }; refetch: () => Promise<void> } };
    update: { useMutation: (opts: unknown) => { mutateAsync: (data: unknown) => Promise<{ id: number; title: string }> } };
    send: { useMutation: (opts?: unknown) => { mutateAsync: (data: { contractId: number }) => Promise<void> } };
  };
  useUtils: () => { contract: { get: { setData: (opts: unknown, fn: (prev: unknown) => unknown) => void } } };
};
declare const DO_NOT_INVALIDATE_editForm: unknown;
declare const SKIP_QUERY_BATCH_editForm: unknown;
declare const msg_editForm: (strings: TemplateStringsArray, ...args: unknown[]) => unknown;

type ContractEditStep = 'settings' | 'signers' | 'fields' | 'subject';
const ContractEditSteps: ContractEditStep[] = ['settings', 'signers', 'fields', 'subject'];

type ContractEditFormProps = {
  className?: string;
  initialContract: { id: number; title: string; status: string; recipients: unknown[]; fields: unknown[] };
  contractRootPath: string;
};

export const ContractEditForm = ({ className, initialContract, contractRootPath }: ContractEditFormProps) => {
  const { toast } = useToast_editForm();
  const { _ } = useLingui_editForm();
  const navigate = useNavigate_editForm();
  const [searchParams] = useSearchParams_editForm();
  const team = useCurrentTeam_editForm();
  const [isContractPdfLoaded, setIsContractPdfLoaded] = useState_editForm(false);

  const utils = trpc_editForm.useUtils();

  const { data: contract, refetch: refetchContract } = trpc_editForm.contract.get.useQuery(
    { contractId: initialContract.id },
    SKIP_QUERY_BATCH_editForm as unknown as Parameters<typeof trpc_editForm.contract.get.useQuery>[1],
  );

  const { recipients, fields } = contract;

  const { mutateAsync: updateContract } = trpc_editForm.contract.update.useMutation({
    ...(DO_NOT_INVALIDATE_editForm as object),
    onSuccess: (newData: { id: number; title: string }) => {
      utils.contract.get.setData(
        { contractId: newData.id },
        (prev: unknown) => (prev ? { ...(prev as object), ...newData } : prev),
      );
    },
  });

  const { mutateAsync: sendContract } = trpc_editForm.contract.send.useMutation();

  const currentStep: ContractEditStep = (searchParams.get('step') as ContractEditStep) ?? 'settings';
  const currentStepIndex = ContractEditSteps.indexOf(currentStep);

  const handleGoToStep = (step: ContractEditStep) => {
    const params = new URLSearchParams(searchParams);
    params.set('step', step);
    navigate(`?${params.toString()}`);
  };

  const handleSettingsSubmit = async (data: { title: string }) => {
    try {
      await updateContract({ contractId: contract.id, data });
      handleGoToStep('signers');
    } catch {
      toast({
        title: _(msg_editForm`Error`),
        description: _(msg_editForm`Failed to update contract settings.`),
        variant: 'destructive',
      });
    }
  };

  const handleSendContract = async () => {
    try {
      await sendContract({ contractId: contract.id });
      toast({ description: _(msg_editForm`Contract sent for signing.`) });
      navigate(`${contractRootPath}/${contract.id}`);
    } catch {
      toast({
        title: _(msg_editForm`Send failed`),
        description: _(msg_editForm`An error occurred sending the contract.`),
        variant: 'destructive',
      });
    }
  };

  useEffect_editForm(() => {
    void refetchContract();
  }, [team.id]);

  return (
    <div className={`flex gap-6 ${className ?? ''}`}>
      <div className="hidden w-64 shrink-0 lg:flex lg:flex-col">
        <nav className="space-y-1">
          {ContractEditSteps.map((step, idx) => (
            <button
              key={step}
              onClick={() => idx <= currentStepIndex && handleGoToStep(step)}
              disabled={idx > currentStepIndex}
              className={`w-full rounded px-3 py-2 text-left text-sm ${
                step === currentStep
                  ? 'bg-primary/10 font-semibold text-primary'
                  : idx < currentStepIndex
                  ? 'text-muted-foreground hover:bg-muted'
                  : 'cursor-not-allowed opacity-40'
              }`}
            >
              {step.charAt(0).toUpperCase() + step.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1">
        <div className="rounded-lg border border-border p-4">
          {currentStep === 'settings' && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold">Contract Settings</h2>
              <button
                onClick={() => handleSettingsSubmit({ title: contract.title })}
                className="rounded bg-primary px-4 py-2 text-sm text-white"
              >
                Save &amp; Continue
              </button>
            </div>
          )}
          {currentStep === 'subject' && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold">Confirm &amp; Send</h2>
              <button
                onClick={handleSendContract}
                className="rounded bg-primary px-4 py-2 text-sm text-white"
              >
                Send Contract
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


// ContractSigningDateField — react-tsx FP shape
declare const convertToLocalFormat_dateField: (text: string, format: string | null | undefined, tz: string | null | undefined) => string;
declare const DEFAULT_DATE_FORMAT_dateField: string;
declare const DEFAULT_TIMEZONE_dateField: string;
declare const DO_NOT_INVALIDATE_dateField: unknown;
declare const AppError_dateField: new (code: string, opts?: { message?: string }) => Error;
declare const AppErrorCode_dateField: { UNAUTHORIZED: string; DOCUMENT_NOT_FOUND: string };
declare const ZDateFieldMeta_dateField: { safeParse: (v: unknown) => { success: boolean; data?: { format?: string } } };
declare const trpc_dateField: {
  field: {
    signFieldWithToken: { useMutation: (opts: unknown) => { mutateAsync: (payload: unknown) => Promise<void>; isPending: boolean } };
    removeSignedFieldWithToken: { useMutation: (opts: unknown) => { mutateAsync: (payload: unknown) => Promise<void>; isPending: boolean } };
  };
};
declare const useToast_dateField: () => { toast: (opts: { title?: string; description?: string; variant?: string }) => void };
declare const useLingui_dateField: () => { _: (msg: unknown) => string };
declare const useRevalidator_dateField: () => { revalidate: () => void };
declare const useDocumentSigningRecipientCtx_dateField: () => { recipient: { id: number; token: string }; isHelperMode: boolean };
declare const msg_dateField: (strings: TemplateStringsArray, ...args: unknown[]) => unknown;
declare const cn_dateField: (...args: unknown[]) => string;

type FieldWithSig_dateField = {
  id: number;
  type: string;
  customText: string;
  inserted: boolean;
  fieldMeta: unknown;
};

type DateFieldProps = {
  field: FieldWithSig_dateField;
  dateFormat?: string | null;
  timezone?: string | null;
  onSignField?: (value: unknown) => Promise<void> | void;
  onUnsignField?: (value: unknown) => Promise<void> | void;
};

export const ContractSigningDateField = ({
  field,
  dateFormat = DEFAULT_DATE_FORMAT_dateField,
  timezone = DEFAULT_TIMEZONE_dateField,
  onSignField,
  onUnsignField,
}: DateFieldProps) => {
  const { _ } = useLingui_dateField();
  const { toast } = useToast_dateField();
  const { revalidate } = useRevalidator_dateField();
  const { recipient, isHelperMode } = useDocumentSigningRecipientCtx_dateField();

  const { mutateAsync: signField, isPending: isSignPending } =
    trpc_dateField.field.signFieldWithToken.useMutation(DO_NOT_INVALIDATE_dateField as unknown as Parameters<typeof trpc_dateField.field.signFieldWithToken.useMutation>[0]);
  const { mutateAsync: removeField, isPending: isRemovePending } =
    trpc_dateField.field.removeSignedFieldWithToken.useMutation(DO_NOT_INVALIDATE_dateField as unknown as Parameters<typeof trpc_dateField.field.removeSignedFieldWithToken.useMutation>[0]);

  const isLoading = isSignPending || isRemovePending;

  const safeFieldMeta = ZDateFieldMeta_dateField.safeParse(field.fieldMeta);
  const parsedFieldMeta = safeFieldMeta.success ? safeFieldMeta.data : null;

  const localDateString = convertToLocalFormat_dateField(field.customText, dateFormat, timezone);
  const isDifferentTime = field.inserted && localDateString !== field.customText;
  const tooltipText = _(msg_dateField`"${field.customText}" will appear on the document using timezone "${timezone || ''}"`);

  const onSign = async (authOptions?: unknown) => {
    try {
      const payload = {
        token: recipient.token,
        fieldId: field.id,
        value: dateFormat ?? DEFAULT_DATE_FORMAT_dateField,
        authOptions,
      };
      if (onSignField) {
        await onSignField(payload);
      } else {
        await signField(payload);
        revalidate();
      }
    } catch (err) {
      if (err instanceof Error && err.constructor.name === 'AppError') throw err;
      toast({
        title: _(msg_dateField`An error occurred`),
        description: _(msg_dateField`Failed to sign the date field. Please try again.`),
        variant: 'destructive',
      });
    }
  };

  const onRemove = async () => {
    try {
      const payload = { token: recipient.token, fieldId: field.id };
      if (onUnsignField) {
        await onUnsignField(payload);
      } else {
        await removeField(payload);
        revalidate();
      }
    } catch {
      toast({
        title: _(msg_dateField`Error`),
        description: _(msg_dateField`Failed to remove the date field signature.`),
        variant: 'destructive',
      });
    }
  };

  return (
    <div
      className={cn_dateField(
        'relative flex cursor-pointer items-center justify-center rounded border-2',
        field.inserted ? 'border-primary bg-primary/5' : 'border-dashed border-muted-foreground/40',
        isLoading && 'cursor-wait opacity-60',
      )}
      onClick={() => (field.inserted ? onRemove() : onSign())}
      title={isDifferentTime ? tooltipText : undefined}
    >
      {isLoading ? (
        <span className="animate-spin text-primary">⏳</span>
      ) : field.inserted ? (
        <div className="text-center">
          <span className="block text-xs font-semibold text-primary">{localDateString}</span>
          {isDifferentTime && (
            <span className="block text-[10px] text-muted-foreground">{field.customText}</span>
          )}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">Date</span>
      )}
    </div>
  );
};


// CategoryGrid — react-tsx FP shape with multiple useState, trpc query, conditional rendering
declare const useCurrentTeam_catGrid: () => { id: number; url: string };
declare const useCurrentWorkspace_catGrid: () => { id: string; name: string };
declare const useState_catGrid: <T>(v: T) => [T, (v: T) => void];
declare const trpc_catGrid: {
  category: { getCategories: { useQuery: (opts: { type: string; parentId: string | null }) => { data?: { categories: Array<{ id: string; name: string; pinned: boolean; subCategories: unknown[] }> } | null; isPending: boolean } } };
};
declare const FolderType_catGrid: { DOCUMENT: string; TEMPLATE: string };
declare const formatDocumentsPath_catGrid: (teamUrl: string) => string;
declare const formatTemplatesPath_catGrid: (teamUrl: string) => string;

type CategoryWithSubs = { id: string; name: string; pinned: boolean; subCategories: unknown[] };
type CategoryGridProps = { type: string; parentId: string | null };

export const CategoryGrid = ({ type, parentId }: CategoryGridProps) => {
  const team = useCurrentTeam_catGrid();
  const workspace = useCurrentWorkspace_catGrid();

  const [isMoving, setIsMoving] = useState_catGrid(false);
  const [categoryToMove, setCategoryToMove] = useState_catGrid<CategoryWithSubs | null>(null);
  const [isDeleting, setIsDeleting] = useState_catGrid(false);
  const [categoryToDelete, setCategoryToDelete] = useState_catGrid<CategoryWithSubs | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState_catGrid(false);
  const [categoryForSettings, setCategoryForSettings] = useState_catGrid<CategoryWithSubs | null>(null);

  const { data: categoriesData, isPending } = trpc_catGrid.category.getCategories.useQuery({ type, parentId });

  const formatBreadcrumbPath = (categoryId: string) => {
    const root = type === FolderType_catGrid.DOCUMENT
      ? formatDocumentsPath_catGrid(team.url)
      : formatTemplatesPath_catGrid(team.url);
    return `${root}/c/${categoryId}`;
  };

  const formatViewAllPath = () => {
    const root = type === FolderType_catGrid.DOCUMENT
      ? formatDocumentsPath_catGrid(team.url)
      : formatTemplatesPath_catGrid(team.url);
    return parentId ? `${root}/categories?parentId=${parentId}` : `${root}/categories`;
  };

  const rootPath = type === FolderType_catGrid.DOCUMENT
    ? formatDocumentsPath_catGrid(team.url)
    : formatTemplatesPath_catGrid(team.url);

  const pinned = categoriesData?.categories.filter((c) => c.pinned) ?? [];
  const unpinned = categoriesData?.categories.filter((c) => !c.pinned) ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-1 items-center font-medium text-muted-foreground text-sm">
          <a href={rootPath} className="flex items-center gap-1 hover:opacity-75">
            <span aria-hidden>🏠</span>
            <span>Home</span>
          </a>
          {parentId && (
            <>
              <span className="mx-1">/</span>
              <a href={formatBreadcrumbPath(parentId)} className="hover:opacity-75">
                {categoriesData?.categories[0]?.name ?? parentId}
              </a>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <a href={formatViewAllPath()} className="text-sm text-muted-foreground underline hover:text-foreground">
            View all
          </a>
        </div>
      </div>

      {isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <>
          {pinned.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Pinned</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {pinned.map((cat) => (
                  <div
                    key={cat.id}
                    className="group relative flex flex-col gap-2 rounded-lg border border-border p-4 hover:bg-muted/50"
                  >
                    <a href={formatBreadcrumbPath(cat.id)} className="font-medium text-sm after:absolute after:inset-0">
                      {cat.name}
                    </a>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={(e) => { e.preventDefault(); setCategoryToMove(cat); setIsMoving(true); }}
                        className="rounded p-1 text-xs hover:bg-muted"
                      >
                        Move
                      </button>
                      <button
                        onClick={(e) => { e.preventDefault(); setCategoryForSettings(cat); setIsSettingsOpen(true); }}
                        className="rounded p-1 text-xs hover:bg-muted"
                      >
                        Edit
                      </button>
                      <button
                        onClick={(e) => { e.preventDefault(); setCategoryToDelete(cat); setIsDeleting(true); }}
                        className="rounded p-1 text-xs text-destructive hover:bg-destructive/10"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {unpinned.map((cat) => (
              <div
                key={cat.id}
                className="group relative flex flex-col gap-2 rounded-lg border border-border p-4 hover:bg-muted/50"
              >
                <a href={formatBreadcrumbPath(cat.id)} className="font-medium text-sm after:absolute after:inset-0">
                  {cat.name}
                </a>
              </div>
            ))}
            {unpinned.length === 0 && pinned.length === 0 && (
              <div className="col-span-full rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No categories yet
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};


// ContractEditorSettingsDialog — react-tsx FP shape (large settings form dialog)
declare const useCurrentContractEditor_settings: () => {
  contract: { id: number; title: string; distributionMethod: string; visibility: string; templateType: string; documentMeta: unknown };
  editorConfig: { allowDistributionMethodChange: boolean; allowVisibilityChange: boolean };
};
declare const useCurrentWorkspace_settings: () => { id: string; plan: string };
declare const DATE_FORMATS_settings: Array<{ label: string; value: string }>;
declare const TIME_ZONES_settings: Array<{ label: string; value: string }>;
declare const SUPPORTED_LANGUAGES_settings: Array<{ label: string; value: string }>;
declare const DEFAULT_DATE_FORMAT_settings: string;
declare const DEFAULT_TIMEZONE_settings: string;
declare const AppError_settings: new (code?: string) => Error;
declare const extractDocumentAuthMethods_settings: (meta: unknown) => { globalAccessAuth: string[]; globalActionAuth: string[] };
declare const trpc_settings: {
  contract: { update: { useMutation: (opts: unknown) => { mutateAsync: (data: unknown) => Promise<void>; isPending: boolean } } };
  useUtils: () => { contract: { get: { invalidate: () => void } } };
};
declare const useToast_settings: () => { toast: (opts: { title?: string; description?: string; variant?: string }) => void };
declare const useLingui_settings: () => { t: (s: TemplateStringsArray, ...args: unknown[]) => string; _ : (msg: unknown) => string };
declare const useForm_settings: <T>(opts: { defaultValues: Partial<T>; resolver: unknown }) => {
  control: unknown;
  handleSubmit: (fn: (data: T) => void | Promise<void>) => (e?: unknown) => void;
  formState: { isSubmitting: boolean; isDirty: boolean };
  reset: (vals?: Partial<T>) => void;
  watch: (field: keyof T) => unknown;
};
declare const zodResolver_settings: (schema: unknown) => unknown;
declare const z_settings: { object: (s: Record<string, unknown>) => unknown; string: () => unknown; boolean: () => unknown; array: (s: unknown) => unknown; optional: () => unknown };
declare const useState_settings: <T>(v: T) => [T, (v: T) => void];
declare const useEffect_settings: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useMemo_settings: <T>(fn: () => T, deps: unknown[]) => T;
declare const msg_settings: (strings: TemplateStringsArray, ...args: unknown[]) => unknown;

export const ContractEditorSettingsDialog = () => {
  const { contract, editorConfig } = useCurrentContractEditor_settings();
  const workspace = useCurrentWorkspace_settings();
  const { t, _ } = useLingui_settings();
  const { toast } = useToast_settings();
  const [isOpen, setIsOpen] = useState_settings(false);

  const utils = trpc_settings.useUtils();

  const { mutateAsync: updateContract, isPending } = trpc_settings.contract.update.useMutation({
    onSuccess: () => utils.contract.get.invalidate(),
  } as unknown as Parameters<typeof trpc_settings.contract.update.useMutation>[0]);

  const { globalAccessAuth, globalActionAuth } = useMemo_settings(
    () => extractDocumentAuthMethods_settings(contract.documentMeta),
    [contract.documentMeta],
  );

  const form = useForm_settings<{
    title: string;
    dateFormat: string;
    timezone: string;
    language: string;
    redirectUrl: string;
    globalAccessAuth: string[];
    globalActionAuth: string[];
    emailSettings: unknown;
  }>({
    defaultValues: {
      title: contract.title,
      dateFormat: DEFAULT_DATE_FORMAT_settings,
      timezone: DEFAULT_TIMEZONE_settings,
      language: 'en',
      redirectUrl: '',
      globalAccessAuth,
      globalActionAuth,
    },
    resolver: zodResolver_settings(
      z_settings.object({
        title: z_settings.string(),
        dateFormat: z_settings.string(),
        timezone: z_settings.string(),
        language: z_settings.string(),
        redirectUrl: z_settings.string(),
      }),
    ),
  });

  const handleSubmit = async (data: unknown) => {
    try {
      await updateContract({ contractId: contract.id, data });
      toast({ description: t`Settings saved successfully` });
      setIsOpen(false);
    } catch {
      toast({
        title: t`Failed to save settings`,
        description: t`An error occurred. Please try again.`,
        variant: 'destructive',
      });
    }
  };

  useEffect_settings(() => {
    if (!isOpen) form.reset();
  }, [isOpen, form]);

  return (
    <div>
      <button
        onClick={() => setIsOpen(true)}
        className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
      >
        {t`Settings`}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-2xl rounded-lg bg-background p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t`Contract Settings`}</h2>
              <button onClick={() => setIsOpen(false)} className="text-muted-foreground hover:text-foreground">
                ✕
              </button>
            </div>

            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">{t`Date Format`}</label>
                  <select className="rounded border px-2 py-1.5 text-sm">
                    {DATE_FORMATS_settings.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">{t`Timezone`}</label>
                  <select className="rounded border px-2 py-1.5 text-sm">
                    {TIME_ZONES_settings.map((tz) => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setIsOpen(false)} className="rounded border px-4 py-2 text-sm">
                  {t`Cancel`}
                </button>
                <button
                  type="submit"
                  className="rounded bg-primary px-4 py-2 text-sm text-white"
                  disabled={isPending || !form.formState.isDirty}
                >
                  {isPending ? t`Saving...` : t`Save Settings`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};


// ConfigureContractAdvancedSettings — react-tsx FP shape (embed authoring form section)
declare const DATE_FORMATS_advSettings: Array<{ label: string; value: string }>;
declare const TIME_ZONES_advSettings: Array<{ label: string; value: string }>;
declare const SUPPORTED_LANGUAGES_advSettings: Array<{ label: string; value: string }>;
declare const CONTRACT_SIGNATURE_TYPES_advSettings: Array<{ label: string; value: string }>;
declare const useFormContext_advSettings: <T>() => {
  watch: (field: string) => unknown;
  setValue: (field: string, value: unknown) => void;
  control: unknown;
};
declare const useLingui_advSettings: () => { _: (msg: unknown) => string };
declare const useConfigureContract_advSettings: () => { features: { allowConfigureCommunication: boolean; allowSignatureTypes: boolean } };
declare const ContractDistributionMethod_advSettings: { EMAIL: string; DIRECT: string };

type AdvancedSettingsFormSchema = {
  meta: {
    distributionMethod: string;
    dateFormat: string;
    timezone: string;
    language: string;
    emailSubject?: string;
    emailBody?: string;
    emailSettings?: unknown;
    redirectUrl?: string;
    allowedSignatureTypes?: string[];
  };
};

interface ConfigureContractAdvancedSettingsProps {
  control: unknown;
  isSubmitting: boolean;
}

export const ConfigureContractAdvancedSettings = ({
  control,
  isSubmitting,
}: ConfigureContractAdvancedSettingsProps) => {
  const { _ } = useLingui_advSettings();
  const form = useFormContext_advSettings<AdvancedSettingsFormSchema>();
  const { features } = useConfigureContract_advSettings();
  const { watch, setValue } = form;

  const distributionMethod = watch('meta.distributionMethod') as string;
  const emailSettings = watch('meta.emailSettings');
  const isEmailDistribution = distributionMethod === ContractDistributionMethod_advSettings.EMAIL;

  return (
    <div>
      <h3 className="mb-1 text-lg font-medium text-foreground">Advanced Settings</h3>
      <p className="mb-6 text-sm text-muted-foreground">Configure additional options for this contract</p>

      <div role="tablist" className="mb-6 inline-flex rounded-md border border-border">
        <button role="tab" className="px-4 py-2 text-sm font-medium">
          General
        </button>
        {features.allowConfigureCommunication && (
          <button role="tab" className="px-4 py-2 text-sm font-medium">
            Communication
          </button>
        )}
      </div>

      <div role="tabpanel" className="space-y-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Date Format</label>
          <select
            className="rounded border px-2 py-1.5 text-sm"
            onChange={(e) => setValue('meta.dateFormat', e.target.value)}
          >
            {DATE_FORMATS_advSettings.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Timezone</label>
          <select
            className="rounded border px-2 py-1.5 text-sm"
            onChange={(e) => setValue('meta.timezone', e.target.value)}
          >
            {TIME_ZONES_advSettings.map((tz) => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Language</label>
          <select
            className="rounded border px-2 py-1.5 text-sm"
            onChange={(e) => setValue('meta.language', e.target.value)}
          >
            {SUPPORTED_LANGUAGES_advSettings.map((lang) => (
              <option key={lang.value} value={lang.value}>{lang.label}</option>
            ))}
          </select>
        </div>

        {features.allowSignatureTypes && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Allowed Signature Types</label>
            <div className="flex flex-wrap gap-2">
              {CONTRACT_SIGNATURE_TYPES_advSettings.map((sig) => (
                <label key={sig.value} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    value={sig.value}
                    onChange={(e) => {
                      const current = (watch('meta.allowedSignatureTypes') as string[]) ?? [];
                      if (e.target.checked) {
                        setValue('meta.allowedSignatureTypes', [...current, sig.value]);
                      } else {
                        setValue('meta.allowedSignatureTypes', current.filter((v) => v !== sig.value));
                      }
                    }}
                  />
                  {sig.label}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Redirect URL after signing</label>
          <input
            type="url"
            className="rounded border px-3 py-2 text-sm"
            placeholder="https://example.com/thank-you"
            onChange={(e) => setValue('meta.redirectUrl', e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Signers will be redirected here after completing the contract.</p>
        </div>
      </div>
    </div>
  );
};


// ProfileAvatarForm — react-tsx FP shape with useDropzone, useForm, useMemo, trpc mutation
declare const useAuthSession_avatar: () => { user: { id: number; name: string | null; avatarImageId: string | null }; refreshSession: () => Promise<void> };
declare const useLingui_avatar: () => { _: (msg: unknown) => string };
declare const useToast_avatar: () => { toast: (opts: { title?: string; description?: string; variant?: string }) => void };
declare const trpc_avatar: { profile: { setProfileImage: { useMutation: () => { mutateAsync: (data: { bytes: string | null; teamId?: number; orgId?: string }) => Promise<void> } } } };
declare const extractInitials_avatar: (name: string) => string;
declare const formatAvatarUrl_avatar: (id: string | null, type: string) => string;
declare const base64_avatar: { encode: (bytes: ArrayBuffer) => string };
declare const useDropzone_avatar: (opts: { onDrop: (files: File[]) => void; accept: Record<string, string[]>; maxSize: number; maxFiles: number; multiple: boolean }) => { getRootProps: () => Record<string, unknown>; getInputProps: () => Record<string, unknown>; isDragActive: boolean; fileRejections: Array<{ errors: Array<{ code: string }> }> };
declare const useForm_avatar: <T>(opts: { values: Partial<T>; resolver: unknown }) => {
  control: unknown;
  handleSubmit: (fn: (data: T) => void | Promise<void>) => (e?: unknown) => void;
  formState: { isSubmitting: boolean };
  reset: () => void;
  setValue: (field: keyof T, value: unknown) => void;
  watch: (field: keyof T) => unknown;
};
declare const zodResolver_avatar: (schema: unknown) => unknown;
declare const z_avatar: { object: (s: Record<string, unknown>) => unknown; string: () => { nullish: () => unknown } };
declare const useMemo_avatar: <T>(fn: () => T, deps: unknown[]) => T;
declare const cn_avatar: (...args: unknown[]) => string;
declare const msg_avatar: (strings: TemplateStringsArray, ...args: unknown[]) => unknown;
declare const ErrorCode_avatar: { FileTooLarge: string; FileInvalidType: string; TooManyFiles: string };

const ZProfileAvatarSchema = z_avatar.object({ bytes: z_avatar.string().nullish() });
type TProfileAvatarSchema = { bytes?: string | null };

type ProfileAvatarFormProps = {
  className?: string;
  team?: { id: number; name: string; avatarImageId: string | null };
  organisation?: { id: string; name: string; avatarImageId: string | null };
};

export const ProfileAvatarForm = ({ className, team, organisation }: ProfileAvatarFormProps) => {
  const { user, refreshSession } = useAuthSession_avatar();
  const { _ } = useLingui_avatar();
  const { toast } = useToast_avatar();

  const { mutateAsync: setProfileImage } = trpc_avatar.profile.setProfileImage.useMutation();

  const initials = extractInitials_avatar(team?.name || organisation?.name || user.name || '');

  const hasAvatar = useMemo_avatar(() => {
    if (team) return team.avatarImageId !== null;
    if (organisation) return organisation.avatarImageId !== null;
    return user.avatarImageId !== null;
  }, [team, organisation, user.avatarImageId]);

  const avatarId = team ? team.avatarImageId : organisation ? organisation.avatarImageId : user.avatarImageId;

  const form = useForm_avatar<TProfileAvatarSchema>({
    values: { bytes: null },
    resolver: zodResolver_avatar(ZProfileAvatarSchema),
  });

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone_avatar({
    onDrop: async ([file]) => {
      if (!file) return;
      const arrayBuffer = await file.arrayBuffer();
      const bytes = base64_avatar.encode(arrayBuffer);
      form.setValue('bytes', bytes);
    },
    accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp'] },
    maxSize: 5 * 1024 * 1024,
    maxFiles: 1,
    multiple: false,
  });

  const onSubmit = async (data: TProfileAvatarSchema) => {
    try {
      await setProfileImage({
        bytes: data.bytes ?? null,
        teamId: team?.id,
        orgId: organisation?.id,
      });
      await refreshSession();
      toast({ description: _(msg_avatar`Profile image updated`) });
      form.reset();
    } catch {
      toast({
        title: _(msg_avatar`Error`),
        description: _(msg_avatar`Failed to update profile image`),
        variant: 'destructive',
      });
    }
  };

  const bytesPreview = form.watch('bytes') as string | null | undefined;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className={cn_avatar('flex flex-col gap-4', className)}>
      <div className="flex items-center gap-6">
        <div className="relative h-20 w-20 overflow-hidden rounded-full border border-border">
          {bytesPreview ? (
            <img src={`data:image/*;base64,${bytesPreview}`} alt={initials} className="h-full w-full object-cover" />
          ) : hasAvatar && avatarId ? (
            <img src={formatAvatarUrl_avatar(avatarId, team ? 'team' : organisation ? 'org' : 'user')} alt={initials} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted text-sm font-semibold">
              {initials}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div
            {...getRootProps()}
            className={cn_avatar(
              'cursor-pointer rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-primary',
              isDragActive && 'border-primary bg-primary/5',
            )}
          >
            <input {...getInputProps()} />
            {isDragActive ? <span>Drop the file here...</span> : <span>Click or drag to upload a photo</span>}
          </div>
          {fileRejections.length > 0 && (
            <p className="text-xs text-destructive">
              {fileRejections[0]?.errors[0]?.code === ErrorCode_avatar.FileTooLarge
                ? _(msg_avatar`File is too large. Maximum size is 5MB.`)
                : _(msg_avatar`Invalid file type. Please upload a JPEG, PNG, or WebP image.`)}
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          className="rounded bg-primary px-4 py-2 text-sm text-white"
          disabled={form.formState.isSubmitting || !bytesPreview}
        >
          {form.formState.isSubmitting ? _(msg_avatar`Saving...`) : _(msg_avatar`Save`)}
        </button>
      </div>
    </form>
  );
};


// ContractSignerPageRenderer — react-tsx FP shape with many hooks and destructured context
declare const useLingui_pageRenderer: () => { t: (s: TemplateStringsArray, ...args: unknown[]) => string };
declare const useCurrentContractRender_pageRenderer: () => { renderData: unknown; pageCount: number; currentPage: number; setCurrentPage: (p: number) => void };
declare const useOptionalAuthSession_pageRenderer: () => { sessionData: { user: { id: number } } | null };
declare const useRequiredContractSigningAuthCtx_pageRenderer: () => {
  authConfig: { accessAuth: string | null; actionAuth: string | null };
  isAuthValid: boolean;
  handleAuthVerification: (opts: unknown) => Promise<void>;
};
declare const useToast_pageRenderer: () => { toast: (opts: { title?: string; description?: string; variant?: string }) => void };
declare const useRequiredSigningCtx_pageRenderer: () => {
  contractData: { id: number; title: string };
  recipient: { id: number; role: string; token: string };
  signerFields: Array<{ id: number; type: string; pageNumber: number; pageX: number; pageY: number; inserted: boolean }>;
  recipientFieldsRemaining: number;
  requiredSignerFields: unknown[];
  selectedHelperSignerFields: unknown[];
  isSubmitting: boolean;
  onSignatureComplete: () => Promise<void>;
};

export const ContractSignerPageRenderer = () => {
  const { t } = useLingui_pageRenderer();

  const { renderData, pageCount, currentPage, setCurrentPage } = useCurrentContractRender_pageRenderer();

  const sessionCtx = useOptionalAuthSession_pageRenderer();
  const user = sessionCtx?.sessionData?.user;

  const {
    authConfig,
    isAuthValid,
    handleAuthVerification,
  } = useRequiredContractSigningAuthCtx_pageRenderer();

  const { toast } = useToast_pageRenderer();

  const {
    contractData,
    recipient,
    signerFields,
    recipientFieldsRemaining,
    requiredSignerFields,
    selectedHelperSignerFields,
    isSubmitting,
    onSignatureComplete,
  } = useRequiredSigningCtx_pageRenderer();

  const handlePageChange = (page: number) => {
    if (page < 1 || page > pageCount) return;
    setCurrentPage(page);
  };

  const handleSubmit = async (authOptions?: unknown) => {
    try {
      if (!isAuthValid && authConfig.actionAuth) {
        await handleAuthVerification(authOptions);
      }
      await onSignatureComplete();
    } catch {
      toast({
        title: t`Submission failed`,
        description: t`An error occurred while submitting your signature. Please try again.`,
        variant: 'destructive',
      });
    }
  };

  const fieldsOnCurrentPage = signerFields.filter((f) => f.pageNumber === currentPage);
  const pendingFields = signerFields.filter((f) => !f.inserted);

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium">
          {t`Page ${currentPage} of ${pageCount}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="rounded border px-2 py-1 text-xs disabled:opacity-40"
          >
            ← Prev
          </button>
          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage >= pageCount}
            className="rounded border px-2 py-1 text-xs disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-auto">
        <div className="relative">{/* PDF page renders here */}</div>
        {fieldsOnCurrentPage.map((field) => (
          <div
            key={field.id}
            className="absolute flex cursor-pointer items-center justify-center rounded border-2 border-primary bg-primary/10"
            style={{ left: `${field.pageX}%`, top: `${field.pageY}%`, width: '120px', height: '40px' }}
          >
            <span className="text-xs text-primary">{field.type}</span>
          </div>
        ))}
      </div>

      <div className="border-t border-border p-4">
        {recipientFieldsRemaining === 0 ? (
          <button
            onClick={() => handleSubmit()}
            disabled={isSubmitting}
            className="w-full rounded bg-primary py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {isSubmitting ? t`Submitting...` : t`Complete Signing`}
          </button>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            {t`${recipientFieldsRemaining} field(s) remaining`}
          </p>
        )}
      </div>
    </div>
  );
};


// UserAccountSkeleton — react-tsx FP shape with className prop, URL helper, icon-placeholder JSX
declare const WEBAPP_URL_skeleton: () => string;
declare const cn_skeleton: (...args: unknown[]) => string;

type UserAccountSkeletonProps = {
  className?: string;
  user?: {
    name?: string | null;
    url?: string | null;
  };
  rows?: number;
};

export function UserAccountSkeleton({ className, user, rows = 3 }: UserAccountSkeletonProps) {
  const profileUrl = user?.url
    ? `${WEBAPP_URL_skeleton()}/u/${user.url}`
    : null;

  return (
    <div className={cn_skeleton('animate-pulse space-y-4', className)}>
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-full bg-muted" />
        <div className="flex flex-col gap-2">
          <div className="h-4 w-32 rounded bg-muted" />
          {profileUrl && (
            <div className="h-3 w-48 rounded bg-muted" />
          )}
        </div>
      </div>

      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-border p-3">
            <div className="h-5 w-5 rounded bg-muted" />
            <div className="flex flex-1 flex-col gap-1">
              <div className="h-3 w-24 rounded bg-muted" />
              <div className="h-3 w-40 rounded bg-muted" />
            </div>
            <div className="h-6 w-16 rounded bg-muted" />
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="h-9 flex-1 rounded bg-muted" />
        <div className="h-9 w-24 rounded bg-muted" />
      </div>
    </div>
  );
}


// SignFieldPhoneDialog — react-tsx FP shape (createCallable pattern, Zod inline schema, useForm)
declare const createCallable_phoneDialog: <P, R>(fn: (props: P & { resolve: (v: R) => void }) => React.ReactNode) => { Root: React.ComponentType; call: (props: P) => Promise<R> };
declare const useLingui_phoneDialog: () => { t: (s: TemplateStringsArray, ...args: unknown[]) => string };
declare const useForm_phoneDialog: <T>(opts: { resolver: unknown; defaultValues?: Partial<T> }) => {
  control: unknown;
  handleSubmit: (fn: (data: T) => void | Promise<void>) => (e?: unknown) => void;
  formState: { isSubmitting: boolean; errors: Record<string, { message?: string }> };
  reset: () => void;
};
declare const zodResolver_phoneDialog: (schema: unknown) => unknown;
declare const z_phoneDialog: {
  object: (s: Record<string, unknown>) => unknown;
  string: () => {
    min: (n: number, opts: { message: string }) => {
      max: (n: number, opts: { message: string }) => {
        regex: (re: RegExp, opts: { message: string }) => unknown;
      };
    };
  };
};
declare const useState_phoneDialog: <T>(v: T) => [T, (v: T) => void];

type PhoneDialogResult = { value: string } | null;

export const SignFieldPhoneDialog = createCallable_phoneDialog<{ defaultValue?: string }, PhoneDialogResult>(
  ({ defaultValue, resolve }) => {
    const { t } = useLingui_phoneDialog();
    const [isOpen, setIsOpen] = useState_phoneDialog(true);

    const ZPhoneSchema = z_phoneDialog.object({
      phoneNumber: z_phoneDialog
        .string()
        .min(7, { message: t`Phone number must be at least 7 digits` })
        .max(20, { message: t`Phone number must not exceed 20 digits` })
        .regex(/^[\+\d\s\-\(\)]+$/, { message: t`Phone number contains invalid characters` }),
    });

    type TPhoneSchema = { phoneNumber: string };

    const form = useForm_phoneDialog<TPhoneSchema>({
      resolver: zodResolver_phoneDialog(ZPhoneSchema),
      defaultValues: { phoneNumber: defaultValue ?? '' },
    });

    const onSubmit = async (data: TPhoneSchema) => {
      resolve({ value: data.phoneNumber });
      setIsOpen(false);
    };

    const onDismiss = () => {
      resolve(null);
      setIsOpen(false);
    };

    if (!isOpen) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="w-full max-w-sm rounded-lg bg-background p-6 shadow-xl">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">{t`Enter Phone Number`}</h2>
            <p className="text-sm text-muted-foreground">
              {t`Please enter a valid phone number to sign this field.`}
            </p>
          </div>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">{t`Phone Number`}</label>
              <input
                type="tel"
                className="rounded border px-3 py-2 text-sm"
                placeholder="+1 555 000 0000"
                defaultValue={defaultValue}
              />
              {form.formState.errors['phoneNumber'] && (
                <p className="text-xs text-destructive">{form.formState.errors['phoneNumber'].message}</p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onDismiss}
                className="flex-1 rounded border border-border px-4 py-2 text-sm"
              >
                {t`Cancel`}
              </button>
              <button
                type="submit"
                className="flex-1 rounded bg-primary px-4 py-2 text-sm text-white"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? t`Saving...` : t`Confirm`}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  },
);


// TemplateBatchDispatchDialog — react-tsx FP shape (CSV upload dialog with useForm, trpc)
declare const useToast_batchDispatch: () => { toast: (opts: { title?: string; description?: string; variant?: string }) => void };
declare const useLingui_batchDispatch: () => { _: (msg: unknown) => string };
declare const useCurrentTeam_batchDispatch: () => { id: number; url: string };
declare const useForm_batchDispatch: <T>(opts: { resolver: unknown; defaultValues?: Partial<T> }) => {
  handleSubmit: (fn: (data: T) => void | Promise<void>) => (e?: unknown) => void;
  formState: { isSubmitting: boolean };
  reset: () => void;
  setValue: (field: keyof T, value: unknown) => void;
  watch: (field: keyof T) => unknown;
};
declare const zodResolver_batchDispatch: (schema: unknown) => unknown;
declare const z_batchDispatch: { object: (s: Record<string, unknown>) => unknown; instanceof: (cls: unknown) => unknown; boolean: () => { default: (v: boolean) => unknown } };
declare const trpc_batchDispatch: { template: { uploadBatchDispatch: { useMutation: () => { mutateAsync: (data: { templateId: number; teamId: number; csvFile: File; sendImmediately: boolean }) => Promise<void> } } } };
declare const msg_batchDispatch: (strings: TemplateStringsArray, ...args: unknown[]) => unknown;

const ZBatchDispatchSchema = z_batchDispatch.object({
  file: z_batchDispatch.instanceof(File),
  sendImmediately: z_batchDispatch.boolean().default(false),
});

type TBatchDispatchSchema = { file: File; sendImmediately: boolean };

type TemplateBatchDispatchDialogProps = {
  templateId: number;
  recipients: Array<{ email: string; name?: string | null }>;
  trigger?: React.ReactNode;
  onSuccess?: () => void;
};

export const TemplateBatchDispatchDialog = ({
  templateId,
  recipients,
  trigger,
  onSuccess,
}: TemplateBatchDispatchDialogProps) => {
  const { _ } = useLingui_batchDispatch();
  const { toast } = useToast_batchDispatch();
  const team = useCurrentTeam_batchDispatch();

  const form = useForm_batchDispatch<TBatchDispatchSchema>({
    resolver: zodResolver_batchDispatch(ZBatchDispatchSchema),
    defaultValues: { sendImmediately: false },
  });

  const { mutateAsync: uploadBatchDispatch } = trpc_batchDispatch.template.uploadBatchDispatch.useMutation();

  const handleDownloadTemplate = () => {
    const headers = recipients.flatMap((_, i) => [`recipient_${i + 1}_email`, `recipient_${i + 1}_name`]);
    const exampleRow = recipients.flatMap((r) => [r.email, r.name ?? '']);
    const csv = [headers.join(','), exampleRow.join(',')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: 'batch-template.csv' });
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) form.setValue('file', file);
  };

  const onSubmit = async (data: TBatchDispatchSchema) => {
    try {
      await uploadBatchDispatch({ templateId, teamId: team.id, csvFile: data.file, sendImmediately: data.sendImmediately });
      toast({ description: _(msg_batchDispatch`Batch dispatch started successfully.`) });
      form.reset();
      onSuccess?.();
    } catch {
      toast({
        title: _(msg_batchDispatch`Error`),
        description: _(msg_batchDispatch`Failed to start batch dispatch. Please check your CSV file.`),
        variant: 'destructive',
      });
    }
  };

  const selectedFile = form.watch('file') as File | undefined;

  return (
    <div>
      {trigger}
      <div className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <h3 className="text-base font-semibold">{_(msg_batchDispatch`Batch Send`)}</h3>
          <p className="text-sm text-muted-foreground">
            {_(msg_batchDispatch`Upload a CSV file to send to multiple recipients at once.`)}
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownloadTemplate}
          className="flex items-center gap-2 rounded border border-border px-3 py-2 text-sm hover:bg-muted"
        >
          <span>↓</span>
          {_(msg_batchDispatch`Download CSV Template`)}
        </button>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">{_(msg_batchDispatch`Upload CSV`)}</label>
            <input type="file" accept=".csv" onChange={handleFileChange} className="text-sm" />
            {selectedFile && (
              <div className="flex items-center gap-2 rounded border border-border px-3 py-2">
                <span aria-hidden>📄</span>
                <span className="flex-1 truncate text-sm">{selectedFile.name}</span>
                <button
                  type="button"
                  onClick={() => form.setValue('file', undefined as unknown as File)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              onChange={(e) => form.setValue('sendImmediately', e.target.checked)}
            />
            {_(msg_batchDispatch`Send immediately after upload`)}
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="submit"
              disabled={form.formState.isSubmitting || !selectedFile}
              className="rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-60"
            >
              {form.formState.isSubmitting
                ? _(msg_batchDispatch`Processing...`)
                : _(msg_batchDispatch`Start Batch Send`)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};


// TagMultiSelectCombobox — react-tsx FP shape (generic function component with useState, useLingui)
declare const useLingui_tagSelect: () => { t: (s: TemplateStringsArray, ...args: unknown[]) => string };
declare const useState_tagSelect: <T>(v: T) => [T, (v: T) => void];
declare const cn_tagSelect: (...args: unknown[]) => string;

type TagOption = { label: string; value: string; badgeVariant?: string };

type TagMultiSelectComboboxProps<T extends TagOption = TagOption> = {
  options: T[];
  selected: T['value'][];
  onChange: (selected: T['value'][]) => void;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
};

export function TagMultiSelectCombobox<T extends TagOption>({
  options,
  selected,
  onChange,
  placeholder,
  emptyMessage,
  disabled = false,
  className,
}: TagMultiSelectComboboxProps<T>) {
  const { t } = useLingui_tagSelect();
  const [open, setOpen] = useState_tagSelect(false);
  const [query, setQuery] = useState_tagSelect('');

  const handleSelect = (value: T['value']) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const handleRemove = (value: T['value']) => {
    onChange(selected.filter((v) => v !== value));
  };

  const filteredOptions = query
    ? options.filter((opt) => opt.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const selectedOptions = options.filter((opt) => selected.includes(opt.value));

  return (
    <div className={cn_tagSelect('relative w-full', className)}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={cn_tagSelect(
          'flex min-h-10 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-3 py-2 text-sm',
          disabled && 'cursor-not-allowed opacity-50',
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {selectedOptions.length > 0 ? (
          selectedOptions.map((opt) => (
            <span
              key={opt.value}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
            >
              {opt.label}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleRemove(opt.value); }}
                disabled={disabled}
                className="ml-1 text-primary/60 hover:text-primary"
                aria-label={t`Remove ${opt.label}`}
              >
                ✕
              </button>
            </span>
          ))
        ) : (
          <span className="text-muted-foreground">
            {placeholder ?? t`Select options...`}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
          <div className="p-2">
            <input
              type="text"
              className="w-full rounded border border-border px-2 py-1 text-sm outline-none"
              placeholder={t`Search...`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                {emptyMessage ?? t`No results found.`}
              </li>
            ) : (
              filteredOptions.map((opt) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={selected.includes(opt.value)}
                  onClick={() => handleSelect(opt.value)}
                  className={cn_tagSelect(
                    'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted',
                    selected.includes(opt.value) && 'font-medium text-primary',
                  )}
                >
                  <span className={cn_tagSelect('h-4 w-4 text-primary', !selected.includes(opt.value) && 'opacity-0')}>
                    ✓
                  </span>
                  {opt.label}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}



// --- too-many-lines shape: react-tsx-component (license/status banner with JSX) ---
declare function cn(...classes: (string | boolean | undefined)[]): string;
declare const Link: (props: { to: string; children: React.ReactNode; className?: string }) => JSX.Element;
declare const AlertTriangleIcon: (props: { className?: string }) => JSX.Element;
declare const KeyRoundIcon: (props: { className?: string }) => JSX.Element;

type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'UNAUTHORIZED' | 'NOT_FOUND';

type CachedSubscription = {
  derivedStatus: SubscriptionStatus;
  expiresAt?: string;
  plan?: string;
};

type SubscriptionStatusBannerProps = {
  subscription: CachedSubscription | null;
};

export const SubscriptionStatusBanner = ({ subscription }: SubscriptionStatusBannerProps) => {
  const status = subscription?.derivedStatus;

  if (!subscription || status === 'ACTIVE' || status === 'NOT_FOUND') {
    return null;
  }

  const isError = status === 'EXPIRED' || status === 'UNAUTHORIZED';

  return (
    <div
      className={cn('mb-8 rounded-lg bg-yellow-200 text-yellow-900 dark:bg-yellow-400', {
        'bg-destructive text-destructive-foreground': isError,
      })}
    >
      <div className="flex items-center justify-between gap-x-4 px-4 py-3 font-medium text-sm">
        <div className="flex items-center">
          <AlertTriangleIcon className="mr-2.5 h-5 w-5" />

          {status === 'PAST_DUE' && (
            <span>Subscription Payment Overdue - Please update your payment method to avoid service interruptions.</span>
          )}
          {status === 'EXPIRED' && (
            <span>Subscription Expired - Please renew your subscription to continue using premium features.</span>
          )}
          {status === 'UNAUTHORIZED' && (
            <span>Subscription Unauthorized - Please contact support to resolve your account status.</span>
          )}
        </div>

        <div className="flex items-center gap-x-4">
          {status === 'PAST_DUE' && (
            <Link
              to="/settings/billing"
              className="rounded bg-yellow-900 px-3 py-1 text-yellow-100 hover:bg-yellow-800"
            >
              Update Payment
            </Link>
          )}

          {isError && (
            <Link
              to="/settings/billing"
              className="rounded bg-white/20 px-3 py-1 hover:bg-white/30"
            >
              Renew Subscription
            </Link>
          )}

          <Link to="/support" className="flex items-center hover:underline">
            <KeyRoundIcon className="mr-1 h-4 w-4" />
            Contact Support
          </Link>
        </div>
      </div>

      {subscription.expiresAt && (
        <div className="border-t border-current/20 px-4 py-2 text-xs">
          {isError ? 'Expired' : 'Expires'}: {new Date(subscription.expiresAt).toLocaleDateString()}
          {subscription.plan && <span className="ml-2">Plan: {subscription.plan}</span>}
        </div>
      )}
    </div>
  );
};



// --- too-many-lines shape: react-tsx-component (generic data table with pagination) ---
declare function useReactTable<TData>(opts: {
  data: TData[];
  columns: ColumnDef<TData>[];
  getCoreRowModel: () => RowModel<TData>;
  manualPagination?: boolean;
  pageCount?: number;
}): TableInstance<TData>;
declare function getCoreRowModel<TData>(): () => RowModel<TData>;

type ColumnDef<TData> = {
  id?: string;
  header?: string | ((ctx: HeaderContext<TData>) => React.ReactNode);
  cell?: (ctx: CellContext<TData>) => React.ReactNode;
  accessorKey?: keyof TData;
};
declare class RowModel<TData> {}
declare class TableInstance<TData> {
  getHeaderGroups(): HeaderGroup<TData>[];
  getRowModel(): { rows: Row<TData>[] };
}
declare class HeaderGroup<TData> { id: string; headers: Header<TData>[]; }
declare class Header<TData> { id: string; isPlaceholder: boolean; column: Column<TData>; getContext(): HeaderContext<TData>; }
declare class Row<TData> { id: string; getVisibleCells(): Cell<TData>[]; original: TData; }
declare class Cell<TData> { id: string; column: Column<TData>; getContext(): CellContext<TData>; }
declare class Column<TData> { columnDef: ColumnDef<TData>; }
declare class HeaderContext<TData> {}
declare class CellContext<TData> {}
declare function flexRender<T>(component: T, ctx: unknown): React.ReactNode;

type RecordTableProps<TData> = {
  columns: ColumnDef<TData>[];
  data: TData[];
  currentPage: number;
  totalPages?: number;
  perPage?: number;
  onPaginationChange?: (page: number, perPage: number) => void;
  emptyState?: React.ReactNode;
  isLoading?: boolean;
};

export function RecordTable<TData>({
  columns,
  data,
  currentPage,
  totalPages,
  perPage = 10,
  onPaginationChange,
  emptyState,
  isLoading,
}: RecordTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: totalPages,
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="w-full">
      <div className="rounded-md border">
        <table className="w-full caption-bottom text-sm">
          <thead className="[&_tr]:border-b">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {isLoading ? (
              <tr><td colSpan={columns.length} className="py-8 text-center">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="py-8 text-center">{emptyState ?? 'No records found.'}</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b transition-colors hover:bg-muted/50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="p-4 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages !== undefined && totalPages > 1 && (
        <div className="flex items-center justify-between px-2 py-4">
          <p className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              disabled={currentPage <= 1}
              onClick={() => onPaginationChange?.(currentPage - 1, perPage)}
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => onPaginationChange?.(currentPage + 1, perPage)}
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}



// --- too-many-lines shape: react-tsx-component (workspace/org switcher menu) ---
declare function useNavigate(): (to: string) => void;
declare function useLocation(): { pathname: string };
declare const DropdownMenu: (props: { children: React.ReactNode }) => JSX.Element;
declare const DropdownMenuTrigger: (props: { asChild?: boolean; children: React.ReactNode }) => JSX.Element;
declare const DropdownMenuContent: (props: { align?: string; className?: string; children: React.ReactNode }) => JSX.Element;
declare const DropdownMenuItem: (props: { onClick?: () => void; className?: string; children: React.ReactNode }) => JSX.Element;
declare const DropdownMenuSeparator: () => JSX.Element;
declare const DropdownMenuLabel: (props: { children: React.ReactNode }) => JSX.Element;
declare const Avatar: (props: { className?: string; children: React.ReactNode }) => JSX.Element;
declare const AvatarImage: (props: { src?: string; alt?: string }) => JSX.Element;
declare const AvatarFallback: (props: { children: React.ReactNode }) => JSX.Element;
declare const CheckIcon: (props: { className?: string }) => JSX.Element;
declare const PlusIcon: (props: { className?: string }) => JSX.Element;
declare const ChevronsUpDownIcon: (props: { className?: string }) => JSX.Element;

type WorkspaceItem = {
  id: string;
  name: string;
  slug: string;
  avatarUrl?: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
};

type WorkspaceSwitcherProps = {
  currentWorkspace: WorkspaceItem;
  workspaces: WorkspaceItem[];
  onCreateWorkspace?: () => void;
};

export function WorkspaceSwitcher({
  currentWorkspace,
  workspaces,
  onCreateWorkspace,
}: WorkspaceSwitcherProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

  const handleSelectWorkspace = (workspace: WorkspaceItem) => {
    const relativePath = location.pathname.split('/').slice(2).join('/');
    navigate(`/w/${workspace.slug}/${relativePath}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-accent">
          <Avatar className="h-6 w-6">
            <AvatarImage src={currentWorkspace.avatarUrl} alt={currentWorkspace.name} />
            <AvatarFallback>{getInitials(currentWorkspace.name)}</AvatarFallback>
          </Avatar>
          <span className="flex-1 truncate text-sm font-medium">{currentWorkspace.name}</span>
          <ChevronsUpDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            onClick={() => handleSelectWorkspace(workspace)}
            className="flex items-center gap-2"
          >
            <Avatar className="h-5 w-5">
              <AvatarImage src={workspace.avatarUrl} alt={workspace.name} />
              <AvatarFallback>{getInitials(workspace.name)}</AvatarFallback>
            </Avatar>
            <span className="flex-1 truncate">{workspace.name}</span>
            {workspace.id === currentWorkspace.id && (
              <CheckIcon className="h-4 w-4" />
            )}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onCreateWorkspace} className="gap-2">
          <PlusIcon className="h-4 w-4" />
          Create Workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}



// --- too-many-lines shape: react-tsx-component (team group create dialog with form) ---
declare function useForm<T>(opts?: { defaultValues?: Partial<T> }): FormInstance<T>;
declare function zodResolver<T>(schema: unknown): (data: unknown) => { values?: T; errors?: unknown };
declare function useMutation<TInput, TOutput>(opts: {
  mutationFn: (data: TInput) => Promise<TOutput>;
  onSuccess?: (data: TOutput) => void;
  onError?: (err: Error) => void;
}): { mutate: (data: TInput) => void; isPending: boolean };
declare class FormInstance<T> {
  handleSubmit: (fn: (data: T) => void) => (e: Event) => void;
  register: (name: keyof T) => { name: string; onChange: unknown; ref: unknown };
  formState: { errors: Partial<Record<keyof T, { message?: string }>> };
  reset: () => void;
}
declare const Dialog: (props: { open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }) => JSX.Element;
declare const DialogContent: (props: { className?: string; children: React.ReactNode }) => JSX.Element;
declare const DialogHeader: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogFooter: (props: { children: React.ReactNode }) => JSX.Element;
declare const Button: (props: { type?: string; variant?: string; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) => JSX.Element;
declare const Input: (props: Record<string, unknown>) => JSX.Element;
declare const Label: (props: { htmlFor?: string; children: React.ReactNode }) => JSX.Element;
declare function toast(opts: { title: string; description?: string; variant?: string }): void;

type CreateGroupFormData = {
  name: string;
  description?: string;
};

type TeamGroupCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  onGroupCreated?: (groupId: string) => void;
};

export function TeamGroupCreateDialog({
  open,
  onOpenChange,
  teamId,
  onGroupCreated,
}: TeamGroupCreateDialogProps) {
  const form = useForm<CreateGroupFormData>({
    defaultValues: { name: '', description: '' },
  });

  const { mutate: createGroup, isPending } = useMutation<
    CreateGroupFormData & { teamId: string },
    { id: string }
  >({
    mutationFn: (data) => createTeamGroup(data),
    onSuccess: (group) => {
      toast({ title: 'Group created', description: 'The new group has been created successfully.' });
      form.reset();
      onOpenChange(false);
      onGroupCreated?.(group.id);
    },
    onError: (err) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const onSubmit = (data: CreateGroupFormData) => {
    createGroup({ ...data, teamId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Group</DialogTitle>
          <DialogDescription>
            Groups allow you to organize team members and manage permissions collectively.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit) as unknown as React.FormEventHandler}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Group Name</Label>
              <Input
                id="name"
                placeholder="e.g. Engineering"
                {...form.register('name')}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                placeholder="Brief description of this group"
                {...form.register('description')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating...' : 'Create Group'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

declare function createTeamGroup(data: CreateGroupFormData & { teamId: string }): Promise<{ id: string }>;



// --- too-many-lines shape: react-tsx-component (configure fields view with drag drop) ---
declare function useState<T>(init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare const DragDropContext: (props: { onDragEnd: (result: DragResult) => void; children: React.ReactNode }) => JSX.Element;
declare const Droppable: (props: { droppableId: string; children: (provided: DroppableProvided, snapshot: DroppableStateSnapshot) => React.ReactNode }) => JSX.Element;
declare const Draggable: (props: { draggableId: string; index: number; children: (provided: DraggableProvided) => React.ReactNode }) => JSX.Element;
declare class DragResult { draggableId: string; destination?: { index: number; droppableId: string }; source: { index: number }; }
declare class DroppableProvided { innerRef: unknown; droppableProps: unknown; placeholder: React.ReactNode; }
declare class DroppableStateSnapshot { isDraggingOver: boolean; }
declare class DraggableProvided { innerRef: unknown; draggableProps: unknown; dragHandleProps: unknown; }

type FieldConfig = {
  id: string;
  type: 'text' | 'signature' | 'date' | 'checkbox';
  label: string;
  required: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
};

type ConfigureFieldsViewProps = {
  fields: FieldConfig[];
  onFieldsChange: (fields: FieldConfig[]) => void;
  onFieldSelect: (fieldId: string | null) => void;
  selectedFieldId: string | null;
};

type FieldTypeOption = { value: FieldConfig['type']; label: string; icon: string };

const FIELD_TYPE_OPTIONS: FieldTypeOption[] = [
  { value: 'text', label: 'Text', icon: 'T' },
  { value: 'signature', label: 'Signature', icon: 'S' },
  { value: 'date', label: 'Date', icon: 'D' },
  { value: 'checkbox', label: 'Checkbox', icon: 'C' },
];

export function ConfigureFieldsView({
  fields,
  onFieldsChange,
  onFieldSelect,
  selectedFieldId,
}: ConfigureFieldsViewProps) {
  const [activeTab, setActiveTab] = useState<'fields' | 'settings'>('fields');

  const handleDragEnd = useCallback(
    (result: DragResult) => {
      if (!result.destination) return;
      const reordered = [...fields];
      const [removed] = reordered.splice(result.source.index, 1);
      reordered.splice(result.destination.index, 0, removed);
      onFieldsChange(reordered);
    },
    [fields, onFieldsChange],
  );

  const handleRemoveField = useCallback(
    (fieldId: string) => {
      onFieldsChange(fields.filter((f) => f.id !== fieldId));
      if (selectedFieldId === fieldId) onFieldSelect(null);
    },
    [fields, selectedFieldId, onFieldsChange, onFieldSelect],
  );

  const handleAddField = useCallback(
    (type: FieldConfig['type']) => {
      const newField: FieldConfig = {
        id: Math.random().toString(36).slice(2),
        type,
        label: FIELD_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type,
        required: false,
        x: 100,
        y: 100,
        width: 200,
        height: 40,
      };
      onFieldsChange([...fields, newField]);
    },
    [fields, onFieldsChange],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b">
        <button
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'fields' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'
          }`}
          onClick={() => setActiveTab('fields')}
        >
          Fields ({fields.length})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'settings' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'
          }`}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
      </div>

      {activeTab === 'fields' ? (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Add Field</p>
            <div className="grid grid-cols-4 gap-1">
              {FIELD_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleAddField(option.value)}
                  className="flex flex-col items-center rounded border p-2 text-xs hover:bg-accent"
                >
                  <span className="mb-1 font-bold">{option.icon}</span>
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="fields">
                {(provided) => (
                  <div ref={provided.innerRef as unknown as React.Ref<HTMLDivElement>} {...(provided.droppableProps as object)} className="space-y-2">
                    {fields.map((field, index) => (
                      <Draggable key={field.id} draggableId={field.id} index={index}>
                        {(dragProvided) => (
                          <div
                            ref={dragProvided.innerRef as unknown as React.Ref<HTMLDivElement>}
                            {...(dragProvided.draggableProps as object)}
                            className={`flex items-center gap-2 rounded border p-2 text-sm ${
                              selectedFieldId === field.id ? 'border-primary bg-primary/5' : 'hover:bg-accent'
                            }`}
                            onClick={() => onFieldSelect(field.id === selectedFieldId ? null : field.id)}
                          >
                            <span {...(dragProvided.dragHandleProps as object)} className="cursor-grab text-muted-foreground">≡</span>
                            <span className="flex-1 truncate">{field.label}</span>
                            <span className="rounded bg-muted px-1 text-xs text-muted-foreground">{field.type}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRemoveField(field.id); }}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              ×
                            </button>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </div>
        </div>
      ) : (
        <div className="p-4">
          <p className="text-sm text-muted-foreground">Configure global field settings here.</p>
        </div>
      )}
    </div>
  );
}



// --- too-many-lines shape: react-tsx-component (envelope editor settings dialog with tabs) ---
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];
declare const Tabs: (props: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => JSX.Element;
declare const TabsList: (props: { children: React.ReactNode }) => JSX.Element;
declare const TabsTrigger: (props: { value: string; children: React.ReactNode }) => JSX.Element;
declare const TabsContent: (props: { value: string; children: React.ReactNode }) => JSX.Element;
declare const Sheet: (props: { open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }) => JSX.Element;
declare const SheetContent: (props: { side?: string; className?: string; children: React.ReactNode }) => JSX.Element;
declare const SheetHeader: (props: { children: React.ReactNode }) => JSX.Element;
declare const SheetTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const SheetDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const Switch: (props: { checked: boolean; onCheckedChange: (v: boolean) => void; id?: string }) => JSX.Element;
declare const Label: (props: { htmlFor?: string; className?: string; children: React.ReactNode }) => JSX.Element;
declare const Input: (props: Record<string, unknown>) => JSX.Element;
declare const Select: (props: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => JSX.Element;
declare const SelectTrigger: (props: { className?: string; children: React.ReactNode }) => JSX.Element;
declare const SelectValue: (props: { placeholder?: string }) => JSX.Element;
declare const SelectContent: (props: { children: React.ReactNode }) => JSX.Element;
declare const SelectItem: (props: { value: string; children: React.ReactNode }) => JSX.Element;
declare const Button: (props: { type?: string; variant?: string; onClick?: () => void; children: React.ReactNode }) => JSX.Element;

type EnvelopeEditorSettings = {
  title: string;
  message?: string;
  redirectUrl?: string;
  language: string;
  timezone: string;
  dateFormat: string;
  reminderEnabled: boolean;
  reminderIntervalDays: number;
  expirationEnabled: boolean;
  expirationDays: number;
  requirePasscode: boolean;
};

type EnvelopeEditorSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: EnvelopeEditorSettings;
  onSettingsChange: (settings: EnvelopeEditorSettings) => void;
};

export function EnvelopeEditorSettingsDialog({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
}: EnvelopeEditorSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState('general');
  const [localSettings, setLocalSettings] = useState(settings);

  const handleChange = <K extends keyof EnvelopeEditorSettings>(
    key: K,
    value: EnvelopeEditorSettings[K],
  ) => {
    const updated = { ...localSettings, [key]: value };
    setLocalSettings(updated);
    onSettingsChange(updated);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-96">
        <SheetHeader>
          <SheetTitle>Envelope Settings</SheetTitle>
          <SheetDescription>Configure settings for this envelope.</SheetDescription>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="reminders">Reminders</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={localSettings.title}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('title', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="message">Message (optional)</Label>
                <Input
                  id="message"
                  value={localSettings.message ?? ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('message', e.target.value)}
                  placeholder="Add a message for signers"
                />
              </div>

              <div className="space-y-2">
                <Label>Language</Label>
                <Select value={localSettings.language} onValueChange={(v) => handleChange('language', v)}>
                  <SelectTrigger><SelectValue placeholder="Select language" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="de">German</SelectItem>
                    <SelectItem value="fr">French</SelectItem>
                    <SelectItem value="es">Spanish</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="redirectUrl">Redirect URL (optional)</Label>
                <Input
                  id="redirectUrl"
                  value={localSettings.redirectUrl ?? ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('redirectUrl', e.target.value)}
                  placeholder="https://example.com/after-sign"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="reminders">
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                <Switch
                  id="reminderEnabled"
                  checked={localSettings.reminderEnabled}
                  onCheckedChange={(v) => handleChange('reminderEnabled', v)}
                />
                <Label htmlFor="reminderEnabled" className="cursor-pointer">
                  Send automatic reminders
                </Label>
              </div>

              {localSettings.reminderEnabled && (
                <div className="space-y-2">
                  <Label htmlFor="reminderDays">Remind every N days</Label>
                  <Input
                    id="reminderDays"
                    type="number"
                    min={1}
                    value={localSettings.reminderIntervalDays}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      handleChange('reminderIntervalDays', parseInt(e.target.value, 10))
                    }
                  />
                </div>
              )}

              <div className="flex items-center gap-3">
                <Switch
                  id="expirationEnabled"
                  checked={localSettings.expirationEnabled}
                  onCheckedChange={(v) => handleChange('expirationEnabled', v)}
                />
                <Label htmlFor="expirationEnabled" className="cursor-pointer">
                  Enable expiration
                </Label>
              </div>

              {localSettings.expirationEnabled && (
                <div className="space-y-2">
                  <Label htmlFor="expirationDays">Expires after N days</Label>
                  <Input
                    id="expirationDays"
                    type="number"
                    min={1}
                    value={localSettings.expirationDays}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      handleChange('expirationDays', parseInt(e.target.value, 10))
                    }
                  />
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="security">
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                <Switch
                  id="requirePasscode"
                  checked={localSettings.requirePasscode}
                  onCheckedChange={(v) => handleChange('requirePasscode', v)}
                />
                <Label htmlFor="requirePasscode" className="cursor-pointer">
                  Require passcode to open
                </Label>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}



// --- too-many-lines shape: react-tsx-component (PDF viewer with page navigation) ---
declare function useState<T>(init: T | (() => T)): [T, (v: T | ((p: T) => T)) => void];
declare function useEffect(fn: () => (() => void) | void, deps?: unknown[]): void;
declare function useRef<T>(init: T | null): { current: T | null };
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;

type PdfDocument = {
  numPages: number;
  getPage: (pageNum: number) => Promise<PdfPage>;
};
declare class PdfPage {
  getViewport(opts: { scale: number }): PdfViewport;
  render(ctx: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): { promise: Promise<void> };
}
declare class PdfViewport { width: number; height: number; }
declare function loadPdfDocument(url: string): Promise<PdfDocument>;

type DocumentViewerProps = {
  pdfUrl: string;
  initialPage?: number;
  onPageChange?: (page: number) => void;
  className?: string;
};

export function DocumentViewer({
  pdfUrl,
  initialPage = 1,
  onPageChange,
  className,
}: DocumentViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<PdfDocument | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    loadPdfDocument(pdfUrl)
      .then((doc) => {
        if (cancelled) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setIsLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [pdfUrl]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;

    pdfDoc.getPage(currentPage).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      page.render({ canvasContext: ctx, viewport }).promise.then(() => {
        if (!cancelled) onPageChange?.(currentPage);
      });
    });

    return () => { cancelled = true; };
  }, [pdfDoc, currentPage, scale, onPageChange]);

  const goToPrevPage = useCallback(() => {
    setCurrentPage((p) => Math.max(1, p - 1));
  }, []);

  const goToNextPage = useCallback(() => {
    setCurrentPage((p) => Math.min(totalPages, p + 1));
  }, [totalPages]);

  const handleZoomIn = useCallback(() => setScale((s) => Math.min(3, s + 0.25)), []);
  const handleZoomOut = useCallback(() => setScale((s) => Math.max(0.5, s - 0.25)), []);

  return (
    <div className={`flex flex-col ${className ?? ''}`}>
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevPage}
            disabled={currentPage <= 1}
            className="rounded border px-2 py-1 text-sm disabled:opacity-50"
          >
            ‹ Prev
          </button>
          <span className="text-sm">
            Page {currentPage} / {totalPages}
          </span>
          <button
            onClick={goToNextPage}
            disabled={currentPage >= totalPages}
            className="rounded border px-2 py-1 text-sm disabled:opacity-50"
          >
            Next ›
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={handleZoomOut} className="rounded border px-2 py-1 text-sm">−</button>
          <span className="text-sm">{Math.round(scale * 100)}%</span>
          <button onClick={handleZoomIn} className="rounded border px-2 py-1 text-sm">+</button>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-auto bg-gray-100 p-4">
        {isLoading && <div className="text-muted-foreground">Loading document...</div>}
        {error && <div className="text-destructive">{error}</div>}
        <canvas ref={canvasRef} className={isLoading || error ? 'hidden' : ''} />
      </div>
    </div>
  );
}



// --- too-many-lines shape: react-tsx-component (recipient selector for envelope editor) ---
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare const Combobox: (props: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => JSX.Element;
declare const ComboboxTrigger: (props: { className?: string; children: React.ReactNode }) => JSX.Element;
declare const ComboboxContent: (props: { children: React.ReactNode }) => JSX.Element;
declare const ComboboxInput: (props: { placeholder?: string; value: string; onValueChange: (v: string) => void }) => JSX.Element;
declare const ComboboxEmpty: (props: { children: React.ReactNode }) => JSX.Element;
declare const ComboboxItem: (props: { value: string; className?: string; children: React.ReactNode }) => JSX.Element;
declare const Avatar: (props: { className?: string; children: React.ReactNode }) => JSX.Element;
declare const AvatarImage: (props: { src?: string; alt?: string }) => JSX.Element;
declare const AvatarFallback: (props: { children: React.ReactNode }) => JSX.Element;
declare const Badge: (props: { variant?: string; className?: string; children: React.ReactNode }) => JSX.Element;
declare const CheckIcon: (props: { className?: string }) => JSX.Element;

type RecipientOption = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  role?: string;
};

type EnvelopeRecipientSelectorProps = {
  recipients: RecipientOption[];
  selectedRecipientId: string | null;
  onSelect: (recipientId: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

export function EnvelopeRecipientSelector({
  recipients,
  selectedRecipientId,
  onSelect,
  placeholder = 'Select recipient...',
  disabled = false,
}: EnvelopeRecipientSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredRecipients = recipients.filter(
    (r) =>
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.email.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const selectedRecipient = recipients.find((r) => r.id === selectedRecipientId);

  const getInitials = useCallback(
    (name: string) =>
      name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2),
    [],
  );

  return (
    <Combobox value={selectedRecipientId ?? ''} onValueChange={onSelect}>
      <ComboboxTrigger
        className={`flex w-full items-center gap-2 rounded border px-3 py-2 text-left text-sm ${
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-accent'
        }`}
      >
        {selectedRecipient ? (
          <>
            <Avatar className="h-6 w-6">
              <AvatarImage src={selectedRecipient.avatarUrl} alt={selectedRecipient.name} />
              <AvatarFallback>{getInitials(selectedRecipient.name)}</AvatarFallback>
            </Avatar>
            <span className="flex-1 truncate">{selectedRecipient.name}</span>
            {selectedRecipient.role && (
              <Badge variant="outline" className="text-xs">{selectedRecipient.role}</Badge>
            )}
          </>
        ) : (
          <span className="flex-1 text-muted-foreground">{placeholder}</span>
        )}
      </ComboboxTrigger>

      <ComboboxContent>
        <ComboboxInput
          placeholder="Search recipients..."
          value={searchQuery}
          onValueChange={setSearchQuery}
        />

        {filteredRecipients.length === 0 ? (
          <ComboboxEmpty>No recipients found.</ComboboxEmpty>
        ) : (
          filteredRecipients.map((recipient) => (
            <ComboboxItem
              key={recipient.id}
              value={recipient.id}
              className="flex items-center gap-2"
            >
              <Avatar className="h-6 w-6">
                <AvatarImage src={recipient.avatarUrl} alt={recipient.name} />
                <AvatarFallback>{getInitials(recipient.name)}</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="font-medium">{recipient.name}</p>
                <p className="text-xs text-muted-foreground">{recipient.email}</p>
              </div>
              {recipient.role && <Badge variant="outline" className="text-xs">{recipient.role}</Badge>}
              {recipient.id === selectedRecipientId && (
                <CheckIcon className="h-4 w-4 text-primary" />
              )}
            </ComboboxItem>
          ))
        )}
      </ComboboxContent>
    </Combobox>
  );
}



// --- too-many-lines shape: react-tsx-component (team member invite dialog with role select) ---
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare const Dialog: (props: { open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }) => JSX.Element;
declare const DialogContent: (props: { className?: string; children: React.ReactNode }) => JSX.Element;
declare const DialogHeader: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogFooter: (props: { children: React.ReactNode }) => JSX.Element;
declare const Button: (props: { type?: string; variant?: string; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) => JSX.Element;
declare const Input: (props: Record<string, unknown>) => JSX.Element;
declare const Label: (props: { htmlFor?: string; children: React.ReactNode }) => JSX.Element;
declare const Select: (props: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => JSX.Element;
declare const SelectTrigger: (props: { children: React.ReactNode }) => JSX.Element;
declare const SelectValue: (props: { placeholder?: string }) => JSX.Element;
declare const SelectContent: (props: { children: React.ReactNode }) => JSX.Element;
declare const SelectItem: (props: { value: string; children: React.ReactNode }) => JSX.Element;
declare function toast(opts: { title: string; description?: string; variant?: string }): void;

type TeamMemberRole = 'ADMIN' | 'MEMBER';

type InviteMemberFormState = {
  email: string;
  role: TeamMemberRole;
  sendEmailNotification: boolean;
};

type TeamMemberInviteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  onMemberInvited?: (email: string) => void;
};

export function TeamMemberInviteDialog({
  open,
  onOpenChange,
  teamId,
  onMemberInvited,
}: TeamMemberInviteDialogProps) {
  const [form, setForm] = useState<InviteMemberFormState>({
    email: '',
    role: 'MEMBER',
    sendEmailNotification: true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleEmailChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, email: e.target.value }));
    setValidationError(null);
  }, []);

  const handleRoleChange = useCallback((role: string) => {
    setForm((prev) => ({ ...prev, role: role as TeamMemberRole }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!form.email.trim()) {
      setValidationError('Email address is required.');
      return;
    }
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(form.email)) {
      setValidationError('Please enter a valid email address.');
      return;
    }

    setIsSubmitting(true);
    try {
      await inviteTeamMember({ teamId, email: form.email, role: form.role });
      toast({ title: 'Invitation sent', description: `${form.email} has been invited to the team.` });
      setForm({ email: '', role: 'MEMBER', sendEmailNotification: true });
      onOpenChange(false);
      onMemberInvited?.(form.email);
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  }, [form, teamId, onOpenChange, onMemberInvited]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
          <DialogDescription>
            Invite someone to join this team. They will receive an email with instructions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="inviteEmail">Email Address</Label>
            <Input
              id="inviteEmail"
              type="email"
              placeholder="colleague@company.com"
              value={form.email}
              onChange={handleEmailChange}
            />
            {validationError && (
              <p className="text-sm text-destructive">{validationError}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={handleRoleChange}>
              <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MEMBER">Member — Can view and sign documents</SelectItem>
                <SelectItem value="ADMIN">Admin — Can manage team settings and members</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Sending...' : 'Send Invitation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

declare function inviteTeamMember(opts: { teamId: string; email: string; role: TeamMemberRole }): Promise<void>;



// --- too-many-lines shape: react-tsx-component (direct link settings dialog with copy/toggle) ---
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare const Dialog: (props: { open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }) => JSX.Element;
declare const DialogContent: (props: { className?: string; children: React.ReactNode }) => JSX.Element;
declare const DialogHeader: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogFooter: (props: { children: React.ReactNode }) => JSX.Element;
declare const Button: (props: { type?: string; variant?: string; disabled?: boolean; size?: string; onClick?: () => void; children: React.ReactNode }) => JSX.Element;
declare const Input: (props: Record<string, unknown>) => JSX.Element;
declare const Label: (props: { htmlFor?: string; className?: string; children: React.ReactNode }) => JSX.Element;
declare const Switch: (props: { id?: string; checked: boolean; onCheckedChange: (v: boolean) => void }) => JSX.Element;
declare const Alert: (props: { className?: string; children: React.ReactNode }) => JSX.Element;
declare const AlertDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const CopyIcon: (props: { className?: string }) => JSX.Element;
declare const RefreshCwIcon: (props: { className?: string }) => JSX.Element;
declare function toast(opts: { title: string; description?: string }): void;

type DirectLinkConfig = {
  enabled: boolean;
  token: string;
  url: string;
  expiresAt?: string;
  requireAuth: boolean;
};

type DirectLinkDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  directLink: DirectLinkConfig | null;
  onUpdate: (config: Partial<DirectLinkConfig>) => Promise<void>;
};

export function DirectLinkDialog({
  open,
  onOpenChange,
  templateId,
  directLink,
  onUpdate,
}: DirectLinkDialogProps) {
  const [isEnabled, setIsEnabled] = useState(directLink?.enabled ?? false);
  const [requireAuth, setRequireAuth] = useState(directLink?.requireAuth ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const handleToggleEnabled = useCallback(async (enabled: boolean) => {
    setIsEnabled(enabled);
    setIsSaving(true);
    try {
      await onUpdate({ enabled });
      toast({ title: enabled ? 'Direct link enabled' : 'Direct link disabled' });
    } finally {
      setIsSaving(false);
    }
  }, [onUpdate]);

  const handleToggleRequireAuth = useCallback(async (requireAuth: boolean) => {
    setRequireAuth(requireAuth);
    setIsSaving(true);
    try {
      await onUpdate({ requireAuth });
      toast({ title: 'Direct link updated' });
    } finally {
      setIsSaving(false);
    }
  }, [onUpdate]);

  const handleCopyLink = useCallback(() => {
    if (directLink?.url) {
      navigator.clipboard.writeText(directLink.url);
      toast({ title: 'Link copied', description: 'Direct link copied to clipboard.' });
    }
  }, [directLink]);

  const handleRegenerateToken = useCallback(async () => {
    setIsRegenerating(true);
    try {
      await regenerateDirectLinkToken(templateId);
      toast({ title: 'Token regenerated', description: 'The direct link token has been regenerated.' });
    } finally {
      setIsRegenerating(false);
    }
  }, [templateId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Direct Link Settings</DialogTitle>
          <DialogDescription>
            Allow anyone with the link to access and use this template without logging in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-medium">Enable Direct Link</Label>
              <p className="text-sm text-muted-foreground">Share a public link for this template.</p>
            </div>
            <Switch
              id="enabled"
              checked={isEnabled}
              onCheckedChange={handleToggleEnabled}
            />
          </div>

          {isEnabled && directLink && (
            <>
              <div className="space-y-2">
                <Label>Direct Link URL</Label>
                <div className="flex gap-2">
                  <Input value={directLink.url} readOnly className="flex-1 text-xs" />
                  <Button size="sm" variant="outline" onClick={handleCopyLink}>
                    <CopyIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium">Require Authentication</Label>
                  <p className="text-sm text-muted-foreground">Signers must create an account.</p>
                </div>
                <Switch
                  id="requireAuth"
                  checked={requireAuth}
                  onCheckedChange={handleToggleRequireAuth}
                />
              </div>

              <div className="space-y-2">
                <Label>Danger Zone</Label>
                <Alert className="border-destructive">
                  <AlertDescription className="flex items-center justify-between">
                    <span className="text-sm">Regenerate token to invalidate existing links.</span>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleRegenerateToken}
                      disabled={isRegenerating}
                    >
                      <RefreshCwIcon className="mr-1 h-3 w-3" />
                      {isRegenerating ? 'Regenerating...' : 'Regenerate'}
                    </Button>
                  </AlertDescription>
                </Alert>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

declare function regenerateDirectLinkToken(templateId: string): Promise<void>;



// --- too-many-lines shape: react-tsx-component (drop zone wrapper with drag state) ---
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function useRef<T>(init: T | null): { current: T | null };
declare function cn(...classes: (string | boolean | undefined | null)[]): string;

type DropZoneWrapperProps = {
  onFilesDropped: (files: File[]) => void;
  accept?: string[];
  maxFiles?: number;
  maxSizeMb?: number;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
};

export function DropZoneWrapper({
  onFilesDropped,
  accept = ['application/pdf'],
  maxFiles = 10,
  maxSizeMb = 50,
  disabled = false,
  children,
  className,
}: DropZoneWrapperProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);
  const dragCounterRef = useRef(0);

  const validateFiles = useCallback(
    (files: File[]): { valid: File[]; error: string | null } => {
      if (files.length > maxFiles) {
        return { valid: [], error: `Maximum ${maxFiles} file${maxFiles !== 1 ? 's' : ''} allowed.` };
      }
      const oversized = files.filter((f) => f.size > maxSizeMb * 1024 * 1024);
      if (oversized.length > 0) {
        return { valid: [], error: `Files must be under ${maxSizeMb}MB each.` };
      }
      const wrongType = accept.length > 0 ? files.filter((f) => !accept.includes(f.type)) : [];
      if (wrongType.length > 0) {
        return { valid: [], error: `Only ${accept.join(', ')} files are accepted.` };
      }
      return { valid: files, error: null };
    },
    [accept, maxFiles, maxSizeMb],
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (disabled) return;
      dragCounterRef.current += 1;
      if (dragCounterRef.current === 1) {
        setIsDragOver(true);
        setDragError(null);
      }
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragOver(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files);
      const { valid, error } = validateFiles(files);
      if (error) {
        setDragError(error);
        return;
      }
      onFilesDropped(valid);
    },
    [disabled, validateFiles, onFilesDropped],
  );

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        'relative',
        isDragOver && !disabled && 'ring-2 ring-primary ring-offset-2',
        disabled && 'pointer-events-none',
        className,
      )}
    >
      {children}

      {isDragOver && !disabled && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-lg bg-primary/10 backdrop-blur-sm">
          <div className="rounded-lg border-2 border-dashed border-primary bg-background px-8 py-6 text-center">
            <p className="text-lg font-semibold text-primary">Drop files here</p>
            <p className="text-sm text-muted-foreground">
              Up to {maxFiles} file{maxFiles !== 1 ? 's' : ''}, max {maxSizeMb}MB each
            </p>
          </div>
        </div>
      )}

      {dragError && (
        <div className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded bg-destructive px-4 py-2 text-sm text-destructive-foreground shadow">
          {dragError}
        </div>
      )}
    </div>
  );
}



// --- too-many-lines shape: react-tsx-component (mobile navigation with sheet) ---
declare function useState<T>(init: T): [T, (v: T) => void];
declare const Sheet: (props: { open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }) => JSX.Element;
declare const SheetContent: (props: { side?: string; className?: string; children: React.ReactNode }) => JSX.Element;
declare const SheetHeader: (props: { children: React.ReactNode }) => JSX.Element;
declare const SheetTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const MenuIcon: (props: { className?: string }) => JSX.Element;
declare const XIcon: (props: { className?: string }) => JSX.Element;
declare const HomeIcon: (props: { className?: string }) => JSX.Element;
declare const FileTextIcon: (props: { className?: string }) => JSX.Element;
declare const UsersIcon: (props: { className?: string }) => JSX.Element;
declare const SettingsIcon: (props: { className?: string }) => JSX.Element;
declare const BellIcon: (props: { className?: string }) => JSX.Element;
declare const Avatar: (props: { className?: string; children: React.ReactNode }) => JSX.Element;
declare const AvatarImage: (props: { src?: string; alt?: string }) => JSX.Element;
declare const AvatarFallback: (props: { children: React.ReactNode }) => JSX.Element;
declare function cn(...cls: (string | boolean | undefined)[]): string;

type NavItem = { label: string; href: string; icon: React.ReactNode; active?: boolean };

type MobileAppNavProps = {
  user: { name: string; email: string; avatarUrl?: string };
  navItems: NavItem[];
  orgName?: string;
  notificationCount?: number;
};

export function MobileAppNav({
  user,
  navItems,
  orgName,
  notificationCount = 0,
}: MobileAppNavProps) {
  const [isOpen, setIsOpen] = useState(false);

  const getInitials = (name: string) =>
    name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <>
      <div className="flex items-center justify-between border-b px-4 py-3 lg:hidden">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsOpen(true)}
            className="rounded-md p-1.5 hover:bg-accent"
            aria-label="Open navigation"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          {orgName && <span className="font-semibold">{orgName}</span>}
        </div>

        <div className="flex items-center gap-2">
          {notificationCount > 0 && (
            <button className="relative rounded-full p-1.5 hover:bg-accent">
              <BellIcon className="h-5 w-5" />
              <span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                {notificationCount > 9 ? '9+' : notificationCount}
              </span>
            </button>
          )}
          <Avatar className="h-7 w-7">
            <AvatarImage src={user.avatarUrl} alt={user.name} />
            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
          </Avatar>
        </div>
      </div>

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="flex items-center justify-between">
              <span>{orgName ?? 'Navigation'}</span>
              <button onClick={() => setIsOpen(false)} className="rounded-md p-1 hover:bg-accent">
                <XIcon className="h-5 w-5" />
              </button>
            </SheetTitle>
          </SheetHeader>

          <nav className="flex flex-col p-3">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  item.active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-accent',
                )}
              >
                {item.icon}
                {item.label}
              </a>
            ))}
          </nav>

          <div className="absolute bottom-0 left-0 right-0 border-t p-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarImage src={user.avatarUrl} alt={user.name} />
                <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 overflow-hidden">
                <p className="truncate font-medium text-sm">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}



// --- too-many-lines shape: react-tsx-component (signing page renderer with field overlays) ---
declare function useState<T>(init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare const SignatureField: (props: { fieldId: string; page: number; x: number; y: number; width: number; height: number; signed: boolean; onSign: (id: string) => void }) => JSX.Element;
declare const TextField: (props: { fieldId: string; page: number; x: number; y: number; width: number; height: number; value: string; onChange: (id: string, v: string) => void }) => JSX.Element;
declare const DateField: (props: { fieldId: string; page: number; x: number; y: number; width: number; height: number; value: string; onChange: (id: string, v: string) => void }) => JSX.Element;
declare const CheckboxField: (props: { fieldId: string; page: number; x: number; y: number; width: number; height: number; checked: boolean; onToggle: (id: string) => void }) => JSX.Element;

type SigningField = {
  id: string;
  type: 'SIGNATURE' | 'TEXT' | 'DATE' | 'CHECKBOX';
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
};

type FieldValues = Record<string, string | boolean>;

type SignerPageRendererProps = {
  pdfPageCount: number;
  fields: SigningField[];
  fieldValues: FieldValues;
  onFieldChange: (fieldId: string, value: string | boolean) => void;
  onSign: (fieldId: string) => void;
  currentPage: number;
  scale?: number;
};

export function SignerPageRenderer({
  pdfPageCount,
  fields,
  fieldValues,
  onFieldChange,
  onSign,
  currentPage,
  scale = 1,
}: SignerPageRendererProps) {
  const pageFields = useMemo(
    () => fields.filter((f) => f.page === currentPage),
    [fields, currentPage],
  );

  const handleTextChange = useCallback(
    (id: string, value: string) => onFieldChange(id, value),
    [onFieldChange],
  );

  const handleDateChange = useCallback(
    (id: string, value: string) => onFieldChange(id, value),
    [onFieldChange],
  );

  const handleCheckboxToggle = useCallback(
    (id: string) => onFieldChange(id, !(fieldValues[id] as boolean)),
    [fieldValues, onFieldChange],
  );

  return (
    <div
      className="relative"
      style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
    >
      {/* PDF canvas rendered separately — field overlays sit on top */}

      {pageFields.map((field) => {
        const style = {
          position: 'absolute' as const,
          left: field.x,
          top: field.y,
          width: field.width,
          height: field.height,
        };

        return (
          <div key={field.id} style={style}>
            {field.type === 'SIGNATURE' && (
              <SignatureField
                fieldId={field.id}
                page={field.page}
                x={field.x}
                y={field.y}
                width={field.width}
                height={field.height}
                signed={Boolean(fieldValues[field.id])}
                onSign={onSign}
              />
            )}
            {field.type === 'TEXT' && (
              <TextField
                fieldId={field.id}
                page={field.page}
                x={field.x}
                y={field.y}
                width={field.width}
                height={field.height}
                value={(fieldValues[field.id] as string) ?? ''}
                onChange={handleTextChange}
              />
            )}
            {field.type === 'DATE' && (
              <DateField
                fieldId={field.id}
                page={field.page}
                x={field.x}
                y={field.y}
                width={field.width}
                height={field.height}
                value={(fieldValues[field.id] as string) ?? ''}
                onChange={handleDateChange}
              />
            )}
            {field.type === 'CHECKBOX' && (
              <CheckboxField
                fieldId={field.id}
                page={field.page}
                x={field.x}
                y={field.y}
                width={field.width}
                height={field.height}
                checked={Boolean(fieldValues[field.id])}
                onToggle={handleCheckboxToggle}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}



// --- too-many-lines shape: react-tsx-component (folder move dialog with tree picker) ---
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare const Dialog: (props: { open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }) => JSX.Element;
declare const DialogContent: (props: { className?: string; children: React.ReactNode }) => JSX.Element;
declare const DialogHeader: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogFooter: (props: { children: React.ReactNode }) => JSX.Element;
declare const Button: (props: { type?: string; variant?: string; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) => JSX.Element;
declare const Input: (props: Record<string, unknown>) => JSX.Element;
declare const FolderIcon: (props: { className?: string }) => JSX.Element;
declare const FolderOpenIcon: (props: { className?: string }) => JSX.Element;
declare const ChevronRightIcon: (props: { className?: string }) => JSX.Element;
declare const CheckIcon: (props: { className?: string }) => JSX.Element;
declare function cn(...cls: (string | boolean | undefined | null)[]): string;
declare function toast(opts: { title: string; description?: string; variant?: string }): void;

type FolderNode = {
  id: string;
  name: string;
  parentId: string | null;
  children?: FolderNode[];
};

type FolderMoveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemName: string;
  itemId: string;
  currentFolderId: string | null;
  folders: FolderNode[];
  onMove: (itemId: string, targetFolderId: string | null) => Promise<void>;
};

export function FolderMoveDialog({
  open,
  onOpenChange,
  itemName,
  itemId,
  currentFolderId,
  folders,
  onMove,
}: FolderMoveDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(currentFolderId);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isMoving, setIsMoving] = useState(false);

  const rootFolders = useMemo(
    () => folders.filter((f) => f.parentId === null),
    [folders],
  );

  const toggleExpand = useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const handleMove = useCallback(async () => {
    if (selectedFolderId === currentFolderId) {
      onOpenChange(false);
      return;
    }
    setIsMoving(true);
    try {
      await onMove(itemId, selectedFolderId);
      toast({ title: 'Moved', description: `${itemName} has been moved successfully.` });
      onOpenChange(false);
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setIsMoving(false);
    }
  }, [selectedFolderId, currentFolderId, itemId, itemName, onMove, onOpenChange]);

  const renderFolder = (folder: FolderNode, depth = 0): React.ReactNode => {
    const isExpanded = expandedFolderIds.has(folder.id);
    const isSelected = selectedFolderId === folder.id;
    const hasChildren = folder.children && folder.children.length > 0;
    const matchesSearch = folder.name.toLowerCase().includes(searchQuery.toLowerCase());

    if (searchQuery && !matchesSearch) return null;

    return (
      <div key={folder.id}>
        <button
          className={cn(
            'flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent',
            isSelected && 'bg-primary/10 text-primary',
          )}
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => setSelectedFolderId(folder.id)}
        >
          {hasChildren ? (
            <span
              onClick={(e) => { e.stopPropagation(); toggleExpand(folder.id); }}
              className="mr-0.5"
            >
              <ChevronRightIcon className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-90')} />
            </span>
          ) : (
            <span className="mr-0.5 w-3" />
          )}
          {isExpanded ? (
            <FolderOpenIcon className="h-4 w-4 shrink-0 text-amber-500" />
          ) : (
            <FolderIcon className="h-4 w-4 shrink-0 text-amber-500" />
          )}
          <span className="flex-1 truncate text-left">{folder.name}</span>
          {isSelected && <CheckIcon className="h-4 w-4 text-primary" />}
        </button>
        {isExpanded && folder.children?.map((child) => renderFolder(child, depth + 1))}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move "{itemName}"</DialogTitle>
          <DialogDescription>Select a folder to move this item into.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Input
            placeholder="Search folders..."
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
          />

          <div className="max-h-64 overflow-y-auto rounded border p-2">
            <button
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent',
                selectedFolderId === null && 'bg-primary/10 text-primary',
              )}
              onClick={() => setSelectedFolderId(null)}
            >
              <FolderIcon className="h-4 w-4 shrink-0" />
              <span>Root (no folder)</span>
              {selectedFolderId === null && <CheckIcon className="ml-auto h-4 w-4 text-primary" />}
            </button>

            {rootFolders.map((folder) => renderFolder(folder))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isMoving}>
            Cancel
          </Button>
          <Button onClick={handleMove} disabled={isMoving}>
            {isMoving ? 'Moving...' : 'Move Here'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



// --- too-many-lines shape: react-tsx-component (document signing auth provider context) ---
declare function useState<T>(init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function createContext<T>(init: T): React.Context<T>;
declare function useContext<T>(ctx: React.Context<T>): T;
declare const React: { createContext: typeof createContext; useContext: typeof useContext; ReactNode: unknown };

type AuthMethod = 'EMAIL_OTP' | 'SMS_OTP' | 'PASSKEY' | 'PASSWORD';

type AuthState = {
  isAuthenticated: boolean;
  authMethod: AuthMethod | null;
  recipientId: string | null;
  completedAt?: Date;
};

type SigningAuthActions = {
  markAuthenticated: (method: AuthMethod, recipientId: string) => void;
  clearAuth: () => void;
  requireAuth: (method: AuthMethod) => void;
};

type SigningAuthContextValue = AuthState & SigningAuthActions & {
  requiredMethod: AuthMethod | null;
  isAuthRequired: boolean;
};

const SigningAuthContext = createContext<SigningAuthContextValue>({
  isAuthenticated: false,
  authMethod: null,
  recipientId: null,
  markAuthenticated: () => {},
  clearAuth: () => {},
  requireAuth: () => {},
  requiredMethod: null,
  isAuthRequired: false,
});

export function useSigningAuth() {
  return useContext(SigningAuthContext);
}

type DocumentSigningAuthProviderProps = {
  children: React.ReactNode;
  initialRecipientId?: string;
  requiredAuthMethod?: AuthMethod;
};

export function DocumentSigningAuthProvider({
  children,
  initialRecipientId,
  requiredAuthMethod,
}: DocumentSigningAuthProviderProps) {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    authMethod: null,
    recipientId: initialRecipientId ?? null,
  });
  const [requiredMethod, setRequiredMethod] = useState<AuthMethod | null>(requiredAuthMethod ?? null);

  const markAuthenticated = useCallback((method: AuthMethod, recipientId: string) => {
    setAuthState({
      isAuthenticated: true,
      authMethod: method,
      recipientId,
      completedAt: new Date(),
    });
  }, []);

  const clearAuth = useCallback(() => {
    setAuthState({
      isAuthenticated: false,
      authMethod: null,
      recipientId: initialRecipientId ?? null,
    });
  }, [initialRecipientId]);

  const requireAuth = useCallback((method: AuthMethod) => {
    setRequiredMethod(method);
  }, []);

  const isAuthRequired = requiredMethod !== null && !authState.isAuthenticated;

  const value: SigningAuthContextValue = {
    ...authState,
    markAuthenticated,
    clearAuth,
    requireAuth,
    requiredMethod,
    isAuthRequired,
  };

  return (
    <SigningAuthContext.Provider value={value}>
      {children}
    </SigningAuthContext.Provider>
  );
}



// --- too-many-lines shape: react-tsx-component (webhook create dialog with URL + events) ---
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare const Dialog: (props: { open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }) => JSX.Element;
declare const DialogContent: (props: { className?: string; children: React.ReactNode }) => JSX.Element;
declare const DialogHeader: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogFooter: (props: { children: React.ReactNode }) => JSX.Element;
declare const Button: (props: { type?: string; variant?: string; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) => JSX.Element;
declare const Input: (props: Record<string, unknown>) => JSX.Element;
declare const Label: (props: { htmlFor?: string; children: React.ReactNode }) => JSX.Element;
declare const Checkbox: (props: { id: string; checked: boolean; onCheckedChange: (v: boolean) => void }) => JSX.Element;
declare function toast(opts: { title: string; description?: string; variant?: string }): void;

type WebhookEvent =
  | 'document.created'
  | 'document.sent'
  | 'document.signed'
  | 'document.completed'
  | 'document.voided'
  | 'recipient.signed';

const WEBHOOK_EVENTS: { value: WebhookEvent; label: string; description: string }[] = [
  { value: 'document.created', label: 'Document Created', description: 'Fires when a document is created.' },
  { value: 'document.sent', label: 'Document Sent', description: 'Fires when a document is sent to recipients.' },
  { value: 'document.signed', label: 'Document Signed', description: 'Fires when a recipient signs.' },
  { value: 'document.completed', label: 'Document Completed', description: 'Fires when all recipients have signed.' },
  { value: 'document.voided', label: 'Document Voided', description: 'Fires when a document is voided.' },
  { value: 'recipient.signed', label: 'Recipient Signed', description: 'Fires for each individual signature.' },
];

type WebhookCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  onCreated?: (webhookId: string) => void;
};

export function WebhookCreateDialog({
  open,
  onOpenChange,
  teamId,
  onCreated,
}: WebhookCreateDialogProps) {
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<Set<WebhookEvent>>(new Set());
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleEvent = useCallback((event: WebhookEvent) => {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!url.trim()) { setUrlError('Webhook URL is required.'); return; }
    try { new URL(url); } catch { setUrlError('Please enter a valid URL.'); return; }
    if (selectedEvents.size === 0) { setUrlError('Select at least one event to subscribe to.'); return; }
    setUrlError(null);
    setIsSubmitting(true);
    try {
      const webhook = await createWebhook({ teamId, url, secret, events: Array.from(selectedEvents) });
      toast({ title: 'Webhook created', description: 'Your webhook endpoint has been registered.' });
      onOpenChange(false);
      onCreated?.(webhook.id);
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  }, [url, secret, selectedEvents, teamId, onOpenChange, onCreated]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Webhook</DialogTitle>
          <DialogDescription>
            Register an endpoint to receive real-time notifications about events in your account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          <div className="space-y-2">
            <Label htmlFor="webhookUrl">Endpoint URL</Label>
            <Input
              id="webhookUrl"
              type="url"
              placeholder="https://your-server.com/webhook"
              value={url}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setUrl(e.target.value); setUrlError(null); }}
            />
            {urlError && <p className="text-sm text-destructive">{urlError}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhookSecret">Secret (optional)</Label>
            <Input
              id="webhookSecret"
              type="password"
              placeholder="Used to verify webhook payloads"
              value={secret}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSecret(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            <Label>Events to Subscribe</Label>
            {WEBHOOK_EVENTS.map((event) => (
              <div key={event.value} className="flex items-start gap-3">
                <Checkbox
                  id={event.value}
                  checked={selectedEvents.has(event.value)}
                  onCheckedChange={() => toggleEvent(event.value)}
                />
                <div>
                  <label htmlFor={event.value} className="cursor-pointer font-medium text-sm">
                    {event.label}
                  </label>
                  <p className="text-xs text-muted-foreground">{event.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create Webhook'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

declare function createWebhook(opts: { teamId: string; url: string; secret: string; events: WebhookEvent[] }): Promise<{ id: string }>;



// --- too-many-lines shape: react-tsx-component (passkey create dialog with device registration) ---
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare const Dialog: (props: { open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }) => JSX.Element;
declare const DialogContent: (props: { className?: string; children: React.ReactNode }) => JSX.Element;
declare const DialogHeader: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogFooter: (props: { children: React.ReactNode }) => JSX.Element;
declare const Button: (props: { type?: string; variant?: string; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) => JSX.Element;
declare const Input: (props: Record<string, unknown>) => JSX.Element;
declare const Label: (props: { htmlFor?: string; children: React.ReactNode }) => JSX.Element;
declare const Alert: (props: { variant?: string; className?: string; children: React.ReactNode }) => JSX.Element;
declare const AlertDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const FingerprintIcon: (props: { className?: string }) => JSX.Element;
declare function toast(opts: { title: string; description?: string; variant?: string }): void;

type PasskeyCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onPasskeyCreated?: (passkeyId: string) => void;
};

type PasskeyRegistrationStep = 'naming' | 'authenticating' | 'success' | 'error';

export function PasskeyCreateDialog({
  open,
  onOpenChange,
  userId,
  onPasskeyCreated,
}: PasskeyCreateDialogProps) {
  const [passkeyName, setPasskeyName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [step, setStep] = useState<PasskeyRegistrationStep>('naming');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isSupported = typeof window !== 'undefined' && 'credentials' in navigator;

  const handleRegister = useCallback(async () => {
    if (!passkeyName.trim()) {
      setNameError('Please give your passkey a name (e.g. "MacBook Touch ID").');
      return;
    }
    setNameError(null);
    setStep('authenticating');
    try {
      const challenge = await fetchRegistrationChallenge(userId);
      const credential = await navigator.credentials.create(challenge as CredentialCreationOptions);
      if (!credential) throw new Error('Registration cancelled.');
      const passkeyId = await savePasskeyCredential(userId, passkeyName, credential as PublicKeyCredential);
      setStep('success');
      toast({ title: 'Passkey registered', description: `"${passkeyName}" is now set up.` });
      onPasskeyCreated?.(passkeyId);
    } catch (err) {
      setErrorMessage((err as Error).message);
      setStep('error');
    }
  }, [passkeyName, userId, onPasskeyCreated]);

  const handleClose = useCallback(() => {
    setPasskeyName('');
    setNameError(null);
    setStep('naming');
    setErrorMessage(null);
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FingerprintIcon className="h-5 w-5" />
            Register Passkey
          </DialogTitle>
          <DialogDescription>
            Passkeys use your device&apos;s biometrics or PIN for fast, secure sign-in.
          </DialogDescription>
        </DialogHeader>

        {!isSupported && (
          <Alert variant="destructive">
            <AlertDescription>
              Your browser does not support passkeys. Please try a modern browser like Chrome or Safari.
            </AlertDescription>
          </Alert>
        )}

        {step === 'naming' && isSupported && (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="passkeyName">Passkey Name</Label>
              <Input
                id="passkeyName"
                placeholder="e.g. MacBook Touch ID, iPhone Face ID"
                value={passkeyName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setPasskeyName(e.target.value);
                  setNameError(null);
                }}
              />
              {nameError && <p className="text-sm text-destructive">{nameError}</p>}
            </div>
            <p className="text-sm text-muted-foreground">
              Your device will prompt you to authenticate using biometrics or your device PIN.
            </p>
          </div>
        )}

        {step === 'authenticating' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <FingerprintIcon className="h-16 w-16 animate-pulse text-primary" />
            <p className="text-center text-sm">Follow the prompts on your device to complete registration...</p>
          </div>
        )}

        {step === 'success' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-center font-medium text-primary">Passkey registered successfully!</p>
            <p className="text-center text-sm text-muted-foreground">You can now use "{passkeyName}" to sign in.</p>
          </div>
        )}

        {step === 'error' && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage ?? 'Registration failed. Please try again.'}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          {step === 'naming' && (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleRegister} disabled={!isSupported}>Register Passkey</Button>
            </>
          )}
          {(step === 'success' || step === 'error') && (
            <Button onClick={handleClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

declare function fetchRegistrationChallenge(userId: string): Promise<unknown>;
declare function savePasskeyCredential(userId: string, name: string, credential: PublicKeyCredential): Promise<string>;
declare class PublicKeyCredential {}



// --- too-many-lines shape: react custom hook (editor recipients hook) ---
declare function useState<T>(init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare function useEffect(fn: () => (() => void) | void, deps?: unknown[]): void;

type RecipientRole = 'SIGNER' | 'VIEWER' | 'APPROVER' | 'CC';

type EditorRecipient = {
  id: string;
  name: string;
  email: string;
  role: RecipientRole;
  signingOrder: number;
  color: string;
  fieldCount: number;
};

type UseEditorRecipientsOptions = {
  initialRecipients?: EditorRecipient[];
  onRecipientAdded?: (recipient: EditorRecipient) => void;
  onRecipientRemoved?: (recipientId: string) => void;
  onRecipientUpdated?: (recipient: EditorRecipient) => void;
};

type UseEditorRecipientsReturn = {
  recipients: EditorRecipient[];
  selectedRecipientId: string | null;
  selectRecipient: (id: string | null) => void;
  addRecipient: (partialRecipient: Omit<EditorRecipient, 'id' | 'signingOrder' | 'color' | 'fieldCount'>) => EditorRecipient;
  removeRecipient: (id: string) => void;
  updateRecipient: (id: string, updates: Partial<EditorRecipient>) => void;
  reorderRecipients: (fromIndex: number, toIndex: number) => void;
  recipientCount: number;
  signerCount: number;
};

const RECIPIENT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export function useEditorRecipients({
  initialRecipients = [],
  onRecipientAdded,
  onRecipientRemoved,
  onRecipientUpdated,
}: UseEditorRecipientsOptions = {}): UseEditorRecipientsReturn {
  const [recipients, setRecipients] = useState<EditorRecipient[]>(initialRecipients);
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(
    initialRecipients[0]?.id ?? null,
  );

  const selectRecipient = useCallback((id: string | null) => {
    setSelectedRecipientId(id);
  }, []);

  const addRecipient = useCallback(
    (partialRecipient: Omit<EditorRecipient, 'id' | 'signingOrder' | 'color' | 'fieldCount'>) => {
      const newRecipient: EditorRecipient = {
        ...partialRecipient,
        id: Math.random().toString(36).slice(2),
        signingOrder: recipients.length + 1,
        color: RECIPIENT_COLORS[recipients.length % RECIPIENT_COLORS.length],
        fieldCount: 0,
      };
      setRecipients((prev) => [...prev, newRecipient]);
      onRecipientAdded?.(newRecipient);
      return newRecipient;
    },
    [recipients.length, onRecipientAdded],
  );

  const removeRecipient = useCallback(
    (id: string) => {
      setRecipients((prev) => {
        const filtered = prev.filter((r) => r.id !== id);
        return filtered.map((r, i) => ({ ...r, signingOrder: i + 1 }));
      });
      setSelectedRecipientId((prev) => (prev === id ? null : prev));
      onRecipientRemoved?.(id);
    },
    [onRecipientRemoved],
  );

  const updateRecipient = useCallback(
    (id: string, updates: Partial<EditorRecipient>) => {
      setRecipients((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          const updated = { ...r, ...updates };
          onRecipientUpdated?.(updated);
          return updated;
        }),
      );
    },
    [onRecipientUpdated],
  );

  const reorderRecipients = useCallback((fromIndex: number, toIndex: number) => {
    setRecipients((prev) => {
      const result = [...prev];
      const [moved] = result.splice(fromIndex, 1);
      result.splice(toIndex, 0, moved);
      return result.map((r, i) => ({ ...r, signingOrder: i + 1 }));
    });
  }, []);

  const recipientCount = useMemo(() => recipients.length, [recipients]);
  const signerCount = useMemo(() => recipients.filter((r) => r.role === 'SIGNER').length, [recipients]);

  return {
    recipients,
    selectedRecipientId,
    selectRecipient,
    addRecipient,
    removeRecipient,
    updateRecipient,
    reorderRecipients,
    recipientCount,
    signerCount,
  };
}



// --- too-many-lines shape: react-tsx-component (AI features enable dialog) ---
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare const Dialog: (props: { open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }) => JSX.Element;
declare const DialogContent: (props: { className?: string; children: React.ReactNode }) => JSX.Element;
declare const DialogHeader: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogFooter: (props: { children: React.ReactNode }) => JSX.Element;
declare const Button: (props: { type?: string; variant?: string; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) => JSX.Element;
declare const Alert: (props: { variant?: string; children: React.ReactNode }) => JSX.Element;
declare const AlertDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const SparklesIcon: (props: { className?: string }) => JSX.Element;
declare function toast(opts: { title: string; description?: string; variant?: string }): void;

type AiFeaturesEnableDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  onEnabled?: () => void;
};

type EnableStep = 'review' | 'enabling' | 'success' | 'error';

export function AiFeaturesEnableDialog({
  open,
  onOpenChange,
  orgId,
  onEnabled,
}: AiFeaturesEnableDialogProps) {
  const [step, setStep] = useState<EnableStep>('review');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasAccepted, setHasAccepted] = useState(false);

  const handleEnable = useCallback(async () => {
    if (!hasAccepted) return;
    setStep('enabling');
    try {
      await enableAiFeatures(orgId);
      setStep('success');
      toast({ title: 'AI features enabled', description: 'AI-assisted capabilities are now available.' });
      onEnabled?.();
    } catch (err) {
      setErrorMessage((err as Error).message);
      setStep('error');
    }
  }, [hasAccepted, orgId, onEnabled]);

  const handleClose = useCallback(() => {
    setStep('review');
    setHasAccepted(false);
    setErrorMessage(null);
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="h-5 w-5 text-primary" />
            Enable AI Features
          </DialogTitle>
          <DialogDescription>
            AI-powered capabilities can help your team work more efficiently.
          </DialogDescription>
        </DialogHeader>

        {step === 'review' && (
          <div className="space-y-4 py-4">
            <div className="space-y-3">
              <h3 className="font-medium">What you&apos;re enabling:</h3>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <SparklesIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  AI-assisted document analysis and field detection
                </li>
                <li className="flex items-start gap-2">
                  <SparklesIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  Smart recipient suggestions based on document content
                </li>
                <li className="flex items-start gap-2">
                  <SparklesIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  Automated reminder optimization
                </li>
              </ul>
            </div>

            <Alert>
              <AlertDescription className="text-sm">
                By enabling AI features, document content may be sent to an AI provider for processing.
                No document data is stored or used for model training.
              </AlertDescription>
            </Alert>

            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                id="accept-ai-terms"
                checked={hasAccepted}
                onChange={(e) => setHasAccepted(e.target.checked)}
                className="mt-0.5"
              />
              <label htmlFor="accept-ai-terms" className="cursor-pointer text-sm">
                I understand and agree to the AI data processing terms.
              </label>
            </div>
          </div>
        )}

        {step === 'enabling' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <SparklesIcon className="h-12 w-12 animate-pulse text-primary" />
            <p className="text-center text-sm">Enabling AI features for your organisation...</p>
          </div>
        )}

        {step === 'success' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-center font-medium text-primary">AI features are now enabled!</p>
            <p className="text-center text-sm text-muted-foreground">
              Your team can now use AI-powered capabilities across the platform.
            </p>
          </div>
        )}

        {step === 'error' && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage ?? 'Failed to enable AI features. Please try again.'}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          {step === 'review' && (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleEnable} disabled={!hasAccepted}>
                Enable AI Features
              </Button>
            </>
          )}
          {(step === 'success' || step === 'error') && (
            <Button onClick={handleClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

declare function enableAiFeatures(orgId: string): Promise<void>;



declare const useForm: <T>(opts: any) => { control: any; handleSubmit: (fn: any) => any; watch: (name?: string) => any; setValue: (name: string, val: any) => void; getValues: (name?: string) => any; formState: { isSubmitting: boolean } };
declare const FormField: (props: { control: any; name: string; render: (args: { field: any }) => JSX.Element }) => JSX.Element;
declare const FormItem: (props: { children?: any; className?: string }) => JSX.Element;
declare const FormControl: (props: { children?: any }) => JSX.Element;
declare const FormMessage: (props?: any) => JSX.Element;
declare const FormLabel: (props: { children?: any }) => JSX.Element;
declare const Input: (props: any) => JSX.Element;
declare const Button: (props: any) => JSX.Element;
declare const Select: (props: any) => JSX.Element;
declare const SelectTrigger: (props: any) => JSX.Element;
declare const SelectValue: (props: any) => JSX.Element;
declare const SelectContent: (props: any) => JSX.Element;
declare const SelectItem: (props: { value: string; children?: any }) => JSX.Element;
declare const Checkbox: (props: any) => JSX.Element;
declare const zodResolver: (schema: any) => any;
declare const z: any;
declare const useFieldArray: (opts: any) => { fields: any[]; append: (val: any) => void; remove: (idx: number) => void };
declare const useToast: () => { toast: (opts: any) => void };
declare const trpc: any;

export function RecipientConfigForm({ onSubmit }: { onSubmit: (data: any) => Promise<void> }) {
  const { toast } = useToast();
  const form = useForm<any>({
    resolver: zodResolver(z.object({})),
    defaultValues: { recipients: [], distributeDocument: false, expiryDate: null, reminderEnabled: false, reminderDays: 3, locale: 'en', subject: '', message: '' },
  });
  const { fields: recipients, append, remove } = useFieldArray({ control: form.control, name: 'recipients' });
  const distributeDocument = form.watch('distributeDocument');
  const reminderEnabled = form.watch('reminderEnabled');
  const { mutateAsync: sendReminder, isPending } = trpc.document.sendReminder.useMutation();

  const handleAddRecipient = () => {
    append({ name: '', email: '', role: 'SIGNER' });
  };

  const handleRemoveRecipient = (index: number) => {
    remove(index);
  };

  const handleSubmitForm = form.handleSubmit(async (data: any) => {
    try {
      await onSubmit(data);
      toast({ title: 'Sent successfully' });
    } catch {
      toast({ title: 'Failed to send', description: 'Please try again.' });
    }
  });

  return (
    <form onSubmit={handleSubmitForm} className="space-y-6">
      <div className="space-y-2">
        <FormField
          control={form.control}
          name="subject"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Subject</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Document subject" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="message"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Message</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Optional message to recipients" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="space-y-2">
        {recipients.map((recipient, index) => (
          <div key={recipient.id} className="flex flex-row gap-2 items-start">
            <FormField
              control={form.control}
              name={`recipients.${index}.name`}
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input {...field} aria-label="Name" placeholder={`Recipient ${index + 1}`} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`recipients.${index}.email`}
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input {...field} aria-label="Email" placeholder="email@example.com" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`recipients.${index}.role`}
              render={({ field }) => (
                <FormItem>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <SelectTrigger><SelectValue placeholder="Role" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SIGNER">Signer</SelectItem>
                      <SelectItem value="VIEWER">Viewer</SelectItem>
                      <SelectItem value="APPROVER">Approver</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <button type="button" onClick={() => handleRemoveRecipient(index)} className="mt-2 text-destructive">
              Remove
            </button>
          </div>
        ))}

        {recipients.length > 0 && (
          <div className="mt-4 flex flex-row items-center">
            <FormField
              control={form.control}
              name="distributeDocument"
              render={({ field }) => (
                <FormItem>
                  <div className="flex flex-row items-center">
                    <Checkbox
                      id="distributeDocument"
                      className="h-5 w-5"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                    {distributeDocument && (
                      <label className="ml-2 text-muted-foreground text-sm" htmlFor="distributeDocument">
                        Send document to all recipients
                      </label>
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {reminderEnabled && (
          <FormField
            control={form.control}
            name="reminderDays"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reminder interval (days)</FormLabel>
                <FormControl>
                  <Input {...field} type="number" min={1} max={30} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </div>

      <div className="flex justify-between gap-4">
        <Button type="button" variant="outline" onClick={handleAddRecipient}>
          Add recipient
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Sending...' : 'Send'}
        </Button>
      </div>
    </form>
  );
}



declare namespace SVGAttributes { type Props = React.SVGAttributes<SVGElement>; }

export type DecorativeBackgroundProps = Omit<React.SVGAttributes<SVGElement>, 'viewBox'>;

export const DecorativeBackground = ({ ...props }: DecorativeBackgroundProps) => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 1440 900" {...props}>
      <defs>
        <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="grad2" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
        </linearGradient>
        <clipPath id="clip1">
          <rect width="1440" height="900" />
        </clipPath>
      </defs>
      <g clipPath="url(#clip1)">
        <path stroke="url(#grad1)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="0.8"
          d="M100 200 Q400 100 700 300 T1300 200" />
        <path stroke="url(#grad2)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="0.6"
          d="M0 400 Q350 250 700 450 T1440 350" />
        <circle cx="720" cy="450" r="300" fill="url(#grad1)" />
        <circle cx="200" cy="200" r="150" fill="url(#grad2)" />
        <circle cx="1200" cy="650" r="200" fill="url(#grad1)" />
      </g>
    </svg>
  );
};



declare const useSigningContext: () => { recipient: any; envelope: any; isDirectTemplate: boolean; envelopeData: any };
declare const signEnvelopeField: (opts: any) => Promise<{ signedField: any }>;
declare const extractFieldInsertionValues: (opts: any) => any;
declare const isBase64Image: (val: string) => boolean;
declare const FieldType: { SIGNATURE: string; DATE: string; TEXT: string; INITIALS: string };

type TSignFieldValue = { type: string; value?: string; typedSignature?: string; drawSignature?: string };
type TAuthOptions = { method: string; token?: string };

export function useFieldSigning() {
  const { recipient, envelope, isDirectTemplate, envelopeData } = useSigningContext();

  const handleDirectTemplateFieldInsertion = (fieldId: number, fieldValue: TSignFieldValue) => {
    const foundField = recipient.fields.find((f: any) => f.id === fieldId);

    if (!foundField) {
      throw new Error('Field not found');
    }

    const insertionValues = extractFieldInsertionValues({
      fieldValue,
      field: foundField,
      documentMeta: envelope.documentMeta,
    });

    const updatedField = {
      ...foundField,
      ...insertionValues,
    };

    if (fieldValue.type === FieldType.SIGNATURE) {
      const isBase64 = isBase64Image(fieldValue.value || '');
      return { ...updatedField, signatureType: isBase64 ? 'draw' : 'type' };
    }

    return updatedField;
  };

  const signField = async (
    fieldId: number,
    fieldValue: TSignFieldValue,
    authOptions?: TAuthOptions,
  ) => {
    if (isDirectTemplate) {
      return handleDirectTemplateFieldInsertion(fieldId, fieldValue);
    }

    const { signedField } = await signEnvelopeField({
      token: envelopeData.recipient.token,
      fieldId,
      fieldValue,
      authOptions,
    });

    return signedField;
  };

  return { signField };
}



declare const useCurrentOrganisation: () => any;
declare const useState: <T>(init: T) => [T, (v: T) => void];
declare const useToast2: () => { toast: (opts: any) => void };
declare const trpcOrg: any;
declare const Dialog2: (props: any) => JSX.Element;
declare const DialogContent2: (props: any) => JSX.Element;
declare const DialogHeader2: (props: any) => JSX.Element;
declare const DialogTitle2: (props: any) => JSX.Element;
declare const DialogDescription2: (props: any) => JSX.Element;
declare const DialogFooter2: (props: any) => JSX.Element;
declare const DialogClose2: (props: any) => JSX.Element;
declare const Button2: (props: any) => JSX.Element;
declare const AlertTriangle: (props: any) => JSX.Element;
declare const Link2: (props: any) => JSX.Element;

export const BillingUpgradeBanner = () => {
  const { toast } = useToast2();
  const [isOpen, setIsOpen] = useState(false);
  const organisation = useCurrentOrganisation();
  const { mutateAsync: manageSubscription, isPending } = trpcOrg.billing.subscription.manage.useMutation();

  const handleOpenPortal = async (organisationId: string) => {
    try {
      const { redirectUrl } = await manageSubscription({ organisationId });
      window.open(redirectUrl, '_blank');
      setIsOpen(false);
    } catch {
      toast({
        title: 'Something went wrong',
        description: 'Please try again later.',
        variant: 'destructive',
      });
    }
  };

  if (!organisation || organisation.subscription?.status === 'ACTIVE') {
    return null;
  }

  return (
    <>
      <div
        className="flex items-center gap-2 rounded-md bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800 cursor-pointer"
        onClick={() => setIsOpen(true)}
        role="button"
        tabIndex={0}
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>Your subscription requires attention.</span>
        <Link2 to="#" className="ml-auto font-medium underline underline-offset-2" onClick={(e: any) => { e.stopPropagation(); setIsOpen(true); }}>
          Manage billing
        </Link2>
      </div>

      <Dialog2 open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent2>
          <DialogHeader2>
            <DialogTitle2>Billing issue</DialogTitle2>
            <DialogDescription2>
              Your organisation subscription is not active. Please update your payment method to continue using all features.
            </DialogDescription2>
          </DialogHeader2>
          <DialogFooter2>
            <DialogClose2 asChild>
              <Button2 variant="ghost">Cancel</Button2>
            </DialogClose2>
            <Button2
              onClick={() => organisation && handleOpenPortal(organisation.id)}
              disabled={isPending}
            >
              {isPending ? 'Opening portal...' : 'Manage subscription'}
            </Button2>
          </DialogFooter2>
        </DialogContent2>
      </Dialog2>
    </>
  );
};



declare const useForm2: <T>(opts: any) => { control: any; handleSubmit: (fn: any) => any; watch: (name?: string) => any; setValue: (name: string, val: any) => void; getValues: (name?: string) => any };
declare const useFieldArray2: (opts: any) => { fields: any[]; append: (val: any) => void; remove: (idx: number) => void };
declare const FormField2: (props: { control: any; name: string; render: (args: { field: any }) => JSX.Element }) => JSX.Element;
declare const FormItem2: (props: { children?: any; className?: string }) => JSX.Element;
declare const FormControl2: (props: { children?: any }) => JSX.Element;
declare const FormMessage2: (props?: any) => JSX.Element;
declare const Checkbox2: (props: any) => JSX.Element;
declare const Input2: (props: any) => JSX.Element;
declare const PlusIcon: (props: any) => JSX.Element;
declare const TrashIcon: (props: any) => JSX.Element;
declare const Separator: (props: any) => JSX.Element;

export const RadioOptionEditor = ({ value, onValueChange }: { value: any; onValueChange: (v: any) => void }) => {
  const form = useForm2<any>({
    defaultValues: {
      values: value?.values || [{ id: 1, checked: false, label: '' }],
      required: value?.required || false,
      readOnly: value?.readOnly || false,
    },
  });

  const { fields: formValues, append, remove } = useFieldArray2({ control: form.control, name: 'values' });

  const addOption = () => {
    append({ id: formValues.length + 1, checked: false, label: '' });
  };

  const handleSubmit = form.handleSubmit((data: any) => {
    onValueChange(data);
  });

  return (
    <form onChange={handleSubmit} className="space-y-4">
      <div className="-mx-4 mt-2 mb-4">
        <Separator />
      </div>

      <div className="flex flex-row items-center justify-between gap-2">
        <p className="font-medium text-sm">Radio options</p>
        <button type="button" onClick={addOption}>
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>

      <ul className="space-y-2">
        {formValues.map((optionField, index) => (
          <li key={`option-${index}`} className="flex flex-row items-center gap-2">
            <FormField2
              control={form.control}
              name={`values.${index}.checked`}
              render={({ field }) => (
                <FormItem2>
                  <FormControl2>
                    <Checkbox2
                      className="h-5 w-5"
                      checked={field.value}
                      onCheckedChange={(checked) => {
                        const currentValues = form.getValues('values') || [];
                        if (checked) {
                          const newValues = currentValues.map((val: any) => ({
                            ...val,
                            checked: false,
                          }));
                          newValues[index].checked = true;
                          form.setValue('values', newValues);
                        } else {
                          field.onChange(false);
                        }
                      }}
                    />
                  </FormControl2>
                  <FormMessage2 />
                </FormItem2>
              )}
            />
            <FormField2
              control={form.control}
              name={`values.${index}.label`}
              render={({ field }) => (
                <FormItem2 className="flex-1">
                  <FormControl2>
                    <Input2 {...field} placeholder={`Option ${index + 1}`} />
                  </FormControl2>
                  <FormMessage2 />
                </FormItem2>
              )}
            />
            <button type="button" onClick={() => remove(index)} className="text-destructive">
              <TrashIcon className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </form>
  );
};



declare const useMemo: <T>(fn: () => T, deps: any[]) => T;
declare const extractInitials: (name: string) => string;
declare const AvatarWithText: (props: { avatarClass?: string; avatarFallback: string; primaryText: any; secondaryText: string }) => JSX.Element;
declare const BadgeCell: (props: { label: string; variant: string }) => JSX.Element;
declare const ActionsMenu: (props: { items: any[] }) => JSX.Element;
declare const DataTable: (props: { columns: any[]; data: any[]; pagination?: any }) => JSX.Element;
declare const useOrganisationMembersQuery: (opts: any) => { data: any; isLoading: boolean };
declare const useConfirmDialog: () => { confirm: (opts: any) => Promise<boolean> };
declare const trpcMembers: any;

type OrgMember = {
  id: string;
  name?: string;
  email: string;
  role: string;
  joinedAt: string;
  userId: string;
};

export function OrgMembersTable({ organisationId }: { organisationId: string }) {
  const { confirm } = useConfirmDialog();
  const { mutateAsync: removeMember } = trpcMembers.organisation.removeMember.useMutation();
  const { data, isLoading } = useOrganisationMembersQuery({ organisationId });

  const members: OrgMember[] = data?.data ?? [];

  const columns = useMemo(() => [
    {
      header: 'Member',
      cell: ({ row }: { row: { original: OrgMember } }) => {
        const fallback = row.original.name
          ? extractInitials(row.original.name)
          : row.original.email.slice(0, 1).toUpperCase();
        return (
          <AvatarWithText
            avatarClass="h-10 w-10"
            avatarFallback={fallback}
            primaryText={<span className="font-semibold">{row.original.name}</span>}
            secondaryText={row.original.email}
          />
        );
      },
    },
    {
      header: 'Role',
      cell: ({ row }: { row: { original: OrgMember } }) => (
        <BadgeCell label={row.original.role} variant={row.original.role === 'ADMIN' ? 'default' : 'outline'} />
      ),
    },
    {
      header: 'Joined',
      cell: ({ row }: { row: { original: OrgMember } }) => (
        <span className="text-muted-foreground text-sm">{new Date(row.original.joinedAt).toLocaleDateString()}</span>
      ),
    },
    {
      header: 'Actions',
      cell: ({ row }: { row: { original: OrgMember } }) => (
        <ActionsMenu
          items={[
            {
              label: 'Remove member',
              destructive: true,
              onClick: async () => {
                const ok = await confirm({ title: 'Remove member', description: 'This action cannot be undone.' });
                if (ok) {
                  await removeMember({ organisationId, memberId: row.original.id });
                }
              },
            },
          ]}
        />
      ),
    },
  ], [organisationId, removeMember, confirm]);

  if (isLoading) {
    return <div className="py-8 text-center text-muted-foreground">Loading members...</div>;
  }

  return <DataTable columns={columns} data={members} />;
}



declare const useParams: () => Record<string, string>;
declare const useToast3: () => { toast: (opts: any) => void };
declare const trpcAdmin: any;
declare const useMemo2: <T>(fn: () => T, deps: any[]) => T;
declare const Link3: (props: { to: string; className?: string; children?: any }) => JSX.Element;
declare const DataTable2: (props: { columns: any[]; data: any[] }) => JSX.Element;
declare const Skeleton: (props: { className?: string }) => JSX.Element;
declare const Badge: (props: { children?: any; variant?: string }) => JSX.Element;

export function AdminTeamDetailPage() {
  const { id } = useParams();
  const teamId = Number(id);
  const { toast } = useToast3();

  const { data: team, isLoading } = trpcAdmin.admin.team.get.useQuery(
    { teamId },
    { enabled: Number.isFinite(teamId) && teamId > 0 },
  );

  const handleCopyId = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard' });
  };

  const memberColumns = useMemo2(() => {
    if (!team) return [];

    return [
      {
        header: 'Member',
        cell: ({ row }: { row: { original: any } }) => (
          <div className="space-y-1">
            <Link3
              className="font-medium hover:underline"
              to={`/admin/users/${row.original.user.id}`}
            >
              {row.original.user.name ?? row.original.user.email}
            </Link3>
            {row.original.user.name && (
              <div className="font-mono text-muted-foreground text-xs">{row.original.user.email}</div>
            )}
          </div>
        ),
      },
      {
        header: 'User ID',
        cell: ({ row }: { row: { original: any } }) => (
          <button
            className="font-mono text-xs text-muted-foreground hover:underline"
            onClick={() => handleCopyId(String(row.original.user.id))}
            type="button"
          >
            {row.original.user.id}
          </button>
        ),
      },
      {
        header: 'Role',
        cell: ({ row }: { row: { original: any } }) => (
          <Badge variant="outline">{row.original.role}</Badge>
        ),
      },
    ];
  }, [team]);

  if (isLoading) {
    return (
      <div className="space-y-4 p-8">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!team) {
    return <div className="p-8 text-muted-foreground">Team not found.</div>;
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">{team.name}</h1>
        <Badge variant="outline">ID: {team.id}</Badge>
      </div>
      <DataTable2 columns={memberColumns} data={team.members ?? []} />
    </div>
  );
}



declare const verifyPresignToken: (opts: any) => Promise<{ userId: string; teamId: string } | null>;
declare const getTeamSettings: (opts: any) => Promise<any>;
declare const useLoaderData: <T>() => T;
declare const useToast4: () => { toast: (opts: any) => void };
declare const useState3: <T>(init: T | (() => T)) => [T, (v: T) => void];
declare const useLayoutEffect: (fn: () => void, deps?: any[]) => void;
declare const useMemo3: <T>(fn: () => T, deps: any[]) => T;
declare const EnvelopeEditorComponent: (props: any) => JSX.Element;
declare const SpinnerIcon: (props: any) => JSX.Element;
declare const CheckCircleIcon: (props: any) => JSX.Element;
declare const superLoaderJson: (data: any) => any;

type EmbedLoaderData = {
  envelopeType: string;
  teamSettings: any;
  features: any;
  editorOptions: any;
  initialValues: any;
};

export const shouldRevalidateEmbed = () => false;

export function EmbedEnvelopeCreatePage() {
  const loaderData = useLoaderData<EmbedLoaderData>();
  const { toast } = useToast4();

  const [isDone, setIsDone] = useState3(false);
  const [envelopeId, setEnvelopeId] = useState3<string | null>(null);

  useLayoutEffect(() => {
    if (isDone) {
      window.parent?.postMessage({ type: 'envelope:created', envelopeId }, '*');
    }
  }, [isDone, envelopeId]);

  const derivedMeta = useMemo3(() => {
    if (!loaderData.initialValues) return {};
    return { subject: loaderData.initialValues.subject || '', message: loaderData.initialValues.message || '' };
  }, [loaderData.initialValues]);

  const handleComplete = (id: string) => {
    setEnvelopeId(id);
    setIsDone(true);
  };

  if (isDone) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 text-center">
        <CheckCircleIcon className="h-12 w-12 text-green-500" />
        <p className="text-lg font-semibold">Envelope created successfully</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <EnvelopeEditorComponent
        envelopeType={loaderData.envelopeType}
        teamSettings={loaderData.teamSettings}
        features={loaderData.features}
        editorOptions={loaderData.editorOptions}
        defaultValues={derivedMeta}
        onComplete={handleComplete}
      />
    </div>
  );
}



declare const useForm3: <T>(opts: any) => { control: any; handleSubmit: (fn: any) => any; watch: (name?: string) => any; setValue: (name: string, val: any) => void; getValues: (name?: string) => any; formState: { errors: any } };
declare const useFieldArray3: (opts: any) => { fields: any[]; append: (val: any) => void; remove: (idx: number) => void };
declare const FormField3: (props: { control: any; name: string; render: (args: { field: any }) => JSX.Element }) => JSX.Element;
declare const FormItem3: (props: { children?: any; className?: string }) => JSX.Element;
declare const FormControl3: (props: { children?: any }) => JSX.Element;
declare const FormMessage3: (props?: any) => JSX.Element;
declare const FormLabel3: (props: { children?: any }) => JSX.Element;
declare const Checkbox3: (props: any) => JSX.Element;
declare const Input3: (props: any) => JSX.Element;
declare const PlusIcon2: (props: any) => JSX.Element;
declare const TrashIcon2: (props: any) => JSX.Element;
declare const Separator2: (props: any) => JSX.Element;
declare const Switch: (props: any) => JSX.Element;
declare const zodResolver2: (schema: any) => any;
declare const z2: any;
declare const DEFAULT_FONT_SIZE: number;

type CheckboxFieldMeta = {
  type: 'checkbox';
  direction?: 'vertical' | 'horizontal';
  values?: Array<{ id: number; checked: boolean; value: string }>;
  required?: boolean;
  readOnly?: boolean;
  validationRule?: string;
  validationLength?: number;
  label?: string;
  fontSize?: number;
};

type EditorCheckboxFormProps = {
  value: CheckboxFieldMeta | undefined;
  onValueChange: (value: CheckboxFieldMeta) => void;
};

export const EditorFieldCheckboxForm = ({
  value = { type: 'checkbox', direction: 'vertical' },
  onValueChange,
}: EditorCheckboxFormProps) => {
  const form = useForm3<any>({
    resolver: zodResolver2(z2.object({})),
    mode: 'onChange',
    defaultValues: {
      label: value.label || '',
      direction: value.direction || 'vertical',
      validationRule: value.validationRule || '',
      validationLength: value.validationLength || 0,
      values: value.values || [{ id: 1, checked: false, value: '' }],
      required: value.required || false,
      readOnly: value.readOnly || false,
      fontSize: value.fontSize || DEFAULT_FONT_SIZE,
    },
  });

  const { fields: checkboxValues, append: appendValue, remove: removeValue } = useFieldArray3({
    control: form.control,
    name: 'values',
  });

  const addCheckboxValue = () => {
    appendValue({ id: checkboxValues.length + 1, checked: false, value: '' });
  };

  const handleFormChange = form.handleSubmit((data: any) => {
    onValueChange({ type: 'checkbox', ...data } as CheckboxFieldMeta);
  });

  return (
    <form onChange={handleFormChange} className="space-y-4">
      <FormField3
        control={form.control}
        name="label"
        render={({ field }) => (
          <FormItem3>
            <FormLabel3>Label</FormLabel3>
            <FormControl3><Input3 {...field} placeholder="Field label" /></FormControl3>
            <FormMessage3 />
          </FormItem3>
        )}
      />

      <div className="-mx-4 mt-2 mb-4">
        <Separator2 />
      </div>

      <div className="flex flex-row items-center justify-between gap-2">
        <p className="font-medium text-sm">Checkbox values</p>
        <button type="button" onClick={addCheckboxValue}>
          <PlusIcon2 className="h-4 w-4" />
        </button>
      </div>

      <ul className="space-y-2">
        {checkboxValues.map((cbField, index) => (
          <li key={`cb-${cbField.id}`} className="flex flex-row items-center gap-2">
            <FormField3
              control={form.control}
              name={`values.${index}.checked`}
              render={({ field }) => (
                <FormItem3>
                  <FormControl3>
                    <Checkbox3
                      className="h-5 w-5"
                      checked={field.value}
                      onCheckedChange={(checked) => {
                        if (!checked) {
                          field.onChange(false);
                          return;
                        }
                        const currentValues = form.getValues('values') || [];
                        const newValues = currentValues.map((v: any, i: number) => ({
                          ...v,
                          checked: i === index,
                        }));
                        form.setValue('values', newValues);
                      }}
                    />
                  </FormControl3>
                  <FormMessage3 />
                </FormItem3>
              )}
            />
            <FormField3
              control={form.control}
              name={`values.${index}.value`}
              render={({ field }) => (
                <FormItem3 className="flex-1">
                  <FormControl3>
                    <Input3 {...field} placeholder={`Option ${index + 1}`} />
                  </FormControl3>
                  <FormMessage3 />
                </FormItem3>
              )}
            />
            <button type="button" onClick={() => removeValue(index)} className="text-destructive">
              <TrashIcon2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      <FormField3
        control={form.control}
        name="required"
        render={({ field }) => (
          <FormItem3 className="flex items-center gap-2">
            <FormControl3>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl3>
            <FormLabel3>Required</FormLabel3>
          </FormItem3>
        )}
      />
    </form>
  );
};



declare const useState: <S>(initial: S) => [S, (next: S) => void];
declare const useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => void;
declare const useCallback: <T extends (...args: never[]) => unknown>(cb: T, deps: readonly unknown[]) => T;
declare const measureViewport: (el: HTMLElement) => { width: number; height: number };
declare const formatRecipient: (input: { name: string; email: string }) => string;
declare const cx: (...classes: Array<string | false | null | undefined>) => string;

interface AnnotationOverlayProps {
  page: number;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  recipient: { name: string; email: string; status: 'pending' | 'signed' | 'declined' };
  readOnly?: boolean;
  showStatus?: boolean;
  showColors?: boolean;
}

export function AnnotationOverlayPopover({
  page,
  positionX,
  positionY,
  width,
  height,
  recipient,
  readOnly = false,
  showStatus = false,
  showColors = false,
}: AnnotationOverlayProps): JSX.Element | null {
  const [hidden, setHidden] = useState<boolean>(false);

  const [coords, setCoords] = useState({
    x: 0,
    y: 0,
    height: 0,
    width: 0,
  });

  const recompute = useCallback(() => {
    const pageEl = document.querySelector<HTMLElement>(`[data-page-number="${page}"]`);

    if (!pageEl) {
      return;
    }

    const viewport = measureViewport(pageEl);

    const fieldHeight = (Number(height) / 100) * viewport.height;
    const fieldWidth = (Number(width) / 100) * viewport.width;

    const fieldX = (Number(positionX) / 100) * viewport.width + Number(fieldWidth);
    const fieldY = (Number(positionY) / 100) * viewport.height;

    setCoords({
      x: fieldX,
      y: fieldY,
      height: fieldHeight,
      width: fieldWidth,
    });
  }, [height, page, positionX, positionY, width]);

  useEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    const onResize = () => {
      recompute();
    };

    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [recompute]);

  useEffect(() => {
    const pageEl = document.querySelector<HTMLElement>(`[data-page-number="${page}"]`);

    if (!pageEl) {
      return;
    }

    const observer = new ResizeObserver(() => {
      recompute();
    });

    observer.observe(pageEl);

    return () => {
      observer.disconnect();
    };
  }, [recompute, page]);

  if (hidden) {
    return null;
  }

  return (
    <div
      id="annotation-overlay-tooltip"
      className={cx('absolute z-40', showColors && 'ring-2 ring-indigo-400')}
      style={{
        top: `${coords.y}px`,
        left: `${coords.x}px`,
      }}
    >
      <div className="relative flex w-fit flex-col p-4 text-sm">
        <div className="absolute -top-3 -left-3 z-50 h-6 w-6 rounded-full border-2 border-gray-200/50 bg-neutral-50">
          <span className="text-xs text-gray-400">
            {(recipient.name || recipient.email).slice(0, 2).toUpperCase()}
          </span>
        </div>
        {showStatus && (
          <span
            className={cx(
              'mx-auto mb-1 rounded-full px-2 py-0.5 text-xs font-medium',
              readOnly
                ? 'bg-neutral-100 text-neutral-700'
                : recipient.status === 'signed'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-700',
            )}
          >
            {readOnly ? 'Read only' : recipient.status === 'signed' ? 'Signed' : 'Pending'}
          </span>
        )}

        <p className="text-center font-semibold">
          <span>Signature field</span>
        </p>

        <p className="mt-1 text-center text-xs text-muted-foreground">{formatRecipient(recipient)}</p>

        <button
          type="button"
          className="absolute top-0 right-0 my-1 p-2 focus:outline-none focus-visible:ring-0"
          onClick={() => setHidden(true)}
          title="Hide annotation"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}



declare function useState<S>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void];
declare function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
declare function useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]): T;
declare function useRef<T>(initial: T): { current: T };
declare const window: {
  addEventListener(type: string, handler: (event: { data: unknown }) => void): void;
  removeEventListener(type: string, handler: (event: { data: unknown }) => void): void;
};
declare const document: { title: string };
declare function btoa(input: string): string;

interface WidgetTheme {
  background: string;
  foreground: string;
  border: string;
  accent: string;
  radius: string;
}

export default function WidgetPlaygroundPage(): JSX.Element {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [presignToken, setPresignToken] = useState('');
  const [widgetId, setWidgetId] = useState('');
  const [widgetMode, setWidgetMode] = useState<'compact' | 'full'>('compact');
  const [locale, setLocale] = useState('en');
  const [theme, setTheme] = useState<WidgetTheme>({
    background: '',
    foreground: '',
    border: '',
    accent: '',
    radius: '8px',
  });
  const [generalFlags, setGeneralFlags] = useState({
    showHeader: true,
    showFooter: true,
    allowResize: false,
    enableShortcuts: true,
  });
  const [networkFlags, setNetworkFlags] = useState({
    allowAnalytics: false,
    streamUpdates: true,
    retryOnFailure: true,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [eventLog, setEventLog] = useState<string[]>([]);
  const lastRefreshRef = useRef<number>(0);

  useEffect(() => {
    const onMessage = (event: { data: unknown }): void => {
      const stamp = new Date().toISOString().slice(11, 19);
      setEventLog((prev) => [...prev, `[${stamp}] ${JSON.stringify(event.data)}`]);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    document.title = `Widget Preview \u00b7 ${widgetMode}`;
  }, [widgetMode]);

  const handleRefresh = useCallback(() => {
    lastRefreshRef.current = Date.now();
    setEventLog((prev) => [...prev, '[refresh] preview reloaded']);
  }, []);

  const buildPreviewSrc = (): string => {
    const payload = {
      widgetId,
      mode: widgetMode,
      locale,
      theme,
      flags: { ...generalFlags, ...networkFlags },
    };
    return `/widget/preview?token=${encodeURIComponent(presignToken)}#${btoa(JSON.stringify(payload))}`;
  };

  const onLaunch = (): void => {
    if (!presignToken) {
      setErrorMessage('Token is required');
      return;
    }
    setErrorMessage(null);
    setPreviewUrl(buildPreviewSrc());
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'monospace' }}>
      <div style={{ width: '320px', padding: '12px', borderRight: '1px solid #ccc', overflowY: 'auto' }}>
        <h2 style={{ margin: '0 0 12px', fontSize: '16px' }}>Widget Preview</h2>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold' }}>Presign Token</label>
        <input
          type="text"
          value={presignToken}
          onChange={(e: { target: { value: string } }) => setPresignToken(e.target.value)}
          style={{ width: '100%', padding: '4px', fontSize: '12px' }}
          placeholder="presign_..."
        />
        {errorMessage && <div style={{ color: 'red', fontSize: '11px' }}>{errorMessage}</div>}
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginTop: '8px' }}>Widget ID</label>
        <input
          type="text"
          value={widgetId}
          onChange={(e: { target: { value: string } }) => setWidgetId(e.target.value)}
          style={{ width: '100%', padding: '4px', fontSize: '12px' }}
        />
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginTop: '8px' }}>Mode</label>
        <select
          value={widgetMode}
          onChange={(e: { target: { value: string } }) => setWidgetMode(e.target.value as 'compact' | 'full')}
          style={{ width: '100%', padding: '4px', fontSize: '12px' }}
        >
          <option value="compact">Compact</option>
          <option value="full">Full</option>
        </select>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginTop: '8px' }}>Locale</label>
        <select
          value={locale}
          onChange={(e: { target: { value: string } }) => setLocale(e.target.value)}
          style={{ width: '100%', padding: '4px', fontSize: '12px' }}
        >
          <option value="en">English</option>
          <option value="de">German</option>
          <option value="ja">Japanese</option>
        </select>
        <h3 style={{ fontSize: '14px', margin: '12px 0 4px' }}>General Flags</h3>
        {Object.entries(generalFlags).map(([key, value]) => (
          <label key={key} style={{ display: 'block', fontSize: '12px' }}>
            <input
              type="checkbox"
              checked={value}
              onChange={(e: { target: { checked: boolean } }) =>
                setGeneralFlags((prev) => ({ ...prev, [key]: e.target.checked }))
              }
            />
            {key}
          </label>
        ))}
        <h3 style={{ fontSize: '14px', margin: '12px 0 4px' }}>Network Flags</h3>
        {Object.entries(networkFlags).map(([key, value]) => (
          <label key={key} style={{ display: 'block', fontSize: '12px' }}>
            <input
              type="checkbox"
              checked={value}
              onChange={(e: { target: { checked: boolean } }) =>
                setNetworkFlags((prev) => ({ ...prev, [key]: e.target.checked }))
              }
            />
            {key}
          </label>
        ))}
        <button onClick={onLaunch} style={{ width: '100%', padding: '6px', marginTop: '12px' }}>
          Launch Preview
        </button>
        <button onClick={handleRefresh} style={{ width: '100%', padding: '6px', marginTop: '6px' }}>
          Refresh
        </button>
      </div>
      <div style={{ flex: 1, padding: '12px' }}>
        {previewUrl ? (
          <iframe src={previewUrl} style={{ width: '100%', height: '60%', border: '1px solid #ccc' }} />
        ) : (
          <div style={{ padding: '24px', color: '#888' }}>No preview launched yet.</div>
        )}
        <div style={{ height: '40%', overflowY: 'auto', borderTop: '1px solid #ccc', padding: '8px' }}>
          <h3 style={{ fontSize: '14px' }}>Event Log</h3>
          {eventLog.map((entry, idx) => (
            <div key={idx} style={{ fontSize: '11px', fontFamily: 'monospace' }}>
              {entry}
            </div>
          ))}
          {theme.accent && <div style={{ color: theme.accent }}>themed</div>}
          {setTheme === setTheme ? null : null}
        </div>
      </div>
    </div>
  );
}



declare const NotifyTooltip: (props: { children?: JSX.Element | JSX.Element[] }) => JSX.Element;
declare const NotifyTrigger: (props: { children?: JSX.Element | JSX.Element[] }) => JSX.Element;
declare const NotifyContent: (props: { className?: string; children?: JSX.Element | JSX.Element[] }) => JSX.Element;
declare const BellIcon: (props: { className?: string }) => JSX.Element;
declare const Translate: (props: { children?: JSX.Element | JSX.Element[] | string }) => JSX.Element;

export const NotificationPreferencesTooltip = () => (
  <NotifyTooltip>
    <NotifyTrigger>
      <BellIcon className="mx-2 h-4 w-4" />
    </NotifyTrigger>

    <NotifyContent className="max-w-md space-y-2 p-4 text-foreground">
      <h2>
        <Translate>Notification delivery preferences</Translate>
      </h2>

      <p>
        <Translate>
          The channels enabled below determine how the platform contacts the account holder
          whenever activity happens on a workspace.
        </Translate>
      </p>

      <p>
        <Translate>
          Each channel can be toggled independently per project from the settings page.
          Multiple channels can be selected.
        </Translate>
      </p>

      <ul className="ml-3.5 list-outside list-disc space-y-0.5 py-2">
        <li>
          <Translate>
            <strong>Email digest</strong> - A daily summary delivered to the verified email
            address on the account; safe default for low-priority alerts.
          </Translate>
        </li>
        <li>
          <Translate>
            <strong>Push to phone</strong> - Real-time push notifications via the mobile app,
            suitable for time-sensitive activity such as approvals.
          </Translate>
        </li>

        <li>
          <Translate>
            <strong>Webhook callbacks</strong> - HTTP POSTs to a configured endpoint, useful
            for integrations such as Slack, PagerDuty, or internal automations.
          </Translate>
        </li>

        <li>
          <Translate>
            <strong>Disabled</strong> - No notifications will be sent for this category;
            existing in-app indicators continue to appear in the activity feed.
          </Translate>
        </li>
      </ul>
    </NotifyContent>
  </NotifyTooltip>
);




declare const useState: <S>(initial: S) => [S, (v: S) => void];
declare const useMemo: <T>(factory: () => T, deps: readonly unknown[]) => T;
declare const useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => void;
declare const useCallback: <T extends (...args: never[]) => unknown>(cb: T, deps: readonly unknown[]) => T;

type InvoiceLine = {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: number;
};

type InvoiceDraft = {
  readonly customerName: string;
  readonly customerEmail: string;
  readonly issuedAt: string;
  readonly dueAt: string;
  readonly lines: ReadonlyArray<InvoiceLine>;
  readonly notes: string;
};

type InvoiceComposerProps = {
  readonly initialDraft: InvoiceDraft;
  readonly currency: 'USD' | 'EUR' | 'GBP';
  readonly onSubmit: (draft: InvoiceDraft) => Promise<{ readonly id: string }>;
};

declare const formatCurrency: (value: number, currency: string) => string;
declare const validateInvoiceDraft: (draft: InvoiceDraft) => ReadonlyArray<string>;
declare const computeLineSubtotal: (line: InvoiceLine) => number;
declare const TextField: (props: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) => JSX.Element;
declare const DateField: (props: { label: string; value: string; onChange: (v: string) => void }) => JSX.Element;
declare const LineEditor: (props: { line: InvoiceLine; onChange: (line: InvoiceLine) => void; onRemove: () => void }) => JSX.Element;
declare const SubmitButton: (props: { label: string; disabled: boolean; pending: boolean; onClick: () => void }) => JSX.Element;
declare const ErrorBanner: (props: { messages: ReadonlyArray<string> }) => JSX.Element;
declare const SuccessBanner: (props: { invoiceId: string }) => JSX.Element;

export const InvoiceComposer = ({ initialDraft, currency, onSubmit }: InvoiceComposerProps): JSX.Element => {
  const [customerName, setCustomerName] = useState(initialDraft.customerName);
  const [customerEmail, setCustomerEmail] = useState(initialDraft.customerEmail);
  const [issuedAt, setIssuedAt] = useState(initialDraft.issuedAt);
  const [dueAt, setDueAt] = useState(initialDraft.dueAt);
  const [notes, setNotes] = useState(initialDraft.notes);
  const [lines, setLines] = useState<ReadonlyArray<InvoiceLine>>(initialDraft.lines);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [errors, setErrors] = useState<ReadonlyArray<string>>([]);

  const draft = useMemo<InvoiceDraft>(
    () => ({ customerName, customerEmail, issuedAt, dueAt, lines, notes }),
    [customerName, customerEmail, issuedAt, dueAt, lines, notes],
  );

  const validationErrors = useMemo(() => validateInvoiceDraft(draft), [draft]);

  const subtotal = useMemo(() => {
    let total = 0;
    for (const line of lines) {
      total += computeLineSubtotal(line);
    }
    return total;
  }, [lines]);

  const tax = useMemo(() => Math.round(subtotal * 0.08 * 100) / 100, [subtotal]);
  const grandTotal = useMemo(() => subtotal + tax, [subtotal, tax]);

  const handleLineChange = useCallback(
    (updated: InvoiceLine) => {
      setLines(lines.map((line) => (line.id === updated.id ? updated : line)));
    },
    [lines],
  );

  const handleLineRemove = useCallback(
    (lineId: string) => {
      setLines(lines.filter((line) => line.id !== lineId));
    },
    [lines],
  );

  const handleAddLine = useCallback(() => {
    const next: InvoiceLine = {
      id: `line-${lines.length + 1}`,
      description: '',
      quantity: 1,
      unitPrice: 0,
    };
    setLines([...lines, next]);
  }, [lines]);

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await onSubmit(draft);
      setSubmittedId(result.id);
      setErrors([]);
    } catch (err) {
      setErrors([(err as Error).message]);
    }
    setIsSubmitting(false);
  }, [draft, isSubmitting, onSubmit, validationErrors]);

  useEffect(() => {
    if (submittedId) {
      const handle = setTimeout(() => setSubmittedId(null), 5000);
      return () => clearTimeout(handle);
    }
    return undefined;
  }, [submittedId]);

  if (submittedId) {
    return (
      <div className="invoice-composer invoice-composer--success">
        <SuccessBanner invoiceId={submittedId} />
      </div>
    );
  }

  return (
    <div className="invoice-composer">
      <header className="invoice-composer__header">
        <h1 className="invoice-composer__title">New Invoice</h1>
        <p className="invoice-composer__subtitle">Compose and review before sending.</p>
      </header>

      {errors.length > 0 && <ErrorBanner messages={errors} />}

      <section className="invoice-composer__customer">
        <TextField label="Customer name" value={customerName} onChange={setCustomerName} required />
        <TextField label="Customer email" value={customerEmail} onChange={setCustomerEmail} required />
      </section>

      <section className="invoice-composer__dates">
        <DateField label="Issued" value={issuedAt} onChange={setIssuedAt} />
        <DateField label="Due" value={dueAt} onChange={setDueAt} />
      </section>

      <section className="invoice-composer__lines">
        <h2 className="invoice-composer__lines-heading">Line items</h2>
        {lines.map((line) => (
          <LineEditor
            key={line.id}
            line={line}
            onChange={handleLineChange}
            onRemove={() => handleLineRemove(line.id)}
          />
        ))}
        <button type="button" className="invoice-composer__add-line" onClick={handleAddLine}>
          Add line
        </button>
      </section>

      <section className="invoice-composer__totals">
        <div className="invoice-composer__total-row">
          <span>Subtotal</span>
          <span>{formatCurrency(subtotal, currency)}</span>
        </div>
        <div className="invoice-composer__total-row">
          <span>Tax</span>
          <span>{formatCurrency(tax, currency)}</span>
        </div>
        <div className="invoice-composer__total-row invoice-composer__total-row--grand">
          <span>Total</span>
          <span>{formatCurrency(grandTotal, currency)}</span>
        </div>
      </section>

      <section className="invoice-composer__notes">
        <TextField label="Notes" value={notes} onChange={setNotes} />
      </section>

      <footer className="invoice-composer__footer">
        <SubmitButton
          label="Send invoice"
          disabled={validationErrors.length > 0}
          pending={isSubmitting}
          onClick={handleSubmit}
        />
      </footer>
    </div>
  );
};



declare const cn: (...args: unknown[]) => string;
declare const Checkbox: (props: Record<string, unknown>) => JSX.Element;
declare const RadioGroup: (props: { children?: unknown; className?: string }) => JSX.Element;
declare const RadioGroupItem: (props: Record<string, unknown>) => JSX.Element;
declare const Label: (props: { children?: unknown; htmlFor?: string; className?: string }) => JSX.Element;
declare const ChevronIcon: (props: { className?: string }) => JSX.Element;

type WidgetKind = 'checkbox' | 'radio' | 'dropdown' | 'signature' | 'date' | 'text';

type WidgetMeta =
  | { kind: 'checkbox'; options: { value: string }[]; layout: 'horizontal' | 'vertical' }
  | { kind: 'radio'; options: { value: string }[] }
  | { kind: 'dropdown'; placeholder: string }
  | { kind: 'signature'; imageDataUrl?: string }
  | { kind: 'text'; placeholder: string };

type WidgetProps = {
  widget: {
    kind: WidgetKind;
    inserted?: boolean;
    customText?: string;
    meta?: WidgetMeta | null;
  };
  selectedValues?: string[];
};

export const WidgetPreview = ({ widget, selectedValues }: WidgetProps): JSX.Element => {
  if (widget.kind === 'checkbox' && widget.meta?.kind === 'checkbox') {
    if (!widget.meta.options || widget.meta.options.length === 0) {
      return (
        <div
          className={cn(
            'flex gap-1 py-0.5',
            widget.meta.layout === 'horizontal' ? 'flex-row flex-wrap' : 'flex-col gap-y-1',
          )}
        >
          <div className="flex items-center">
            <Checkbox className="h-3 w-3" disabled />
            <Label className="ml-1.5 text-xs opacity-50">Checkbox option</Label>
          </div>
        </div>
      );
    }

    return (
      <div
        className={cn(
          'flex gap-1 py-0.5',
          widget.meta.layout === 'horizontal' ? 'flex-row flex-wrap' : 'flex-col gap-y-1',
        )}
      >
        {widget.meta.options.map((item, index) => (
          <div key={index} className="flex items-center">
            <Checkbox
              className="h-3 w-3"
              id={`option-${index}`}
              checked={(selectedValues ?? []).includes(item.value)}
            />
            {item.value && (
              <Label htmlFor={`option-${index}`} className="ml-1.5 text-xs">
                {item.value}
              </Label>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (
    widget.kind === 'radio' &&
    widget.meta?.kind === 'radio' &&
    widget.meta.options &&
    widget.meta.options.length > 0
  ) {
    return (
      <div className="flex flex-col gap-y-2 py-0.5">
        <RadioGroup className="gap-y-1">
          {widget.meta.options.map((item, index) => (
            <div key={index} className="flex items-center">
              <RadioGroupItem
                className="pointer-events-none h-3 w-3"
                value={item.value}
                id={`radio-${index}`}
                checked={item.value === widget.customText}
              />
              {item.value && (
                <Label htmlFor={`radio-${index}`} className="ml-1.5 text-xs">
                  {item.value}
                </Label>
              )}
            </div>
          ))}
        </RadioGroup>
      </div>
    );
  }

  if (widget.kind === 'dropdown' && widget.meta?.kind === 'dropdown' && !widget.inserted) {
    return (
      <div className="flex flex-row items-center py-0.5 text-sm">
        <p>{widget.meta.placeholder}</p>
        <ChevronIcon className="h-4 w-4" />
      </div>
    );
  }

  if (widget.kind === 'signature' && widget.meta?.kind === 'signature' && widget.meta.imageDataUrl && widget.inserted) {
    return (
      <img src={widget.meta.imageDataUrl} alt="Signature" className="h-full w-full object-contain" />
    );
  }

  const fallbackText = widget.customText ?? '';

  return (
    <div className="flex h-full w-full items-center overflow-hidden">
      <p className="w-full whitespace-pre-wrap text-left text-sm">{fallbackText}</p>
    </div>
  );
};



export function ProductCard({
  title,
  price,
}: {
  /**
   * Product display name
   */
  title: string;

  /**
   * Price in USD
   */
  price: number;
}) {
  return (
    <div>
      <h3>{title}</h3>
      <span>${price}</span>
    </div>
  );
}

export function OrderSummary({
  orderId,
  customerEmail,
  totalAmount,
}: {
  orderId: string;
  customerEmail: string;
  totalAmount: number;
}) {
  const formattedTotal = `$${totalAmount.toFixed(2)}`;
  
  return (
    <section>
      <p>Order: {orderId}</p>
      <p>Customer: {customerEmail}</p>
      <p>Total: {formattedTotal}</p>
    </section>
  );
}



declare const cx: (...parts: Array<string | undefined>) => string;

export type StatTileProps = {
  glyph?: (props: { className?: string }) => JSX.Element;
  label: string;
  amount?: string | number;
  className?: string;
  children?: React.ReactNode;
};

export const StatTile = ({ glyph: Glyph, label, amount, className, children }: StatTileProps) => {
  return (
    <div
      className={cx(
        'h-32 max-h-32 max-w-full overflow-hidden rounded-lg border border-border bg-background shadow shadow-transparent duration-200 hover:shadow-border/80',
        className,
      )}
    >
      <div className="flex h-full max-h-full flex-col px-4 pt-4 pb-6 sm:px-4 sm:pt-4 sm:pb-8">
        <div className="flex items-start">
          {Glyph && (
            <div className="mr-2 h-4 w-4">
              <Glyph className="h-4 w-4 text-muted-foreground" />
            </div>
          )}

          <h3 className="mb-2 flex items-end font-medium text-primary-forground text-sm leading-tight">{label}</h3>
        </div>

        {children || (
          <p className="mt-auto font-semibold text-4xl text-foreground leading-8">
            {typeof amount === 'number' ? amount.toLocaleString('en-US') : amount}
          </p>
        )}
      </div>
    </div>
  );
};



// React Hook Form: intentionally clearing field values with undefined
declare const useForm: () => {
  setValue: (name: string, value: any | undefined) => void;
  getValues: (name: string) => any;
};

function ProductOptionEditor() {
  const form = useForm();

  const removeOption = (optionId: string) => {
    const currentSelection = form.getValues('selectedOption');
    const options = form.getValues('options') || [];
    
    const updatedOptions = options.filter((opt: any) => opt.id !== optionId);
    form.setValue('options', updatedOptions);
    
    if (currentSelection === optionId) {
      // Idiomatic reset: explicitly pass undefined to clear the field
      form.setValue('selectedOption', undefined);
    }
  };

  return removeOption;
}



declare const React: {
  createContext<T>(defaultValue: T): { Provider: unknown };
  useContext<T>(ctx: { Provider: unknown }): T;
};

interface DrawingToolValue {
  brushSize: number;
  setBrushSize: (size: number) => void;
}

const DrawingToolContext = React.createContext<DrawingToolValue | undefined>(undefined);

export function useDrawingTool(): DrawingToolValue {
  const tool = React.useContext(DrawingToolContext);
  if (!tool) {
    throw new Error('useDrawingTool must be used within a DrawingToolProvider');
  }
  return tool;
}



// --- undefined-passed-as-optional shape: createContext<Type | undefined>(undefined) React idiom ---
declare function createContext<T>(defaultValue: T): { Provider: any; Consumer: any };
declare function useContext<T>(ctx: { Provider: any; Consumer: any }): T;

type ThemeContextValue = {
  mode: 'light' | 'dark';
  primaryColor: string;
  fontScale: number;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const defaultTheme: ThemeContextValue = {
  mode: 'light',
  primaryColor: '#0066cc',
  fontScale: 1.0,
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  return ctx ?? defaultTheme;
}



// --- undefined-passed-as-optional shape: field.onChange(undefined) intentional RHF clear on Remove click ---
declare function useController<T>(opts: { name: string; control: any }): { field: { value: T; onChange: (v: T | undefined) => void } };
declare const control: any;

function AttachmentField({ name }: { name: string }) {
  const { field } = useController<File | undefined>({ name, control });

  return (
    <div>
      {field.value ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            field.onChange(undefined);
          }}
        >
          Remove attachment
        </button>
      ) : (
        <label>Upload file</label>
      )}
    </div>
  );
}



// --- undefined-passed-as-optional shape: form.setValue('field', undefined) RHF state clear after auth failure ---
declare function useForm3<T>(): { setValue: (name: keyof T, value: T[keyof T] | undefined) => void };
declare function parseError(err: unknown): { code: string; message: string };
declare function showValidationError(msg: string): void;
declare function setShowAuthChallenge(v: boolean): void;

type SigningFormValues = {
  authCredentials: { code: string } | undefined;
  signerName: string;
};

async function handleSigningSubmit(
  data: SigningFormValues,
  form: ReturnType<typeof useForm3<SigningFormValues>>,
  onComplete: () => Promise<void>,
) {
  try {
    await onComplete();
  } catch (error) {
    const err = parseError(error);

    if (err.code === 'TWO_FACTOR_AUTH_FAILED') {
      form.setValue('authCredentials', undefined);
      setShowAuthChallenge(true);
      showValidationError('Invalid verification code. Please try again.');
      return;
    }
  }
}



// --- unknown-catch-variable shape: catch(err) console.error(err) + setState call; no property access ---
declare function loadEmbedConfig(token: string): Promise<{ css?: string; language?: string }>;
declare function injectStyles(css: string): void;
declare function setHasLoaded(v: boolean): void;
declare function activateLocale(lang: string): Promise<void>;

async function initEmbedFrame(token: string) {
  try {
    const data = await loadEmbedConfig(token);

    if (data.css) {
      injectStyles(data.css);
    }

    if (data.language) {
      await activateLocale(data.language);
    }

    setHasLoaded(true);
  } catch (err) {
    console.error(err);
    setHasLoaded(true);
  }
}



// --- unknown-catch-variable shape: catch(_err) underscore-prefixed intentional discard; billing action ---
declare function createSubscriptionCheckout(opts: { planId: string; teamName: string }): Promise<{ checkoutUrl: string; paymentRequired: boolean }>;
declare function setDialogOpen(v: boolean): void;
declare function showToast14(opts: { title: string; description: string; variant?: string }): void;

async function handleSubscriptionUpgrade(planId: string, teamName: string) {
  try {
    const result = await createSubscriptionCheckout({ planId, teamName });

    if (!result.paymentRequired) {
      setDialogOpen(false);
      return;
    }

    window.location.href = result.checkoutUrl;
  } catch (_err) {
    showToast14({
      title: 'Something went wrong',
      description: 'An error occurred while trying to create a checkout session.',
      variant: 'destructive',
    });
  }
}



// --- unknown-catch-variable shape: catch(error) console.error(error) only; image upload to canvas ---
declare function loadImageFile(file: File): Promise<HTMLImageElement>;
declare function renderImageOnCanvas(img: HTMLImageElement, canvas: HTMLCanvasElement): string;
declare function onImageChange(dataUrl: string): void;

async function handleImageUpload(file: File, canvasRef: { current: HTMLCanvasElement | null }) {
  try {
    const img = await loadImageFile(file);

    if (!canvasRef.current) {
      return;
    }

    const dataUrl = renderImageOnCanvas(img, canvasRef.current);
    onImageChange(dataUrl);
  } catch (error) {
    console.error(error);
  }
}



// Short-circuit guard pattern: value && field.onChange(value) — idiomatic React onChange guard
declare const ComboBox: (props: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  onSelect?: (v: string) => void;
}) => null;

declare function useFormField(): { value: string; onChange: (v: string) => void };

export function TimezonePickerField() {
  const field = useFormField();
  return ComboBox({
    value: field.value,
    onChange: field.onChange,
    options: ['UTC', 'America/New_York'],
    onSelect: (value) => {
      value && field.onChange(value);
    },
  });
}



// \d in JSX pattern prop is a regex digit shorthand interpreted by the browser — not a useless escape
declare function PinInput(props: {
  maxLength: number;
  pattern: string;
  inputMode: string;
  value?: string;
  onChange?: (v: string) => void;
}): null;

export function NumericOtpInput(props: { value: string; onChange: (v: string) => void }) {
  return PinInput({
    maxLength: 6,
    pattern: "^\\d+$",
    inputMode: 'numeric',
    value: props.value,
    onChange: props.onChange,
  });
}



// No outer pendingShape — first and only declaration inside the mouseup handler callback
declare class Shape {
  constructor(opts: { x: number; y: number; width: number; height: number });
}
declare function getSelectionBox(): { x: number; y: number; width: number; height: number };
declare function addShapeToLayer(shape: Shape): void;
declare function setPendingShape(shape: Shape): void;

export function setupSelectionHandler(canvasElement: HTMLElement): void {
  canvasElement.addEventListener('mouseup', () => {
    const box = getSelectionBox();
    if (box.width > 10 && box.height > 10) {
      const pendingShape = new Shape({ x: box.x, y: box.y, width: box.width, height: box.height });
      addShapeToLayer(pendingShape);
      setPendingShape(pendingShape);
    }
  });
}



// react-hook-form FormField render prop — required API, cannot be extracted — FP shape 396ca370ddde
declare const FormField: any;
declare const FormItem: any;
declare const FormControl: any;
declare const FormMessage: any;
declare const RecipientRoleSelect: any;
declare const form: any;
declare const isSubmitting: boolean;
declare const index: number;
declare function handleRoleChange(index: number, value: string): void;

function RecipientRoleFieldExample() {
  return (
    <FormField
      control={form.control}
      name={`recipients.${index}.role`}
      render={({ field }: any) => (
        <FormItem className="col-span-1 mt-auto">
          <FormControl>
            <RecipientRoleSelect
              {...field}
              onValueChange={(value: string) => {
                handleRoleChange(index, value);
              }}
              disabled={isSubmitting}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}



// react-hook-form shadcn FormField render prop API — FP shape 3c00a7c9a2f7
declare const Select: any;
declare const SelectTrigger: any;
declare const SelectValue: any;
declare const SelectContent: any;
declare const documentHasBeenSent: boolean;
declare function handleAutoSave(): void;

function DateFormatFieldExample() {
  return (
    <FormField
      control={form.control}
      name="meta.dateFormat"
      render={({ field }: any) => (
        <FormItem>
          <FormControl>
            <Select
              {...field}
              onValueChange={(value: string) => {
                field.onChange(value);
                void handleAutoSave();
              }}
              value={field.value}
              disabled={documentHasBeenSent}
            >
              <SelectTrigger className="bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}



// react-hook-form FormField render prop with signing order input — FP shape 4c5710742fab
declare const Input: any;
declare const GripVerticalIcon: any;
declare const cn: any;
declare const signers: any[];
declare const snapshot: any;
declare const isSigningOrderSequential: boolean;
declare const showAdvancedSettings: boolean;
declare function handleSigningOrderChange(index: number, value: string): void;

function SigningOrderFieldExample() {
  return (
    <FormField
      control={form.control}
      name={`signers.${index}.signingOrder`}
      render={({ field }: any) => (
        <FormItem
          className={cn('col-span-2 mt-auto flex items-center gap-x-1 space-y-0', {
            'mb-6': false,
          })}
        >
          <GripVerticalIcon className="h-5 w-5 flex-shrink-0 opacity-40" />
          <FormControl>
            <Input
              type="number"
              max={signers.length}
              className={cn('w-full text-center')}
              {...field}
              onChange={(e: any) => {
                field.onChange(e);
                handleSigningOrderChange(index, e.target.value);
              }}
            />
          </FormControl>
        </FormItem>
      )}
    />
  );
}



// react-hook-form FormField render prop with name field — FP shape 5109aff0b220
declare const RecipientAutoCompleteInput: any;
declare const isSubmitting2: boolean;

function RecipientNameFieldExample() {
  return (
    <FormField
      control={form.control}
      name={`recipients.${index}.name`}
      render={({ field }: any) => (
        <FormItem
          className={cn({
            'col-span-4': true,
          })}
        >
          <FormControl>
            <RecipientAutoCompleteInput
              type="text"
              placeholder="Name"
              {...field}
              disabled={isSubmitting2}
              onBlur={field.onBlur}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}



// react-hook-form FormField render prop template placeholder — FP shape 58be09cdf017
declare const Checkbox: any;
declare const isSigningOrderSequential2: boolean;
declare function handleSigningOrderChange2(index: number, value: string): void;

function PlaceholderSigningOrderFieldExample() {
  return (
    <FormField
      control={form.control}
      name={`placeholders.${index}.signingOrder`}
      render={({ field }: any) => (
        <FormItem className="col-span-2 mt-auto flex items-center gap-x-1 space-y-0">
          <FormControl>
            <Input
              type="number"
              max={10}
              className="w-full text-center"
              {...field}
              onChange={(e: any) => {
                field.onChange(e);
                handleSigningOrderChange2(index, e.target.value);
              }}
              onBlur={(e: any) => {
                field.onBlur();
              }}
            />
          </FormControl>
        </FormItem>
      )}
    />
  );
}



// react-hook-form FormField render prop signingOrder checkbox — FP shape 9ae72a9d6fe6
declare const DocumentSigningOrder: { SEQUENTIAL: string; PARALLEL: string };
declare const hasAssistantRole: boolean;
declare const hasDocumentBeenSent: boolean;
declare function setShowSigningOrderConfirmation(v: boolean): void;

function SigningOrderCheckboxFieldExample() {
  return (
    <FormField
      control={form.control}
      name="signingOrder"
      render={({ field }: any) => (
        <FormItem className="mb-6 flex flex-row items-center space-x-2 space-y-0">
          <FormControl>
            <Checkbox
              {...field}
              id="signingOrder"
              checked={field.value === DocumentSigningOrder.SEQUENTIAL}
              onCheckedChange={(checked: any) => {
                if (!checked && hasAssistantRole) {
                  setShowSigningOrderConfirmation(true);
                  return;
                }
                field.onChange(
                  checked ? DocumentSigningOrder.SEQUENTIAL : DocumentSigningOrder.PARALLEL,
                );
              }}
            />
          </FormControl>
        </FormItem>
      )}
    />
  );
}



// react-hook-form FormField render prop title input — FP shape a1824d176686
declare const DocumentStatus: { DRAFT: string };
declare function handleAutoSave2(): Promise<void>;

function TitleFieldExample() {
  return (
    <FormField
      control={form.control}
      name="title"
      render={({ field }: any) => (
        <FormItem>
          <FormControl>
            <Input
              className="bg-background"
              {...field}
              disabled={field.disabled}
              maxLength={255}
              onBlur={() => void handleAutoSave2()}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}



// react-hook-form FormField render prop language select — FP shape b280be562e16
declare const Tooltip: any;
declare const TooltipTrigger: any;
declare const TooltipContent: any;
declare const InfoIcon: any;

function LanguageFieldExample() {
  return (
    <FormField
      control={form.control}
      name="meta.language"
      render={({ field }: any) => (
        <FormItem>
          <FormControl>
            <Select
              {...field}
              onValueChange={(value: string) => {
                field.onChange(value);
                void handleAutoSave2();
              }}
              value={field.value}
            >
              <SelectTrigger className="bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}



// react-hook-form FormField render prop with nested destructuring { field: { value, ...field } } — FP shape f290e8472d6e
declare const allowDictateNextSignerEnabled: boolean;

function AllowDictateNextSignerFieldExample() {
  return (
    <FormField
      control={form.control}
      name="allowDictateNextSigner"
      render={({ field: { value, ...field } }: any) => (
        <FormItem className="mb-6 flex flex-row items-center space-x-2 space-y-0">
          <FormControl>
            <Checkbox
              {...field}
              id="allowDictateNextSigner"
              checked={value}
              onCheckedChange={(checked: any) => {
                field.onChange(checked);
                void handleAutoSave2();
              }}
              disabled={isSubmitting || !allowDictateNextSignerEnabled}
            />
          </FormControl>
        </FormItem>
      )}
    />
  );
}



// useEffect with conditional cleanup — rule missed the cleanup inside the `if` branch — FP shape 402a075832f6
declare function useEffect(fn: () => (() => void) | void, deps: any[]): void;
declare function useRef<T>(initial: T): { current: T };
declare function scheduleAutoSave(data: any): void;
declare function getFormValues(): any;

function EditorFormWithConditionalCleanup() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = window.document.getElementById('editor-form-container');

    const handleBlur = () => {
      const data = getFormValues();
      scheduleAutoSave(data);
    };

    if (container) {
      container.addEventListener('blur', handleBlur, true);
      return () => {
        container.removeEventListener('blur', handleBlur, true);
      };
    }
  }, []);

  return null;
}



// Static leaf component with useMemo for its items — memoizing the component has no benefit — FP shape 5fba867731dc
declare function useMemo<T>(fn: () => T, deps: any[]): T;
declare const Popover: any;
declare const PopoverTrigger: any;
declare const PopoverContent: any;

export function DocumentViewOptions({
  sourceUrl,
  editUrl,
}: {
  sourceUrl: string;
  editUrl: string;
}) {
  const items = useMemo(() => {
    return [
      { title: 'View source', href: sourceUrl },
      { title: 'Edit on GitHub', href: editUrl },
    ];
  }, [sourceUrl, editUrl]);

  return (
    <Popover>
      <PopoverTrigger>Options</PopoverTrigger>
      <PopoverContent>
        {items.map((item: any) => (
          <a key={item.href} href={item.href}>{item.title}</a>
        ))}
      </PopoverContent>
    </Popover>
  );
}



// .map().filter() chain passed as useState initializer — only runs on mount — FP shape 350168ad3610
declare function useState<T>(initial: T): [T, (v: T) => void];
declare const ZCheckboxFieldMeta: any;
declare const fieldMeta: any;

function CheckboxField({ field }: { field: any }) {
  const parsedMeta = ZCheckboxFieldMeta.parse(
    fieldMeta ?? { type: 'checkbox', values: [{ id: 1, checked: false, value: '' }] },
  );

  const values = parsedMeta.values?.map((item: any) => ({
    ...item,
    value: item.value.length > 0 ? item.value : `empty-value-${item.id}`,
  }));

  const [checkedValues, setCheckedValues] = useState(
    values
      ?.map((item: any) =>
        item.checked ? (item.value.length > 0 ? item.value : `empty-value-${item.id}`) : ''
      )
      .filter(Boolean) || [],
  );

  return null;
}



// .sort().map() chain passed as useState initializer — runs only on mount — FP shape f81e12025a6f
declare const envelopeItems: Array<{ id: string; title: string; order: number }>;

interface LocalFile {
  id: string;
  title: string;
  envelopeItemId: string;
  isUploading: boolean;
}

function EnvelopeUploadPage() {
  const [localFiles, setLocalFiles] = useState<LocalFile[]>(
    envelopeItems
      .sort((a, b) => a.order - b.order)
      .map((item) => ({
        id: item.id,
        title: item.title,
        envelopeItemId: item.id,
        isUploading: false,
      })),
  );

  return null;
}



// Context.Provider wraps a div with {...props} — consumers are deeply nested, rule can't see through spread — FP shape 4c1e4255630f
declare const React: any;
declare const cn: any;

type FieldItemContextValue = { id: string };
const FieldItemContext = React.createContext<FieldItemContextValue>({} as FieldItemContextValue);

const FieldItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }: any, ref: any) => {
    const id = React.useId();

    return (
      <FieldItemContext.Provider value={{ id }}>
        <div ref={ref} className={cn('space-y-2', className)} {...props} />
      </FieldItemContext.Provider>
    );
  },
);
FieldItem.displayName = 'FieldItem';

export function useFieldItem() {
  const context = React.useContext(FieldItemContext);
  return {
    fieldItemId: `${context.id}-field-item`,
    fieldDescriptionId: `${context.id}-field-description`,
    fieldMessageId: `${context.id}-field-message`,
  };
}



// Context.Provider wraps single dynamic child selected from children array — consumers in subtree — FP shape ebbc7567db08
declare const useContext: any;

interface WizardStepContextValue {
  isTransitioning: boolean;
  stepIndex: number;
  currentStep: number;
  totalSteps: number;
  isFirst: boolean;
  isLast: boolean;
  goNext: () => void;
  goPrevious: () => void;
}

const WizardStepContext = React.createContext<WizardStepContextValue | null>(null);

function WizardStepper({
  children,
  currentStep,
  totalSteps,
  goNext,
  goPrevious,
  isTransitioning,
}: any) {
  if (totalSteps === 0) return null;

  const currentChild = React.Children.toArray(children)[currentStep - 1];

  const contextValue: WizardStepContextValue = {
    isTransitioning,
    stepIndex: currentStep - 1,
    currentStep,
    totalSteps,
    isFirst: currentStep === 1,
    isLast: currentStep === totalSteps,
    goNext,
    goPrevious,
  };

  return (
    <WizardStepContext.Provider value={contextValue}>
      {currentChild}
    </WizardStepContext.Provider>
  );
}

export function useWizardStep() {
  const ctx = useContext(WizardStepContext);
  if (!ctx) throw new Error('useWizardStep must be used within WizardStepper');
  return ctx;
}



// --- magic-string shape: typed-union-state-literal (two-factor method toggle) ---
declare function useState<T>(init: T): [T, (v: T) => void];

function TwoFactorSetupPanel() {
  const [method, setMethod] = useState<'totp' | 'backup'>('totp');

  return (
    <div>
      <button onClick={() => setMethod('totp')}>Authenticator App</button>
      <button onClick={() => setMethod('backup')}>Backup Codes</button>
      {method === 'totp' ? <div>Scan QR code</div> : <div>Save backup codes</div>}
    </div>
  );
}




// --- magic-string shape: typed-column-key-literal (sort handler argument) ---
type SortableColumn = 'name' | 'email' | 'createdAt' | 'status';

declare function useState<T>(init: T): [T, (v: T) => void];

function MemberTable({ members }: { members: Array<{ name: string; email: string; createdAt: string; status: string }> }) {
  const [sortColumn, setSortColumn] = useState<SortableColumn>('name');

  function handleColumnSort(col: SortableColumn) {
    setSortColumn(col);
  }

  return (
    <table>
      <thead>
        <tr>
          <th onClick={() => handleColumnSort('name')}>Name</th>
          <th onClick={() => handleColumnSort('email')}>Email</th>
          <th onClick={() => handleColumnSort('createdAt')}>Joined</th>
        </tr>
      </thead>
    </table>
  );
}




// --- magic-string shape: typed-union-width-comparison (layout variant check) ---
type LayoutWidth = 'full' | 'contained' | 'narrow';

interface BannerProps {
  width?: LayoutWidth;
  children: React.ReactNode;
}

function PageBanner({ width = 'contained', children }: BannerProps) {
  const isFullWidth = width === 'full';
  return (
    <div style={{ maxWidth: isFullWidth ? '100%' : '1200px' }}>
      {children}
    </div>
  );
}




// arithmetic-loop-bounds-guaranteed: virtualItems index bounded by itemCount === pages.length
declare function useVirtualItems(opts: { itemCount: number; overscan: number }): { virtualItems: { index: number }[] };

function PagedViewer({ pageMetadata }: { pageMetadata: { width: number; height: number }[] }) {
  const numPages = pageMetadata.length;
  const { virtualItems } = useVirtualItems({ itemCount: numPages, overscan: 3 });

  return (
    <div>
      {virtualItems.map((item) => {
        const meta = pageMetadata[item.index];
        const ratio = meta.height / meta.width;
        return <div key={item.index} style={{ paddingBottom: `${ratio * 100}%` }} />;
      })}
    </div>
  );
}



// guarded-or-preinitialized-object-access: context.slots[index] where provider guarantees exact slot count
declare const PinContext: React.Context<{ slots: { char: string; isActive: boolean }[] }>;

const CodeInputSlot = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'> & { index: number }
>(({ index, ...props }, ref) => {
  const ctx = React.useContext(PinContext);
  const { char, isActive } = ctx.slots[index];

  return (
    <div ref={ref} data-active={isActive} {...props}>
      {char}
    </div>
  );
});

CodeInputSlot.displayName = 'CodeInputSlot';



// Local async function named 'exec' inside a useEffect — not child_process.exec
declare const useEffect: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const doSearchSync: () => void;
declare const doSearch: () => Promise<void>;
declare let open: boolean;
declare let triggerOnFocus: boolean;
declare let searchTerm: string;

function useSearchEffect() {
  useEffect(() => {
    const exec = async () => {
      if (!open) {
        return;
      }

      if (triggerOnFocus) {
        doSearchSync();
      }

      if (searchTerm) {
        doSearchSync();
      }
    };

    void exec();
  }, [searchTerm, open, triggerOnFocus]);

  useEffect(() => {
    const exec = async () => {
      if (!open) {
        return;
      }

      if (triggerOnFocus) {
        await doSearch();
      }

      if (searchTerm) {
        await doSearch();
      }
    };

    void exec();
  }, [searchTerm, open, triggerOnFocus]);
}



// Enum dispatch for UI rendering — comparing field type against enum namespace member
declare const enum WidgetType { CHART = 'CHART', TABLE = 'TABLE', MAP = 'MAP' }

interface Widget { id: string; type: WidgetType; customData?: string; }

function extractChartWidgets(widgets: Widget[]): Widget[] {
  return widgets.filter((w) => w.type === WidgetType.CHART);
}



// Enum comparison for conditional icon rendering — not a secret comparison
declare const enum BlockType { TEXT = 'TEXT', IMAGE = 'IMAGE', VIDEO = 'VIDEO' }
declare const ImageIcon: React.FC<{ className?: string }>;

interface Block { id: string; type: BlockType; }

function renderBlockIcon(block: Block) {
  return block.type !== BlockType.IMAGE ? null : <ImageIcon className="h-4 w-4" />;
}



// Zod refine comparing password fields in client-side form validation — browser-side, no timing oracle
declare const z: {
  object: (shape: any) => any;
  string: () => { min: (n: number) => any };
};

const ZChangePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(8),
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((data: { newPassword: string; confirmPassword: string }) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: "Passwords don't match",
  });



// Enum comparison to decide which image to render in a UI component — not a secret
declare const enum ItemKind { PHOTO = 'PHOTO', VIDEO = 'VIDEO', DOCUMENT = 'DOCUMENT' }

interface GalleryItem { id: string; type: ItemKind; thumbnailUrl?: string; }

function renderGalleryItemPreview(item: GalleryItem) {
  if (item.type === ItemKind.PHOTO && item.thumbnailUrl) {
    return <img src={item.thumbnailUrl} alt="Preview" className="h-full w-full object-contain" />;
  }
  return null;
}



// Boolean config flag comparison for feature gating — not a secret comparison
declare const useFormContext: () => { watch: (name: string) => any };
declare const toast: (opts: any) => void;

interface SignatureOptions { typedEnabled: boolean; drawEnabled: boolean; uploadEnabled: boolean; }

function validateSignatureInput(value: string, options: SignatureOptions) {
  const isTyped = !value.startsWith('data:image');

  if (isTyped && options.typedEnabled === false) {
    toast({ title: 'Error', description: 'Typed signatures are not allowed.', variant: 'destructive' });
    return false;
  }

  return true;
}



// Comparing field type against FieldType enum to determine which auth flow to use — routing, not secret
declare const enum FieldType { SIGNATURE = 'SIGNATURE', TEXT = 'TEXT', DATE = 'DATE' }

interface AuthAction { actionTarget: FieldType; onReauthFormSubmit: (authOptions?: any) => Promise<void>; }

async function executeActionAuth(options: AuthAction, derivedActionAuth?: string[]) {
  if (!derivedActionAuth || options.actionTarget !== FieldType.SIGNATURE) {
    await options.onReauthFormSubmit();
    return;
  }
  // request auth from user
}



// Zod refine comparing password fields for client-side validation — browser-side, no timing oracle
declare const z: { object: (s: any) => any; string: () => any; };

const ZSetPasswordFormSchema = z
  .object({
    password: z.string(),
    repeatedPassword: z.string(),
  })
  .refine((data: { password: string; repeatedPassword: string }) => data.password === data.repeatedPassword, {
    message: 'Passwords do not match',
    path: ['repeatedPassword'],
  });



// Array length check to show empty-state UI — not a secret comparison
declare const ApiKeyCard: React.FC<{ keyId: string; name: string }>;

interface ApiKey { id: string; name: string; createdAt: Date; }

function ApiKeyList({ apiKeys }: { apiKeys: ApiKey[] }) {
  return (
    <div>
      {apiKeys && apiKeys.length === 0 && (
        <p className="text-muted-foreground text-sm italic">No API keys yet. Create one to get started.</p>
      )}
      {apiKeys && apiKeys.length > 0 && (
        <ul>
          {apiKeys.map((key) => (
            <li key={key.id}>
              <ApiKeyCard keyId={key.id} name={key.name} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}



// Enum comparison for CSS class conditional in UI component — styling, not secret
declare const enum FieldType { SIGNATURE = 'SIGNATURE', FREE_SIGNATURE = 'FREE_SIGNATURE', TEXT = 'TEXT' }
declare const cn: (...classes: (string | false | undefined)[]) => string;

interface FormField { type: FieldType; inserted: boolean; }

function getFieldContainerClass(field: FormField): string {
  return cn(
    'field-card-container group relative flex h-full w-full items-center rounded',
    field.type !== FieldType.SIGNATURE && field.type !== FieldType.FREE_SIGNATURE ? 'px-2' : undefined,
    !field.inserted ? 'justify-center' : undefined,
  );
}



// DB primary key comparison to find a record in UI list for display — not auth
interface ApiKeyEntry { id: number; name: string; token: string; createdAt: Date; }

function ApiKeyHighlight({
  apiKeys,
  newlyCreatedKeyId,
}: {
  apiKeys: ApiKeyEntry[];
  newlyCreatedKeyId: number | null;
}) {
  const newlyCreatedKey = newlyCreatedKeyId
    ? apiKeys.find((key) => key.id === newlyCreatedKeyId)
    : null;

  if (!newlyCreatedKey) return null;

  return <div className="mt-4 rounded bg-muted p-3">{newlyCreatedKey.name} was just created.</div>;
}


// FP: tRPC onSuccess async navigate callback — standard mutation pattern, no type mismatch
declare function usePortalMutation<TInput>(opts: {
  mutationFn: (data: TInput) => Promise<void>;
  onSuccess?: () => Promise<void> | void;
}): { mutate: (data: TInput) => void };
declare function useNavigate(): (path: string) => Promise<void>;
declare function buildPortalPath(slug: string): string;

function PortalJoinConfirmForm({ slug, inviteToken }: { slug: string; inviteToken: string }) {
  const navigate = useNavigate();
  const { mutate: acceptInvite } = usePortalMutation({
    mutationFn: async (data: { token: string }) => submitPortalInvite(data),
    onSuccess: async () => {
      await navigate(buildPortalPath(slug));
    },
  });
  return <button onClick={() => acceptInvite({ token: inviteToken })}>Join Portal</button>;
}

declare function submitPortalInvite(data: { token: string }): Promise<void>;



// FP: Radix UI namespace member re-export aliases — intentional module re-aliasing pattern.
// The rule must not fire on const X = Namespace.X; re-export patterns.
declare const CollapsiblePrimitive: {
  Root: unknown;
  Trigger: unknown;
  Content: unknown;
};

const Collapsible = CollapsiblePrimitive.Root;
const CollapsibleTrigger = CollapsiblePrimitive.Trigger;
const CollapsibleContent = CollapsiblePrimitive.Content;

export { Collapsible, CollapsibleTrigger, CollapsibleContent };



// Exported component prop-type alias over a library type — decouples consumers from the primitive, standard React practice
declare namespace SelectPrimitive_8973 {
  interface SelectProps {
    value?: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
    children?: React.ReactNode;
  }
}

export type EnvelopeStatusSelectProps_8973 = SelectPrimitive_8973.SelectProps;

declare function forwardRef_8973<T, P>(fn: (props: P, ref: React.Ref<T>) => React.ReactElement | null): React.ForwardRefExoticComponent<P & React.RefAttributes<T>>;

export const EnvelopeStatusSelect_8973 = forwardRef_8973<HTMLButtonElement, EnvelopeStatusSelectProps_8973>(({ ...props }, _ref) => {
  return <div role="combobox" aria-expanded="false" />;
});

