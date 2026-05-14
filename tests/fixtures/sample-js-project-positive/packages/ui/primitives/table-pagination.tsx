
// --- react-readonly-props FP: Table instance prop (not primitive) ---
declare namespace TanStackTable { interface Table<T> { getState(): { pagination: { pageIndex: number; pageSize: number } }; setPageSize(n: number): void; getCanNextPage(): boolean; getCanPreviousPage(): boolean; nextPage(): void; previousPage(): void; getPageCount(): number; } }

interface TablePaginationProps<TData> {
  table: TanStackTable.Table<TData>;
  showRowCount?: boolean;
}

function TablePagination<TData>({ table, showRowCount }: TablePaginationProps<TData>) {
  const { pageIndex, pageSize } = table.getState().pagination;
  return (
    <div className="flex items-center gap-2">
      <button disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>Prev</button>
      <span>Page {pageIndex + 1}</span>
      <button disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>Next</button>
    </div>
  );
}
