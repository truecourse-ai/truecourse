// FP shape: Prisma create call with typed data object — no type mismatch
interface BackgroundJobData {
  jobId: string;
  payload: Record<string, unknown>;
  scheduledAt: Date;
  status: 'PENDING' | 'RUNNING' | 'DONE';
}
declare const prisma: {
  backgroundJob: {
    create: (args: { data: BackgroundJobData }) => Promise<BackgroundJobData & { id: number }>;
  };
};

async function scheduleJob(jobId: string, payload: Record<string, unknown>): Promise<void> {
  await prisma.backgroundJob.create({
    data: {
      jobId,
      payload,
      scheduledAt: new Date(),
      status: 'PENDING',
    },
  });
}


// FP shape: prisma.$transaction with async callback and conditional logic — no type mismatch
interface GroupMembership { groupId: string; userId: string }
interface DbClient {
  groupMembership: {
    deleteMany: (args: { where: { groupId: string; userId: string } }) => Promise<{ count: number }>;
  };
  $transaction: <T>(fn: (tx: DbClient) => Promise<T>) => Promise<T>;
}
declare const prisma: DbClient;

async function removeMemberFromGroup(userId: string, groupId: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (groupId) {
      await tx.groupMembership.deleteMany({
        where: { groupId, userId },
      });
    }
  });
}


// FP shape: prisma.$transaction with async callback and multiple ops — no type mismatch
interface UserRecord { id: string; email: string; organisationId: string }
interface OrgRecord { id: string; name: string; planId: string }
declare const prisma: {
  $transaction: <T>(fn: (tx: {
    user: { deleteMany: (args: { where: { organisationId: string } }) => Promise<{ count: number }> };
    organisation: { delete: (args: { where: { id: string } }) => Promise<OrgRecord> };
  }) => Promise<T>) => Promise<T>;
};

async function deleteOrganisation(orgId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.user.deleteMany({ where: { organisationId: orgId } });
    await tx.organisation.delete({ where: { id: orgId } });
  });
}


// FP shape: Prisma transaction with async callback doing multiple writes — no type mismatch
interface SessionRecord { id: string; userId: string; token: string; expiresAt: Date }
declare const prisma: {
  $transaction: <T>(fn: (tx: {
    session: {
      deleteMany: (args: { where: { userId: string } }) => Promise<{ count: number }>;
      create: (args: { data: Omit<SessionRecord, 'id'> }) => Promise<SessionRecord>;
    };
  }) => Promise<T>) => Promise<T>;
};

async function rotateUserSession(userId: string, newToken: string): Promise<SessionRecord> {
  return prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { userId } });
    return tx.session.create({
      data: { userId, token: newToken, expiresAt: new Date(Date.now() + 86400000) },
    });
  });
}



// E07: Kysely fn.count<number>() with generic type param — correct ORM usage; no type mismatch.
declare const fn: { count<T>(col: string): { as(alias: string): unknown } };
declare const db: { selectFrom(table: string): { select(cols: unknown[]): { where(col: string, op: string, val: unknown): { executeTakeFirstOrThrow(): Promise<{ total: number }> } } } };

async function countActiveContracts(ownerId: string): Promise<number> {
  const result = await db
    .selectFrom('contracts')
    .select([fn.count<number>('id').as('total')])
    .where('ownerId', '=', ownerId)
    .executeTakeFirstOrThrow();

  return result.total;
}



// E19: fn.count<number>().as() — Kysely typed count with alias; no type mismatch.
declare const fn2: { count<T>(col: string): { as(alias: string): unknown } };
declare const db2: { selectFrom(t: string): { select(c: unknown[]): { where(col: string, op: string, val: unknown): { executeTakeFirstOrThrow(): Promise<{ total: number }> } } } };

async function countDocumentsForUser(userId: string): Promise<number> {
  const result = await db2
    .selectFrom('documents')
    .select([fn2.count<number>('id').as('total')])
    .where('createdById', '=', userId)
    .executeTakeFirstOrThrow();

  return result.total;
}



// E24: Prisma $transaction callback — no type mismatch.
interface TxClient {
  contract: { create(args: { data: { title: string; ownerId: string } }): Promise<{ id: string; title: string }> };
}

declare const prisma2: { $transaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> };

async function createContractInTransaction(title: string, ownerId: string) {
  return prisma2.$transaction(async (tx) => {
    const contract = await tx.contract.create({
      data: { title, ownerId },
    });
    return contract;
  });
}



// E27: ORM boolean expression in query — no type mismatch.
declare const db3: {
  selectFrom(t: string): {
    where(col: string, op: string, val: unknown): {
      where(col: string, op: string, val: unknown): {
        executeTakeFirst(): Promise<{ id: string } | undefined>;
      };
    };
  };
};

async function findActiveSubscription(orgId: string): Promise<{ id: string } | undefined> {
  return db3
    .selectFrom('subscriptions')
    .where('orgId', '=', orgId)
    .where('isActive', '=', true)
    .executeTakeFirst();
}



