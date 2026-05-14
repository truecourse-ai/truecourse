// Shared monorepo UI library — primitive imports via @acme/ui subpath.
// The rule must NOT flag imports from a shared-ui workspace package.
declare const React: { createElement: Function; useState: Function };

declare function AlertBox(props: { children: unknown }): unknown;
declare function AlertText(props: { children: unknown }): unknown;
declare function ButtonPrimitive(props: { onClick?: () => void; disabled?: boolean; children: unknown }): unknown;
declare function ModalRoot(props: { open: boolean; onOpenChange: (v: boolean) => void; children: unknown }): unknown;
declare function ModalContent(props: { children: unknown }): unknown;
declare function ModalHeader(props: { children: unknown }): unknown;
declare function ModalTitle(props: { children: unknown }): unknown;
declare function ModalFooter(props: { children: unknown }): unknown;
declare function FieldLabel(props: { htmlFor?: string; children: unknown }): unknown;
declare function TextInput(props: { id?: string; value?: string; readOnly?: boolean }): unknown;

// Simulates: import { Alert, AlertDescription } from '@acme/ui/primitives/alert';
// Simulates: import { Button } from '@acme/ui/primitives/button';
// Simulates: import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@acme/ui/primitives/dialog';
// Simulates: import { Label } from '@acme/ui/primitives/label';
// These are all subpath imports from a single shared UI library package (@acme/ui),
// which lives under packages/ui/ in the monorepo — not a cross-service import.

type SignDialogState = 'IDLE' | 'SIGNING' | 'DONE' | 'ERROR';

type DocumentSignDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSigned: (signatureId: string) => void;
  documentId: string;
  recipientEmail: string;
};

const SIGNING_STATUS_LABELS: Record<SignDialogState, string> = {
  IDLE: 'Ready to sign',
  SIGNING: 'Applying signature…',
  DONE: 'Document signed',
  ERROR: 'Signature failed',
};

function DocumentSignDialogComponent(props: DocumentSignDialogProps): unknown {
  const { open, onOpenChange, onSigned, documentId, recipientEmail } = props;
  const [state, setState] = (React.useState as Function)('IDLE' as SignDialogState);
  const [errorMessage, setErrorMessage] = (React.useState as Function)('');

  async function handleSign(): Promise<void> {
    setState('SIGNING');
    try {
      const signatureId = `sig-${documentId}-${Date.now()}`;
      onSigned(signatureId);
      setState('DONE');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
      setState('ERROR');
    }
  }

  return ModalRoot({
    open,
    onOpenChange,
    children: ModalContent({
      children: [
        ModalHeader({ children: ModalTitle({ children: 'Sign Document' }) }),
        state === 'ERROR'
          ? AlertBox({ children: AlertText({ children: errorMessage }) })
          : null,
        FieldLabel({ htmlFor: 'recipient', children: 'Recipient' }),
        TextInput({ id: 'recipient', value: recipientEmail, readOnly: true }),
        ModalFooter({
          children: [
            ButtonPrimitive({ onClick: () => onOpenChange(false), children: 'Cancel' }),
            ButtonPrimitive({
              onClick: handleSign,
              disabled: state === 'SIGNING',
              children: SIGNING_STATUS_LABELS[state as SignDialogState],
            }),
          ],
        }),
      ],
    }),
  });
}

export { DocumentSignDialogComponent };



// E01: JSX .map() with typed props — unpinnedFolders.map(folder => <FolderCard .../>); no type mismatch.
declare function React_createElement(tag: unknown, props: unknown, ...children: unknown[]): unknown;

interface FolderItem {
  id: string;
  name: string;
  color: string;
}

declare const FolderCard: (props: { key: string; folder: FolderItem }) => unknown;
declare const unpinnedFolders: FolderItem[];

const folderList = unpinnedFolders.map((folder) => (
  React_createElement(FolderCard, { key: folder.id, folder })
));



// E13: destructured .map() over navigation links returning JSX — no type mismatch.
declare function React_createElement(tag: unknown, props: unknown, ...children: unknown[]): unknown;
declare const NavLink: (props: { key: string; to: string; children: unknown }) => unknown;

