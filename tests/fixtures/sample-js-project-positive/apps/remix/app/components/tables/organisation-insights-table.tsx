
// E39: tanstack table header render function returning JSX — correct type; no type mismatch.
declare function React_createElement(tag: string, props: unknown, ...children: unknown[]): unknown;

interface TableColumnDef {
  header: () => unknown;
  accessorKey: string;
  size: number;
}

const activityTableColumns: TableColumnDef[] = [
  {
    header: () => React_createElement('span', { className: 'whitespace-nowrap' }, 'User'),
    accessorKey: 'userName',
    size: 200,
  },
  {
    header: () => React_createElement('span', { className: 'whitespace-nowrap' }, 'Action'),
    accessorKey: 'actionType',
    size: 160,
  },
];



// E45: i18n.date(new Date(row.getValue())) — row.getValue returns unknown, new Date() coerces it; correct usage.
declare const i18n: { date(d: Date): string };
declare const activityRow: { getValue(key: string): unknown };

const formattedActivityDate = i18n.date(new Date(activityRow.getValue('occurredAt')));



// --- argument-type-mismatch FP: .map() over members building combobox options; toString() produces string ---
declare const trpcTeam: { member: { getMany: { useQuery: (opts: { teamId: number }) => { data: Array<{ name: string | null; email: string; userId: number }> | undefined; isLoading: boolean } } } };
declare function MultiCombobox(props: { options: Array<{ label: string; value: string }>; onChange: (vals: string[]) => void }): JSX.Element;

function MemberFilterDropdown({ teamId }: { teamId: number }) {
  const { data } = trpcTeam.member.getMany.useQuery({ teamId });
  const comboBoxOptions = (data ?? []).map((member) => ({
    label: member.name ?? member.email,
    value: member.userId.toString(),
  }));
  return <MultiCombobox options={comboBoxOptions} onChange={(vals) => console.log(vals)} />;
}



// --- argument-type-mismatch FP: LinguiJS _() translation call with MessageDescriptor argument ---
declare function createI18n(): { _: (descriptor: { id: string; message?: string }) => string };
const i18nInstance = createI18n();
const _ = i18nInstance._;

function LocalizedPageTitle({ heading }: { heading: { id: string; message?: string } }) {
  return <h1>{_(heading)}</h1>;
}



// --- argument-type-mismatch FP: Object.values().map() producing typed array for MultiSelect options ---
const SIGNATURE_METHODS = { DRAW: 'draw', TYPE: 'type', UPLOAD: 'upload' } as const;
type SignatureMethod = typeof SIGNATURE_METHODS[keyof typeof SIGNATURE_METHODS];

declare function MultiSelectField(props: { options: Array<{ label: string; value: string }>; value: string[]; onChange: (vals: string[]) => void }): JSX.Element;

function SignatureMethodPicker({ selected, onChange }: { selected: string[]; onChange: (v: string[]) => void }) {
  const options = Object.values(SIGNATURE_METHODS).map((method) => ({
    label: method.charAt(0).toUpperCase() + method.slice(1),
    value: method,
  }));
  return <MultiSelectField options={options} value={selected} onChange={onChange} />;
}



// --- argument-type-mismatch FP: lingui _() translation with tagged template literal ---
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): { id: string; message: string };
declare function useLingui(): { _: (descriptor: { id: string; message?: string }) => string };

function StatusBadge({ status }: { status: 'active' | 'inactive' | 'pending' }) {
  const { _ } = useLingui();
  const labels: Record<string, string> = {
    active: _(msg`Active`),
    inactive: _(msg`Inactive`),
    pending: _(msg`Pending`),
  };
  return <span>{labels[status]}</span>;
}



// --- argument-type-mismatch FP: .map() callback with Icon component and isActive comparison ---
declare function NavIcon(props: { name: string; active?: boolean }): JSX.Element;

const NAV_SECTIONS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'docs', label: 'Documentation', icon: 'book' },
  { id: 'api', label: 'API Reference', icon: 'code' },
] as const;

