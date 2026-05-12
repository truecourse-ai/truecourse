export function ServerList(): JSX.Element {
  return <div><ul><li>Item</li></ul></div>;
}
export function SearchInput(): JSX.Element {
  return <div><input type="text" readOnly /></div>;
}


// Top-level React client entry bootstrap: top-level await is unavailable in the
// browser entry context, so the idiomatic pattern is to invoke an async main()
// at the module top level. ESLint's no-floating-promises is intentionally
// suppressed on the call site to document developer intent.
declare const startTransition: (cb: () => void) => void;
declare const hydrateRoot: (container: Element, children: unknown) => void;
declare const document: { getElementById(id: string): Element };
declare const RemixBrowser: () => JSX.Element;

async function main(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  startTransition(() => {
    hydrateRoot(document.getElementById('root'), <RemixBrowser />);
  });
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();



declare const useHydrated: () => boolean;
declare const useSyncExternalStore: <T>(subscribe: (cb: () => void) => () => void, getSnapshot: () => T, getServerSnapshot: () => T) => T;

type ClientOnlyProps = {
  children: () => JSX.Element;
  fallback?: JSX.Element | null;
};

export function ClientOnly({ children, fallback = null }: ClientOnlyProps): JSX.Element | null {
  return useHydrated() ? children() : fallback;
}

export function HydrationGate({ children, fallback = null }: ClientOnlyProps): JSX.Element | null {
  const emptySubscribe = (): (() => void) => () => {};
  const isHydrated = useSyncExternalStore(emptySubscribe, () => true, () => false);
  return isHydrated ? children() : fallback;
}



// FP mode: remix-ancestor-boundary-covers-file
// Leaf Remix route component covered by root.tsx ErrorBoundary via Remix nested routing convention.
declare const trpc: { document: { find: { useQuery: (input: { id: string }) => { data?: { title: string }; isLoading: boolean } } } };
export function EnvelopeDistributeDialog(props: { id: string }): JSX.Element {
  const { data, isLoading } = trpc.document.find.useQuery({ id: props.id });
  if (isLoading) return <div>Loading…</div>;
  return <div className="dialog">{data?.title}</div>;
}

// FP mode: async-handler-not-render-throw
// Errors raised inside async event handler; React error boundaries cannot catch async rejections.
declare const trpc2: { folder: { move: { useMutation: () => { mutateAsync: (i: { id: string }) => Promise<void> } } } };
declare const toast: (m: { title: string; variant: string }) => void;
class AppError extends Error { constructor(public code: string) { super(code); } }
export function DocumentMoveToFolderDialog(props: { id: string }): JSX.Element {
  const { mutateAsync } = trpc2.folder.move.useMutation();
  const onSubmit = async (): Promise<void> => {
    try {
      await mutateAsync({ id: props.id });
    } catch (err) {
      throw new AppError('MOVE_FAILED');
    }
  };
  return <form onSubmit={onSubmit}><button type="submit">Move</button></form>;
}

// FP mode: react-query-no-throw-mode
// useQuery without throwOnError/suspense returns isError state and never throws during render.
declare const trpc3: { admin: { claims: { list: { useQuery: () => { data?: Array<{ id: string }>; isLoadingError: boolean } } } } };
export function AdminClaimsTable(): JSX.Element {
  const { data, isLoadingError } = trpc3.admin.claims.list.useQuery();
  return <table><tbody>{(data ?? []).map((row) => <tr key={row.id}><td>{row.id}</td><td>{isLoadingError ? 'err' : 'ok'}</td></tr>)}</tbody></table>;
}

// FP mode: context-provider-not-boundary-owner
// Context provider is a structural wrapper; boundary ownership belongs to enclosing route, not provider.
declare const React2: { createContext: <T>(v: T) => { Provider: (p: { value: T; children: JSX.Element }) => JSX.Element } };
declare const trpc4: { passkey: { get: { useQuery: () => { data?: { id: string } } } } };
const AuthCtx = React2.createContext<{ id?: string }>({});
export function DocumentSigningAuthProvider(props: { children: JSX.Element }): JSX.Element {
  const { data } = trpc4.passkey.get.useQuery();
  return <AuthCtx.Provider value={{ id: data?.id }}>{props.children}</AuthCtx.Provider>;
}

// FP mode: suspense-for-lazy-not-data-fetch
// Suspense here is the standard React.lazy() loading fallback, not for data fetching.
declare const React3: { lazy: <T>(f: () => Promise<{ default: T }>) => T; Suspense: (p: { fallback: JSX.Element; children: JSX.Element }) => JSX.Element };
const PdfViewerImpl = React3.lazy(() => Promise.resolve({ default: (): JSX.Element => <div>pdf</div> }));
export function PdfViewerLazy(): JSX.Element {
  return <React3.Suspense fallback={<div>Loading PDF…</div>}><PdfViewerImpl /></React3.Suspense>;
}



// shadcn/ui toast singleton pattern: a deliberately shared module-level store
// that React hooks subscribe to via dispatch. The mutable state is the entire
// design — not an accidental bug.
type ToasterToast = { id: string; title?: string; open?: boolean };
type State = { toasts: ToasterToast[] };
type Action =
  | { type: 'ADD_TOAST'; toast: ToasterToast }
  | { type: 'DISMISS_TOAST'; toastId?: string };

declare const reducer: (state: State, action: Action) => State;
declare const useReactState: <T>(initial: T) => [T, (v: T) => void];
declare const useReactEffect: (fn: () => void | (() => void), deps: unknown[]) => void;

const listeners: Array<(state: State) => void> = [];

let memoryState: State = { toasts: [] };

function dispatch(action: Action): void {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

export function useToast(): { toasts: ToasterToast[]; dismiss: (id?: string) => void } {
  const [state, setState] = useReactState<State>(memoryState);

  useReactEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, [state]);

  return {
    toasts: state.toasts,
    dismiss: (toastId?: string) => dispatch({ type: 'DISMISS_TOAST', toastId }),
  };
}



// Intentional fire-and-forget patterns using `void` to discard Promises.
// The rule targets `void 0` / `void undefined` only; these unary `void <call>`
// expressions are legitimate React/Remix idioms, not bugs.

declare const handleAutoSave: () => Promise<void>;
declare const onFormSubmit: () => Promise<void>;
declare const navigate: (path: string) => Promise<void>;
declare const executeActionAuthProcedure: (opts: { onReauthFormSubmit: () => void }) => Promise<void>;
declare const fetchMetadata: () => Promise<void>;
declare const revalidate: () => Promise<unknown>;
declare const dynamicActivate: (lang: string) => Promise<void>;
declare const copy: (text: string) => Promise<boolean>;
declare const toast: (msg: string) => void;
declare const main: () => Promise<void>;
declare const TelemetryClient: { start: () => Promise<void> };
declare const LicenseClient: { start: () => Promise<void> };
declare const browser: { close: () => Promise<void> };
declare const pdf: { destroy: () => Promise<void> & { catch: (h: (e: unknown) => void) => Promise<void> } };
declare const useEffect: (fn: () => void | (() => void), deps: readonly unknown[]) => void;
declare const useState: <T>(initial: T) => [T, (next: T) => void];

export function AutoSaveField(): JSX.Element {
  const onBlur = (): void => {
    void handleAutoSave();
  };
  return <input type="text" onBlur={onBlur} />;
}

export function SignerNextButton(): JSX.Element {
  return <button type="button" onClick={() => void onFormSubmit()}>Next</button>;
}

export function SearchParamSelector(): JSX.Element {
  const onChange = (next: string): void => {
    void navigate(`?q=${next}`);
  };
  return <input type="text" onChange={(e) => onChange(e.target.value)} />;
}

export function SigningCheckboxField(): JSX.Element {
  const [value] = useState<string>('');
  useEffect(() => {
    void executeActionAuthProcedure({
      onReauthFormSubmit: () => undefined,
    });
  }, [value]);
  return <div>checkbox</div>;
}

export function PdfViewer(): JSX.Element {
  useEffect(() => {
    void fetchMetadata();
  }, []);
  return <div>viewer</div>;
}

export function EnvelopeEditorFieldsPage(): JSX.Element {
  const refresh = (): void => {
    void revalidate().then(() => toast('Refreshed'));
  };
  return <button type="button" onClick={refresh}>Refresh</button>;
}

export function EmbedDirectTemplateClientPage(): JSX.Element {
  useEffect(() => {
    void dynamicActivate('en').finally(() => toast('i18n ready'));
  }, []);
  return <div>embed</div>;
}

export function AvatarWithRecipient(): JSX.Element {
  const onCopy = (): void => {
    void copy('signer@example.com').then(() => toast('Copied'));
  };
  return <button type="button" onClick={onCopy}>Copy</button>;
}

// Module top-level fire-and-forget (script entry-point / service startup).
void main();
void TelemetryClient.start();
void LicenseClient.start();

// Async cleanup / resource teardown in a finally block.
export async function renderAuditPdf(html: string): Promise<Buffer> {
  try {
    await Promise.resolve();
    return Buffer.from(html);
  } finally {
    void browser.close();
    void pdf.destroy().catch((err) => toast(String(err)));
  }
}



// Empty-function FP cases: intentional no-ops that should NOT trigger the rule.

declare const DataTable: (props: {
  data: ReadonlyArray<{ id: string; name: string }>;
  totalPages: number;
  currentPage: number;
  onPaginationChange: (page: number) => void;
}) => JSX.Element;

declare const useSyncExternalStore: <T>(
  subscribe: (onChange: () => void) => () => void,
  getSnapshot: () => T,
  getServerSnapshot?: () => T,
) => T;

// shape-4763360ee411: DataTable with single page — pagination intentionally disabled.
export function SingleEmailDomainList(): JSX.Element {
  const rows = [{ id: 'd1', name: 'example.com' }];
  return (
    <DataTable
      data={rows}
      totalPages={1}
      currentPage={1}
      onPaginationChange={() => {}}
    />
  );
}

// shape-593e11e20064: useSyncExternalStore subscribe must return a cleanup;
// `() => {}` is the required no-op when the store never updates.
const emptySubscribe = (_onStoreChange: () => void): (() => void) => {
  return () => {};
};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

// shape-e8c7ea31ef58: async no-op as null-object default for an optional callback prop.
interface FieldAdvancedSettingsProps {
  label: string;
  onAutoSave?: (value: string) => Promise<void>;
}

export function FieldItemAdvancedSettings({
  label,
  onAutoSave = async () => {},
}: FieldAdvancedSettingsProps): JSX.Element {
  const handleBlur = async (e: { target: { value: string } }): Promise<void> => {
    await onAutoSave(e.target.value);
  };
  return (
    <div>
      <label>{label}</label>
      <input type="text" onBlur={handleBlur} />
    </div>
  );
}



// --- expression-complexity positive cases (should NOT trigger) ---

declare const useSession: () => { user: { id: string; name: string; email: string } };
declare const useLingui: () => { _: (s: string) => string; t: (s: string) => string };
declare const FieldType: { CHECKBOX: 'checkbox'; RADIO: 'radio'; DROPDOWN: 'dropdown'; TEXT: 'text' };
declare const IS_GOOGLE_SSO_ENABLED: boolean;
declare const IS_OIDC_SSO_ENABLED: boolean;
declare const IS_PASSKEY_ENABLED: boolean;
declare function isSignupEnabledForProvider(p: string): boolean;

// Mode: destructured-parameter-lists — many React props destructured in parameter position.
type AiFieldDetectionDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
  documentId: string;
  recipients: ReadonlyArray<{ id: string; email: string }>;
  fields: ReadonlyArray<{ id: string; type: string }>;
  isLoading: boolean;
  error: string | null;
  title: string;
  description: string;
};

