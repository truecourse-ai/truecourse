
type OrgRow = { id: string; name: string; teamCount: unknown; memberCount: unknown; createdAt: Date };

declare function useTranslation(): { t: (key: string) => string };

type ColumnDef = {
  header: () => React.ReactNode;
  accessorKey: string;
  cell: (props: { row: { original: OrgRow; getValue: (key: string) => unknown } }) => React.ReactNode;
  size?: number;
};

function buildAdminColumns(): ColumnDef[] {
  const { t } = useTranslation();

  return [
    {
      header: () => <span>{t('Teams')}</span>,
      accessorKey: 'teamCount',
      cell: ({ row }) => <div>{Number(row.original.teamCount) || 0}</div>,
      size: 120,
    },
    {
      header: () => <span>{t('Members')}</span>,
      accessorKey: 'memberCount',
      cell: ({ row }) => <div>{Number(row.original.memberCount) || 0}</div>,
      size: 160,
    },
  ];
}
