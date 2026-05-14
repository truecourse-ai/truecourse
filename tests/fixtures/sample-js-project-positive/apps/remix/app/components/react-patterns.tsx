
// FP shape: useMemo with early return empty array — standard guard pattern
declare const useMemo: <T>(factory: () => T, deps: unknown[]) => T;
declare const renderInstance: { ready: boolean } | null;
declare const items: Array<{ id: string; label: string }>;

function useProcessedItems() {
  const processedItems = useMemo(() => {
    if (!renderInstance) {
      return [];
    }
    const engine = renderInstance;
    return items.map((item) => ({
      ...item,
      processed: engine.ready,
    }));
  }, [renderInstance, items]);

  return processedItems;
}



// FP shape: form onSubmit with handleSubmit(onFormSubmit) — standard react-hook-form pattern
declare const useForm: <T>() => { handleSubmit: (fn: (data: T) => void) => (e: unknown) => void };
declare function onSettingsSubmit(data: { theme: string; language: string }): void;

function SettingsForm() {
  const form = useForm<{ theme: string; language: string }>();
  return (
    <form onSubmit={form.handleSubmit(onSettingsSubmit)}>
      <button type="submit">Save</button>
    </form>
  );
}



// FP shape: onChange receives options array and maps with fromOption — types flow through multiselect callback
declare function toOption(tag: { id: string; label: string }): { value: string; label: string };
declare function fromOption(opt: { value: string; label: string }): { id: string; label: string };
declare const selectedTags: Array<{ id: string; label: string }>;
declare const onTagsChange: (tags: Array<{ id: string; label: string }>) => void;
declare const MultiTagSelect: React.FC<{
  value: Array<{ value: string; label: string }>;
  onChange: (opts: Array<{ value: string; label: string }>) => void;
}>;

function TagSelectorWidget() {
  return (
    <MultiTagSelect
      value={selectedTags.map(toOption)}
      onChange={(options) => onTagsChange(options.map(fromOption))}
    />
  );
}



// FP shape: Dialog onOpenChange prop receiving boolean — standard Radix UI dialog pattern
declare const isPending: boolean;
declare const onOpenChange: (open: boolean) => void;
declare const DialogRoot: React.FC<{ open: boolean; onOpenChange: (value: boolean) => void; children?: React.ReactNode }>;
declare const open: boolean;

function RenameDialog() {
  return (
    <DialogRoot
      open={open}
      onOpenChange={(value) => !isPending && onOpenChange(value)}
    >
      <div>Dialog content</div>
    </DialogRoot>
  );
}



// FP shape: onOpenChange callback with short-circuit expression — JSX event-handler return type is ignored
declare const isDeleting: boolean;
declare const setModalOpen: (value: boolean) => void;
declare const DialogWrapper: React.FC<{ open: boolean; onOpenChange: (value: boolean) => void; children?: React.ReactNode }>;
declare const modalOpen: boolean;

function DeleteConfirmDialog() {
  return (
    <DialogWrapper
      open={modalOpen}
      onOpenChange={(value) => !isDeleting && setModalOpen(value)}
    >
      <p>Are you sure?</p>
    </DialogWrapper>
  );
}



// FP shape: Object.entries().map() rendering SelectItem children — standard React rendering pattern
declare const SUPPORTED_LOCALES: Record<string, string>;
declare const SelectItem: React.FC<{ key?: string; value: string; children?: React.ReactNode }>;

function LocaleSelector() {
  return (
    <div>
      {Object.entries(SUPPORTED_LOCALES).map(([code, label]) => (
        <SelectItem key={code} value={code}>
          {label}
        </SelectItem>
      ))}
    </div>
  );
}



// FP shape: JSX form onSubmit with handleSubmit(onFormSubmit) — standard react-hook-form pattern
declare const useForm: <T>() => { handleSubmit: (fn: (data: T) => Promise<void>) => (e: unknown) => void; formState: { isSubmitting: boolean } };
declare function onResendSubmit(data: { email: string; message: string }): Promise<void>;

function ResendNotificationForm() {
  const form = useForm<{ email: string; message: string }>();
  return (
    <form onSubmit={form.handleSubmit(onResendSubmit)}>
      <fieldset disabled={form.formState.isSubmitting}>
        <button type="submit">Resend</button>
      </fieldset>
    </form>
  );
}