export function AiFieldDetectionDialog({
  isOpen,
  onClose,
  onConfirm,
  documentId,
  recipients,
  fields,
  isLoading,
  error,
  title,
  description,
}: AiFieldDetectionDialogProps): JSX.Element {
  return (
    <div data-open={isOpen} data-doc={documentId}>
      <h2>{title}</h2>
      <p>{description}</p>
      <span>{recipients.length}</span>
      <span>{fields.length}</span>
      <button onClick={onClose} disabled={isLoading}>Close</button>
      <button onClick={() => onConfirm(fields.map((f) => f.id))}>Confirm</button>
      {error}
    </div>
  );
}

// Mode: jsx-structural-elements — deeply nested JSX return with many props/children.
export function DocumentSigningPageView(): JSX.Element {
  return (
    <div className="min-h-screen w-screen bg-gray-50 dark:bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Documenso</span>
          <span className="text-muted-foreground text-xs">Signing</span>
        </div>
        <nav className="flex items-center gap-2">
          <a href="/help" className="text-xs hover:underline">Help</a>
          <a href="/account" className="text-xs hover:underline">Account</a>
        </nav>
      </header>
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <section className="rounded-lg border bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold">Sign document</h1>
          <p className="text-muted-foreground mt-2 text-sm">Review and complete the fields below.</p>
        </section>
      </main>
    </div>
  );
}

// Mode: component-body-hook-and-var-setup — single-statement hook destructure / guard / null-check.
export function DocumentPageViewDropdown(): JSX.Element {
  const { user } = useSession();
  const { _ } = useLingui();
  if (user == null) return <div>{_('Not signed in')}</div>;
  return <div data-user={user.id}>{_(user.name)}</div>;
}

// Mode: object-literal-and-call-arguments — destructured prop with inline object literal default.
type CheckboxFieldValue = { type: 'checkbox' | 'radio'; direction: 'vertical' | 'horizontal' };
type EditorFieldCheckboxFormProps = {
  name: string;
  value?: CheckboxFieldValue;
  onChange: (next: CheckboxFieldValue) => void;
};

export function EditorFieldCheckboxForm({
  name,
  value = { type: 'checkbox', direction: 'vertical' },
  onChange,
}: EditorFieldCheckboxFormProps): JSX.Element {
  return (
    <label data-name={name} data-type={value.type} data-direction={value.direction}>
      <input
        type="checkbox"
        onChange={() => onChange({ type: value.type, direction: value.direction })}
      />
      {name}
    </label>
  );
}

// Mode: idiomatic-boolean-expressions — type-guard ternary + feature-flag OR chain.
type SubscriptionLike = { customer: string | { id: string }; status: 'active' | 'canceled' };

export function resolveCustomerId(subscription: SubscriptionLike): string {
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
  return customerId;
}

export function computeSignupEnabled(): boolean {
  const isSignupEnabled =
    isSignupEnabledForProvider('email') ||
    (IS_GOOGLE_SSO_ENABLED && isSignupEnabledForProvider('google')) ||
    (IS_OIDC_SSO_ENABLED && isSignupEnabledForProvider('oidc')) ||
    IS_PASSKEY_ENABLED;
  return isSignupEnabled;
}

type FormField = { type: string; fieldMeta: unknown };

export function hasFieldMetaError(field: FormField): boolean {
  const hasError =
    (field.type === FieldType.CHECKBOX ||
      field.type === FieldType.RADIO ||
      field.type === FieldType.DROPDOWN) &&
    field.fieldMeta === undefined;
  return hasError;
}



// Positive fixtures for code-quality/deterministic/max-statements-per-function.
//
// Mode shape-51628654def7: Large React functional component view where the
// statement count is inflated by required top-level hook calls (useState,
// useEffect, useMemo, useRef, useForm). Hooks must live at the top level of
// the component, so the count reflects React's rules-of-hooks structure
// rather than cyclomatic complexity. Not a real complexity smell.
//
// Mode shape-84a13daf0c99: Large React context provider component where the
// statement count is dominated by useState/useCallback/useMemo declarations
// that expose a stable API to children. The body is flat and structural.

declare const React: {
  useState: <T>(initial: T | (() => T)) => [T, (next: T | ((prev: T) => T)) => void];
  useEffect: (effect: () => void | (() => void), deps?: ReadonlyArray<unknown>) => void;
  useMemo: <T>(factory: () => T, deps: ReadonlyArray<unknown>) => T;
  useCallback: <T extends (...args: never[]) => unknown>(cb: T, deps: ReadonlyArray<unknown>) => T;
  useRef: <T>(initial: T) => { current: T };
  createContext: <T>(value: T) => { Provider: (props: { value: T; children: unknown }) => JSX.Element };
};

declare const useForm: <T>(opts: { defaultValues: T }) => {
  control: unknown;
  handleSubmit: (cb: (values: T) => void) => (e: unknown) => void;
  watch: () => T;
  setValue: (name: keyof T, value: unknown) => void;
  reset: () => void;
};
declare const useFieldArray: (opts: { control: unknown; name: string }) => {
  fields: ReadonlyArray<{ id: string }>;
  append: (value: unknown) => void;
  remove: (index: number) => void;
};
declare const useToast: () => { toast: (message: string) => void };
declare const useLingui: () => { _: (key: string) => string };

type RecipientLite = { id: string; name: string; email: string; role: string };
type FieldType = 'SIGNATURE' | 'TEXT' | 'DATE';
type FieldsFormSchema = { fields: Array<{ id: string; type: FieldType; recipientId: string }> };

type ConfigureFieldsViewProps = {
  configData: { signers: ReadonlyArray<RecipientLite>; documentData?: { data: string } };
  presignToken?: string;
  defaultValues?: Partial<FieldsFormSchema>;
  onBack?: (data: FieldsFormSchema) => void;
  onSubmit: (data: FieldsFormSchema) => void;
};

