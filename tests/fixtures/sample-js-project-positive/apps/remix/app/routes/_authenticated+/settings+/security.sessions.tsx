
declare function useSessionList(): { sessions: Array<{ id: string; device: string; lastActive: string; current: boolean }>; revokeSession(id: string): Promise<void> };

export default function SecuritySessionsPage() {
  const { sessions, revokeSession } = useSessionList();

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Active Sessions</h2>
      <ul className="divide-y rounded-md border">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{session.device}</p>
              <p className="text-sm text-muted-foreground">{session.lastActive}</p>
            </div>
            {!session.current && (
              <button
                className="text-sm text-destructive"
                onClick={() => void revokeSession(session.id)}
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}



declare const useLingui26: () => { t: (strings: TemplateStringsArray, ...vals: unknown[]) => string };
declare const useSession26: () => { session: { id: string } | null };
declare const useQuery26: (opts: unknown) => { data: { sessions: Array<{ id: string; userAgent: string | null; createdAt: Date; lastActiveAt: Date }> } | null; isLoading: boolean; refetch: () => void };
declare const useState26: <T>(init: T) => [T, (v: T) => void];
declare const useMemo26: <T>(fn: () => T, deps: unknown[]) => T;
declare const UAParser26: new () => { setUA: (ua: string) => void; getResult: () => { browser: { name?: string }; os: { name?: string } } };
declare const DateTime26: { DATETIME_SHORT: unknown };
declare const authClient26: { getSessions: () => Promise<{ sessions: Array<{ id: string; userAgent: string | null; createdAt: Date; lastActiveAt: Date }> }>; revokeSession: (opts: { sessionId: string }) => Promise<void>; revokeOtherSessions: () => Promise<void> };
declare const Badge26: React.ComponentType<{ children: React.ReactNode }>;
declare const Button26: React.ComponentType<{ size?: string; variant?: string; loading?: boolean; onClick?: () => void; children: React.ReactNode }>;
declare const DataTable26: React.ComponentType<{ columns: unknown[]; data: unknown[] }>;
declare const DataTablePagination26: React.ComponentType<unknown>;
declare const Skeleton26: React.ComponentType<{ className?: string }>;
declare const TableCell26: React.ComponentType<{ colSpan?: number; className?: string; children?: React.ReactNode }>;
declare const SettingsHeader26: React.ComponentType<{ title: React.ReactNode; subtitle?: React.ReactNode }>;
declare const SessionRevokeAllDialog26: React.ComponentType;
declare const appMetaTags26: (title: unknown) => unknown[];

const uaParser26 = new UAParser26();

export function meta26() {
  return appMetaTags26('Active Sessions');
}

export default function SecuritySessionsPage26() {
  const { t } = useLingui26();
  const { data, isLoading, refetch } = useQuery26({
    queryKey: ['active-sessions'],
    queryFn: async () => await authClient26.getSessions(),
  });
  const { session } = useSession26();

  const sessions = data?.sessions ?? [];

  const columns = useMemo26(() => {
    return [
      {
        header: t`Device`,
        accessorKey: 'userAgent',
        cell: ({ row }: { row: { original: { id: string; userAgent: string | null } } }) => {
          const ua = row.original.userAgent || '';
          uaParser26.setUA(ua);
          const result = uaParser26.getResult();
          const browser = result.browser.name || t`Unknown`;
          const os = result.os.name || t`Unknown`;
          const isCurrent = row.original.id === session?.id;
          return (
            <div className="flex items-center gap-2">
              <span>{browser} ({os})</span>
              {isCurrent && <Badge26>Current</Badge26>}
            </div>
          );
        },
      },
      {
        header: t`Last active`,
        accessorKey: 'lastActiveAt',
        cell: ({ row }: { row: { original: { lastActiveAt: Date } } }) =>
          row.original.lastActiveAt.toLocaleDateString(),
      },
      {
        id: 'actions',
        cell: ({ row }: { row: { original: { id: string } } }) => {
          const isCurrent = row.original.id === session?.id;
          return (
            <Button26
              size="sm"
              variant="ghost"
              onClick={async () => {
                await authClient26.revokeSession({ sessionId: row.original.id });
                void refetch();
              }}
            >
              {isCurrent ? t`Sign out` : t`Revoke`}
            </Button26>
          );
        },
      },
    ];
  }, [session?.id, t, refetch]);

  return (
    <div className="space-y-8">
      <SettingsHeader26 title={t`Active Sessions`} subtitle={t`Manage devices that are signed in to your account`} />
      <DataTable26 columns={columns} data={sessions} />
      <SessionRevokeAllDialog26 />
    </div>
  );
}



declare const authClient2: { getSessions: () => Promise<{ sessions: Array<{ id: string; userAgent?: string; createdAt: Date; expiresAt: Date; current?: boolean }> }> };
declare const useSession2: () => { session: { id: string } | null };
declare const useQuery2: <T>(opts: { queryKey: string[]; queryFn: () => Promise<T> }) => { data: T | undefined; isLoading: boolean; isLoadingError: boolean; refetch: () => Promise<unknown> };
declare const useMemo3: <T>(fn: () => T, deps: unknown[]) => T;
declare const useState3: <T>(v: T) => [T, (v: T) => void];
declare const SessionRevokeAllDialog: React.FC<{ onSuccess: () => void }>;
declare const SettingsHeader2: React.FC<{ title: string; subtitle?: string }>;
declare const DataTable3: React.FC<{ columns: unknown[]; data: unknown[]; skeleton?: unknown }>;
declare const Skeleton3: React.FC<{ className?: string }>;
declare const Badge3: React.FC<{ variant?: string; className?: string; children?: React.ReactNode }>;
declare const msg3: (strings: TemplateStringsArray) => unknown;
declare const UAParser2: new () => { setUA: (ua: string) => void; getResult: () => { browser: { name?: string }; os: { name?: string } } };
declare const appMetaTags2: (title: unknown) => unknown[];
declare const React: { FC: unknown; ReactNode: unknown };

export function activeSessionsMeta() {
  return appMetaTags2(msg3`Active Sessions`);
}

const parser2 = new UAParser2();

export default function ActiveSessionsPage() {
  const { data, isLoading, isLoadingError, refetch } = useQuery2({
    queryKey: ['active-sessions-v2'],
    queryFn: async () => await authClient2.getSessions(),
  });

  const { session } = useSession2();
  const results = data?.sessions ?? [];

  const columns = useMemo3(() => [
    {
      header: 'Device',
      accessorKey: 'userAgent',
      cell: ({ row }: { row: { original: { userAgent?: string } } }) => {
        const ua = row.original.userAgent || '';
        parser2.setUA(ua);
        const result = parser2.getResult();
        return <span>{result.browser.name} on {result.os.name}</span>;
      },
    },
    {
      header: 'Created',
      accessorKey: 'createdAt',
      cell: ({ row }: { row: { original: { createdAt: Date } } }) => (
        <span>{row.original.createdAt.toLocaleDateString()}</span>
      ),
    },
    {
      header: 'Status',
      accessorKey: 'current',
      cell: ({ row }: { row: { original: { current?: boolean } } }) => (
        row.original.current ? <Badge3 variant="default">Current</Badge3> : null
      ),
    },
  ], []);

  return (
    <div>
      <SettingsHeader2 title="Active Sessions" subtitle="Manage your active sessions" />

      <SessionRevokeAllDialog onSuccess={() => refetch()} />

      <DataTable3
        columns={columns}
        data={results}
        skeleton={{
          enabled: isLoading,
          rows: 5,
          component: <Skeleton3 className="h-4 w-full" />,
        }}
      />
    </div>
  );
}


// argument-type-mismatch FP: DateTime.fromJSDate accepts Date; row.original.updatedAt is Date — no mismatch
declare const DateTime_bd: { fromJSDate(date: Date): { toRelative(): string | null } };
declare const useLingui_bd: () => { t: (strings: TemplateStringsArray, ...vals: unknown[]) => string };
declare const useMemo_bd: <T>(fn: () => T, deps: unknown[]) => T;

export function useSessionTableColumns_bd() {
  const { t } = useLingui_bd();
  return useMemo_bd(() => [
    {
      header: t`Last Active`,
      accessorKey: 'updatedAt',
      cell: ({ row }: { row: { original: { updatedAt: Date } } }) =>
        DateTime_bd.fromJSDate(row.original.updatedAt).toRelative(),
    },
    {
      header: t`Created`,
      accessorKey: 'createdAt',
      cell: ({ row }: { row: { original: { createdAt: Date } } }) =>
        DateTime_bd.fromJSDate(row.original.createdAt).toRelative(),
    },
  ], [t]);
}

