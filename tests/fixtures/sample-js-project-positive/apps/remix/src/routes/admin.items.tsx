
// --- empty-function shape: intentional no-op pagination callback ---
// DataTable requires onPaginationChange but pagination is static (all items shown).
// The empty arrow function is intentional — no state update needed.
declare function DataTable<T>(props: {
  columns: unknown[];
  data: T[];
  perPage: number;
  currentPage: number;
  totalPages: number;
  onPaginationChange: () => void;
}): JSX.Element;
declare const columns: unknown[];
declare const items: Array<{ id: string; name: string }>;

export function AdminItemList() {
  return (
    <div>
      <DataTable
        columns={columns}
        data={items}
        perPage={items.length}
        currentPage={1}
        totalPages={1}
        onPaginationChange={() => {}}
      />
    </div>
  );
}