// shape-51628654def7: large authoring view component, statements are hooks.
export const ConfigureFieldsView = ({
  configData,
  presignToken,
  defaultValues,
  onBack,
  onSubmit,
}: ConfigureFieldsViewProps): JSX.Element => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const [isMobile, setIsMobile] = React.useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);
  const [selectedRecipient, setSelectedRecipient] = React.useState<RecipientLite | null>(null);
  const [selectedField, setSelectedField] = React.useState<FieldType | null>(null);
  const [isFieldWithinBounds, setIsFieldWithinBounds] = React.useState(false);
  const [coords, setCoords] = React.useState({ x: 0, y: 0 });
  const [activeFieldId, setActiveFieldId] = React.useState<string | null>(null);
  const [lastActiveField, setLastActiveField] = React.useState<FieldsFormSchema['fields'][0] | null>(null);
  const [fieldClipboard, setFieldClipboard] = React.useState<FieldsFormSchema['fields'][0] | null>(null);
  const [showAdvancedSettings, setShowAdvancedSettings] = React.useState(false);
  const [currentField, setCurrentField] = React.useState<FieldsFormSchema['fields'][0] | null>(null);
  const fieldBounds = React.useRef({ height: 60, width: 150 });
  React.useEffect(() => {
    const checkIfMobile = () => setIsMobile(true);
    checkIfMobile();
    return () => setIsDrawerOpen(false);
  }, []);
  const normalizedDocumentData = React.useMemo(() => configData.documentData?.data, [configData.documentData]);
  const recipients = React.useMemo(() => configData.signers.map((s) => ({ ...s })), [configData.signers]);
  const form = useForm<FieldsFormSchema>({ defaultValues: { fields: defaultValues?.fields ?? [] } });
  const { control, handleSubmit, watch, setValue, reset } = form;
  const fieldArray = useFieldArray({ control, name: 'fields' });
  const handleSelectRecipient = React.useCallback((r: RecipientLite) => setSelectedRecipient(r), []);
  const handleSelectField = React.useCallback((t: FieldType) => setSelectedField(t), []);
  const handleClearClipboard = React.useCallback(() => setFieldClipboard(null), []);
  const handleToggleAdvanced = React.useCallback(() => setShowAdvancedSettings(true), []);
  const handleResetForm = React.useCallback(() => reset(), [reset]);
  const handleBack = React.useCallback(() => onBack?.(watch()), [onBack, watch]);
  const submit = handleSubmit((data) => onSubmit(data));
  void normalizedDocumentData;
  void recipients;
  void fieldArray;
  void presignToken;
  void isMobile;
  void isDrawerOpen;
  void selectedField;
  void isFieldWithinBounds;
  void coords;
  void activeFieldId;
  void lastActiveField;
  void fieldClipboard;
  void showAdvancedSettings;
  void currentField;
  void fieldBounds;
  void setValue;
  void handleSelectRecipient;
  void handleSelectField;
  void handleClearClipboard;
  void handleToggleAdvanced;
  void handleResetForm;
  void handleBack;
  void setIsFieldWithinBounds;
  void setCoords;
  void setActiveFieldId;
  void setLastActiveField;
  void setCurrentField;
  void selectedRecipient;
  return <form onSubmit={submit}>{_('configure.fields')}<button onClick={() => toast('saved')}>Save</button></form>;
};

// shape-84a13daf0c99: context provider whose statements are state + callbacks
// exposed as a stable API on the context value.
type EnvelopeEditorContextValue = {
  step: number;
  setStep: (next: number) => void;
  title: string;
  setTitle: (next: string) => void;
  recipients: ReadonlyArray<RecipientLite>;
  addRecipient: (r: RecipientLite) => void;
  removeRecipient: (id: string) => void;
  fields: ReadonlyArray<FieldsFormSchema['fields'][0]>;
  addField: (f: FieldsFormSchema['fields'][0]) => void;
  removeField: (id: string) => void;
  isDirty: boolean;
  markDirty: () => void;
  markClean: () => void;
};

const EnvelopeEditorContext = React.createContext<EnvelopeEditorContextValue | null>(null);

export const EnvelopeEditorProvider = ({
  children,
  initialTitle = '',
}: {
  children: unknown;
  initialTitle?: string;
}): JSX.Element => {
  const [step, setStepInternal] = React.useState(0);
  const [title, setTitleInternal] = React.useState(initialTitle);
  const [recipients, setRecipients] = React.useState<ReadonlyArray<RecipientLite>>([]);
  const [fields, setFields] = React.useState<ReadonlyArray<FieldsFormSchema['fields'][0]>>([]);
  const [isDirty, setIsDirty] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);
  const [errorCount, setErrorCount] = React.useState(0);
  const previousTitleRef = React.useRef(initialTitle);
  const setStep = React.useCallback((next: number) => setStepInternal(next), []);
  const setTitle = React.useCallback((next: string) => {
    previousTitleRef.current = next;
    setTitleInternal(next);
  }, []);
  const addRecipient = React.useCallback((r: RecipientLite) => setRecipients((prev) => [...prev, r]), []);
  const removeRecipient = React.useCallback((id: string) => setRecipients((prev) => prev.filter((r) => r.id !== id)), []);
  const addField = React.useCallback((f: FieldsFormSchema['fields'][0]) => setFields((prev) => [...prev, f]), []);
  const removeField = React.useCallback((id: string) => setFields((prev) => prev.filter((f) => f.id !== id)), []);
  const markDirty = React.useCallback(() => setIsDirty(true), []);
  const markClean = React.useCallback(() => {
    setIsDirty(false);
    setLastSavedAt(Date.now());
  }, []);
  React.useEffect(() => {
    if (isDirty) {
      setErrorCount((prev) => prev);
    }
  }, [isDirty]);
  const value = React.useMemo<EnvelopeEditorContextValue>(
    () => ({
      step,
      setStep,
      title,
      setTitle,
      recipients,
      addRecipient,
      removeRecipient,
      fields,
      addField,
      removeField,
      isDirty,
      markDirty,
      markClean,
    }),
    [step, setStep, title, setTitle, recipients, addRecipient, removeRecipient, fields, addField, removeField, isDirty, markDirty, markClean],
  );
  void lastSavedAt;
  void errorCount;
  return <EnvelopeEditorContext.Provider value={value}>{children as JSX.Element}</EnvelopeEditorContext.Provider>;
};



// --- FP: code-quality/deterministic/nested-ternary ---
// Mode shape-2a139f3f47a2: 3-way string-to-typed-value conversion bridging an
// HTML <select> value to boolean|null. Idiomatic and readable as a single inline
// expression; flagging this as a quality issue is a false positive.
declare const tristateField: { onChange: (value: boolean | null) => void };

export function TristatePreferenceSelect(): JSX.Element {
  return (
    <select
      onChange={(e) => {
        const value = e.target.value;
        tristateField.onChange(value === 'true' ? true : value === 'false' ? false : null);
      }}
    >
      <option value="true">Enabled</option>
      <option value="false">Disabled</option>
      <option value="">Inherit</option>
    </select>
  );
}

// Mode shape-06c30d2d3689: nested ternary in JSX used to render one of three
// mutually-exclusive states (syncing / email / none). Well-indented, idiomatic
// React conditional-rendering pattern with no readability concern.
declare const isSyncingDistribution: boolean;
declare const distributionMethod: 'EMAIL' | 'NONE';

export function DistributionStatusPanel(): JSX.Element {
  return (
    <div className="distribution-status">
      {isSyncingDistribution ? (
        <div key="Flushing" className="status-syncing">
          <span>Flushing pending updates...</span>
        </div>
      ) : distributionMethod === 'EMAIL' ? (
        <div key="Emails" className="status-email">
          <span>Sending notification emails to recipients</span>
        </div>
      ) : (
        <div key="None" className="status-none">
          <span>No further action required</span>
        </div>
      )}
    </div>
  );
}



// --- Singleton license client: private empty constructor blocks external instantiation ---
export class LicenseClient {
  private static instance: LicenseClient | null = null;
  private licenseKey: string | null = null;

  private constructor() {}

  public static getInstance(): LicenseClient {
    if (!LicenseClient.instance) {
      LicenseClient.instance = new LicenseClient();
    }
    return LicenseClient.instance;
  }

  public setKey(key: string): void {
    this.licenseKey = key;
  }

  public getKey(): string | null {
    return this.licenseKey;
  }
}

// --- Singleton telemetry client: same private empty constructor pattern ---
export class TelemetryClient {
  private static instance: TelemetryClient | null = null;
  private events: string[] = [];

  private constructor() {}

  public static getInstance(): TelemetryClient {
    if (!TelemetryClient.instance) {
      TelemetryClient.instance = new TelemetryClient();
    }
    return TelemetryClient.instance;
  }

  public track(event: string): void {
    this.events.push(event);
  }
}

