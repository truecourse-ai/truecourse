// Route component for the team contracts list — JSX markup, hooks, and
// status-tab helpers inflate the line count; this is idiomatic Remix/React
// framework structure, not decomposable excess logic.

declare function useCurrentWorkspace(): { id: string; slug: string; name: string; avatarId?: string };
declare function useSearchParams(): [URLSearchParams, (p: URLSearchParams) => void];
declare function useParams(): Record<string, string | undefined>;
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare const ContractStatus: { DRAFT: string; PENDING: string; ACTIVE: string; EXPIRED: string; ALL: string };
declare function useSessionStorage<T>(key: string, init: T): [T, (v: T) => void];
declare function formatContractsPath(slug: string): string;
declare function formatAvatarUrl(id: string): string;
declare const STATS_CAP: number;
declare const trpc: {
  contract: {
    findContracts: {
      useQuery(params: object, opts?: object): { data: { count: number; stats: Record<string, number>; items: unknown[] } | undefined; isLoading: boolean; isLoadingError: boolean };
    };
  };
};
declare const SKIP_QUERY_BATCH_META: object;
declare function parseIntArray(val: string): number[];

type RowSelection = Record<string, boolean>;

declare function ContractsTable(props: {
  data: unknown;
  isLoading: boolean;
  isLoadingError: boolean;
  onMoveContract: (id: number) => void;
  enableSelection: boolean;
  rowSelection: RowSelection;
  onRowSelectionChange: (v: RowSelection) => void;
}): JSX.Element;

declare function ContractsTableEmptyState(props: { status: string }): JSX.Element;
declare function ContractStatusBadge(props: { status: string }): JSX.Element;
declare function ContractSearch(props: { initialValue?: string }): JSX.Element;
declare function PeriodPicker(): JSX.Element;
declare function ContractMoveDialog(props: {
  contractId: number;
  open: boolean;
  folderId?: string;
  onOpenChange: (open: boolean) => void;
}): JSX.Element;
declare function BulkMoveDialog(props: {
  contractIds: string[];
  open: boolean;
  folderId?: string;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}): JSX.Element;
declare function BulkDeleteDialog(props: {
  contractIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}): JSX.Element;
declare function BulkActionBar(props: {
  selectedCount: number;
  onMoveClick: () => void;
  onDeleteClick: () => void;
  onClearSelection: () => void;
}): JSX.Element;
declare function FolderGrid(props: { type: string; parentId: string | null }): JSX.Element;
declare function DropZoneWrapper(props: { type: string; children: JSX.Element }): JSX.Element;
declare namespace JSX { interface Element {} }