interface NavEntry {
  href: string;
  label: string;
}

declare const navEntries: NavEntry[];

const navItems = navEntries.map(({ href, label }) =>
  React_createElement(NavLink, { key: href, to: href }, label)
);



// E18: .map() returning JSX button elements from typed field list — no type mismatch.
declare function React_createElement(tag: unknown, props: unknown, ...children: unknown[]): unknown;

interface EditableField {
  id: string;
  label: string;
  disabled: boolean;
}

declare const editableFields: EditableField[];
declare const areFieldsLocked: boolean;

const fieldButtons = editableFields.map((field) =>
  React_createElement(
    'button',
    { key: field.id, disabled: areFieldsLocked || field.disabled },
    field.label,
  )
);



// E20: .map((value, index) => JSX) from typed array — no type mismatch.
declare function React_createElement(tag: unknown, props: unknown, ...children: unknown[]): unknown;

declare const CheckboxOption: (props: { key: number; value: string; selected: boolean }) => unknown;

declare const checkboxValues: string[];
declare const selectedValues: string[];

const checkboxOptions = checkboxValues.map((value, index) =>
  React_createElement(CheckboxOption, {
    key: index,
    value,
    selected: selectedValues.includes(value),
  })
);



// E21: functional setState update — returning same type from updater; no type mismatch.
interface FieldData {
  id: string;
  value: string;
  required: boolean;
}

declare const setFormFields: (updater: (prev: FieldData[] | null) => FieldData[] | null) => void;
declare const newFieldId: string;

setFormFields((fieldData) => {
  if (!fieldData) return fieldData;
  return fieldData.filter((f) => f.id !== newFieldId);
});



// E25: JSX list rendering with typed props — waitingRecipients.map(recipient => <AvatarWithRecipient .../>); no type mismatch.
declare function React_createElement(tag: unknown, props: unknown): unknown;

interface Recipient {
  id: string;
  name: string;
  email: string;
}

declare const AvatarWithRecipient: (props: { key: string; recipient: Recipient; contractStatus: string }) => unknown;
declare const pendingRecipients: Recipient[];
declare const contractStatus: string;

const pendingAvatars = pendingRecipients.map((recipient) =>
  React_createElement(AvatarWithRecipient, { key: recipient.id, recipient, contractStatus })
);



// E26: useMemo() returning array of column definitions — no type mismatch.
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;

interface ColumnDef {
  id: string;
  header: string;
  accessorKey: string;
  size: number;
}

declare const locale: string;

const memberColumns = useMemo((): ColumnDef[] => {
  return [
    { id: 'name', header: 'Name', accessorKey: 'fullName', size: 200 },
    { id: 'role', header: 'Role', accessorKey: 'roleName', size: 150 },
    { id: 'joinedAt', header: 'Joined', accessorKey: 'createdAt', size: 120 },
  ];
}, [locale]);



// E35: async callback property — correctly typed async handler; no type mismatch.
interface TwoFactorAuthOptions {
  code: string;
  method: string;
}

declare function performSignAction(authOptions: TwoFactorAuthOptions): Promise<void>;

const signingHandlers = {
  onReauthFormSubmit: async (authOptions: TwoFactorAuthOptions) =>
    await performSignAction(authOptions),
};



// E37: form.handleSubmit() — standard react-hook-form pattern; no type mismatch.
interface TotpFormValues {
  totpCode: string;
}

declare const totpForm: {
  handleSubmit(onValid: (values: TotpFormValues) => void): (e: unknown) => void;
};

declare function onTotpSubmit(values: TotpFormValues): void;

const handleTotpFormSubmit = totpForm.handleSubmit(onTotpSubmit);



// E41: conditional i18n translation as JSX prop — no type mismatch.
interface MessageDescriptor2 {
  id: string;
  message: string;
}

declare function _t(descriptor: MessageDescriptor2): string;
declare const placeholderMsg: MessageDescriptor2 | undefined;
declare function React_createElement2(tag: unknown, props: unknown): unknown;
declare const SearchInput: unknown;

const searchElement = React_createElement2(SearchInput, {
  placeholder: placeholderMsg && _t(placeholderMsg),
});



