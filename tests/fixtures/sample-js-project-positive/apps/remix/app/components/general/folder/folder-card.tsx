declare const Link: (props: { to: string; className?: string; children: React.ReactNode }) => JSX.Element;
declare const DropdownMenu: (props: { children: React.ReactNode }) => JSX.Element;
declare const DropdownMenuTrigger: (props: { children: React.ReactNode; asChild?: boolean }) => JSX.Element;
declare const DropdownMenuContent: (props: { children: React.ReactNode; align?: string }) => JSX.Element;
declare const DropdownMenuItem: (props: { children: React.ReactNode; onClick?: () => void; className?: string }) => JSX.Element;
declare const Button: (props: { children: React.ReactNode; variant?: string; size?: string; onClick?: () => void }) => JSX.Element;
declare const Folder: (props: { className?: string }) => JSX.Element;
declare const MoreHorizontal: (props: { className?: string }) => JSX.Element;
declare const cn: (...args: unknown[]) => string;
declare const formatDate: (d: Date) => string;

type FolderCardProps = {
  id: string;
  name: string;
  documentCount: number;
  createdAt: Date;
  teamUrl: string;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
};

export function FolderCard({
  id,
  name,
  documentCount,
  createdAt,
  teamUrl,
  onRename,
  onDelete,
}: FolderCardProps) {
  return (
    <div className="group relative flex items-center gap-3 rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <Link to={`/t/${teamUrl}/folders/${id}`} className="flex flex-1 items-center gap-3 overflow-hidden">
        <Folder className="h-8 w-8 shrink-0 text-muted-foreground" />
        <div className="overflow-hidden">
          <p className="truncate font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">
            {documentCount} document{documentCount !== 1 ? 's' : ''} · {formatDate(createdAt)}
          </p>
        </div>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onRename(id)}>Rename</DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => onDelete(id)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
