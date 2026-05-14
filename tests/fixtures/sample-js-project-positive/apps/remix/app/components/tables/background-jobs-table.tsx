
declare const i18n: { date: (d: Date | string) => string };
declare const jobRow: { completedAt: Date | null; failedAt: Date | null };

function formatJobDate(row: typeof jobRow) {
  return {
    completedAt: row.completedAt ? i18n.date(row.completedAt) : 'N/A',
    failedAt: row.failedAt ? i18n.date(row.failedAt) : 'N/A',
  };
}



// --- argument-type-mismatch FP: i18n.date() receiving a Date value ---
declare const i18n: { date: (value: Date, opts?: Intl.DateTimeFormatOptions) => string };

interface TableRow {
  original: { createdAt: Date; name: string };
}

const emailDomainColumns = [
  {
    id: 'createdAt',
    header: 'Created',
    cell: ({ row }: { row: TableRow }) => i18n.date(row.original.createdAt),
  },
  {
    id: 'name',
    header: 'Domain',
    cell: ({ row }: { row: TableRow }) => row.original.name,
  },
];
