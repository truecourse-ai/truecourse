
declare const useLingui3: () => { _: (msg: unknown) => string; i18n: { date: (d: Date, opts?: unknown) => string } };
declare const useToast3: () => { toast: (opts: { title: string; variant?: string }) => void };
declare const useSearchParams3: () => [URLSearchParams, unknown];
declare const useUpdateSearchParams3: () => (params: Record<string, string | number | undefined>) => void;
declare const useMemo3: <T>(fn: () => T, deps: unknown[]) => T;
declare const useState3: <T>(init: T) => [T, (v: T) => void];
declare const trpc3: {
  admin: {
    users: {
      findPending: {
        useQuery: (input: unknown, opts?: unknown) => { data: { data: Array<{ id: string; email: string; name: string; createdAt: Date; status: string }>; perPage: number; currentPage: number; totalPages: number } | undefined; isPending: boolean; refetch: () => void };
      };
      activate: {
        useMutation: (opts: { onSuccess: () => void; onError: () => void }) => { mutateAsync: (data: { userId: string }) => Promise<void>; isPending: boolean };
      };
    };
  };
};
declare const Link3: React.ComponentType<{ to: string; className?: string; children: React.ReactNode }>;
declare const DataTable3: React.ComponentType<{ columns: unknown[]; data: unknown[]; skeleton?: unknown; onPaginationChange?: unknown }>;
declare const DataTablePagination3: React.ComponentType<{ perPage: number; currentPage: number; totalPages: number; onPageChange: (page: number) => void; onPerPageChange: (perPage: number) => void }>;
declare const Badge3: React.ComponentType<{ variant?: string; children: React.ReactNode }>;
declare const Button3: React.ComponentType<{ size?: string; loading?: boolean; onClick?: () => void; children: React.ReactNode }>;
declare const msg3: (strings: TemplateStringsArray, ...vals: unknown[]) => unknown;
declare const Loader3: React.ComponentType<{ className?: string }>;
declare const DateTime3: { DATETIME_SHORT: unknown };

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

export function AdminPendingUsersPage() {
  const { _, i18n } = useLingui3();
  const { toast } = useToast3();

  const [searchParams] = useSearchParams3();
  const updateSearchParams = useUpdateSearchParams3();

  const page = searchParams?.get?.('page') ? Number(searchParams.get('page')) : undefined;
  const perPage = searchParams?.get?.('perPage') ? Number(searchParams.get('perPage')) : undefined;

  const {
    data: findPendingData,
    isPending: isLoading,
    refetch,
  } = trpc3.admin.users.findPending.useQuery(
    {
      page: page || 1,
      perPage: perPage || 20,
    },
    {
      placeholderData: (previousData: unknown) => previousData as typeof previousData,
    },
  );

  const { mutateAsync: activateUser, isPending: isActivating } = trpc3.admin.users.activate.useMutation({
    onSuccess: () => {
      toast({ title: _(msg3`User activated`), variant: 'default' });
      void refetch();
    },
    onError: () => {
      toast({ title: _(msg3`Failed to activate user`), variant: 'destructive' });
    },
  });

  const results = findPendingData ?? {
    data: [],
    perPage: 20,
    currentPage: 1,
    totalPages: 1,
  };

  const columns = useMemo3(() => {
    return [
      {
        header: _(msg3`User`),
        accessorKey: 'email',
        cell: ({ row }: { row: { original: { id: string; email: string; name: string } } }) => (
          <Link3 to={`/admin/users/${row.original.id}`}>
            <span className="font-medium">{row.original.name || row.original.email}</span>
          </Link3>
        ),
      },
      {
        header: _(msg3`Email`),
        accessorKey: 'email',
        cell: ({ row }: { row: { original: { email: string } } }) => (
          <span className="text-muted-foreground text-sm">{row.original.email}</span>
        ),
      },
      {
        header: _(msg3`Status`),
        accessorKey: 'status',
        cell: ({ row }: { row: { original: { status: string; createdAt: Date } } }) => {
          const isOld = Date.now() - row.original.createdAt.getTime() > EIGHT_HOURS_MS;

          return (
            <Badge3 variant={isOld ? 'destructive' : 'secondary'}>
              {row.original.status}
            </Badge3>
          );
        },
      },
      {
        header: _(msg3`Registered`),
        accessorKey: 'createdAt',
        cell: ({ row }: { row: { original: { createdAt: Date } } }) =>
          i18n.date(row.original.createdAt, DateTime3.DATETIME_SHORT),
      },
      {
        id: 'actions',
        cell: ({ row }: { row: { original: { id: string } } }) => (
          <Button3
            size="sm"
            loading={isActivating}
            onClick={() => activateUser({ userId: row.original.id })}
          >
            {isActivating ? <Loader3 className="h-4 w-4 animate-spin" /> : _(msg3`Activate`)}
          </Button3>
        ),
      },
    ];
  }, [_, i18n, isActivating]);

  return (
    <div className="mx-auto max-w-screen-xl px-4 md:px-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold">{_(msg3`Pending Users`)}</h1>
      </div>

      <DataTable3 columns={columns} data={results.data} />

      <DataTablePagination3
        perPage={results.perPage}
        currentPage={results.currentPage}
        totalPages={results.totalPages}
        onPageChange={(newPage) => updateSearchParams({ page: newPage })}
        onPerPageChange={(newPerPage) => updateSearchParams({ perPage: newPerPage, page: 1 })}
      />
    </div>
  );
}