function SideNav({ currentSection }: { currentSection: string }) {
  return (
    <nav>
      {NAV_SECTIONS.map((section) => {
        const isActive = section.id === currentSection;
        return (
          <div key={section.id}>
            <NavIcon name={section.icon} active={isActive} />
            <span>{section.label}</span>
          </div>
        );
      })}
    </nav>
  );
}



// --- argument-type-mismatch FP: lingui _() with plain string argument ---
declare function useLingui(): { _: (str: string) => string };

const LANGUAGE_OPTIONS = [
  { code: 'en', full: 'English' },
  { code: 'fr', full: 'French' },
  { code: 'de', full: 'German' },
];

function LanguageSelector({ onSelect }: { onSelect: (code: string) => void }) {
  const { _ } = useLingui();
  return (
    <select onChange={(e) => onSelect(e.target.value)}>
      {LANGUAGE_OPTIONS.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {_(lang.full)}
        </option>
      ))}
    </select>
  );
}



// --- argument-type-mismatch FP: i18n.date() with Date argument ---
declare function useI18n(): { date: (d: Date, opts?: { dateStyle?: 'short' | 'medium' | 'long' }) => string };

interface TeamMembership { userId: number; teamName: string; joinedAt: Date; }

function MembershipRow({ membership }: { membership: TeamMembership }) {
  const i18n = useI18n();
  return (
    <tr>
      <td>{membership.teamName}</td>
      <td>{i18n.date(membership.joinedAt, { dateStyle: 'medium' })}</td>
    </tr>
  );
}



// --- argument-type-mismatch FP: .map() rendering JSX list items ---
interface AuditRecipient { id: number; name: string; email: string; action: string; }

function RecipientAuditList({ recipients }: { recipients: AuditRecipient[] }) {
  return (
    <ul className="divide-y">
      {recipients.map((recipient) => (
        <li key={recipient.id} className="py-2">
          <span className="font-medium">{recipient.name}</span>
          <span className="text-muted-foreground ml-2">{recipient.email}</span>
          <span className="text-xs ml-2">{recipient.action}</span>
        </li>
      ))}
    </ul>
  );
}



// --- argument-type-mismatch FP: cva() or cn() with variant class strings for badge rendering ---
declare function cva(base: string, config?: { variants?: Record<string, Record<string, string>> }): (opts?: Record<string, string>) => string;

const badgeVariants = cva('inline-flex items-center rounded px-2 py-0.5 text-xs font-medium', {
  variants: {
    intent: {
      success: 'bg-green-100 text-green-800',
      warning: 'bg-yellow-100 text-yellow-800',
      danger: 'bg-red-100 text-red-800',
      neutral: 'bg-gray-100 text-gray-800',
    },
  },
});

function StatusBadgeItem({ intent, label }: { intent: 'success' | 'warning' | 'danger' | 'neutral'; label: string }) {
  return <span className={badgeVariants({ intent })}>{label}</span>;
}



// Shape: i18n.date() accepting Date from data row — no type mismatch
declare const i18n: { date: (d: Date | number, opts?: Record<string, unknown>) => string };
declare const inviteRow: { original: { invitedAt: Date; email: string } };

export function formatInviteDate(): string {
  return i18n.date(inviteRow.original.invitedAt);
}


// --- argument-type-mismatch FP: tRPC query hook with placeholderData option; no type mismatch ---
declare const trpc: {
  admin: {
    document: {
      find: {
        useQuery(
          params: { query: string; page: number; perPage: number },
          opts?: { placeholderData?: (prev: unknown) => unknown },
        ): { data: unknown; isPending: boolean };
      };
    };
  };
};

declare const debouncedSearchTerm: string;
declare const currentPage: number;
declare const pageSize: number;

const { data: adminDocumentsData, isPending: isAdminDocsLoading } = trpc.admin.document.find.useQuery(
  {
    query: debouncedSearchTerm,
    page: currentPage || 1,
    perPage: pageSize || 20,
  },
  {
    placeholderData: (previousData) => previousData,
  },
);


