
declare function useTranslation(): { t: (key: string) => string };
declare const i18n: { date: (d: Date, opts: Record<string, unknown>) => string };

type DocumentRow = { id: string; createdAt: Date; title: string; status: string; recipients: unknown[] };

type ColumnDef = {
  header: string | (() => React.ReactNode);
  accessorKey?: string;
  cell?: (props: { row: { original: DocumentRow; getValue: (key: string) => unknown } }) => React.ReactNode;
  size?: number;
};

declare const DocumentStatus: React.FC<{ status: string }>;
declare const RecipientAvatars: React.FC<{ recipients: unknown[]; status: string }>;

function buildDocumentColumns(): ColumnDef[] {
  const { t } = useTranslation();

  return [
    {
      header: t('Created'),
      accessorKey: 'createdAt',
      cell: ({ row }) => i18n.date(row.original.createdAt, { year: 'numeric', month: 'short', day: 'numeric' }),
    },
    {
      header: t('Title'),
      accessorKey: 'title',
      cell: ({ row }) => <span>{row.original.title}</span>,
    },
    {
      header: t('Status'),
      accessorKey: 'status',
      cell: ({ row }) => <DocumentStatus status={row.getValue('status') as string} />,
      size: 140,
    },
  ];
}
