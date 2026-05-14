
// Shape 64c3e6e67aee: prisma.$transaction with async callback containing Promise.all(.map(async ...)).
interface PrismaClient { $transaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T>; user: { update(args: object): Promise<{ id: number }> } }
declare const prisma: PrismaClient;
interface RoleUpdate { userId: number; role: string }
declare const roleUpdates: RoleUpdate[];

async function applyRoleUpdates(updates: RoleUpdate[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await Promise.all(
      updates.map(async (update) => {
        await tx.user.update({ where: { id: update.userId }, data: { role: update.role } });
      }),
    );
  });
}



// Shape 6576aa08806a: prisma.findMany({where:{...}}) followed by .map(); standard Prisma pattern.
interface SessionRecord { id: string; userId: number; expiresAt: Date; deviceInfo: string }
interface SessionSummary { id: string; expiresAt: Date; isExpired: boolean }
interface UserRepository { session: { findMany(args: { where: object }): Promise<SessionRecord[]> } }
declare const userRepo: UserRepository;
declare const userId: number;

async function getActiveSessions(uid: number): Promise<SessionSummary[]> {
  const sessions = await userRepo.session.findMany({
    where: { userId: uid, expiresAt: { gt: new Date() } },
  });
  return sessions.map((s) => ({ id: s.id, expiresAt: s.expiresAt, isExpired: false }));
}



// FP shape: Kysely type-safe query builder fn.count with typed expression
declare const db: { selectFrom: (table: string) => any };
declare function buildFilteredQuery(): any;

async function countFilteredRecords() {
  const baseQuery = buildFilteredQuery().clearSelect().select('Record.id');

  const countResult = await db
    .selectFrom(baseQuery.as('filtered'))
    .select(({ fn }: { fn: { count: <T>(col: string) => { as: (alias: string) => unknown } } }) =>
      fn.count<number>('id').as('total'),
    )
    .executeTakeFirstOrThrow();

  return Number(countResult.total ?? 0);
}



// FP shape: Prisma $transaction with async callback that uses deleteMany
declare const prisma: {
  $transaction: <T>(fn: (tx: { session: { deleteMany: (opts: any) => Promise<{ count: number }> }; auditLog: { createMany: (opts: any) => Promise<void> } }) => Promise<T>) => Promise<T>;
};
declare const userId: number;
declare const tokenIds: string[];

async function revokeTokens() {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.session.deleteMany({
      where: {
        userId,
        id: { in: tokenIds },
      },
    });

    if (count !== tokenIds.length) {
      throw new Error('Some tokens were not found');
    }

    await tx.auditLog.createMany({
      data: tokenIds.map(() => ({ userId, action: 'TOKEN_REVOKED' })),
    });
  });
}



// FP shape: Prisma $transaction with Promise.all of parallel async map operations
declare const prisma: {
  $transaction: <T>(fn: (tx: { contact: { create: (opts: any) => Promise<{ id: number }> } }) => Promise<T>) => Promise<T>;
};
declare const contactsToCreate: Array<{ name: string; email: string; role: string }>;
declare function normalizeEmail(email: string): string;

async function createContactsBatch() {
  const normalized = contactsToCreate.map((c) => ({ ...c, email: normalizeEmail(c.email) }));

  const created = await prisma.$transaction(async (tx) => {
    return await Promise.all(
      normalized.map(async (contact) => {
        return await tx.contact.create({
          data: {
            name: contact.name,
            email: contact.email,
            role: contact.role,
          },
        });
      }),
    );
  });

  return created;
}



// FP shape: Promise.all with async map over typed array
declare const notificationFields: Array<{ id: number; recipientToken: string; type: string }>;
declare function sendNotificationForField(opts: { token: string; fieldId: number; fieldType: string }): Promise<void>;

async function dispatchAllNotifications() {
  await Promise.all(
    notificationFields.map(async (field) =>
      sendNotificationForField({
        token: field.recipientToken,
        fieldId: field.id,
        fieldType: field.type,
      }),
    ),
  );
}



// FP shape: Promise.all with typed async function calls — no type mismatch
declare function fetchTeamById(opts: { teamId: number; userId: number }): Promise<{ id: number; name: string; orgId: number }>;
declare function fetchUserPermissions(opts: { teamId: number; userId: number }): Promise<{ role: string; scopes: string[] }>;
declare const teamId: number;
declare const userId: number;

async function loadTeamContext() {
  const [team, permissions] = await Promise.all([
    fetchTeamById({ teamId, userId }),
    fetchUserPermissions({ teamId, userId }),
  ]);

  return { team, permissions };
}



// FP shape: Kysely fn.count<number>() with typed expression in select — no type mismatch
declare const kyselyDb: { selectFrom: (table: string) => any };
declare function buildBaseQuery(): any;

async function getRecordCount(): Promise<number> {
  const baseQuery = buildBaseQuery().clearSelect().select('Entry.id');

  const result = await kyselyDb
    .selectFrom(baseQuery.as('base'))
    .select(({ fn }: { fn: { count: <T>(col: string) => { as: (alias: string) => unknown } } }) =>
      fn.count<number>('id').as('total'),
    )
    .executeTakeFirstOrThrow();

  return Number(result.total ?? 0);
}



// FP shape: async map for conditional Prisma operations over removed items
declare const DeliveryStatus: { SENT: string; PENDING: string };
declare const MemberRole: { CC: string; SUBSCRIBER: string };
declare function sendRemovalNotification(opts: { email: string; name: string; orgName: string }): Promise<void>;
declare const removedMembers: Array<{ id: number; email: string; name: string; sendStatus: string; role: string }>;
declare const orgName: string;
declare const notificationsEnabled: boolean;

async function notifyRemovedMembers() {
  await Promise.all(
    removedMembers.map(async (member) => {
      if (
        member.sendStatus !== DeliveryStatus.SENT ||
        member.role === MemberRole.CC ||
        !notificationsEnabled
      ) {
        return;
      }

      await sendRemovalNotification({
        email: member.email,
        name: member.name,
        orgName,
      });
    }),
  );
}
