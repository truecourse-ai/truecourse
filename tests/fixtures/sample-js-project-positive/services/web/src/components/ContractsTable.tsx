import { useMemo, useTransition } from 'react';

declare const Link: (props: { to: string; className?: string; children?: unknown }) => JSX.Element;
declare const Tooltip: (props: { children?: unknown }) => JSX.Element;
declare const TooltipTrigger: (props: { children?: unknown }) => JSX.Element;
declare const TooltipContent: (props: { className?: string; children?: unknown }) => JSX.Element;
declare const Checkbox: (props: { checked?: boolean; onCheckedChange?: (v: boolean) => void; 'aria-label'?: string }) => JSX.Element;
declare const DataTable: (props: { columns: unknown; data: unknown; perPage: number; currentPage: number; totalPages: number; getRowId: (row: { contractId: string }) => string; children?: unknown }) => JSX.Element;
declare const DataTablePagination: (props: { table: unknown }) => JSX.Element;
declare const InfoIcon: (props: { className?: string }) => JSX.Element;
declare const LockIcon: (props: { className?: string }) => JSX.Element;
declare const Globe2Icon: (props: { className?: string }) => JSX.Element;
declare const Loader: (props: { className?: string }) => JSX.Element;
declare const ContractTypeBadge: (props: { type: string }) => JSX.Element;
declare const ContractActions: (props: { row: ContractRow }) => JSX.Element;
declare function formatContractsPath(orgSlug: string): string;

type ContractRow = {
  contractId: string;
  title: string;
  type: 'PUBLIC' | 'TEAM' | 'PRIVATE';
  createdAt: Date;
  owner: { name: string };
};

type ContractsTableProps = {
  data?: { rows: ContractRow[]; perPage: number; currentPage: number; totalPages: number };
  isLoading?: boolean;
  documentRootPath: string;
  orgSlug: string;
  enableSelection?: boolean;
};

export const ContractsTable = ({
  data,
  isLoading,
  documentRootPath,
  orgSlug,
  enableSelection,
}: ContractsTableProps): JSX.Element => {
  const [isPending, startTransition] = useTransition();

  const formatContractLink = (row: ContractRow): string => {
    const path = formatContractsPath(orgSlug);
    return `${path}/${row.contractId}`;
  };

  const columns = useMemo(() => {
    const cols: Array<{ id?: string; header: unknown; cell?: unknown; accessorKey?: string }> = [];

    if (enableSelection) {
      cols.push({
        id: 'select',
        header: (
          <Checkbox
            checked={false}
            onCheckedChange={(value) => void value}
            aria-label="Select all"
          />
        ),
        cell: (
          <Checkbox
            checked={false}
            onCheckedChange={(value) => void value}
            aria-label="Select row"
          />
        ),
      });
    }

    cols.push(
      {
        header: 'Created',
        accessorKey: 'createdAt',
        cell: (row: ContractRow) => row.createdAt.toISOString(),
      },
      {
        header: 'Title',
        cell: (row: ContractRow) => (
          <Link
            to={formatContractLink(row)}
            className="block max-w-[10rem] cursor-pointer truncate font-medium hover:underline md:max-w-[20rem]"
          >
            {row.title}
          </Link>
        ),
      },
      {
        header: (
          <div className="flex flex-row items-center">
            <span>Type</span>
            <Tooltip>
              <TooltipTrigger>
                <InfoIcon className="mx-2 h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent className="!p-0 max-w-md space-y-2 text-foreground">
                <ul className="space-y-0.5 divide-y text-muted-foreground [&>li]:p-4">
                  <li>
                    <h2 className="mb-2 flex flex-row items-center font-semibold">
                      <Globe2Icon className="mr-2 h-5 w-5 text-green-500 dark:text-green-300" />
                      <span>Public</span>
                    </h2>
                    <p>Public contracts are visible to anyone with the share link.</p>
                  </li>
                  <li>
                    <h2 className="mb-2 flex flex-row items-center font-semibold">
                      <LockIcon className="mr-2 h-5 w-5 text-blue-600 dark:text-blue-300" />
                      <span>Private</span>
                    </h2>
                    <p>Private contracts are visible only to the contract owner.</p>
                  </li>
                </ul>
              </TooltipContent>
            </Tooltip>
          </div>
        ),
        accessorKey: 'type',
        cell: (row: ContractRow) => (
          <div className="flex flex-row items-center">
            <ContractTypeBadge type={row.type} />
          </div>
        ),
      },
      {
        header: 'Actions',
        accessorKey: 'actions',
        cell: (row: ContractRow) => (
          <div className="flex items-center gap-x-4">
            <ContractActions row={row} />
          </div>
        ),
      },
    );

    return cols;
  }, [documentRootPath, orgSlug, enableSelection]);

  const onPaginationChange = (page: number, perPage: number): void => {
    startTransition(() => {
      void page;
      void perPage;
    });
  };

  const results = data ?? {
    rows: [],
    perPage: 10,
    currentPage: 1,
    totalPages: 1,
  };

  return (
    <div className="relative">
      <DataTable
        columns={columns}
        data={results.rows}
        perPage={results.perPage}
        currentPage={results.currentPage}
        totalPages={results.totalPages}
        getRowId={(row) => row.contractId}
      >
        {(table: unknown) => <DataTablePagination table={table} />}
      </DataTable>

      {isPending && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50">
          <Loader className="h-8 w-8 animate-spin text-gray-500" />
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span>Loading contracts...</span>
        </div>
      )}
    </div>
  );
};
