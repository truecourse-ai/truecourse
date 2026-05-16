declare const Button: (props: { children: React.ReactNode; onClick?: () => void; variant?: string; size?: string; disabled?: boolean }) => JSX.Element;
declare const Select: (props: { value?: string; onValueChange?: (v: string) => void; children: React.ReactNode }) => JSX.Element;
declare const SelectTrigger: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const SelectContent: (props: { children: React.ReactNode }) => JSX.Element;
declare const SelectItem: (props: { value: string; children: React.ReactNode }) => JSX.Element;
declare const SelectValue: () => JSX.Element;
declare const ChevronLeft: (props: { className?: string }) => JSX.Element;
declare const ChevronRight: (props: { className?: string }) => JSX.Element;
declare const ChevronsLeft: (props: { className?: string }) => JSX.Element;
declare const ChevronsRight: (props: { className?: string }) => JSX.Element;

type DataTablePaginationProps = {
  page: number;
  totalPages: number;
  perPage: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
  pageSizeOptions?: number[];
};

export function DataTablePagination({
  page,
  totalPages,
  perPage,
  totalItems,
  onPageChange,
  onPerPageChange,
  pageSizeOptions = [10, 25, 50, 100],
}: DataTablePaginationProps) {
  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, totalItems);

  return (
    <div className="flex items-center justify-between px-2 py-3">
      <p className="text-sm text-muted-foreground">
        {totalItems > 0 ? `${start}–${end} of ${totalItems}` : 'No results'}
      </p>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Rows per page</span>
          <Select value={String(perPage)} onValueChange={(v) => onPerPageChange(Number(v))}>
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>{size}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={() => onPageChange(1)}
            disabled={page <= 1}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="px-2 text-sm">{page} / {totalPages}</span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onPageChange(totalPages)}
            disabled={page >= totalPages}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