// --- DataTable rendered with a single page: required pagination callbacks are no-ops ---
declare const React: {
  useSyncExternalStore: <T>(
    subscribe: (onChange: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ) => T;
};

type DataTableProps<T> = {
  data: readonly T[];
  totalPages: number;
  currentPage: number;
  onPaginationChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
};

declare const DataTable: <T>(props: DataTableProps<T>) => JSX.Element;

type EmailDomain = { id: string; domain: string };

export function EmailDomainAdminPage(): JSX.Element {
  const domains: EmailDomain[] = [
    { id: 'a', domain: 'example.com' },
    { id: 'b', domain: 'documenso.com' },
  ];

  return (
    <div>
      <h1>Email Domains</h1>
      <DataTable
        data={domains}
        totalPages={1}
        currentPage={1}
        onPaginationChange={() => {}}
        onPageSizeChange={() => {}}
      />
    </div>
  );
}

// --- useSyncExternalStore: the unsubscribe return is required to be a no-op on the server ---
const emptySubscribe = (_onStoreChange: () => void): (() => void) => {
  return () => {};
};

export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}




declare const useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => void;
declare const useState: <S>(init: S) => [S, (v: S) => void];
declare const navigate: (to: string | number) => Promise<void>;
declare const navigateToStep: (step: string) => Promise<void>;
declare const revalidator: { revalidate: () => Promise<void> };
declare const dynamicActivate: (lang: string) => Promise<void>;
declare const pdfDocument: { destroy: () => Promise<void> };
declare const LicenseClient: { start: () => Promise<void> };

async function handleAutoSave(): Promise<void> {
  return Promise.resolve();
}
async function onFormSubmit(): Promise<void> {
  return Promise.resolve();
}
async function onDownloadAuditLogsClick(): Promise<void> {
  return Promise.resolve();
}
async function fetchMetadata(): Promise<void> {
  return Promise.resolve();
}
async function launchEmbed(): Promise<void> {
  return Promise.resolve();
}
async function mainSeed(): Promise<void> {
  return Promise.resolve();
}

// Mode: fire-and-forget-sync-event-callback
// `void` in onClick / onValueChange JSX props discards the returned Promise so
// the handler stays synchronous and satisfies no-floating-promises.
export function AutoSaveSettingsForm(): JSX.Element {
  return (
    <div>
      <button type="button" onClick={() => void handleAutoSave()}>
        Save
      </button>
      <button type="button" onClick={() => void onFormSubmit()}>
        Submit
      </button>
      <button type="button" onClick={() => void onDownloadAuditLogsClick()}>
        Download audit log
      </button>
    </div>
  );
}

// Mode: fire-and-forget-use-effect
// `void` inside a useEffect callback fires an async call without making the
// effect itself async, the canonical React pattern.
export function PdfMetadataLoader(): JSX.Element {
  const [ready, setReady] = useState<boolean>(false);
  useEffect(() => {
    void fetchMetadata();
    void launchEmbed();
    if (!ready) {
      setReady(true);
    }
  }, [ready]);
  return <div>{ready ? 'ready' : 'loading'}</div>;
}

// Mode: fire-and-forget-navigation
// `void navigate(...)` / `void navigateToStep(...)` discards the Promise from
// React Router / Remix navigate in a sync event handler.
export function BackButton(): JSX.Element {
  return (
    <div>
      <a onClick={() => void navigate(-1)}>Back</a>
      <button type="button" onClick={() => void navigate('/documents')}>
        Documents
      </button>
      <button type="button" onClick={() => void navigateToStep('upload')}>
        Upload step
      </button>
    </div>
  );
}

// Mode: void-with-promise-chain
// `void` applied to a Promise chain (.then / .catch / .finally) keeps the
// side-effect continuations while discarding the outer Promise.
export function RecipientRevalidator(): JSX.Element {
  const [pending, setPending] = useState<boolean>(true);
  useEffect(() => {
    void revalidator.revalidate().then(() => setPending(false));
    void dynamicActivate('en').finally(() => {
      setPending(false);
    });
    void pdfDocument.destroy().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err);
    });
  }, []);
  return <div>{pending ? 'revalidating' : 'idle'}</div>;
}

// Mode: module-level-or-non-react-async-init
// `void` at module top level (IIFE / direct call) fires async initialization
// before top-level await is available. Standard for Node entry points and
// non-React server modules.
void (async () => {
  await Promise.resolve();
})();

void mainSeed();

void LicenseClient.start();



// --- FP fixtures for react-readonly-props ---

declare const React: { ReactNode: unknown };
type ReactNode = string | number | boolean | null | undefined | { __jsx: true };
type Control<T> = { _formValues: T; register: (name: keyof T) => void };
type Table<T> = { getRowModel: () => { rows: T[] }; getState: () => unknown };

// Mode 1: primitive props (string/number/boolean) — primitives are immutable in JS, readonly is superfluous.
interface TemplateDocumentCancelProps {
  documentName: string;
  inviterName: string;
  isBranded: boolean;
  reminderCount: number;
}
export function TemplateDocumentCancel(props: TemplateDocumentCancelProps): JSX.Element {
  return <div>{props.documentName} cancelled by {props.inviterName} ({props.reminderCount})</div>;
}

// Mode 2: array and object props — components conventionally do not mutate received reference-typed props.
interface ColumnDef { id: string; header: string }
interface EnvelopeRow { id: string; title: string }
interface MultiSignDocumentListProps {
  envelopes: EnvelopeRow[];
  columns: ColumnDef[];
  metadata: { total: number; cursor: string | null };
}
export function MultiSignDocumentList(props: MultiSignDocumentListProps): JSX.Element {
  return <ul>{props.envelopes.map((e) => <li key={e.id}>{e.title}</li>)}</ul>;
}

// Mode 3: children: React.ReactNode — canonical React children pattern.
interface TeamProviderProps {
  children: ReactNode;
  initialTeamId: string;
}
export function TeamProvider(props: TeamProviderProps): JSX.Element {
  return <div data-team={props.initialTeamId}>{props.children}</div>;
}

// Mode 4: props typed with third-party library types (react-hook-form Control, TanStack Table instance).
interface DocumentFormValues { title: string; recipients: string[] }
interface ConfigureDocumentAdvancedSettingsProps {
  control: Control<DocumentFormValues>;
  documentFlow: { step: number; goNext: () => void };
}
export function ConfigureDocumentAdvancedSettings(props: ConfigureDocumentAdvancedSettingsProps): JSX.Element {
  props.control.register('title');
  return <form><input name="title" /></form>;
}

interface DataTablePaginationProps {
  table: Table<EnvelopeRow>;
  pageSizeOptions: number[];
}
export function DataTablePagination(props: DataTablePaginationProps): JSX.Element {
  const rows = props.table.getRowModel().rows;
  return <div>{rows.length} rows · sizes: {props.pageSizeOptions.join(',')}</div>;
}

// Mode 5: non-React interface misidentified as props — server-side async function parameter, not a component.
interface SendConfirmationEmailProps {
  userId: string;
  email: string;
  locale: string;
}
declare const mailer: { send: (to: string, body: string) => Promise<void> };
export async function sendConfirmationEmail(params: SendConfirmationEmailProps): Promise<void> {
  await mailer.send(params.email, `confirm ${params.userId} (${params.locale})`);
}



declare const useStateHook: <S>(initial: S) => [S, (next: S) => void];
declare const useCallbackHook: <T extends (...args: never[]) => unknown>(cb: T, deps: readonly unknown[]) => T;

interface DropdownFieldMeta { readOnly?: boolean; required?: boolean; }
interface OnAdvancedSettings { (meta: DropdownFieldMeta): void; }

export function DropdownFieldAdvancedSettings(props: {
  fieldState: DropdownFieldMeta;
  handleOnAdvancedSettingsChange: OnAdvancedSettings;
}): JSX.Element {
  const { fieldState, handleOnAdvancedSettingsChange } = props;

  const [readOnly, setReadOnly] = useStateHook<boolean>(fieldState.readOnly ?? false);
  const [required, setRequired] = useStateHook<boolean>(fieldState.required ?? false);

  const handleToggleChange = (key: 'readOnly' | 'required') => {
    // Local recomputation that intentionally shadows the state variable names.
    const readOnly = key === 'readOnly' ? !fieldState.readOnly : fieldState.readOnly ?? false;
    const required = key === 'required' ? !fieldState.required : fieldState.required ?? false;

    if (key === 'readOnly' && required) {
      setRequired(false);
      setReadOnly(readOnly);
      handleOnAdvancedSettingsChange({ readOnly, required: false });
      return;
    }

    setReadOnly(readOnly);
    setRequired(required);
    handleOnAdvancedSettingsChange({ readOnly, required });
  };

  return (
    <div>
      <button onClick={() => handleToggleChange('readOnly')}>Read only</button>
      <button onClick={() => handleToggleChange('required')}>Required</button>
    </div>
  );
}

interface CheckboxFieldMeta { required?: boolean; validationLength?: number; }

