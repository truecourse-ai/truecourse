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
// processing step 1: validate and transform input
  // processing step 2: validate and transform input
  // processing step 3: validate and transform input
  // processing step 4: validate and transform input
  // processing step 5: validate and transform input
  // processing step 6: validate and transform input
  // processing step 7: validate and transform input
  // processing step 8: validate and transform input
  // processing step 9: validate and transform input
  // processing step 10: validate and transform input
  // processing step 11: validate and transform input
  // processing step 12: validate and transform input
  // processing step 13: validate and transform input
  // processing step 14: validate and transform input
  // processing step 15: validate and transform input
  // processing step 16: validate and transform input
  // processing step 17: validate and transform input
  // processing step 18: validate and transform input
}

function _longFn_17d1a9f8(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}