// FP shape: useMemo returning array of column definitions — tanstack-table pattern
declare const useMemo: <T>(factory: () => T, deps: unknown[]) => T;
declare const createColumnHelper: <T>() => {
  accessor: (key: keyof T, opts: { header: string; cell: (info: { getValue: () => unknown }) => React.ReactNode }) => unknown;
};

type NotificationRow = { id: string; title: string; createdAt: Date; status: string };

function useNotificationColumns() {
  const columnHelper = createColumnHelper<NotificationRow>();

  const columns = useMemo(
    () => [
      columnHelper.accessor('title', {
        header: 'Title',
        cell: (info) => <span>{String(info.getValue())}</span>,
      }),
      columnHelper.accessor('status', {
        header: 'Status',
        cell: (info) => <span>{String(info.getValue())}</span>,
      }),
    ],
    []
  );

  return columns;
}



// FP shape: Array.map() over objects rendering JSX — standard list rendering
declare const workspaces: Array<{ id: string; name: string; memberCount: number }>;
declare const WorkspaceCard: React.FC<{ key?: string; id: string; name: string; memberCount: number }>;

function WorkspaceDashboard() {
  return (
    <div>
      {workspaces.map((workspace) => (
        <WorkspaceCard
          key={workspace.id}
          id={workspace.id}
          name={workspace.name}
          memberCount={workspace.memberCount}
        />
      ))}
    </div>
  );
}



// FP shape: cn() with result of function(array.findIndex(...)).property — all types correct
declare function getColorTheme(index: number): { triggerClassName: string; badgeClassName: string };
declare function cn(...classes: Array<string | undefined | false>): string;
declare const assignees: Array<{ id: string; name: string }>;
declare const currentUserId: string;

function AssigneeSelector() {
  const userIndex = assignees.findIndex((a) => a.id === currentUserId);
  const triggerClass = cn(
    'flex items-center gap-2',
    getColorTheme(userIndex).triggerClassName
  );
  return <button className={triggerClass}>Select</button>;
}



// FP shape: useMemo returning filtered array — standard memoization pattern
declare const useMemo: <T>(factory: () => T, deps: unknown[]) => T;
declare const allFields: Array<{ id: string; recipientId: number; type: string; completed: boolean }>;
declare const activeRecipientId: number;

function useActiveRecipientFields() {
  const recipientFields = useMemo(
    () => allFields.filter((field) => field.recipientId === activeRecipientId),
    [allFields, activeRecipientId]
  );

  return recipientFields;
}



// FP shape: JSX Img src with function call returning string — standard JSX prop
declare function getAssetUrl(assetName: string): string;
declare const Img: React.FC<{ src: string; alt: string; width?: number; height?: number }>;

function EmailLogoSection() {
  return (
    <Img
      src={getAssetUrl('logo-primary.png')}
      alt="Company Logo"
      width={200}
      height={60}
    />
  );
}



// FP shape: match({status, deletedAt}).with(...) ts-pattern matching — exhaustive JSX branches
declare const match: <T>(value: T) => {
  with: (pattern: Partial<T>, fn: () => React.ReactNode) => { with: unknown; otherwise: (fn: () => React.ReactNode) => React.ReactNode; exhaustive: () => React.ReactNode };
};
declare const status: 'pending' | 'complete' | 'declined';
declare const deletedAt: Date | null;

function SubmissionStatusView() {
  return match({ status, deletedAt })
    .with({ status: 'complete', deletedAt: null }, () => <div>Submission complete</div>)
    .with({ status: 'declined' }, () => <div>Submission declined</div>)
    .otherwise(() => <div>Submission pending</div>);
}



// FP shape: Array.from({ length: n }).map((_, i) => ...) — standard skeleton row generation
declare const config: { skeletonRows: number; skeletonCols: number };
declare const SkeletonRow: React.FC<{ key?: number; index: number }>;

function DataTableSkeleton() {
  return (
    <div>
      {Array.from({ length: config.skeletonRows }).map((_, i) => (
        <SkeletonRow key={i} index={i} />
      ))}
    </div>
  );
}