// --- argument-type-mismatch FP: react-hook-form handleSubmit pattern ---
declare function useForm<T>(): { handleSubmit: (fn: (data: T) => void | Promise<void>) => (e?: React.FormEvent) => void };
declare function toast(msg: string): void;

interface SecurityCodeFormData { code: string; }

function SecurityCodeForm() {
  const form = useForm<SecurityCodeFormData>();

  async function onSubmitCode(data: SecurityCodeFormData) {
    toast(`Submitted code: ${data.code}`);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmitCode)}>
      <button type="submit">Verify</button>
    </form>
  );
}



// --- argument-type-mismatch FP: passthrough onChange handler ---
declare function useFormField(): { onChange: (value: string) => void; value: string };
declare function Select(props: { value?: string; onValueChange?: (value: string) => void; children?: React.ReactNode }): JSX.Element;

function SelectField() {
  const field = useFormField();
  return (
    <Select
      value={field.value}
      onValueChange={(value) => field.onChange(value)}
    >
      <option value="a">Option A</option>
    </Select>
  );
}



// --- argument-type-mismatch FP: .map() rendering Draggable components with composite key ---
declare function Draggable(props: { key?: string; draggableId: string; index: number; children: (provided: object) => JSX.Element }): JSX.Element;

interface SignerEntry { id: number; email: string; name: string; }

function DraggableSignerList({ signers }: { signers: SignerEntry[] }) {
  return (
    <div>
      {signers.map((signer, index) => (
        <Draggable
          key={`signer-${signer.id}`}
          draggableId={`signer-${signer.id}`}
          index={index}
        >
          {(provided) => (
            <div {...provided}>
              {signer.name} ({signer.email})
            </div>
          )}
        </Draggable>
      ))}
    </div>
  );
}



// --- argument-type-mismatch FP: onClick handler with boolean toggle via prev => !prev ---
declare function useState<T>(init: T): [T, (fn: (prev: T) => T) => void];

function ToggleEditPanel() {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div>
      <button onClick={() => setIsEditing((prev) => !prev)}>
        {isEditing ? 'Cancel' : 'Edit'}
      </button>
      {isEditing && <textarea />}
    </div>
  );
}



// --- argument-type-mismatch FP: function call passing options object matching signature ---
interface SignatureClickOptions {
  fieldId: string;
  signerName: string;
  signatureData?: string;
  position: { x: number; y: number };
}

declare function handleFieldActivation(options: SignatureClickOptions): void;

interface SignatureField { fieldId: string; position: { x: number; y: number }; }

function FieldOverlay({ field, signerName }: { field: SignatureField; signerName: string }) {
  return (
    <div
      style={{ left: field.position.x, top: field.position.y, position: 'absolute' }}
      onClick={() =>
        handleFieldActivation({
          fieldId: field.fieldId,
          signerName,
          position: field.position,
        })
      }
    />
  );
}



// --- argument-type-mismatch FP: createCallable generic with typed props and return type ---
declare function createCallable<TProps, TReturn = void>(
  component: (props: TProps & { resolve: (value: TReturn) => void }) => JSX.Element,
): (props: TProps) => Promise<TReturn>;

interface EmailInputDialogProps { defaultEmail?: string; title: string; }

const showEmailInputDialog = createCallable<EmailInputDialogProps, string | null>(
  function EmailInputDialog({ defaultEmail, title, resolve }) {
    return (
      <div>
        <h2>{title}</h2>
        <input defaultValue={defaultEmail} />
        <button onClick={() => resolve(null)}>Cancel</button>
        <button onClick={() => resolve(defaultEmail ?? '')}>Confirm</button>
      </div>
    );
  },
);



// Shape: form.handleSubmit(onFormSubmit) passed as onSubmit — react-hook-form pattern, no type mismatch
declare const workspaceForm: { handleSubmit: (fn: (data: { name: string; slug: string }) => Promise<void>) => React.FormEventHandler };
declare function onWorkspaceFormSubmit(data: { name: string; slug: string }): Promise<void>;

export function WorkspaceCreateFormSnippet() {
  return (
    <form onSubmit={workspaceForm.handleSubmit(onWorkspaceFormSubmit)}>
      <button type="submit">Create</button>
    </form>
  );
}



