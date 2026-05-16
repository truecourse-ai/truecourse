
// FP shape 0224a0c95537: Promise.all with parallel ORM queries — no type mismatch
interface UserRecord { id: string; email: string; name: string; }
declare const db: {
  user: {
    findMany: (opts: object) => Promise<UserRecord[]>;
    count: (opts: object) => Promise<number>;
  };
};

async function getPaginatedUsers(page: number, pageSize: number) {
  const [users, total] = await Promise.all([
    db.user.findMany({ skip: (page - 1) * pageSize, take: pageSize }),
    db.user.count({ where: { active: true } }),
  ]);
  return { users, total };
}



// FP shape 0243657d7f21: Promise.all with execute/executeTakeFirstOrThrow — no type mismatch
interface OrderRow { id: string; status: string; }
declare const ordersQuery: { execute: () => Promise<OrderRow[]> };
declare const countQuery: { executeTakeFirstOrThrow: () => Promise<{ count: number }> };

async function fetchOrdersWithCount() {
  const [orders, countResult] = await Promise.all([
    ordersQuery.execute(),
    countQuery.executeTakeFirstOrThrow(),
  ]);
  return { orders, total: countResult.count };
}



// FP shape 02c40b08ce78: .then() callback mapping ORM results to IDs — no type mismatch
interface SessionRecord { id: string; userId: string; expiresAt: Date; }
declare const db: { session: { findMany: (opts: object) => Promise<SessionRecord[]> } };

async function getActiveSessionIds(userId: string): Promise<string[]> {
  return db.session
    .findMany({ where: { userId, active: true } })
    .then((sessions) => sessions.map((s) => s.id));
}



// FP shape 03cac69f826d: Prisma $transaction with async callback — no type mismatch
interface TxClient { team: { update: (opts: object) => Promise<unknown> } }
declare const db: { $transaction: (fn: (tx: TxClient) => Promise<unknown>) => Promise<unknown> };
declare const teamId: string;
declare const newOwnerId: string;

async function transferTeamOwnership() {
  await db.$transaction(async (tx) => {
    await tx.team.update({
      where: { id: teamId },
      data: { ownerId: newOwnerId },
    });
  });
}



// FP shape 048e30532625: destructured async map for ORM updates — no type mismatch
interface ProjectTransfer { projectId: string; newOwnerId: string; }
interface TxClient { project: { updateMany: (opts: object) => Promise<unknown> } }
declare const db: { $transaction: (fn: (tx: TxClient) => Promise<unknown>) => Promise<unknown> };
declare const transfers: ProjectTransfer[];

async function bulkTransferProjects() {
  await Promise.all(
    transfers.map(async ({ projectId, newOwnerId }) => {
      return db.$transaction(async (tx) => {
        await tx.project.updateMany({ where: { id: projectId }, data: { ownerId: newOwnerId } });
      });
    })
  );
}
