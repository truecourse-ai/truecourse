
// --- argument-type-mismatch shape: react-ui-framework-apis (useMemo with array push for column defs) ---
import * as React from 'react';
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare const Checkbox: React.FC<{ checked?: boolean; onCheckedChange?: (v: boolean) => void; 'aria-label'?: string; onClick?: (e: any) => void }>;

interface ContractRow { id: string; title: string; status: string; createdAt: Date; }
interface ColumnDef<T> { id: string; header?: any; cell?: any; }

export function useContractsTableColumns(enableSelection: boolean) {
  const columns = useMemo(() => {
    const cols: ColumnDef<ContractRow>[] = [];

    if (enableSelection) {
      cols.push({
        id: 'select',
        header: ({ table }: any) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
            onClick={(e) => e.stopPropagation()}
          />
        ),
        cell: ({ row }: any) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
            onClick={(e) => e.stopPropagation()}
          />
        ),
      });
    }

    cols.push({ id: 'title' });
    cols.push({ id: 'status' });
    cols.push({ id: 'createdAt' });

    return cols;
  }, [enableSelection]);

  return columns;
}