// Shape: callback extracting id from object parameter to setter — no type mismatch
declare const recipientPicker: { setActiveRecipient: (id: number) => void };
declare const recipients: Array<{ id: number; email: string }>;

export function RecipientSelectorSnippet() {
  return (
    <select
      onChange={(e) => {
        const id = parseInt(e.target.value, 10);
        recipientPicker.setActiveRecipient(id);
      }}
    >
      {recipients.map((r) => (
        <option key={r.id} value={r.id}>{r.email}</option>
      ))}
    </select>
  );
}

declare const fieldManager: { setSelectedField: (id: string) => void };
declare const onFieldSelected: (field: { id: string; type: string }) => void;

const onSelectedFieldChange = (field: { id: string; type: string }) =>
  fieldManager.setSelectedField(field.id);



// Shape: form.handleSubmit(onHandler) as onSubmit prop — react-hook-form pattern, no type mismatch
declare const securityForm: { handleSubmit: (fn: (data: { code: string; backupCode?: string }) => Promise<void>) => React.FormEventHandler };
declare function onEnable2FAFormSubmit(data: { code: string; backupCode?: string }): Promise<void>;

export function Enable2FAFormSnippet() {
  return (
    <form onSubmit={securityForm.handleSubmit(onEnable2FAFormSubmit)}>
      <button type="submit">Enable</button>
    </form>
  );
}



// Shape: executeAuth with async onReauthFormSubmit wrapper — correctly typed, no mismatch
declare const executeActionAuthProcedure: (opts: { onReauthFormSubmit: (authOptions?: unknown) => Promise<void>; actionTarget: string }) => void;
declare function onSignField(authOptions?: unknown): Promise<void>;
declare const field: { type: string };

export function triggerSignWithReauth(): void {
  void executeActionAuthProcedure({
    onReauthFormSubmit: async (authOptions) => await onSignField(authOptions),
    actionTarget: field.type,
  });
}



// Shape: onValueChange casting string to enum type — intentional cast, no runtime type mismatch
type ViewMode = 'LIST' | 'GRID' | 'COMPACT';

declare function setViewMode(mode: ViewMode): void;

export function ViewModeSwitcherSnippet() {
  return (
    <select
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      onChange={(e) => setViewMode(e.target.value as ViewMode)}
      defaultValue="LIST"
    >
      <option value="LIST">List</option>
      <option value="GRID">Grid</option>
      <option value="COMPACT">Compact</option>
    </select>
  );
}


// --- argument-type-mismatch FP: useCallback async callback with await call; valid async callback, no type mismatch ---
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare const authService: { getCurrentSession(): Promise<{ isAuthenticated: boolean; userId: string } | null> };
declare const setUserSession: (session: { userId: string } | null) => void;

const refreshUserSession = useCallback(async () => {
  const newSession = await authService.getCurrentSession();

  if (!newSession || !newSession.isAuthenticated) {
    setUserSession(null);
    return;
  }

  setUserSession({ userId: newSession.userId });
}, []);


// --- argument-type-mismatch FP: Dialog onOpenChange with boolean guard; no type mismatch ---
declare function Dialog(props: { open: boolean; onOpenChange: (value: boolean) => void; children?: unknown }): unknown;
declare const useFormState: () => { isSubmitting: boolean };
declare const setDialogOpen: (v: boolean) => void;
declare const dialogOpen: boolean;

function ConfirmActionDialog({ children }: { children: unknown }) {
  const formState = useFormState();
  return Dialog({
    open: dialogOpen,
    onOpenChange: (value) => !formState.isSubmitting && setDialogOpen(value),
    children,
  });
}


// --- argument-type-mismatch FP: Array.filter with type predicate guard narrowing union; no type mismatch ---
type UploadItem = { data: File; itemId: string; title: string } | { data: undefined; itemId: string; title: string };

declare const uploadItems: UploadItem[];
declare function uploadFile(file: File): Promise<{ id: string }>;

const itemsToUpload = uploadItems.filter(
  (item): item is { data: File; itemId: string; title: string } =>
    item.data !== undefined && item.itemId !== undefined && item.title !== undefined,
);