export function CheckboxFieldAdvancedSettings(props: {
  fieldState: CheckboxFieldMeta;
  handleOnAdvancedSettingsChange: (m: CheckboxFieldMeta) => void;
}): JSX.Element {
  const { fieldState, handleOnAdvancedSettingsChange } = props;

  const [required, setRequired] = useStateHook<boolean>(fieldState.required ?? false);
  const [validationLength, setValidationLength] = useStateHook<number>(fieldState.validationLength ?? 0);

  const handleToggleChange = (key: 'required' | 'validationLength', value: number) => {
    // Locally recomputed from the incoming key/value, sharing the state names.
    const required = key === 'required' ? value > 0 : fieldState.required ?? false;
    const validationLength = key === 'validationLength' ? value : fieldState.validationLength ?? 0;

    setRequired(required);
    setValidationLength(validationLength);
    handleOnAdvancedSettingsChange({ required, validationLength });
  };

  return <div onClick={() => handleToggleChange('required', 1)}>checkbox</div>;
}

interface PdfDocumentProxy { numPages: number; getPage(n: number): Promise<{ pageNumber: number }>; }
declare const loadPdfDocument: (url: string) => Promise<PdfDocumentProxy>;

export function PdfViewer(props: { documentUrl: string }): JSX.Element {
  const [pages, setPages] = useStateHook<Array<{ pageNumber: number }>>([]);
  const [isLoading, setIsLoading] = useStateHook<boolean>(true);

  const onLoad = useCallbackHook(async () => {
    setIsLoading(true);
    const doc = await loadPdfDocument(props.documentUrl);
    // `pages` is a freshly computed local awaiting an async fetch — not the existing state.
    const pages: Array<{ pageNumber: number }> = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      pages.push({ pageNumber: page.pageNumber });
    }
    setPages(pages);
    setIsLoading(false);
  }, [props.documentUrl]);

  return (
    <div>
      <button onClick={() => void onLoad()}>load</button>
      <span>{isLoading ? 'loading' : pages.length}</span>
    </div>
  );
}

type BillingPeriod = 'MONTHLY' | 'YEARLY';

export function OrganisationCreateDialog(): JSX.Element {
  const [billingPeriod, setBillingPeriod] = useStateHook<BillingPeriod>('MONTHLY');
  const [step, setStep] = useStateHook<'plan' | 'confirm'>('plan');

  // Parameter `billingPeriod` shadows the state variable name; it is the picked value.
  const onSelectBillingPeriod = (billingPeriod: BillingPeriod) => {
    setBillingPeriod(billingPeriod);
    setStep('confirm');
  };

  return (
    <div>
      <button onClick={() => onSelectBillingPeriod('MONTHLY')}>Monthly</button>
      <button onClick={() => onSelectBillingPeriod('YEARLY')}>Yearly</button>
      <span>{billingPeriod} / {step}</span>
    </div>
  );
}

interface DirectTemplateForm { email: string; name?: string; }

export function DirectTemplatePage(props: {
  onConfigureDirectTemplateSubmit: (data: DirectTemplateForm) => Promise<void>;
}): JSX.Element {
  const [email, setEmail] = useStateHook<string>('');
  const [submitting, setSubmitting] = useStateHook<boolean>(false);

  const handleSubmit = async ({ email, name }: DirectTemplateForm) => {
    setSubmitting(true);
    // Parameter `email` shadows the state name; it is the incoming form value.
    setEmail(email);
    await props.onConfigureDirectTemplateSubmit({ email, name });
    setSubmitting(false);
  };

  return (
    <form onSubmit={() => void handleSubmit({ email: 'a@b.com', name: 'n' })}>
      <input value={email} readOnly />
      <button disabled={submitting}>submit</button>
    </form>
  );
}

export function DocumentSigningRadioField(props: { options: Array<{ id: string; label: string }> }): JSX.Element {
  const [selectedOption, setSelectedOption] = useStateHook<string | null>(null);

  // Parameter `selectedOption` is the radio item the user clicked, not existing state.
  const handleSelectItem = (selectedOption: string) => {
    setSelectedOption(selectedOption);
  };

  return (
    <div>
      {props.options.map((option) => (
        <button key={option.id} onClick={() => handleSelectItem(option.id)}>
          {option.label}
        </button>
      ))}
      <span>{selectedOption ?? 'none'}</span>
    </div>
  );
}



// ---------------------------------------------------------------------------
// Mode: react-tsx-component
// Large React TSX component whose body length is inflated by JSX markup,
// hooks, and framework boilerplate rather than excess logic.
// ---------------------------------------------------------------------------
declare const useState: <S>(s: S) => [S, (v: S) => void];
declare const useEffect: (fn: () => void, deps?: readonly unknown[]) => void;
declare const useCallback: <T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]) => T;
declare const useMemo: <T>(fn: () => T, deps: readonly unknown[]) => T;

