// --- too-many-lines shape: React TSX route component with hooks, useMemo, useEffect, JSX, conditional rendering ---
declare function useState<T>(init: T | (() => T)): [T, (v: T) => void];
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare function useSearchParams(): [URLSearchParams, (p: URLSearchParams) => void];
declare function useLocation(): { pathname: string };
declare const trpc: {
  notification: {
    getById: { useQuery: (args: { id: string }, opts?: { enabled?: boolean; retry?: boolean }) => { data: NotificationRecord | undefined; isLoading: boolean } };
    deliveries: { find: { useQuery: (args: DeliveryQueryArgs) => { data: DeliveryPage | undefined; isLoading: boolean; isLoadingError: boolean } } };
  };
};
declare function useDebouncedValue<T>(val: T, ms: number): T;
declare function useUpdateSearchParams(): (params: Record<string, unknown>) => void;
declare function useCurrentWorkspace(): { slug: string };
declare function useToast(): { toast: (opts: { title: string; variant?: string }) => void };

interface NotificationRecord {
  id: string;
  enabled: boolean;
  channelUrl: string;
  events: string[];
}

interface DeliveryQueryArgs {
  notificationId: string;
  page?: number;
  perPage?: number;
  status?: string;
  query?: string;
}

interface DeliveryPage {
  data: DeliveryRow[];
  perPage: number;
  currentPage: number;
  totalPages: number;
}

interface DeliveryRow {
  id: string;
  status: 'SUCCESS' | 'FAILED';
  responseCode: number;
  event: string;
  createdAt: Date;
}

interface RouteComponentProps {
  params: { id: string };
}

type ColumnDef<T> = {
  header: string;
  accessorKey: string;
  cell?: (ctx: { row: { original: T } }) => JSX.Element;
};

declare function Badge(props: { variant?: string; children: unknown }): JSX.Element;
declare function Button(props: { variant?: string; asChild?: boolean; children: unknown }): JSX.Element;
declare function Link(props: { to: string; children: unknown }): JSX.Element;
declare function Input(props: { defaultValue: string; onChange: (e: { target: { value: string } }) => void; placeholder: string }): JSX.Element;
declare function Tabs(props: { value: string; className?: string; children: unknown }): JSX.Element;
declare function TabsList(props: { children: unknown }): JSX.Element;
declare function TabsTrigger(props: { value: string; className?: string; asChild?: boolean; children: unknown }): JSX.Element;
declare function DataTable<T>(props: { columns: ColumnDef<T>[]; data: T[]; perPage: number; currentPage: number; totalPages: number; onPaginationChange: (page: number, perPage: number) => void }): JSX.Element;
declare function SettingsHeader(props: { title: unknown; subtitle?: string; children?: unknown }): JSX.Element;
declare function SpinnerBox(props: { className?: string }): JSX.Element;
declare function GenericErrorLayout(props: { errorCode: number; errorCodeMap: Record<number, { heading: string; subHeading: string; message: string }>; primaryButton: unknown; secondaryButton: unknown }): JSX.Element;
declare function NotificationEditDialog(props: { notification: NotificationRecord; trigger: unknown }): JSX.Element;
declare function CheckCircleIcon(props: { className?: string }): JSX.Element;
declare function XCircleIcon(props: { className?: string }): JSX.Element;
declare function ChevronRightIcon(props: { className?: string }): JSX.Element;
declare function PencilIcon(props: { className?: string }): JSX.Element;
declare function toFriendlyEventName(event: string): string;