const uploadResults = Promise.all(
  itemsToUpload.map(async (item) => {
    const result = await uploadFile(item.data);
    return { fileId: result.id, itemId: item.itemId };
  }),
);


// --- argument-type-mismatch FP: Dialog onOpenChange with isPending guard; no type mismatch ---
declare function Dialog(props: { open: boolean; onOpenChange: (value: boolean) => void; children?: unknown }): unknown;
declare const isPending: boolean;
declare const setIsOpen: (v: boolean) => void;
declare const isOpen: boolean;

function PendingGuardDialog({ children }: { children: unknown }) {
  return Dialog({
    open: isOpen,
    onOpenChange: (value) => !isPending && setIsOpen(value),
    children,
  });
}


// --- argument-type-mismatch FP: i18n macro call _(option.label) used as string prop; valid, no type mismatch ---
declare function _(descriptor: { id: string; message?: string }): string;
declare const FIELD_TYPES: Array<{ label: { id: string; message?: string }; value: string }>;
declare const MultiSelectCombobox: (props: {
  options: Array<{ label: string; value: string }>;
  selectedValues: string[];
  onChange: (vals: string[]) => void;
}) => unknown;
declare const selectedFieldTypes: string[];
declare const setSelectedFieldTypes: (vals: string[]) => void;

const fieldTypeOptions = FIELD_TYPES.map((option) => ({
  label: _(option.label),
  value: option.value,
}));

MultiSelectCombobox({
  options: fieldTypeOptions,
  selectedValues: selectedFieldTypes,
  onChange: setSelectedFieldTypes,
});


// --- argument-type-mismatch FP: cn() wrapping className prop in JSX div; valid classname merge, no type mismatch ---
declare function cn(...classes: (string | undefined | null | false)[]): string;
declare const React_createElement3: (tag: unknown, props: unknown, ...children: unknown[]) => unknown;

interface LazyWrapperProps { className?: string; children?: unknown; }

function LazyWrapper(props: LazyWrapperProps) {
  const fallback = React_createElement3(
    'div',
    { className: cn('h-full w-full', props.className) },
    props.children,
  );
  return fallback;
}


// --- argument-type-mismatch FP: array.slice(0, N).map(callback); standard array slice+map; no type mismatch ---
interface FolderEntry { id: string; name: string; isPinned: boolean; }
declare const FolderCard2: (props: { key: string; folder: FolderEntry }) => unknown;
declare const React_createElement4: (tag: unknown, props: unknown) => unknown;
declare const allFolders: FolderEntry[];

const unpinnedFolders2 = allFolders.filter((f) => !f.isPinned);

const visibleFolderCards = unpinnedFolders2.slice(0, 12).map((folder) =>
  React_createElement4(FolderCard2, { key: folder.id, folder }),
);


// --- argument-type-mismatch FP: fields.map() with recipients.find() and fallback object; no type mismatch ---
interface FormField { id: string; recipientId: number; label: string; }
interface RecipientLite { id: number; name: string; email: string; status: string; }
interface DocumentField extends FormField { recipient: RecipientLite; }

declare const formFields: FormField[];
declare const documentRecipients: RecipientLite[];

const documentFields: DocumentField[] = formFields.map((field) => {
  const recipient = documentRecipients.find((r) => r.id === field.recipientId) || {
    id: field.recipientId,
    name: 'Unknown',
    email: 'unknown@example.com',
    status: 'PENDING',
  };
  return { ...field, recipient };
});


// --- argument-type-mismatch FP: setEnvelopeData functional updater spreading prev; standard React state updater, no type mismatch ---
interface EnvelopeRecipient { id: string; fields: Array<{ id: string; value: string }> }
interface EnvelopeState { id: string; title: string; recipients: EnvelopeRecipient[] }
interface SigningData { envelope: EnvelopeState; currentRecipientId: string }

declare const setSigningData: (updater: (prev: SigningData) => SigningData) => void;
declare const signedFieldId: string;
declare const updatedFieldValue: string;
declare const recipientId: string;