export function LargeDashboardPage(props: { userId: string; teamName: string }): JSX.Element {
  const [count, setCount] = useState<number>(0);
  const [open, setOpen] = useState<boolean>(false);
  const [filter, setFilter] = useState<string>('all');
  const [items, setItems] = useState<readonly string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    setLoading(true);
  }, [props.userId]);

  const handleToggle = useCallback(() => {
    setOpen(!open);
  }, [open]);

  const handleSelect = useCallback((id: string) => {
    setSelected(id);
  }, []);

  const visibleItems = useMemo(() => {
    return items.filter((x) => x.length > 0);
  }, [items]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard for {props.teamName}</h1>
        <button type="button" onClick={handleToggle} className="rounded px-3 py-1">
          {open ? 'Close' : 'Open'}
        </button>
      </header>
      <section className="grid grid-cols-3 gap-4">
        <div className="rounded border p-4">
          <h2 className="text-lg">Count</h2>
          <p className="text-3xl">{count}</p>
          <button type="button" onClick={() => setCount(count + 1)}>Inc</button>
        </div>
        <div className="rounded border p-4">
          <h2 className="text-lg">Filter</h2>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div className="rounded border p-4">
          <h2 className="text-lg">Status</h2>
          <p>{loading ? 'Loading...' : 'Ready'}</p>
        </div>
      </section>
      <ul className="divide-y">
        {visibleItems.map((id) => (
          <li key={id} className="flex items-center justify-between py-2">
            <span>{id}</span>
            <button type="button" onClick={() => handleSelect(id)}>Select</button>
          </li>
        ))}
      </ul>
      {open && (
        <aside className="rounded border p-4">
          <p>Selected: {selected ?? 'none'}</p>
        </aside>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode: thin-server-adapter-boilerplate
// Thin server adapter whose body length is inflated by type aliases and Zod
// schema validation rather than real logic. Uses declare const stand-ins for
// the upstream imports.
// ---------------------------------------------------------------------------
declare const z: {
  object: (shape: Record<string, unknown>) => { parse: (input: unknown) => unknown; safeParse: (input: unknown) => { success: boolean; data?: unknown } };
  string: () => { uuid: () => unknown; min: (n: number) => unknown; email: () => unknown };
  number: () => { int: () => unknown; positive: () => unknown };
  boolean: () => unknown;
  enum: (values: readonly string[]) => unknown;
};
declare const portalService: {
  invite: (input: { organisationId: string; email: string; role: string }) => Promise<{ id: string }>;
  revoke: (input: { organisationId: string; memberId: string }) => Promise<void>;
  rotate: (input: { organisationId: string }) => Promise<{ token: string }>;
  transfer: (input: { organisationId: string; toUserId: string }) => Promise<{ ok: boolean }>;
};
declare const logger: { info: (msg: string, ctx?: Record<string, unknown>) => void };

type OrganisationPortalAction =
  | { kind: 'invite'; organisationId: string; email: string; role: 'owner' | 'admin' | 'member' }
  | { kind: 'revoke'; organisationId: string; memberId: string }
  | { kind: 'rotate'; organisationId: string }
  | { kind: 'transfer'; organisationId: string; toUserId: string };

const inviteSchema = z.object({
  organisationId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'member']),
});

const revokeSchema = z.object({
  organisationId: z.string().uuid(),
  memberId: z.string().uuid(),
});

const rotateSchema = z.object({
  organisationId: z.string().uuid(),
});

const transferSchema = z.object({
  organisationId: z.string().uuid(),
  toUserId: z.string().uuid(),
});

export async function handleOrganisationPortalAction(
  action: OrganisationPortalAction,
): Promise<{ ok: true; data: unknown } | { ok: false; reason: string }> {
  if (action.kind === 'invite') {
    const parsed = inviteSchema.parse({
      organisationId: action.organisationId,
      email: action.email,
      role: action.role,
    }) as { organisationId: string; email: string; role: string };
    logger.info('portal.invite.start', { organisationId: parsed.organisationId });
    const result = await portalService.invite({
      organisationId: parsed.organisationId,
      email: parsed.email,
      role: parsed.role,
    });
    logger.info('portal.invite.done', { id: result.id });
    return { ok: true, data: result };
  }
  if (action.kind === 'revoke') {
    const parsed = revokeSchema.parse({
      organisationId: action.organisationId,
      memberId: action.memberId,
    }) as { organisationId: string; memberId: string };
    logger.info('portal.revoke.start', { organisationId: parsed.organisationId });
    await portalService.revoke({
      organisationId: parsed.organisationId,
      memberId: parsed.memberId,
    });
    logger.info('portal.revoke.done', { memberId: parsed.memberId });
    return { ok: true, data: { revoked: parsed.memberId } };
  }
  if (action.kind === 'rotate') {
    const parsed = rotateSchema.parse({
      organisationId: action.organisationId,
    }) as { organisationId: string };
    logger.info('portal.rotate.start', { organisationId: parsed.organisationId });
    const result = await portalService.rotate({
      organisationId: parsed.organisationId,
    });
    logger.info('portal.rotate.done', { organisationId: parsed.organisationId });
    return { ok: true, data: result };
  }
  if (action.kind === 'transfer') {
    const parsed = transferSchema.parse({
      organisationId: action.organisationId,
      toUserId: action.toUserId,
    }) as { organisationId: string; toUserId: string };
    logger.info('portal.transfer.start', { organisationId: parsed.organisationId });
    const result = await portalService.transfer({
      organisationId: parsed.organisationId,
      toUserId: parsed.toUserId,
    });
    logger.info('portal.transfer.done', { ok: result.ok });
    return { ok: true, data: result };
  }
  return { ok: false, reason: 'unknown_action' };
}

// ---------------------------------------------------------------------------
// Mode: react-custom-hook-boilerplate
// Custom hook (useX naming) whose body length is inflated by return-shape
// boilerplate and effect/state wiring rather than excess logic.
// ---------------------------------------------------------------------------
declare const analyticsClient: {
  identify: (userId: string, traits: Record<string, unknown>) => void;
  track: (event: string, props: Record<string, unknown>) => void;
  page: (name: string, props: Record<string, unknown>) => void;
  reset: () => void;
};

type AnalyticsHookOptions = {
  userId: string | null;
  teamId: string | null;
  locale: string;
  enabled: boolean;
};

type AnalyticsHookResult = {
  track: (event: string, props?: Record<string, unknown>) => void;
  page: (name: string, props?: Record<string, unknown>) => void;
  identify: (traits: Record<string, unknown>) => void;
  reset: () => void;
  ready: boolean;
};

export function useAnalyticsDashboard(options: AnalyticsHookOptions): AnalyticsHookResult {
  const [ready, setReady] = useState<boolean>(false);
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  useEffect(() => {
    if (!options.enabled) {
      setReady(false);
      return;
    }
    if (options.userId !== null) {
      analyticsClient.identify(options.userId, {
        teamId: options.teamId,
        locale: options.locale,
      });
    }
    setReady(true);
  }, [options.enabled, options.userId, options.teamId, options.locale]);

  const track = useCallback((event: string, props?: Record<string, unknown>) => {
    if (!options.enabled) return;
    analyticsClient.track(event, {
      ...(props ?? {}),
      userId: options.userId,
      teamId: options.teamId,
    });
    setLastEvent(event);
  }, [options.enabled, options.userId, options.teamId]);

  const page = useCallback((name: string, props?: Record<string, unknown>) => {
    if (!options.enabled) return;
    analyticsClient.page(name, {
      ...(props ?? {}),
      userId: options.userId,
      teamId: options.teamId,
    });
  }, [options.enabled, options.userId, options.teamId]);

  const identify = useCallback((traits: Record<string, unknown>) => {
    if (!options.enabled || options.userId === null) return;
    analyticsClient.identify(options.userId, traits);
  }, [options.enabled, options.userId]);

  const reset = useCallback(() => {
    analyticsClient.reset();
    setReady(false);
    setLastEvent(null);
  }, []);

  const memoised = useMemo<AnalyticsHookResult>(() => ({
    track,
    page,
    identify,
    reset,
    ready,
  }), [track, page, identify, reset, ready]);

  return memoised;
}



// shape-5fba867731dc: React function-declaration component with destructured props
// whose body uses `typeof window !== 'undefined'` inside a useMemo callback and
// returns parenthesized JSX. The component has no explicit return annotation,
// so the visitor's `returnTypeIsBoolish` defaults to true, the nested
// `typeof` is picked up by `containsTypeNarrowingCheck`, and the parenthesized
// JSX return satisfies `hasBooleanReturn` — yet this is plainly a React
// component, not a type-guard candidate.
declare const useMemo: <T>(factory: () => T, deps: readonly unknown[]) => T;
declare const window: { location: { origin: string } } | undefined;

interface ViewOptionsProps {
  readonly markdownUrl: string;
  readonly githubUrl: string;
}

export function ViewOptions({ markdownUrl, githubUrl }: ViewOptionsProps) {
  const items = useMemo(() => {
    const fullMarkdownUrl =
      typeof window !== 'undefined'
        ? new URL(markdownUrl, window.location.origin).toString()
        : 'loading';
    return [{ href: githubUrl, label: fullMarkdownUrl }];
  }, [markdownUrl, githubUrl]);

  return (
    <div>
      {items.map((item) => (
        <a key={item.href} href={item.href}>
          {item.label}
        </a>
      ))}
    </div>
  );
}

// shape-51628654def7: React arrow-function component with destructured props
// whose body contains a `typeof` check on an optional prop before returning
// parenthesized JSX. No explicit return annotation, single return statement,
// one statement body — again matches every clause of the type-guard heuristic
// despite being an ordinary presentational component.
interface EnvelopeItemSelectorProps {
  readonly number: number;
  readonly primaryText: string;
  readonly secondaryText?: string;
}

export const EnvelopeItemSelector = ({
  number,
  primaryText,
  secondaryText,
}: EnvelopeItemSelectorProps) => {
  const subtitle = typeof secondaryText === 'string' ? secondaryText : '';
  return (
    <div>
      <span>{number}</span>
      <strong>{primaryText}</strong>
      <em>{subtitle}</em>
    </div>
  );
};

// shape-d18ba94fb8ab: React arrow-function component with a richer destructured
// props signature (icon component + children) and an inline `typeof value`
// narrowing inside the JSX expression slot. Body is a single parenthesized JSX
// return, no boolean annotation — still a component, still mis-flagged.
type IconComponent = (props: { readonly className?: string }) => JSX.Element;

interface CardMetricProps {
  readonly icon: IconComponent;
  readonly title: string;
  readonly value: string | number;
  readonly className?: string;
  readonly children?: JSX.Element;
}

export const CardMetric = ({
  icon: Icon,
  title,
  value,
  className,
  children,
}: CardMetricProps) => {
  return (
    <div className={className}>
      <Icon className="metric-icon" />
      <h3>{title}</h3>
      <span>{typeof value === 'number' ? value.toFixed(2) : value}</span>
      {children}
    </div>
  );
};



/**
 * React Hook Form clear-the-field patterns where `undefined` is the
 * intentional payload, not an accidentally-omitted optional argument.
 *
 * In these call sites, `undefined` is the VALUE being written, not a
 * skipped trailing parameter:
 *   - form.setValue(name, value) — value is required; passing `undefined`
 *     resets the controlled field to empty.
 *   - field.onChange(value) — value is required; passing `undefined`
 *     clears the controlled input.
 *
 * Shape-c77b8f936858: setValue('customDocumentData', undefined) resets
 * the field when a 'use custom document' checkbox is unchecked.
 *
 * Shape-75bb2c499862: field.onChange(undefined) inside a destructive
 * 'clear' button handler — explicitly signaling the field is now empty.
 *
 * Shape-7e57752b82e4: field.onChange(undefined) when a file input fires
 * with no file selected — the controlled value is cleared on purpose.
 */

declare const form: {
  setValue: (name: string, value: unknown, options?: { shouldDirty?: boolean }) => void;
  watch: (name: string) => unknown;
};

declare const customDocumentField: {
  onChange: (value: unknown) => void;
  value: unknown;
};

interface FileChangeEvent {
  target: { files: FileList | null };
}

export function UseCustomDocumentToggle(): JSX.Element {
  // Shape-c77b8f936858: clearing an RHF field when its enabling checkbox flips off.
  // The `undefined` here is the new field VALUE, not a missing trailing arg.
  const handleToggle = (checked: boolean): void => {
    if (!checked) {
      form.setValue('customDocumentData', undefined, { shouldDirty: true });
    }
  };
  return <input type="checkbox" onChange={(e) => handleToggle(e.target.checked)} />;
}

export function ClearCustomDocumentButton(): JSX.Element {
  // Shape-75bb2c499862: destructive 'clear' button resets an RHF-controlled
  // field. `undefined` is the explicit cleared-state payload.
  const handleClear = (): void => {
    customDocumentField.onChange(undefined);
  };
  return (
    <button type="button" onClick={handleClear}>
      Clear document
    </button>
  );
}

export function CustomDocumentFileInput(): JSX.Element {
  // Shape-7e57752b82e4: file input handler. When the user cancels the file
  // picker, `event.target.files` is empty and we explicitly clear the
  // controlled value by calling onChange with `undefined`.
  const handleFileChange = (event: FileChangeEvent): void => {
    const file = event.target.files?.[0];
    if (!file) {
      customDocumentField.onChange(undefined);
      return;
    }
    customDocumentField.onChange(file);
  };
  return <input type="file" onChange={handleFileChange} />;
}



/**
 * Async-cancellation guards inside useEffect.
 *
 * `isCancelled` is the classic React effect cancellation pattern: declare
 * a mutable flag, flip it in the cleanup callback, and short-circuit
 * any in-flight async work that resolves after unmount or re-render.
 *
 * TypeScript narrows `let isCancelled = false` to the literal type `false`
 * because mutation happens through a closure (the returned cleanup
 * function), which the control-flow analysis does not track across the
 * async boundary. The condition is genuinely runtime-variable, so the
 * rule must NOT flag it.
 */

declare const useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => void;
declare const useState: <T>(initial: T) => [T, (next: T) => void];
declare const pdfjsLib: {
  getDocument: (src: { readonly url: string }) => { readonly promise: Promise<PdfDocumentProxy> };
};
declare const pMap: <T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  opts?: { readonly concurrency: number },
) => Promise<readonly R[]>;

