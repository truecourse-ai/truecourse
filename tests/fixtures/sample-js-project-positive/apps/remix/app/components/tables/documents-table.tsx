
declare const useLingui7: () => { _: (msg: unknown) => string; i18n: { date: (d: unknown, opts?: unknown) => string } };
declare const useCurrentTeam2: () => { url?: string; teamEmail?: { email: string } | null };
declare const useTransition2: () => [boolean, (fn: () => void) => void];
declare const useUpdateSearchParams5: () => (params: Record<string, string | number>) => void;
declare const useMemo6: <T>(fn: () => T, deps: unknown[]) => T;
declare const Checkbox2: React.FC<{ checked?: boolean; onCheckedChange?: (v: boolean) => void; 'aria-label'?: string; onClick?: (e: React.MouseEvent) => void }>;
declare const DocumentStatus2: React.FC<{ status: string }>;
declare const DataTableTitle2: React.FC<{ row: unknown; teamUrl?: string; teamEmail?: string }>;
declare const StackAvatarsWithTooltip2: React.FC<{ recipients: unknown[]; documentStatus: string }>;
declare const DocumentsTableActionDropdown2: React.FC<{ row: unknown; onMoveDocument?: () => void }>;
declare const DataTable6: React.FC<{ columns: unknown[]; data: unknown[]; skeleton?: unknown; pagination?: unknown }>;
declare const Skeleton6: React.FC<{ className?: string }>;
declare const TableCell6: React.FC<{ children?: React.ReactNode }>;
declare const msg6: (strings: TemplateStringsArray) => unknown;
declare const DateTime2: { DATETIME_SHORT: unknown };
declare const RowSelectionState2: unknown;
declare const React: { FC: unknown; ReactNode: unknown; MouseEvent: unknown };

type DocumentsTableRow2 = {
  id: string;
  createdAt: Date;
  status: string;
  completedAt?: Date | null;
  deletedAt?: Date | null;
  user: { id: string; name?: string | null; email: string };
  recipients: Array<{ id: string; email: string; signingStatus: string; role: string; token: string }>;
  team?: { url: string } | null;
  envelopeId: string;
};

export const DocumentsTable2 = ({
  data,
  isLoading,
  isLoadingError,
  onMoveDocument,
  enableSelection,
  rowSelection,
  onRowSelectionChange,
}: {
  data: DocumentsTableRow2[];
  isLoading: boolean;
  isLoadingError: boolean;
  onMoveDocument?: () => void;
  enableSelection?: boolean;
  rowSelection?: Record<string, boolean>;
  onRowSelectionChange?: (sel: Record<string, boolean>) => void;
}) => {
  const { _, i18n } = useLingui7();
  const team = useCurrentTeam2();
  const [isPending, startTransition] = useTransition2();
  const updateSearchParams = useUpdateSearchParams5();

  const columns = useMemo6(() => {
    const cols: unknown[] = [];

    if (enableSelection) {
      cols.push({
        id: 'select',
        header: ({ table }: { table: { getIsAllPageRowsSelected: () => boolean; toggleAllPageRowsSelected: (v: boolean) => void } }) => (
          <Checkbox2
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label={_(msg6`Select all`)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        cell: ({ row }: { row: { getIsSelected: () => boolean; toggleSelected: (v: boolean) => void } }) => (
          <Checkbox2
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label={_(msg6`Select row`)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        enableSorting: false,
        enableHiding: false,
        size: 40,
      });
    }

    cols.push(
      {
        header: _(msg6`Created`),
        accessorKey: 'createdAt',
        cell: ({ row }: { row: { original: DocumentsTableRow2 } }) =>
          i18n.date(row.original.createdAt, { ...DateTime2.DATETIME_SHORT, hourCycle: 'h12' }),
      },
      {
        header: _(msg6`Title`),
        cell: ({ row }: { row: { original: DocumentsTableRow2 } }) => (
          <DataTableTitle2 row={row.original} teamUrl={team?.url} teamEmail={team?.teamEmail?.email} />
        ),
      },
      {
        id: 'sender',
        header: _(msg6`Sender`),
        cell: ({ row }: { row: { original: DocumentsTableRow2 } }) =>
          row.original.user.name ?? row.original.user.email,
      },
      {
        header: _(msg6`Recipient`),
        accessorKey: 'recipient',
        cell: ({ row }: { row: { original: DocumentsTableRow2 } }) => (
          <StackAvatarsWithTooltip2 recipients={row.original.recipients} documentStatus={row.original.status} />
        ),
      },
      {
        header: _(msg6`Status`),
        accessorKey: 'status',
        cell: ({ row }: { row: { original: DocumentsTableRow2 } }) => <DocumentStatus2 status={row.original.status} />,
        size: 140,
      },
      {
        header: _(msg6`Actions`),
        cell: ({ row }: { row: { original: DocumentsTableRow2 } }) => (
          <DocumentsTableActionDropdown2 row={row.original} onMoveDocument={onMoveDocument} />
        ),
      },
    );

    return cols;
  }, [_, enableSelection, i18n, onMoveDocument, team]);

  return (
    <DataTable6
      columns={columns}
      data={data}
      skeleton={{
        enabled: isLoading,
        rows: 5,
        component: (
          <>
            {enableSelection && <TableCell6><Skeleton6 className="h-4 w-4" /></TableCell6>}
            <TableCell6><Skeleton6 className="h-4 w-20" /></TableCell6>
            <TableCell6><Skeleton6 className="h-4 w-32" /></TableCell6>
            <TableCell6><Skeleton6 className="h-4 w-24" /></TableCell6>
            <TableCell6><Skeleton6 className="h-4 w-24" /></TableCell6>
            <TableCell6><Skeleton6 className="h-4 w-16" /></TableCell6>
            <TableCell6><Skeleton6 className="h-8 w-8 rounded" /></TableCell6>
          </>
        ),
      }}
    />
  );
};
