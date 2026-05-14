
// --- redundant-template-expression FP: template literal wrapping number for Select value ---
declare namespace TanStackTable { interface Table<T> { getState(): { pagination: { pageIndex: number; pageSize: number } }; setPageSize(n: number): void; } }

function DataTablePageSizeSelect<TData>({ table }: { table: TanStackTable.Table<TData> }) {
  return (
    <select
      value={`${table.getState().pagination.pageSize}`}
      onChange={(e) => table.setPageSize(Number(e.target.value))}
    >
      {[10, 20, 30, 40, 50].map((size) => (
        <option key={size} value={`${size}`}>{size} rows</option>
      ))}
    </select>
  );
}
