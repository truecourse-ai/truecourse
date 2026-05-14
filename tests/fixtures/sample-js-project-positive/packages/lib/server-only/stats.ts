
// FP shape: async function with many named params (destructured options) and await db call
declare const db: {
  user: { findFirstOrThrow: (opts: { where: { id: string }; select: { id: true; email: true } }) => Promise<{ id: string; email: string }> };
  report: { count: (opts: { where: Record<string, unknown> }) => Promise<number> };
};

type GetActivityStatsInput = {
  userId: string;
  teamId?: string;
  period?: 'day' | 'week' | 'month';
  search?: string;
  folderId?: string;
  includeArchived?: boolean;
};

export const getActivityStats = async ({
  userId,
  teamId,
  period = 'week',
  search = '',
  folderId,
  includeArchived = false,
}: GetActivityStatsInput) => {
  const user = await db.user.findFirstOrThrow({
    where: { id: userId },
    select: { id: true, email: true },
  });

  const total = await db.report.count({ where: { userId: user.id } });
  return { total, user };
};
