
type FeatureFlag = { key: string; label: string };
type ClaimRow = { id: string; name: string; flags: Record<string, boolean>; maxTeams: number };

declare const FEATURE_FLAGS: FeatureFlag[];
declare const DropdownMenu: React.FC<{ children?: React.ReactNode }>;
declare const DropdownMenuTrigger: React.FC<{ children?: React.ReactNode }>;
declare const MoreHorizIcon: React.FC<{ className?: string }>;

type ColumnDef = {
  header: string | (() => React.ReactNode);
  cell: (props: { row: { original: ClaimRow } }) => React.ReactNode;
  size?: number;
};

function buildClaimsColumns(): ColumnDef[] {
  return [
    {
      header: 'Feature Flags',
      cell: ({ row }) => {
        const enabledFlags = FEATURE_FLAGS.filter(({ key }) => row.original.flags[key]);

        if (enabledFlags.length === 0) {
          return <p className="text-muted-foreground text-xs">None</p>;
        }

        return (
          <ul className="list-disc space-y-1 text-muted-foreground text-xs">
            {enabledFlags.map(({ key, label }) => (
              <li key={key}>{label}</li>
            ))}
          </ul>
        );
      },
    },
    {
      header: 'Actions',
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger>
            <MoreHorizIcon className="h-5 w-5 text-muted-foreground" />
          </DropdownMenuTrigger>
        </DropdownMenu>
      ),
    },
  ];
}