setSigningData((prev) => ({
  ...prev,
  envelope: {
    ...prev.envelope,
    recipients: prev.envelope.recipients.map((r) =>
      r.id === recipientId
        ? { ...r, fields: r.fields.map((f) => (f.id === signedFieldId ? { ...f, value: updatedFieldValue } : f)) }
        : r,
    ),
  },
}));


// --- argument-type-mismatch FP: stage.on('click tap', callback) Konva event; valid event subscription, no type mismatch ---
declare const KonvaStage: {
  on(eventName: string, callback: (e: { target: unknown }) => void): void;
};
declare const setSelectedItems: (items: unknown[]) => void;
declare const selectionRect: { visible(): boolean; width(): number; height(): number };
declare const stageRef: { current: unknown };

KonvaStage.on('click tap', (e) => {
  if (selectionRect.visible() && selectionRect.width() > 0 && selectionRect.height() > 0) {
    return;
  }

  if (e.target === stageRef.current) {
    setSelectedItems([]);
    return;
  }
});


// --- argument-type-mismatch FP: cn() with static classes and className spread; valid Tailwind merge, no type mismatch ---
declare function cn2(...classes: (string | undefined | null | false)[]): string;
declare const React_createElement6: (tag: unknown, props: unknown, ...children: unknown[]) => unknown;

interface EmptyListProps { className?: string; children?: unknown; [key: string]: unknown }

function EmptyListPlaceholder({ className, children, ...rest }: EmptyListProps) {
  return React_createElement6(
    'div',
    {
      className: cn2('px-2 py-4 text-center text-sm', className),
      'data-empty': '',
      role: 'presentation',
      ...rest,
    },
    children,
  );
}


// --- argument-type-mismatch FP: cn() with static error classes and className spread on <p>; valid classname merge, no type mismatch ---
declare function cn3(...classes: (string | undefined | null | false)[]): string;
declare const React_createElement7: (tag: unknown, props: unknown, ...children: unknown[]) => unknown;

interface ErrorMessageProps { id?: string; className?: string; children?: unknown }

function FieldErrorMessage({ id, className, children, ...rest }: ErrorMessageProps & Record<string, unknown>) {
  return React_createElement7(
    'p',
    { id, className: cn3('text-red-500 text-xs', className), ...rest },
    children,
  );
}


// --- argument-type-mismatch FP: Switch onCheckedChange={(value) => setSwitchState(value)}; boolean to boolean setter, no type mismatch ---
declare function Switch(props: { checked: boolean; onCheckedChange: (value: boolean) => void; className?: string }): unknown;
declare const isFeatureEnabled: boolean;
declare const setIsFeatureEnabled: (v: boolean) => void;

const switchElement = Switch({
  checked: isFeatureEnabled,
  onCheckedChange: (value) => setIsFeatureEnabled(value),
  className: 'mt-2',
});


// --- argument-type-mismatch FP: satori() with JSX element and options; valid satori call, no type mismatch ---
declare function satori(element: unknown, options: { width: number; height: number; fonts: unknown[] }): Promise<string>;
declare const React_createElement8: (tag: unknown, props: unknown, ...children: unknown[]) => unknown;
declare const ogFonts: unknown[];

async function generateOpenGraphImage(title: string, description: string): Promise<string> {
  return await satori(
    React_createElement8(
      'div',
      {
        style: { display: 'flex', width: '100%', height: '100%', background: 'white' },
      },
      React_createElement8('h1', { style: { fontSize: 48 } }, title),
      React_createElement8('p', { style: { fontSize: 24 } }, description),
    ),
    {
      width: 1200,
      height: 630,
      fonts: ogFonts,
    },
  );
}


// --- argument-type-mismatch FP: cn() with static flex classes and className prop; valid classname merge, no type mismatch ---
declare function cn4(...classes: (string | undefined | null | false)[]): string;
declare const React_createElement9: (tag: unknown, props: unknown, ...children: unknown[]) => unknown;

interface SettingsContainerProps { className?: string; title?: string; children?: unknown }

function SettingsContainer({ className, title, children }: SettingsContainerProps) {
  return React_createElement9(
    'div',
    { className: cn4('flex flex-row items-center justify-between', className) },
    title ? React_createElement9('h3', { className: 'font-medium text-lg' }, title) : null,
    children,
  );
}