// E40: Prisma $transaction with group creation — no type mismatch.
interface TxClient2 {
  accessGroup: {
    create(args: {
      data: { name: string; orgId: string; permissions: string[] };
    }): Promise<{ id: string; name: string }>;
  };
}

declare const prisma3: { $transaction<T>(fn: (tx: TxClient2) => Promise<T>): Promise<T> };

async function createAccessGroup(orgId: string, name: string, permissions: string[]) {
  return prisma3.$transaction(async (tx) => {
    const group = await tx.accessGroup.create({
      data: { name, orgId, permissions },
    });
    return group;
  });
}



// Prisma $transaction with async callback — correct usage, no type mismatch
declare const db: {
  $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>;
  session: { delete: (args: any) => Promise<any>; create: (args: any) => Promise<any> };
  auditLog: { create: (args: any) => Promise<any> };
};

async function revokeSession(userId: string, sessionId: string) {
  await db.$transaction(async (tx) => {
    await tx.session.delete({
      where: { id: sessionId, userId },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'SESSION_REVOKED',
        sessionId,
      },
    });
  });
}



// Prisma $transaction with interactive async tx — standard pattern, no type mismatch
declare const prisma: {
  $transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
};

async function transferOwnership(fromUserId: string, toUserId: string, resourceId: string) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.resource.update({
      where: { id: resourceId },
      data: { ownerId: toUserId },
    });

    await tx.ownershipTransfer.create({
      data: {
        resourceId,
        fromUserId,
        toUserId,
        transferredAt: new Date(),
      },
    });

    return tx.resource.findUniqueOrThrow({ where: { id: resourceId } });
  });

  return result;
}



// async map over items creating DB records — standard async map pattern, no type mismatch
declare const prisma: {
  attachment: { create: (args: { data: any }) => Promise<{ id: string }> };
  attachmentCopy: { create: (args: { data: any }) => Promise<{ id: string }> };
};
type Attachment = { id: string; data: string; mimeType: string; title: string };
declare const sourceAttachments: Attachment[];
declare const targetDocumentId: string;

async function duplicateAttachments() {
  await Promise.all(
    sourceAttachments.map(async (attachment) => {
      const copy = await prisma.attachment.create({
        data: {
          data: attachment.data,
          mimeType: attachment.mimeType,
          title: attachment.title,
          documentId: targetDocumentId,
        },
      });

      return copy;
    }),
  );
}



// FP shape: ORM typed fn() call; no type mismatch
declare const db: { fn: { count: <T>(col: T) => { as: (alias: string) => unknown } }; selectFrom: (t: string) => unknown };

function countActiveUsers() {
  return db.fn.count('id').as('total');
}



// FP shape: ORM $transaction with async callback; no type mismatch
declare const db: {
  $transaction: <T>(fn: (tx: typeof db) => Promise<T>) => Promise<T>;
  user: { update: (args: { where: unknown; data: unknown }) => Promise<unknown> };
};
declare const userId: string;

async function deactivateUser() {
  return db.$transaction(async (tx) =>
    tx.user.update({
      where: { id: userId },
      data: { active: false, updatedAt: new Date() },
    })
  );
}



// FP shape: Promise.all with parallel ORM queries; no type mismatch
declare const db: {
  project: {
    findMany: (args: { where: unknown; skip?: number; take?: number }) => Promise<unknown[]>;
    count: (args: { where: unknown }) => Promise<number>;
  };
};
declare const whereClause: unknown;

async function findProjectsPaginated(page: number, perPage: number) {
  const [projects, total] = await Promise.all([
    db.project.findMany({ where: whereClause, skip: page * perPage, take: perPage }),
    db.project.count({ where: whereClause }),
  ]);
  return { projects, total };
}



// Shape: setSignedCookie(...).catch((err) => {...}) async Hono cookie with catch — types correct
declare function setSignedCookie(
  ctx: unknown,
  name: string,
  value: string,
  secret: string,
  options?: Record<string, unknown>,
): Promise<void>;
declare function getAuthSecret(): string;
declare const cookieContext: unknown;
declare const sessionToken: string;
declare function appLog(tag: string, msg: string): void;

export async function writeSessionCookie(): Promise<void> {
  await setSignedCookie(cookieContext, 'session', sessionToken, getAuthSecret(), {
    httpOnly: true,
    sameSite: 'lax',
  }).catch((err: unknown) => {
    appLog('WriteSessionCookie', `Error setting signed cookie: ${err}`);
    throw err;
  });
}


// --- argument-type-mismatch FP: fetchRequestHandler() with config object; valid API handler call, no type mismatch ---
declare function fetchRequestHandler(config: {
  request: Request;
  contract: unknown;
  router: unknown;
  options?: {
    errorHandler?: (err: unknown) => void;
  };
}): Promise<Response>;

declare const ApiContract: unknown;
declare const ApiRouter: unknown;

async function handleApiRequest(request: Request): Promise<Response> {
  return fetchRequestHandler({
    request,
    contract: ApiContract,
    router: ApiRouter,
    options: {
      errorHandler: (err) => {
        console.error('API error:', err);
      },
    },
  });
}