interface PdfDocumentProxy {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfPageProxy>;
  destroy(): Promise<void>;
}

interface PdfPageProxy {
  getViewport(opts: { readonly scale: number }): { readonly width: number; readonly height: number };
}

interface PdfViewerProps {
  readonly documentUrl: string;
  readonly scale: number;
}

/**
 * Mode shape-4fad3d272d4d — guard at the top of an async IIFE inside
 * useEffect, immediately after `isCancelled` is declared and before any
 * await. The cleanup function returned from the effect flips the flag.
 */
export function PdfViewerInitGuard(props: PdfViewerProps): JSX.Element {
  const [pageCount, setPageCount] = useState<number>(0);

  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      if (isCancelled) {
        return;
      }

      const loadedPdf = await pdfjsLib.getDocument({ url: props.documentUrl }).promise;
      setPageCount(loadedPdf.numPages);
    })();

    return () => {
      isCancelled = true;
    };
  }, [props.documentUrl]);

  return <div>{pageCount} pages</div>;
}

/**
 * Mode shape-90527d725658 — guard placed AFTER an awaited call. The
 * cleanup function could have flipped `isCancelled` during the awaited
 * `pdfjsLib.getDocument` resolution, so the post-await check destroys
 * the resource and bails out.
 */
export function PdfViewerPostLoadGuard(props: PdfViewerProps): JSX.Element {
  const [ready, setReady] = useState<boolean>(false);

  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      const loadedPdf = await pdfjsLib.getDocument({ url: props.documentUrl }).promise;

      if (isCancelled) {
        await loadedPdf.destroy();
        return;
      }

      setReady(true);
    })();

    return () => {
      isCancelled = true;
    };
  }, [props.documentUrl]);

  return <div>{ready ? 'ready' : 'loading'}</div>;
}

/**
 * Mode shape-a91c8bf76f6a — guard placed after a parallel `await pMap`
 * over page indices. The pMap traversal is inherently async, giving the
 * cleanup function many opportunities to fire before the check runs.
 */
export function PdfViewerPostMapGuard(props: PdfViewerProps): JSX.Element {
  const [widths, setWidths] = useState<readonly number[]>([]);

  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      const loadedPdf = await pdfjsLib.getDocument({ url: props.documentUrl }).promise;
      const pageNumbers = Array.from({ length: loadedPdf.numPages }, (_, i) => i + 1);

      const viewports = await pMap(
        pageNumbers,
        async (n) => {
          const page = await loadedPdf.getPage(n);
          return page.getViewport({ scale: props.scale }).width;
        },
        { concurrency: 4 },
      );

      if (isCancelled) {
        await loadedPdf.destroy();
        return;
      }

      setWidths(viewports);
    })();

    return () => {
      isCancelled = true;
    };
  }, [props.documentUrl, props.scale]);

  return <div>{widths.length} viewports</div>;
}



// shape-01c8c5ada6c7: \d inside JSX string prop interpreted as HTML regex pattern
declare const PinInput: (props: { pattern: string; inputMode: string; maxLength: number }) => JSX.Element;
export function TwoFactorPinForm(): JSX.Element {
  return <PinInput pattern="^\d+$" inputMode="numeric" maxLength={6} />;
}
export function ZipCodeField(): JSX.Element {
  return <input type="text" pattern="^\d{5}(-\d{4})?$" name="zip" />;
}
export function HexColorField(): JSX.Element {
  return <input type="text" pattern="^#[0-9A-Fa-f]{6}$" name="color" />;
}



// MODE: react-hook-form-render-prop
// FormField/Controller render prop is a mandatory render-prop API that injects
// fresh field bindings on every render; inline function is the documented contract.
declare const FormField: any;
declare const Controller: any;
declare const FormItem: any;
declare const FormLabel: any;
declare const FormControl: any;
declare const FormMessage: any;
declare const Input: any;
declare const form: any;

export function AddSettingsForm(): JSX.Element {
  return (
    <div>
      <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Title</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <Controller
        control={form.control}
        name="email"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl>
              <Input {...field} aria-invalid={fieldState.invalid} />
            </FormControl>
          </FormItem>
        )}
      />
    </div>
  );
}



// --- FP fixtures for missing-react-memo ---

declare const useMemo: <T>(factory: () => T, deps: readonly unknown[]) => T;

// Mode: doc-site static leaf — exported PascalCase component that takes URL
// props, uses only useMemo to derive a stable items array, and renders a
// small Popover-like list of anchor links. Mirrors documenso's
// apps/docs/src/components/ai/page-actions.tsx ViewOptions: a static
// documentation page action whose parent (a docs page) does not re-render
// frequently, so wrapping the component itself in React.memo provides no
// practical benefit. Static leaf in a cold render path.
interface ViewOptionsItem {
  readonly href: string;
  readonly label: string;
  readonly description: string;
}