// --- argument-type-mismatch FP: executeActionAuthProcedure with onReauthFormSubmit async callback; field.type is valid FieldType; no type mismatch ---
type FieldType2 = 'SIGNATURE' | 'TEXT' | 'NUMBER' | 'DATE' | 'CHECKBOX';

interface AuthOptions { code: string; method: string }
interface SignField { id: string; type: FieldType2; value: string }

declare function executeActionAuthProcedure(opts: {
  onReauthFormSubmit: (authOptions: AuthOptions) => Promise<void>;
  actionTarget: FieldType2;
}): void;

declare function performFieldSign(authOptions: AuthOptions): Promise<void>;

declare const activeField: SignField;

executeActionAuthProcedure({
  onReauthFormSubmit: async (authOptions) => await performFieldSign(authOptions),
  actionTarget: activeField.type,
});



// --- argument-type-mismatch FP: tRPC useMutation onSuccess destructuring ---
declare function useContractMutation<T>(opts: {
  mutationFn: (data: T) => Promise<{ id: string; title: string }>;
  onSuccess?: (result: { id: string; title: string }) => void;
}): { mutate: (data: T) => void };
declare function useContractRouter(): { push: (path: string) => void; refresh: () => void };
declare function showSuccessToast(message: string): void;

function DuplicateContractDialog({ contractId }: { contractId: string }) {
  const router = useContractRouter();
  const { mutate: duplicateContract } = useContractMutation({
    mutationFn: async (id: string) => {
      const result = await fetchDuplicateContract(id);
      return result;
    },
    onSuccess({ id }) {
      router.push(`/contracts/${id}`);
      showSuccessToast('Contract duplicated successfully');
    },
  });

  return null;
}

declare function fetchDuplicateContract(id: string): Promise<{ id: string; title: string }>;



// FP shape f8403f59ef1e: Dialog onOpenChange with guard expression — no type mismatch
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];
declare function useFormState(): { isSubmitting: boolean; reset: () => void };
declare function Dialog(props: { open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }): JSX.Element;
declare function DialogContent(props: { children: React.ReactNode }): JSX.Element;
declare function Button(props: { variant?: string; onClick?: () => void; children: React.ReactNode }): JSX.Element;

function SigningCompleteDialog({ recipientName }: { recipientName: string }) {
  const [open, setOpen] = useState(false);
  const form = useFormState();

  return (
    <Dialog open={open} onOpenChange={(value) => !form.isSubmitting && setOpen(value)}>
      <DialogContent>
        <p>Signing complete for {recipientName}</p>
        <Button onClick={() => { form.reset(); setOpen(false); }}>Close</Button>
      </DialogContent>
    </Dialog>
  );
}



// FP shape fbac4a2075aa: detectedRecipients.map() rendering list items with fallback avatar — no type mismatch
declare const detectedRecipients: Array<{ name?: string; email?: string }>;
declare function AvatarWithText(props: { avatarFallback: string; primaryText?: string; secondaryText?: string }): JSX.Element;

function DetectedRecipientsList() {
  return (
    <ul className="mt-4 divide-y rounded-lg border">
      {detectedRecipients.map((recipient, index) => (
        <li key={index} className="flex items-center justify-between px-4 py-3">
          <AvatarWithText
            avatarFallback={
              recipient.name
                ? recipient.name.slice(0, 1).toUpperCase()
                : recipient.email
                  ? recipient.email.slice(0, 1).toUpperCase()
                  : '?'
            }
            primaryText={recipient.name}
            secondaryText={recipient.email}
          />
        </li>
      ))}
    </ul>
  );
}



// FP shape fc72e7f95c24: setIsDownloadingState updater with computed key spread — no type mismatch
declare function useState<T>(init: T): [T, (updater: T | ((prev: T) => T)) => void];
declare function generateDownloadKey(itemId: string, version: string): string;
declare function downloadFile(opts: { token: string; fileName: string; version: string }): Promise<void>;

