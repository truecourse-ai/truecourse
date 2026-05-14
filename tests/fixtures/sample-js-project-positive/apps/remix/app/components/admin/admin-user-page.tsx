
// FP shape: component body with multiple hook calls (useLingui, useToast)
declare function useRevalidator(): { revalidate: () => void };

type AdminUserDetailsProps = { userId: string; name: string };

export const AdminUserDetails = ({ userId, name }: AdminUserDetailsProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const { revalidate } = useRevalidator();
  return null;
};



// FP shape: stats is an explicitly typed Record initialised with all ReadStatus enum keys;
// readStatus comes from a DB groupBy on the same enum field. Key is always present.
declare const enum ReadStatus { OPENED = 'OPENED', NOT_OPENED = 'NOT_OPENED' }

interface StatusCount { count: number }

function buildReadStatusStats(
  rows: Array<{ readStatus: ReadStatus; _count: number }>,
): Record<ReadStatus, StatusCount> {
  const stats: Record<ReadStatus, StatusCount> = {
    [ReadStatus.OPENED]: { count: 0 },
    [ReadStatus.NOT_OPENED]: { count: 0 },
  };

  for (const row of rows) {
    const readStatus = row.readStatus;
    stats[readStatus].count += row._count;
  }

  return stats;
}
