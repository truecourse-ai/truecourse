
// FP shape f80330e4111c: useMemo columns definition with Checkbox onCheckedChange toggling — no type mismatch
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare const _: (msg: string) => string;

function useTableColumns() {
  const columns = useMemo(() => {
    return [
      {
        id: 'select',
        header: ({ table }: { table: { getIsAllPageRowsSelected: () => boolean; toggleAllPageRowsSelected: (v: boolean) => void } }) => (
          <input
            type="checkbox"
            checked={table.getIsAllPageRowsSelected()}
            onChange={(e) => table.toggleAllPageRowsSelected(!!e.target.checked)}
            aria-label={_('Select all')}
          />
        ),
        cell: ({ row }: { row: { getIsSelected: () => boolean; toggleSelected: (v: boolean) => void } }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={(e) => row.toggleSelected(!!e.target.checked)}
            aria-label={_('Select row')}
          />
        ),
      },
    ];
  }, []);
  return columns;
}



// FP shape f8833e4bb716: Select onValueChange calling table.setPageSize(Number(value)) — no type mismatch
declare function Select(props: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }): JSX.Element;
declare function SelectContent(props: { side?: string; children: React.ReactNode }): JSX.Element;
declare function SelectItem(props: { key?: unknown; value: string; children: React.ReactNode }): JSX.Element;

function PageSizeSelector({ table }: { table: { getState: () => { pagination: { pageSize: number } }; setPageSize: (n: number) => void } }) {
  return (
    <Select
      value={`${table.getState().pagination.pageSize}`}
      onValueChange={(value) => {
        table.setPageSize(Number(value));
      }}
    >
      <SelectContent side="top">
        {[10, 20, 30, 40, 50].map((pageSize) => (
          <SelectItem key={pageSize} value={`${pageSize}`}>
            {pageSize}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}



// FP shape f8aa8501f1ec: useMemo columns with sort handler header cell — no type mismatch
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare const ChevronUpIcon: React.FC<{ className?: string }>;
declare const ChevronDownIcon: React.FC<{ className?: string }>;
declare const ChevronsUpDown: React.FC<{ className?: string }>;
declare const sortBy: string;
declare const sortOrder: 'asc' | 'desc';
declare function handleColumnSort(col: string): void;

function useOrgColumns() {
  return useMemo(() => [
    {
      header: () => (
        <div className="flex cursor-pointer items-center" onClick={() => handleColumnSort('name')}>
          Name
          {sortBy === 'name' ? (
            sortOrder === 'asc' ? (
              <ChevronUpIcon className="ml-2 h-4 w-4" />
            ) : (
              <ChevronDownIcon className="ml-2 h-4 w-4" />
            )
          ) : (
            <ChevronsUpDown className="ml-2 h-4 w-4" />
          )}
        </div>
      ),
    },
  ], [sortBy, sortOrder]);
}