function useDownloadState() {
  const [isDownloadingState, setIsDownloadingState] = useState<Record<string, boolean>>({});

  async function handleDownload(envelopeItemId: string, token: string, fileName: string, version: string) {
    setIsDownloadingState((prev) => ({
      ...prev,
      [generateDownloadKey(envelopeItemId, version)]: true,
    }));

    try {
      await downloadFile({ token, fileName, version });
    } catch (error) {
      console.error(error);
    } finally {
      setIsDownloadingState((prev) => ({
        ...prev,
        [generateDownloadKey(envelopeItemId, version)]: false,
      }));
    }
  }

  return { isDownloadingState, handleDownload };
}



// FP shape: RECIPIENT_ROLES_DESCRIPTION is a plain object keyed exhaustively by every RecipientRole
// enum member, enforced at compile time by `satisfies Record<keyof typeof RecipientRole, unknown>`.
// Accessing with a RecipientRole typed value is type-safe — no out-of-bounds possible.
declare const enum RecipientRole { VIEWER = 'VIEWER', SIGNER = 'SIGNER', APPROVER = 'APPROVER', CC = 'CC' }

const RECIPIENT_ROLE_DESCRIPTIONS = {
  [RecipientRole.VIEWER]: { label: 'Viewer', description: 'Can view the document' },
  [RecipientRole.SIGNER]: { label: 'Signer', description: 'Must sign the document' },
  [RecipientRole.APPROVER]: { label: 'Approver', description: 'Must approve before signing' },
  [RecipientRole.CC]: { label: 'CC', description: 'Receives a copy only' },
} satisfies Record<RecipientRole, { label: string; description: string }>;

function getRecipientRoleDescription(role: RecipientRole) {
  return RECIPIENT_ROLE_DESCRIPTIONS[role];
}



// FP shape: RECIPIENT_ROLE_LABELS is a Record keyed by RecipientRole enum;
// role comes from Object.values(RecipientRole) iteration so key always present.
declare const enum ContactRole { OWNER = 'OWNER', APPROVER = 'APPROVER', VIEWER = 'VIEWER', CC = 'CC' }

const CONTACT_ROLE_LABELS = {
  [ContactRole.OWNER]: 'Document Owner',
  [ContactRole.APPROVER]: 'Approver',
  [ContactRole.VIEWER]: 'Viewer',
  [ContactRole.CC]: 'CC Recipient',
} satisfies Record<ContactRole, string>;

function buildRoleFilterOptions(): Array<{ value: ContactRole; label: string }> {
  return (Object.values(ContactRole) as ContactRole[]).map((role) => ({
    value: role,
    label: CONTACT_ROLE_LABELS[role],
  }));
}



// FP shape: DOCUMENT_AUTH_TYPES is a Record keyed by DocumentActionAuth enum;
// authType comes from Object.values(DocumentActionAuth) filtered iteration. Enum-exhaustive Record lookup.
declare const enum DocumentActionAuth { NONE = 'NONE', REQUIRE_ACCOUNT = 'REQUIRE_ACCOUNT', REQUIRE_2FA = 'REQUIRE_2FA', PASSKEY = 'PASSKEY' }

interface AuthTypeConfig { label: string; description: string; requiresSetup: boolean }

const DOCUMENT_ACTION_AUTH_TYPES = {
  [DocumentActionAuth.NONE]: { label: 'No authentication', description: 'No extra steps required', requiresSetup: false },
  [DocumentActionAuth.REQUIRE_ACCOUNT]: { label: 'Require account', description: 'Signer must have an account', requiresSetup: false },
  [DocumentActionAuth.REQUIRE_2FA]: { label: 'Two-factor authentication', description: 'Signer must verify via 2FA', requiresSetup: true },
  [DocumentActionAuth.PASSKEY]: { label: 'Passkey', description: 'Signer must authenticate with a passkey', requiresSetup: true },
} satisfies Record<DocumentActionAuth, AuthTypeConfig>;

function getAvailableAuthOptions(excludeSetupRequired: boolean): Array<{ value: DocumentActionAuth; label: string }> {
  return (Object.values(DocumentActionAuth) as DocumentActionAuth[])
    .filter((authType) => !excludeSetupRequired || !DOCUMENT_ACTION_AUTH_TYPES[authType].requiresSetup)
    .map((authType) => ({ value: authType, label: DOCUMENT_ACTION_AUTH_TYPES[authType].label }));
}