// --- argument-type-mismatch FP: .map((event) => toFriendlyName(event)) on typed enum array; result used as string, no type mismatch ---
type WebhookTrigger = 'DOCUMENT_SIGNED' | 'DOCUMENT_SENT' | 'DOCUMENT_VIEWED';

declare function toFriendlyWebhookName(event: WebhookTrigger): string;

interface WebhookRow { eventTriggers: WebhookTrigger[]; enabled: boolean }

function buildEventTriggerTitle(row: WebhookRow): string {
  return row.eventTriggers.map((event) => toFriendlyWebhookName(event)).join(', ');
}


// --- argument-type-mismatch FP: Recharts Tooltip formatter returning [string, boolean]; permissive library type, no actual type mismatch ---
declare const Tooltip: (props: {
  formatter?: (value: unknown, name: string) => [unknown, unknown];
  labelStyle?: object;
  cursor?: object;
}) => unknown;
declare const BarChart: (props: { data: unknown[]; children?: unknown }) => unknown;

declare const chartData: Array<{ month: string; count: number; signed_count: number }>;
declare const isCumulative: boolean;

const statsTooltip = Tooltip({
  labelStyle: { color: 'hsl(var(--foreground))' },
  formatter: (value, name) => [Number(value).toLocaleString('en-US'), name === 'Recipients'],
  cursor: { fill: 'hsl(var(--primary) / 10%)' },
});


// --- argument-type-mismatch FP: useMemo(() => { return [...columns] satisfies ColDef[] }, []) — internal TS error in callback body incorrectly attributed to outer useMemo args; no actual argument type mismatch ---
declare function useMemo2<T>(factory: () => T, deps: unknown[]): T;

interface DataTableColumnDef2<TRow> {
  header: string;
  accessorKey?: string;
  cell?: (opts: { row: { original: TRow } }) => unknown;
}

interface DocumentRow { id: string; title: string; createdAt: Date; status: string }

declare const _t: (descriptor: { id: string; message?: string }) => string;
declare const i18n2: { date(d: Date, opts?: object): string };
declare const team2: { url?: string } | null;

const documentColumns = useMemo2((): DataTableColumnDef2<DocumentRow>[] => {
  return [
    {
      header: _t({ id: 'Created', message: 'Created' }),
      accessorKey: 'createdAt',
      cell: ({ row }) => i18n2.date(row.original.createdAt, { month: 'short', day: 'numeric', year: 'numeric' }),
    },
    {
      header: _t({ id: 'Title', message: 'Title' }),
      accessorKey: 'title',
      cell: ({ row }) => row.original.title,
    },
    {
      header: _t({ id: 'Status', message: 'Status' }),
      accessorKey: 'status',
      cell: ({ row }) => row.original.status,
    },
  ] satisfies DataTableColumnDef2<DocumentRow>[];
}, []);



// --- argument-type-mismatch FP: tRPC useQuery with input object ---
declare function usePaginatedQuery<T>(opts: {
  queryFn: (input: { page: number; perPage: number; search?: string }) => Promise<T>;
  queryKey: string;
}): { data: T | undefined; isLoading: boolean };

function AdminPendingReviewsPage({ page }: { page: number }) {
  const { data: reviews } = usePaginatedQuery({
    queryKey: 'admin.reviews.pending',
    queryFn: (input) => fetchPendingReviews(input),
  });

  return null;
}

declare function fetchPendingReviews(input: {
  page: number;
  perPage: number;
  search?: string;
}): Promise<{ items: unknown[]; total: number }>;


declare const reportColumns: any[];

const insightsColumns = [
  {
    header: 'Projects',
    accessorKey: 'projectCount',
    cell: ({ row }: any) => Number(row.getValue('projectCount')),
    size: 120,
  },
  {
    header: 'Tasks',
    accessorKey: 'taskCount',
    cell: ({ row }: any) => Number(row.getValue('taskCount')),
    size: 140,
  },
];