export default function NotificationDeliveriesPage({ params }: RouteComponentProps) {
  const { toast } = useToast();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const updateSearchParams = useUpdateSearchParams();
  const workspace = useCurrentWorkspace();

  const [searchQuery, setSearchQuery] = useState<string>(
    () => searchParams?.get('query') ?? ''
  );

  const debouncedSearchQuery = useDebouncedValue(searchQuery, 500);

  const parsedPage = Number(searchParams.get('page') ?? '1');
  const parsedPerPage = Number(searchParams.get('perPage') ?? '10');
  const parsedStatus = searchParams.get('status') ?? undefined;

  const { data: notification, isLoading } = trpc.notification.getById.useQuery(
    { id: params.id },
    { enabled: !!params.id, retry: false }
  );

  const {
    data,
    isLoading: isDeliveriesLoading,
    isLoadingError: isDeliveriesLoadingError,
  } = trpc.notification.deliveries.find.useQuery({
    notificationId: params.id,
    page: parsedPage,
    perPage: parsedPerPage,
    status: parsedStatus,
    query: debouncedSearchQuery || undefined,
  });

  useEffect(() => {
    const next = new URLSearchParams(searchParams?.toString());

    next.set('query', debouncedSearchQuery);

    if (debouncedSearchQuery === '') {
      next.delete('query');
    }

    if (next.toString() === searchParams?.toString()) {
      return;
    }

    setSearchParams(next);
  }, [debouncedSearchQuery, pathname, searchParams]);

  const onPaginationChange = (page: number, perPage: number) => {
    updateSearchParams({ page, perPage });
  };

  const results: DeliveryPage = data ?? {
    data: [],
    perPage: 10,
    currentPage: 1,
    totalPages: 1,
  };

  const columns = useMemo((): ColumnDef<DeliveryRow>[] => {
    return [
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => (
          <Badge variant={row.original.status === 'SUCCESS' ? 'default' : 'destructive'}>
            {row.original.status === 'SUCCESS' ? (
              <CheckCircleIcon className="mr-2 h-4 w-4" />
            ) : (
              <XCircleIcon className="mr-2 h-4 w-4" />
            )}
            {row.original.responseCode}
          </Badge>
        ),
      },
      {
        header: 'Event',
        accessorKey: 'event',
        cell: ({ row }) => (
          <div>
            <p className="font-semibold text-foreground text-sm">{toFriendlyEventName(row.original.event)}</p>
            <p className="text-muted-foreground text-xs">{row.original.id}</p>
          </div>
        ),
      },
      {
        header: 'Sent',
        accessorKey: 'createdAt',
        cell: ({ row }) => (
          <div className="flex items-center justify-between gap-2">
            <p>{row.original.createdAt.toLocaleDateString()}</p>
            <div className="opacity-0 transition-opacity group-hover:opacity-100">
              <ChevronRightIcon className="h-4 w-4" />
            </div>
          </div>
        ),
      },
    ];
  }, []);

  const getTabHref = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('status', value);
    if (value === '') {
      next.delete('status');
    }
    if (next.has('page')) {
      next.delete('page');
    }
    let path = pathname;
    if (next.toString()) {
      path += `?${next.toString()}`;
    }
    return path;
  };

  if (isLoading) {
    return <SpinnerBox className="py-32" />;
  }

  if (!notification) {
    return (
      <GenericErrorLayout
        errorCode={404}
        errorCodeMap={{
          404: {
            heading: 'Notification channel not found',
            subHeading: '404 Notification channel not found',
            message:
              'The notification channel you are looking for may have been removed or never existed.',
          },
        }}
        primaryButton={
          <Button asChild>
            <Link to={`/w/${workspace.slug}/settings/notifications`}>Go back</Link>
          </Button>
        }
        secondaryButton={null}
      />
    );
  }

  return (
    <div>
      <SettingsHeader
        title={
          <div className="flex items-center gap-2">
            <p>Notification Channel</p>
            <Badge variant={notification.enabled ? 'default' : 'secondary'}>
              {notification.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>
        }
        subtitle={notification.channelUrl}
      >
        <NotificationEditDialog
          notification={notification}
          trigger={
            <Button>
              <PencilIcon className="mr-2 h-4 w-4" />
              Edit
            </Button>
          }
        />
      </SettingsHeader>

      <div className="mt-4">
        <div className="mb-4 flex flex-row items-center justify-between gap-x-4">
          <Input
            defaultValue={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by delivery ID"
          />

          <Tabs value={parsedStatus ?? ''} className="flex-shrink-0">
            <TabsList>
              <TabsTrigger value="" asChild>
                <Link to={getTabHref('')}>All</Link>
              </TabsTrigger>
              <TabsTrigger value="SUCCESS" asChild>
                <Link to={getTabHref('SUCCESS')}>Success</Link>
              </TabsTrigger>
              <TabsTrigger value="FAILED" asChild>
                <Link to={getTabHref('FAILED')}>Failed</Link>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <DataTable
          columns={columns}
          data={results.data}
          perPage={results.perPage}
          currentPage={results.currentPage}
          totalPages={results.totalPages}
          onPaginationChange={onPaginationChange}
        />
      </div>
    </div>
  );
}
