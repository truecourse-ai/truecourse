
declare function useQuery<T>(key: unknown, opts?: { placeholderData?: (prev: T | undefined) => T | undefined }): { data: T | undefined; isLoading: boolean };
declare const trpc: { team: { member: { invite: { find: { useQuery: typeof useQuery } } } } };
declare function useCurrentTeam(): { id: string };

type InviteStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED';
type UrlParams = { query?: string; page?: number; perPage?: number };

declare const parsedSearchParams: UrlParams;

function MemberInvitesTable() {
  const team = useCurrentTeam();

  const { data, isLoading } = trpc.team.member.invite.find.useQuery(
    {
      teamId: team.id,
      query: parsedSearchParams.query,
      page: parsedSearchParams.page,
      perPage: parsedSearchParams.perPage,
      status: 'PENDING' as InviteStatus,
    },
    {
      placeholderData: (previousData) => previousData,
    },
  );

  return { data, isLoading };
}



// Detect non-page paths that should skip layout (API routes, static assets)
const NON_PAGE_PATH_PATTERN = /^\/(_next|api|static|_vercel)\//;

export function isNonPageRequest(pathname: string): boolean {
  return NON_PAGE_PATH_PATTERN.test(pathname);
}



declare const webhookEventLog: Array<{ type: string; payload: unknown; timestamp: number }>;

// Debug playground: display raw webhook event data as formatted JSON
export function renderWebhookEventDebugView(eventIndex: number): string {
  const event = webhookEventLog[eventIndex];

  if (!event) {
    return 'No event found at index ' + eventIndex;
  }

  const formatted = JSON.stringify(event.payload, null, 2);

  return `[${event.type}] ${formatted}`;
}



import * as _superjson from 'superjson';

export function encodeLoaderData<T>(data: T): string {
  return _superjson.stringify(data);
}

export function decodeLoaderData<T>(encoded: string): T {
  return _superjson.parse<T>(encoded);
}

export function safeDecodeLoaderData<T>(encoded: string, fallback: T): T {
  try {
    return _superjson.parse<T>(encoded);
  } catch {
    return fallback;
  }
}



declare function useMutation<TData, TVars>(opts: {
  onSuccess?: () => void;
  onError?: () => void;
}): { mutateAsync: (vars: TVars) => Promise<TData> };
declare const trpcClient: {
  workspace: {
    member: {
      invite: {
        find: { useQuery: typeof useQuery };
        resend: { useMutation: typeof useMutation };
        revoke: { useMutation: typeof useMutation };
      };
    };
  };
};
declare function useCurrentWorkspace(): { id: string; slug: string };
declare function useUpdateSearchParams(): (params: Record<string, string | number | undefined>) => void;
declare const ZInviteSearchParamsSchema: { parse: (input: unknown) => { query?: string; page?: number; perPage?: number } };
declare function useToast(): { toast: (opts: { title: string; description?: string }) => void };
declare function useSearchParams(): [URLSearchParams, (params: URLSearchParams) => void];
declare const MoreVertical: unknown;
declare const RefreshCw: unknown;
declare const XCircle: unknown;

declare function msgTag(strings: TemplateStringsArray, ...values: unknown[]): string;
declare function useI18n(): { _: (msg: string) => string };

export const WorkspaceMemberInvitesTable = () => {
  const [searchParams] = useSearchParams();
  const updateSearchParams = useUpdateSearchParams();
  const workspace = useCurrentWorkspace();

  const { _ } = useI18n();
  const { toast } = useToast();

  const parsedParams = ZInviteSearchParamsSchema.parse(Object.fromEntries(searchParams ?? []));

  const { data, isLoading, isLoadingError } = trpcClient.workspace.member.invite.find.useQuery(
    {
      workspaceId: workspace.id,
      query: parsedParams.query,
      page: parsedParams.page,
      perPage: parsedParams.perPage,
      status: 'PENDING',
    },
    {
      placeholderData: (previousData) => previousData,
    },
  );

  const { mutateAsync: resendInvitation } = trpcClient.workspace.member.invite.resend.useMutation({
    onSuccess: () => {
      toast({
        title: _('Success'),
        description: _('Invitation has been resent'),
      });
    },
    onError: () => {
      toast({
        title: _('Error'),
        description: _('Failed to resend the invitation'),
      });
    },
  });

  const { mutateAsync: revokeInvitation } = trpcClient.workspace.member.invite.revoke.useMutation({
    onSuccess: () => {
      toast({
        title: _('Success'),
        description: _('Invitation has been revoked'),
      });
    },
    onError: () => {
      toast({
        title: _('Error'),
        description: _('Failed to revoke the invitation'),
      });
    },
  });

  const columns = [
    {
      id: 'email',
      header: _('Email'),
      cell: ({ row }: { row: { original: { email: string; status: string } } }) => (
        row.original.email
      ),
    },
    {
      id: 'status',
      header: _('Status'),
      cell: ({ row }: { row: { original: { email: string; status: string } } }) => (
        row.original.status
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }: { row: { original: { id: string; email: string; status: string } } }) => (
        row.original.id
      ),
    },
  ];

  const onPaginationChange = (page: number, perPage: number) => {
    updateSearchParams({ page, perPage });
  };

  return { data, isLoading, isLoadingError, columns, onPaginationChange, resendInvitation, revokeInvitation };
};
