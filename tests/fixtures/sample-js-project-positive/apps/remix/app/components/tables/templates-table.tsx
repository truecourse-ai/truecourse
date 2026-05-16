declare const useNavigate: () => (path: string) => void;
declare const useToast: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const formatDate: (d: Date) => string;
declare const cn: (...args: unknown[]) => string;
declare const Button: (props: { children: React.ReactNode; onClick?: () => void; variant?: string; size?: string; disabled?: boolean; className?: string }) => JSX.Element;
declare const DropdownMenu: (props: { children: React.ReactNode }) => JSX.Element;
declare const DropdownMenuTrigger: (props: { children: React.ReactNode; asChild?: boolean }) => JSX.Element;
declare const DropdownMenuContent: (props: { children: React.ReactNode; align?: string }) => JSX.Element;
declare const DropdownMenuItem: (props: { children: React.ReactNode; onClick?: () => void; className?: string }) => JSX.Element;
declare const DropdownMenuSeparator: () => JSX.Element;
declare const DataTable: (props: { columns: unknown[]; data: unknown[]; emptyText?: string }) => JSX.Element;
declare const Badge: (props: { children: React.ReactNode; variant?: string }) => JSX.Element;
declare const MoreHorizontal: (props: { className?: string }) => JSX.Element;

type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
  usageCount: number;
  category: string;
};

type WorkflowTemplatesTableProps = {
  templates: WorkflowTemplate[];
  onDelete: (id: string) => Promise<void>;
  onDuplicate: (id: string) => Promise<void>;
  onToggleActive: (id: string, active: boolean) => Promise<void>;
  isLoading?: boolean;
};

export function WorkflowTemplatesTable({
  templates,
  onDelete,
  onDuplicate,
  onToggleActive,
  isLoading = false,
}: WorkflowTemplatesTableProps) {
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleEdit = (id: string) => {
    navigate(`/templates/${id}/edit`);
  };

  const handleDelete = async (id: string) => {
    try {
      await onDelete(id);
      toast({ title: 'Template deleted', description: 'The workflow template was removed.' });
    } catch {
      toast({ title: 'Error', description: 'Could not delete template.', variant: 'destructive' });
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await onDuplicate(id);
      toast({ title: 'Template duplicated', description: 'A copy of the template was created.' });
    } catch {
      toast({ title: 'Error', description: 'Could not duplicate template.', variant: 'destructive' });
    }
  };

  const handleToggle = async (id: string, current: boolean) => {
    try {
      await onToggleActive(id, !current);
      toast({
        title: current ? 'Template deactivated' : 'Template activated',
        description: current
          ? 'The template is now inactive.'
          : 'The template is now active and available.',
      });
    } catch {
      toast({ title: 'Error', description: 'Could not update template status.', variant: 'destructive' });
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Name',
      cell: (row: WorkflowTemplate) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{row.name}</span>
          <span className="text-muted-foreground text-xs">{row.description}</span>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      cell: (row: WorkflowTemplate) => <Badge variant="outline">{row.category}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row: WorkflowTemplate) => (
        <Badge variant={row.isActive ? 'default' : 'secondary'}>
          {row.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'usage',
      header: 'Usage',
      cell: (row: WorkflowTemplate) => (
        <span className="text-sm">{row.usageCount} uses</span>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Last Modified',
      cell: (row: WorkflowTemplate) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.updatedAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (row: WorkflowTemplate) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleEdit(row.id)}>Edit</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDuplicate(row.id)}>Duplicate</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleToggle(row.id, row.isActive)}>
              {row.isActive ? 'Deactivate' : 'Activate'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => handleDelete(row.id)}
              className="text-destructive focus:text-destructive"
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="rounded-md border">
      <DataTable
        columns={columns}
        data={templates}
        emptyText={isLoading ? 'Loading templates...' : 'No templates found.'}
      />
    </div>
  );
}



// FP: React data table component with useMemo columns and JSX — standard React framework structure
declare const useLingui: () => { _: (s: unknown) => string; i18n: unknown };
declare const useCurrentTeam: () => { id: number; url: string };
declare const useTransition: () => [boolean, (fn: () => void) => void];
declare const useUpdateSearchParams: () => (params: Record<string, string | null>) => void;
declare const msg: (s: TemplateStringsArray) => unknown;
declare const Checkbox: React.FC<{ checked?: boolean; onCheckedChange?: (v: boolean) => void; 'aria-label'?: string; onClick?: (e: React.MouseEvent) => void }>;
declare type TFindTemplatesResponse = { data: Array<{ id: number; title: string; createdAt: Date; updatedAt: Date; visibility: string }> };
declare type DataTableColumnDef<T> = { id?: string; header?: string | ((opts: { table: unknown }) => React.ReactNode); cell?: (opts: { row: { original: T; getIsSelected: () => boolean; toggleSelected: (v: boolean) => void } }) => React.ReactNode; size?: number };
declare const DataTable: React.FC<{ columns: DataTableColumnDef<unknown>[]; data: unknown[]; isLoading?: boolean; isLoadingError?: boolean }>;

type TemplatesTableRow = TFindTemplatesResponse['data'][number];

type TemplatesTableProps = {
  data: TFindTemplatesResponse;
  isLoading: boolean;
  isLoadingError: boolean;
  enableSelection?: boolean;
  rowSelection?: Record<string, boolean>;
  onRowSelectionChange?: (selection: Record<string, boolean>) => void;
};

export const TemplatesTable = ({
  data,
  isLoading,
  isLoadingError,
  enableSelection,
  rowSelection,
  onRowSelectionChange,
}: TemplatesTableProps) => {
  const { _ } = useLingui();
  const team = useCurrentTeam();
  const [isPending, startTransition] = useTransition();
  const updateSearchParams = useUpdateSearchParams();

  const columns = React.useMemo(() => {
    const cols: DataTableColumnDef<TemplatesTableRow>[] = [];

    if (enableSelection) {
      cols.push({
        id: 'select',
        header: ({ table }: { table: { getIsAllPageRowsSelected: () => boolean; toggleAllPageRowsSelected: (v: boolean) => void } }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label={_(msg`Select all`)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label={_(msg`Select row`)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        size: 40,
      });
    }

    cols.push({
      id: 'title',
      header: 'Title',
      cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
    });

    cols.push({
      id: 'visibility',
      header: 'Visibility',
      cell: ({ row }) => (
        <span className="capitalize">{row.original.visibility.toLowerCase()}</span>
      ),
    });

    cols.push({
      id: 'createdAt',
      header: 'Created',
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {new Date(row.original.createdAt).toLocaleDateString()}
        </span>
      ),
    });

    return cols;
  }, [_, enableSelection]);

  return (
    <DataTable
      columns={columns as DataTableColumnDef<unknown>[]}
      data={data.data}
      isLoading={isLoading}
      isLoadingError={isLoadingError}
    />
  );
};