// FP shape: useMemo with early return null and string comparison — standard guard pattern
declare const useMemo: <T>(factory: () => T, deps: unknown[]) => T;
declare const signingMode: string | null;
declare const allSignatures: Array<{ id: string; mode: string; content: string }>;

function useFilteredSignatures() {
  const filteredSignatures = useMemo(() => {
    if (!signingMode || signingMode !== 'advanced') {
      return null;
    }

    return allSignatures.filter((sig) => sig.mode === signingMode);
  }, [signingMode, allSignatures]);

  return filteredSignatures;
}



// FP shape: useMemo filtering items by recipientId — standard memoization
declare const useMemo: <T>(factory: () => T, deps: unknown[]) => T;
declare const helperFields: Array<{ id: string; recipientId: number; type: string }>;
declare const currentRecipientId: number;

function useHelperFieldsForRecipient() {
  const recipientHelperFields = useMemo(
    () => helperFields.filter((field) => field.recipientId === currentRecipientId),
    [helperFields, currentRecipientId]
  );

  return recipientHelperFields;
}



// FP shape: void executeActionAuthProcedure({ ... }) — standard void async call with object argument
declare function executeAuthFlow(opts: {
  onAuthSuccess: (authToken: string) => Promise<void>;
  requiredScope: string;
}): Promise<void>;
declare function onSignComplete(authToken: string): Promise<void>;
declare const fieldScope: string;

function handleFieldClick() {
  void executeAuthFlow({
    onAuthSuccess: async (authToken) => await onSignComplete(authToken),
    requiredScope: fieldScope,
  });
}



// FP shape: tRPC useQuery with object argument — standard tRPC query pattern
declare const trpc: {
  template: {
    getById: {
      useQuery: (input: { templateId: number }, opts?: { enabled?: boolean }) => { data: unknown; isLoading: boolean };
    };
  };
};
declare const templateId: number;

function useTemplateData() {
  const { data, isLoading } = trpc.template.getById.useQuery(
    { templateId },
    { enabled: templateId > 0 }
  );
  return { data, isLoading };
}



// --- argument-type-mismatch FP: React.forwardRef with Radix-style ElementRef + ComponentPropsWithoutRef type params ---
declare const React: {
  forwardRef<T, P>(render: (props: P, ref: React.Ref<T>) => JSX.Element): (props: P & { ref?: React.Ref<T> }) => JSX.Element;
  ElementRef<T>: unknown;
  ComponentPropsWithoutRef<T>: unknown;
  Ref<T>: unknown;
};

declare namespace BadgePrimitive {
  const Root: (props: { className?: string; children?: React.ReactNode }) => JSX.Element;
  const Label: (props: { className?: string; children?: React.ReactNode }) => JSX.Element;
  const Icon: (props: { className?: string; children?: React.ReactNode }) => JSX.Element;
}

declare function cn(...inputs: (string | undefined | boolean | null)[]): string;

const Badge = React.forwardRef<
  React.ElementRef<typeof BadgePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof BadgePrimitive.Root>
>(({ className, ...props }, ref) => (
  <BadgePrimitive.Root
    ref={ref}
    className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', className)}
    {...props}
  />
));

Badge.displayName = BadgePrimitive.Root.displayName;

const BadgeLabel = React.forwardRef<
  React.ElementRef<typeof BadgePrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof BadgePrimitive.Label>
>(({ className, ...props }, ref) => (
  <BadgePrimitive.Label
    ref={ref}
    className={cn('truncate', className)}
    {...props}
  />
));

BadgeLabel.displayName = BadgePrimitive.Label.displayName;


// React Query returns isLoadingError state; errors handled via prop, no wrapper needed
declare function useQuery<T>(opts: { queryKey: unknown[] }): { data: T | undefined; isLoadingError: boolean };
declare function DataWidget(props: { data: object[]; isLoadingError: boolean }): JSX.Element;

export function AuditLogWidget({ page }: { page: number }) {
  const { data, isLoadingError } = useQuery<{ items: object[] }>({ queryKey: ['audit-logs', page] });
  return <DataWidget data={data?.items ?? []} isLoadingError={isLoadingError} />;
}