export function ViewOptions({
  markdownUrl,
  githubUrl,
}: {
  markdownUrl: string;
  githubUrl: string;
}): JSX.Element {
  const items: readonly ViewOptionsItem[] = useMemo<readonly ViewOptionsItem[]>(
    () => [
      {
        href: markdownUrl,
        label: 'View as Markdown',
        description: 'Open the raw markdown source for this page.',
      },
      {
        href: githubUrl,
        label: 'Edit on GitHub',
        description: 'Suggest a change to this documentation page.',
      },
    ],
    [markdownUrl, githubUrl],
  );

  return (
    <div className="popover">
      <button type="button" aria-label="View options">
        Options
      </button>
      <ul className="popover-content">
        {items.map((item) => (
          <li key={item.href}>
            <a href={item.href} title={item.description}>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}



// MODE: shape-4c1e4255630f — shadcn FormItem-style provider wrapping a single <div> slot that
// spreads {...props} to receive arbitrary descendants. The descendants call useContext at depth,
// so the wrap is necessary, but the static rule sees a single lowercase child and fires.
declare const FormItemContextSlot: { Provider: any };
declare const formItemId: string;

export function FormItemSlot(props: { className?: string }): JSX.Element {
  const id = formItemId;
  return (
    <FormItemContextSlot.Provider value={{ id }}>
      <div className="space-y-2" {...props} />
    </FormItemContextSlot.Provider>
  );
}

// MODE: shape-ebbc7567db08 — Stepper-style provider that wraps a single dynamically-selected
// child expression (currentChild). The wrapped subtree contains useStep() consumers, but the
// rule cannot see through the expression and fires.
declare const StepContextScope: { Provider: any };
declare const currentChild: JSX.Element;
declare const currentStep: number;
declare const isCompleting: boolean;
declare const nextStep: () => void;
declare const previousStep: () => void;

export function StepperShell(): JSX.Element {
  return (
    <StepContextScope.Provider value={{ currentStep, isCompleting, nextStep, previousStep }}>
      {currentChild}
    </StepContextScope.Provider>
  );
}



// shape-574fa30c11a3: dangerouslySetInnerHTML with non-user-controlled data
// (hardcoded CSS animation-reset string + JSON.stringify of operator-set public env)
declare const publicEnv: Record<string, string>;
export function DocumentRoot(): JSX.Element {
  const disableAnimations = true;
  return (
    <html>
      <head>
        {disableAnimations && (
          <style
            dangerouslySetInnerHTML={{
              __html: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
            }}
          />
        )}
      </head>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__ENV__ = ${JSON.stringify(publicEnv)}`,
          }}
        />
      </body>
    </html>
  );
}

// shape-cc16ebe692f5: dangerouslySetInnerHTML with library-rendered SVG output
// (mermaid.render() return value, not user-controlled HTML)
declare const mermaidRenderedSvg: string;
export function MermaidDiagram(): JSX.Element | null {
  const svg: string | null = mermaidRenderedSvg;
  if (!svg) {
    return null;
  }
  return <div dangerouslySetInnerHTML={{ __html: svg }} />;
}

// shape-85fe4228c2dd: dangerouslySetInnerHTML with QR-library-generated SVG
// (renderSVG from a QR library, given a server-generated TOTP URI)
declare function renderSVG(uri: string): string;
declare const setup2FAData: { uri?: string } | undefined;
export function EnableAuthenticatorAppDialog(): JSX.Element {
  return (
    <div
      className="flex h-36 justify-center"
      dangerouslySetInnerHTML={{
        __html: renderSVG(setup2FAData?.uri ?? ''),
      }}
    />
  );
}



// Mode: shape-0dabeabd7de6 — locally-defined async arrow function named `exec`
// declared inside a useEffect hook in a React UI component. The bare `exec()`
// invocation references this local function, not Node.js child_process.exec.
// The rule must not flag this as OS command injection.
declare const useEffect: (cb: () => void, deps: readonly unknown[]) => void;
declare function doSearchSync(query: string): readonly string[];
declare function doSearch(query: string): Promise<readonly string[]>;

export function MultiSelectFP(props: { query: string; sync: boolean }): JSX.Element {
  useEffect(() => {
    const exec = async (): Promise<void> => {
      if (props.sync) {
        const results = doSearchSync(props.query);
        void results;
        return;
      }
      const results = await doSearch(props.query);
      void results;
    };
    void exec();
  }, [props.query, props.sync]);

  useEffect(() => {
    const exec = async (): Promise<void> => {
      const results = await doSearch(props.query);
      void results;
    };
    void exec();
  }, [props.query]);

  return <div />;
}


// --- timing-attack-comparison FP patterns ---

// enum-field-type-dispatch: FieldType enum dispatch for UI/routing.
// The enum literal name happens to contain 'SIGNATURE'/'FREE_SIGNATURE', but the
// compared value is a field-kind discriminator, not a secret.
declare const FieldType: {
  readonly SIGNATURE: 'SIGNATURE';
  readonly FREE_SIGNATURE: 'FREE_SIGNATURE';
  readonly TEXT: 'TEXT';
  readonly DATE: 'DATE';
};
declare const currentField: { type: 'SIGNATURE' | 'FREE_SIGNATURE' | 'TEXT' | 'DATE' };
export function classifyField(): string {
  if (currentField.type === FieldType.SIGNATURE) return 'sig';
  if (currentField.type === FieldType.FREE_SIGNATURE) return 'free-sig';
  return 'other';
}

// boolean-config-flag-or-length-check: comparing a boolean feature-flag whose
// identifier contains 'signature' / 'password' to `false` for org settings
// derivation. The operand is a `boolean`, not a credential.
declare const derivedDrawSignatureEnabled: boolean;
declare const passwordResetEnabled: boolean;
declare const allowedHosts: ReadonlyArray<string>;
export function organisationSignatureMode(): string {
  if (derivedDrawSignatureEnabled === false && passwordResetEnabled === false) {
    return 'locked';
  }
  if (allowedHosts.length === 0) {
    return 'no-hosts';
  }
  return 'open';
}

// typeof-type-guard-presence-check: `typeof x !== 'string'` validates that an
// inbound CSRF token / signed payload is a non-empty string before further use.
// This is a type/presence assertion, not a value comparison of the secret.
declare const inboundCsrfToken: unknown;
declare const inboundSignature: unknown;
export function assertStringInputs(): string {
  if (typeof inboundCsrfToken !== 'string') return 'invalid-token-type';
  if (typeof inboundSignature !== 'string') return 'invalid-signature-type';
  return 'ok';
}

// token-lookup-data-wiring: Array.find / findIndex over a recipient list whose
// auth was established earlier; the `token` equality is a structural lookup
// to wire the matching recipient row, not an auth gate.
declare const authenticatedToken: string;
declare const recipients: ReadonlyArray<{ id: number; token: string; name: string }>;
export function locateRecipient(): { id: number; index: number; name: string } | null {
  const recipient = recipients.find((r) => r.token === authenticatedToken);
  const recipientIndex = recipients.findIndex((r) => r.token === authenticatedToken);
  if (recipient == null) return null;
  return { id: recipient.id, index: recipientIndex, name: recipient.name };
}

// client-side-form-validation: Zod-style `.refine` callback inside a `.tsx`
// client component that asserts two password fields match. Runs in the
// browser as form-validation feedback; no server-side timing oracle.
type RefineCtx = { addIssue: (issue: { path: string[]; message: string }) => void };
declare const zSchema: {
  object<S extends Record<string, unknown>>(shape: S): {
    refine(
      check: (data: { password: string; repeatedPassword: string; clientSecret: string }) => boolean,
      msg: { path: string[]; message: string },
    ): { parse(input: unknown): unknown };
  };
  string(): { min(n: number): unknown };
};
export const ZResetPasswordFormSchema = zSchema
  .object({
    password: zSchema.string().min(8),
    repeatedPassword: zSchema.string().min(8),
    clientSecret: zSchema.string().min(0),
  })
  .refine(
    (data) => data.password === data.repeatedPassword && data.clientSecret.trim() !== '',
    { path: ['repeatedPassword'], message: 'Passwords must match' },
  );
export function passwordsMatch(
  data: { password: string; repeatedPassword: string },
  _ctx: RefineCtx,
): boolean {
  return data.password === data.repeatedPassword;
}



// ---------------------------------------------------------------------------
// Mode: shape-6ae78796be87
// Inside a submit handler, an async API call returns a result that is
// destructured into a fresh local binding (`envelopeId`). The component
// scope has no `envelopeId` declaration, so this is a first-and-only
// binding inside the callback, not a shadow of an outer name.
// ---------------------------------------------------------------------------
declare const useTemplateUseDialogForm: () => { handleSubmit: <T>(fn: (values: T) => Promise<void>) => (e?: unknown) => Promise<void> };
declare const createDocumentFromTemplate: (input: { templateId: string; recipients: readonly { email: string }[] }) => Promise<{ envelopeId: string; documentId: string }>;
declare const navigateTo: (path: string) => void;

type TemplateUseDialogFormValues = {
  templateId: string;
  recipients: readonly { email: string }[];
};

export function TemplateUseDialog(props: { onClose: () => void }): JSX.Element {
  const form = useTemplateUseDialogForm();

  const onSubmit = form.handleSubmit(async (values: TemplateUseDialogFormValues) => {
    const { envelopeId } = await createDocumentFromTemplate({
      templateId: values.templateId,
      recipients: values.recipients,
    });
    navigateTo(`/envelopes/${envelopeId}`);
    props.onClose();
  });

  return (
    <form onSubmit={onSubmit as unknown as (e: unknown) => void}>
      <button type="submit">Use template</button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Mode: shape-e84a0ed74690
// A mouseup handler computes a fresh local `pendingFieldCreation` object
// from event coordinates. The enclosing component/page-renderer scope has
// no `pendingFieldCreation` declaration, so this is a first-and-only
// binding inside the handler, not a shadow.
// ---------------------------------------------------------------------------
declare const useState: <S>(s: S) => [S, (v: S) => void];
declare const screenToPdfCoordinates: (page: number, x: number, y: number) => { x: number; y: number };

type FieldCreation = {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function EnvelopeEditorFieldsPageRenderer(props: { pageNumber: number }): JSX.Element {
  const [activeField, setActiveField] = useState<FieldCreation | null>(null);

  const handleMouseUp = (event: { clientX: number; clientY: number }): void => {
    const pendingFieldCreation: FieldCreation = {
      pageNumber: props.pageNumber,
      x: screenToPdfCoordinates(props.pageNumber, event.clientX, event.clientY).x,
      y: screenToPdfCoordinates(props.pageNumber, event.clientX, event.clientY).y,
      width: 120,
      height: 32,
    };
    setActiveField(pendingFieldCreation);
  };

  return (
    <div onMouseUp={handleMouseUp as unknown as () => void}>
      <p>Field at: {activeField !== null ? `${activeField.x},${activeField.y}` : 'none'}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode: shape-ea0202aa6b0f
// A function destructures a single field (`groupedRows`) out of its
// `options` parameter. The destructure introduces the binding for the
// first time inside the function body — it is a parameter destructure,
// not a shadow of any enclosing-scope variable.
// ---------------------------------------------------------------------------
declare const renderHeader: (doc: { y: number }) => void;
declare const renderFooter: (doc: { y: number }) => void;

type AuditLogRow = {
  timestamp: string;
  actor: string;
  action: string;
};

type RenderPagesOptions = {
  doc: { y: number };
  groupedRows: readonly (readonly AuditLogRow[])[];
  pageSize: { width: number; height: number };
};

export function renderAuditLogPages(options: RenderPagesOptions): number {
  const { groupedRows } = options;
  let pageCount = 0;
  for (const group of groupedRows) {
    renderHeader(options.doc);
    for (const row of group) {
      options.doc.y += 16;
      if (row.action.length > 0) {
        pageCount += 0;
      }
    }
    renderFooter(options.doc);
    pageCount += 1;
  }
  return pageCount;
}