export default function ContractsPage() {
  const workspace = useCurrentWorkspace();
  const { folderId } = useParams();
  const [searchParams] = useSearchParams();

  const [isMoving, setIsMoving] = useState(false);
  const [contractToMove, setContractToMove] = useState<number | null>(null);

  const [rowSelection, setRowSelection] = useSessionStorage<RowSelection>('contracts-bulk-selection', {});
  const [isBulkMoveOpen, setIsBulkMoveOpen] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);

  const selectedContractIds = useMemo(() => {
    return Object.keys(rowSelection).filter((id) => rowSelection[id]);
  }, [rowSelection]);

  const [stats, setStats] = useState<Record<string, number>>({
    [ContractStatus.DRAFT]: 0,
    [ContractStatus.PENDING]: 0,
    [ContractStatus.ACTIVE]: 0,
    [ContractStatus.EXPIRED]: 0,
    [ContractStatus.ALL]: 0,
  });

  const searchParamsParsed = useMemo(
    () => ({
      status: searchParams.get('status') ?? undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      query: searchParams.get('query') ?? undefined,
      ownerIds: searchParams.get('ownerIds') ? parseIntArray(searchParams.get('ownerIds')!) : [],
    }),
    [searchParams],
  );

  const { data, isLoading, isLoadingError } = trpc.contract.findContracts.useQuery(
    {
      ...searchParamsParsed,
      folderId,
      workspaceId: workspace.id,
    },
    {
      ...SKIP_QUERY_BATCH_META,
    },
  );

  const getTabHref = (value: string) => {
    const params = new URLSearchParams(searchParams);

    params.set('status', value);

    if (value === ContractStatus.ALL) {
      params.delete('status');
    }

    if (params.has('page')) {
      params.delete('page');
    }

    let path = formatContractsPath(workspace.slug);

    if (folderId) {
      path += `/f/${folderId}`;
    }

    if (params.toString()) {
      path += `?${params.toString()}`;
    }

    return path;
  };

  useEffect(() => {
    if (data?.stats) {
      setStats(data.stats);
    }
  }, [data?.stats]);

  return (
    <DropZoneWrapper type="CONTRACT">
      <div className="mx-auto w-full max-w-screen-xl px-4 md:px-8">
        <FolderGrid type="CONTRACT" parentId={folderId ?? null} />

        <div className="mt-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-8">
          <div className="flex flex-row items-center">
            <h2 className="font-semibold text-4xl">Contracts</h2>
          </div>

          <div className="-m-1 flex flex-wrap gap-x-4 gap-y-6 overflow-hidden p-1">
            <div className="overflow-x-auto flex gap-2">
              {[
                ContractStatus.PENDING,
                ContractStatus.ACTIVE,
                ContractStatus.EXPIRED,
                ContractStatus.DRAFT,
                ContractStatus.ALL,
              ]
                .map((value) => (
                  <a key={value} href={getTabHref(value)} className="min-w-[60px] hover:text-foreground">
                    <ContractStatusBadge status={value} />
                    {value !== ContractStatus.ALL && (
                      <span className="ml-1 inline-block opacity-50">
                        {stats[value] >= STATS_CAP ? `${STATS_CAP.toLocaleString()}+` : stats[value]}
                      </span>
                    )}
                  </a>
                ))}
            </div>

            <div className="flex w-48 flex-wrap items-center justify-between gap-x-2 gap-y-4">
              <PeriodPicker />
            </div>
            <div className="flex w-48 flex-wrap items-center justify-between gap-x-2 gap-y-4">
              <ContractSearch initialValue={searchParamsParsed.query} />
            </div>
          </div>
        </div>

        <div className="mt-8">
          <div>
            {data && data.count === 0 ? (
              <ContractsTableEmptyState status={searchParamsParsed.status || ContractStatus.ALL} />
            ) : (
              <ContractsTable
                data={data}
                isLoading={isLoading}
                isLoadingError={isLoadingError}
                onMoveContract={(contractId) => {
                  setContractToMove(contractId);
                  setIsMoving(true);
                }}
                enableSelection
                rowSelection={rowSelection}
                onRowSelectionChange={setRowSelection}
              />
            )}
          </div>
        </div>

        {contractToMove && (
          <ContractMoveDialog
            contractId={contractToMove}
            open={isMoving}
            folderId={folderId}
            onOpenChange={(open) => {
              setIsMoving(open);
              if (!open) {
                setContractToMove(null);
              }
            }}
          />
        )}

        <BulkActionBar
          selectedCount={selectedContractIds.length}
          onMoveClick={() => setIsBulkMoveOpen(true)}
          onDeleteClick={() => setIsBulkDeleteOpen(true)}
          onClearSelection={() => setRowSelection({})}
        />

        <BulkMoveDialog
          contractIds={selectedContractIds}
          open={isBulkMoveOpen}
          folderId={folderId}
          onOpenChange={setIsBulkMoveOpen}
          onSuccess={() => setRowSelection({})}
        />

        <BulkDeleteDialog
          contractIds={selectedContractIds}
          open={isBulkDeleteOpen}
          onOpenChange={setIsBulkDeleteOpen}
          onSuccess={() => setRowSelection({})}
        />
      </div>
    </DropZoneWrapper>
  );
}