// --- argument-type-mismatch FP: ternary string template for IPv6 address wrapping; valid string template, no type mismatch ---
function toAddressUrl(address: string): string {
  return address.includes(':') ? `http://[${address}]` : `http://${address}`;
}

function buildRedirectUrl(hostname: string, port?: number): string {
  const base = toAddressUrl(hostname);
  return port ? `${base}:${port}` : base;
}


// --- argument-type-mismatch FP: generateStaticParams using .map() on page objects; valid property accesses, no type mismatch ---
declare function getPageImage(page: { locale: string; url: string }): { segments: string[] };

interface DocPage { locale: string; url: string; title: string }
declare function getAllDocPages(): DocPage[];

function generateStaticParams() {
  return getAllDocPages().map((page) => ({
    lang: page.locale,
    slug: getPageImage(page).segments,
  }));
}


// --- argument-type-mismatch FP: tRPC procedure chain .input().mutation(); types from Zod schema, no type mismatch ---
declare const z: {
  object<T extends object>(shape: T): { parse(val: unknown): unknown; _output: unknown };
  string(): unknown;
  boolean(): unknown;
};

declare const authenticatedProcedure: {
  input<T>(schema: T): {
    mutation<TResult>(fn: (opts: { ctx: { userId: string }; input: unknown }) => Promise<TResult>): unknown;
  };
};

declare const ZCreateCheckoutRequestSchema: ReturnType<typeof z.object>;

const createCheckoutRoute = authenticatedProcedure
  .input(ZCreateCheckoutRequestSchema)
  .mutation(async ({ ctx, input }) => {
    const { userId } = ctx;
    return { sessionId: `checkout_${userId}` };
  });


// --- argument-type-mismatch FP: authenticatedMiddleware with async handler destructuring params; standard middleware, no type mismatch ---
declare function authenticatedMiddleware<TParams, TResult>(
  handler: (args: { params: TParams }, user: { id: string }, team: { id: string }) => Promise<TResult>,
): unknown;

interface RecipientParams { id: string; recipientId: string }

const deleteRecipientHandler = authenticatedMiddleware<RecipientParams, { success: boolean }>(
  async (args, user, team) => {
    const { id: documentId, recipientId } = args.params;

    return {
      success: true,
    };
  },
);


// --- argument-type-mismatch FP: parsePem(Buffer.from(contents).toString()).map(block => block.der); .map() on array result, no type mismatch ---
interface PemBlock { der: Uint8Array; type: string }

declare function parsePemContents(pemString: string): PemBlock[];

function loadCertificatesFromBase64(base64Contents: string): Uint8Array[] {
  return parsePemContents(
    Buffer.from(base64Contents, 'base64').toString('utf-8'),
  ).map((block) => block.der);
}


// --- argument-type-mismatch FP: tRPC .input().output().mutation() chain; standard tRPC route, no type mismatch ---
declare const z2: {
  object<T extends object>(shape: T): { parse(val: unknown): unknown };
  string(): unknown;
};

declare const procedure2: {
  input<T>(s: T): {
    output<U>(s: U): {
      mutation<TResult>(fn: (opts: { input: unknown; ctx: { metadata: unknown } }) => Promise<TResult>): unknown;
    };
  };
};

declare const ZSignFieldRequestSchema: ReturnType<typeof z2.object>;
declare const ZSignFieldResponseSchema: ReturnType<typeof z2.object>;

const signFieldRoute = procedure2
  .input(ZSignFieldRequestSchema)
  .output(ZSignFieldResponseSchema)
  .mutation(async ({ input, ctx: { metadata } }) => {
    return { success: true };
  });



// FF24 — Prisma $transaction with async callback; standard usage, no type mismatch
type TxClient = {
  emailVerification: {
    findFirst(opts: { where: { email: string } }): Promise<{ id: string; email: string } | null>;
    create(opts: { data: { email: string; token: string; expiresAt: Date } }): Promise<{ id: string }>;
  };
};
declare const db: { $transaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> };

async function createEmailVerification(email: string, token: string) {
  return db.$transaction(async (tx) => {
    const existing = await tx.emailVerification.findFirst({ where: { email } });
    if (existing) {
      return existing;
    }
    return tx.emailVerification.create({
      data: { email, token, expiresAt: new Date(Date.now() + 86400_000) },
    });
  });
}



// FF31 — .map() on Prisma result to typed DTO; all properties correctly typed
type ProjectRecord = { id: string; name: string; createdAt: Date; memberCount: number };
type ProjectDto = { id: string; name: string; memberCount: number };
declare const projectRows: ProjectRecord[];

const projects: ProjectDto[] = projectRows.map((row) => ({
  id: row.id,
  name: row.name,
  memberCount: row.memberCount,
}));



// FP shape f80588b977fc: Promise.then/catch chaining on async DB seed call — no type mismatch
declare function seedWorkspaceData(): Promise<void>;

seedWorkspaceData()
  .then(() => {
    console.log('Workspace data seeded');
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