declare const useUpdateSearchParams49: () => (params: Record<string, string | number | undefined>) => void;
declare const useLingui49: () => { _: (msg: unknown) => string; i18n: { date: (d: Date, opts?: unknown) => string } };
declare const useToast49: () => { toast: (opts: { title: string; variant?: string }) => void };
declare const trpc49: {
  admin: {
    template: {
      findDraft: {
        useQuery: (input: unknown, opts?: unknown) => { data: { data: Array<{ id: string; title: string; teamId: number; createdAt: Date; updatedAt: Date }>; perPage: number; currentPage: number; totalPages: number } | undefined; isPending: boolean; refetch: () => void };
      };
      publish: {
        useMutation: (opts: { onSuccess: () => void; onError: () => void }) => { mutateAsync: (data: { templateId: string }) => Promise<void>; isPending: boolean };
      };
    };
  };
};
declare const useSearchParams49: () => [URLSearchParams, unknown];
declare const useMemo49: <T>(fn: () => T, deps: unknown[]) => T;
declare const Link49: React.ComponentType<{ to: string; className?: string; children: React.ReactNode }>;
declare const DataTable49: React.ComponentType<{ columns: unknown[]; data: unknown[] }>;
declare const DataTablePagination49: React.ComponentType<{ perPage: number; currentPage: number; totalPages: number; onPageChange: (p: number) => void; onPerPageChange: (pp: number) => void }>;
declare const Button49: React.ComponentType<{ size?: string; loading?: boolean; onClick?: () => void; children: React.ReactNode }>;
declare const Loader249: React.ComponentType<{ className?: string }>;
declare const msg49: (strings: TemplateStringsArray, ...vals: unknown[]) => unknown;
declare const DateTime49: { DATETIME_SHORT: unknown };
declare const SIX_HOURS_MS49: number;

export default function AdminDraftTemplatesPage49() {
  const { _, i18n } = useLingui49();
  const { toast } = useToast49();
  const [searchParams] = useSearchParams49();
  const updateSearchParams = useUpdateSearchParams49();

  const page = searchParams?.get?.('page') ? Number(searchParams.get('page')) : undefined;
  const perPage = searchParams?.get?.('perPage') ? Number(searchParams.get('perPage')) : undefined;

  const {
    data: findDraftData,
    isPending: isLoading,
    refetch,
  } = trpc49.admin.template.findDraft.useQuery(
    { page: page || 1, perPage: perPage || 20 },
    { placeholderData: (prev: unknown) => prev as typeof prev },
  );

  const { mutateAsync: publishTemplate, isPending: isPublishing } = trpc49.admin.template.publish.useMutation({
    onSuccess: () => {
      toast({ title: _(msg49`Template published`), variant: 'default' });
      void refetch();
    },
    onError: () => {
      toast({ title: _(msg49`Failed to publish template`), variant: 'destructive' });
    },
  });

  const results = findDraftData ?? {
    data: [],
    perPage: 20,
    currentPage: 1,
    totalPages: 1,
  };

  const columns = useMemo49(() => {
    return [
      {
        header: _(msg49`Template`),
        accessorKey: 'title',
        cell: ({ row }: { row: { original: { id: string; title: string } } }) => (
          <Link49 to={`/admin/templates/${row.original.id}`} className="font-medium hover:underline">
            {row.original.title}
          </Link49>
        ),
      },
      {
        header: _(msg49`Updated`),
        accessorKey: 'updatedAt',
        cell: ({ row }: { row: { original: { updatedAt: Date } } }) =>
          i18n.date(row.original.updatedAt, DateTime49.DATETIME_SHORT),
      },
      {
        id: 'actions',
        cell: ({ row }: { row: { original: { id: string } } }) => (
          <Button49
            size="sm"
            loading={isPublishing}
            onClick={() => publishTemplate({ templateId: row.original.id })}
          >
            {isPublishing ? <Loader249 className="h-4 w-4 animate-spin" /> : _(msg49`Publish`)}
          </Button49>
        ),
      },
    ];
  }, [_, i18n, isPublishing]);

  return (
    <div className="mx-auto max-w-screen-xl px-4 md:px-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold">{_(msg49`Draft Templates`)}</h1>
      </div>

      <DataTable49 columns={columns} data={results.data} />

      <DataTablePagination49
        perPage={results.perPage}
        currentPage={results.currentPage}
        totalPages={results.totalPages}
        onPageChange={(p) => updateSearchParams({ page: p })}
        onPerPageChange={(pp) => updateSearchParams({ perPage: pp, page: 1 })}
      />
    </div>
  );
}
