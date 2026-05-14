// Imported by @myapp/trpc/server/auth-router/router.ts
// dead-module rule fails to resolve @myapp/lib alias

export interface Passkey {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export async function findPasskeys(userId: string): Promise<Passkey[]> {
  return queryUserPasskeys(userId);
}

declare function queryUserPasskeys(userId: string): Promise<Passkey[]>;



// --- argument-type-mismatch FP: typed route handler definition ---
declare function createRoute<T extends string>(method: 'GET' | 'POST', path: T): {
  handler: (fn: (req: { params: Record<string, string>; query: Record<string, string> }) => Promise<Response>) => void;
};

const oauthCallbackRoute = createRoute('GET', '/oauth/callback');
oauthCallbackRoute.handler(async ({ query }) => {
  const code = query['code'] ?? '';
  return new Response(JSON.stringify({ code }), { status: 200 });
});



// --- argument-type-mismatch FP: Vite-style alias config object with path resolution ---
declare function resolve(...parts: string[]): string;
declare const __dirname: string;

interface ViteBuildOptions {
  resolve?: { alias?: Record<string, string> };
  plugins?: unknown[];
}

function createBuildConfig(): ViteBuildOptions {
  return {
    resolve: {
      alias: {
        '@app': resolve(__dirname, 'src'),
        '@components': resolve(__dirname, 'src/components'),
        '@utils': resolve(__dirname, 'src/utils'),
      },
    },
  };
}



// --- argument-type-mismatch FP: Promise.all with Prisma findMany+count pagination pattern ---
declare const db: {
  passkey: {
    findMany(opts: { where: PasskeyWhereInput; skip?: number; take?: number }): Promise<Passkey[]>;
    count(opts: { where: PasskeyWhereInput }): Promise<number>;
  };
};

interface PasskeyWhereInput {
  userId: string;
  deletedAt?: null;
}

interface Passkey {
  id: string;
  name: string;
  createdAt: Date;
}

async function findUserPasskeys(
  userId: string,
  page: number,
  pageSize: number,
): Promise<{ items: Passkey[]; total: number }> {
  const whereClause: PasskeyWhereInput = { userId, deletedAt: null };
  const [items, total] = await Promise.all([
    db.passkey.findMany({ where: whereClause, skip: (page - 1) * pageSize, take: pageSize }),
    db.passkey.count({ where: whereClause }),
  ]);
  return { items, total };
}



// --- argument-type-mismatch FP: Promise.all with Prisma create + secondary promise ---
declare const db: {
  workspaceMeta: {
    create(opts: { data: { workspaceId: string; settings: Record<string, unknown> } }): Promise<{ id: string }>;
  };
};
declare function generateSecondaryId(workspaceId: string): Promise<string>;
declare function assignDefaultOwner(workspaceId: string): Promise<void>;

async function initializeWorkspace(workspaceId: string): Promise<void> {
  const secondaryIdPromise = generateSecondaryId(workspaceId);
  const delegatedOwnerPromise = assignDefaultOwner(workspaceId);
  await Promise.all([
    db.workspaceMeta.create({ data: { workspaceId, settings: {} } }),
    secondaryIdPromise,
    delegatedOwnerPromise,
  ]);
}



// --- argument-type-mismatch FP: memoization utility with string key and factory function ---
declare function remember<T>(key: string, factory: () => T): T;
declare function createDbWithReplicas(): { primary: unknown; replicas: unknown[] };

const dbWithReplicas = remember('dbWithReplicas', () => {
  return createDbWithReplicas();
});



// --- argument-type-mismatch FP: Prisma findMany then map with Promise chaining ---
declare const db: {
  session: {
    findMany(opts: {
      where: { userId: string; id: { not: string } };
      select: { id: boolean };
    }): Promise<Array<{ id: string }>>;
  };
};

async function getOtherSessionIds(
  userId: string,
  currentSessionId: string,
): Promise<string[]> {
  return db.session
    .findMany({
      where: { userId, id: { not: currentSessionId } },
      select: { id: true },
    })
    .then((sessions) => sessions.map((s) => s.id));
}



declare const prismaDb: { apiKey: { findMany: (opts: unknown) => Promise<unknown[]>; count: (opts: unknown) => Promise<number> } };
declare const PrismaLib: { QueryMode: { insensitive: string } };
declare type ApiKeyWhereInput = { userId: number; name?: { contains: string; mode: string } };
declare type FindResultResponse<T> = { data: T[]; totalPages: number; totalCount: number };

export interface FindApiKeysOptions {
  userId: number;
  query?: string;
  page?: number;
  perPage?: number;
  orderBy?: {
    column: string;
    direction: 'asc' | 'desc';
  };
}

export const findApiKeys = async ({ userId, query = '', page = 1, perPage = 10, orderBy }: FindApiKeysOptions): Promise<FindResultResponse<unknown>> => {
  const orderByColumn = orderBy?.column ?? 'createdAt';
  const orderByDirection = orderBy?.direction ?? 'desc';

  const whereClause: ApiKeyWhereInput = { userId };

  if (query.length > 0) {
    whereClause.name = {
      contains: query,
      mode: PrismaLib.QueryMode.insensitive,
    };
  }

  const [data, count] = await Promise.all([
    prismaDb.apiKey.findMany({
      where: whereClause,
      skip: Math.max(page - 1, 0) * perPage,
      take: perPage,
      orderBy: { [orderByColumn]: orderByDirection },
    }),
    prismaDb.apiKey.count({ where: whereClause }),
  ]);

  return {
    data: data as unknown[],
    totalPages: Math.ceil(count / perPage),
    totalCount: count,
  };
};



declare const trpcProcedure: { meta: (m: unknown) => unknown; input: (s: unknown) => unknown; output: (s: unknown) => unknown; query: (fn: (opts: { input: unknown; ctx: unknown }) => Promise<unknown>) => unknown };
declare const getPresignDownloadUrl: (opts: { documentDataId: string }) => Promise<string>;
declare function getEnvelopeByIdForDownload(opts: { id: { type: string; id: number }; type: string; userId: number; teamId?: number }): Promise<{ documentData?: { id: string }; envelopeItems?: Array<{ documentData: { id: string } }> }>;
declare const isEnvelopeCompleted: (status: string) => boolean;
declare const downloadFileMeta: unknown;
declare const ZDownloadFileRequestSchema: unknown;
declare const ZDownloadFileResponseSchema: unknown;

export const downloadFileBetaRoute = (trpcProcedure as unknown as {
  meta: (m: unknown) => typeof trpcProcedure;
  input: (s: unknown) => typeof trpcProcedure;
  output: (s: unknown) => typeof trpcProcedure;
  query: (fn: (opts: { input: { documentId: number; version?: string }; ctx: { teamId?: number; user: { id: number }; logger: { info: (v: unknown) => void } } }) => Promise<unknown>) => unknown;
})
  .meta(downloadFileMeta)
  .input(ZDownloadFileRequestSchema)
  .output(ZDownloadFileResponseSchema)
  .query(async ({ input, ctx }) => {
    const { teamId, user } = ctx;
    const { documentId, version } = input as { documentId: number; version?: string };

    ctx.logger.info({ input: { documentId, version } });

    const envelope = await getEnvelopeByIdForDownload({
      id: { type: 'documentId', id: documentId },
      type: 'DOCUMENT',
      userId: user.id,
      teamId,
    });

    if (!isEnvelopeCompleted((envelope as { status: string }).status)) {
      throw new Error('Document is not yet completed');
    }

    const documentDataId = envelope.documentData?.id ?? envelope.envelopeItems?.[0]?.documentData?.id;

    if (!documentDataId) {
      throw new Error('No document data found');
    }

    const url = await getPresignDownloadUrl({ documentDataId });

    return { url };
  });



declare const prismaInner: {
  tag: {
    findMany: (opts: unknown) => Promise<unknown[]>;
    count: (opts: unknown) => Promise<number>;
  };
  envelope: {
    count: (opts: unknown) => Promise<number>;
  };
};
declare const EnvelopeTypeEnum: { DOCUMENT: string; TEMPLATE: string };
declare type TagWhereInput = { teamId: number; parentId?: number | null; type?: string; OR?: unknown[] };
declare type VisibilityFilter = { visibility?: { in: string[] }; userId?: number };

export interface FindTagsOptions {
  teamId: number;
  userId: number;
  parentId?: number | null;
  type?: string;
  visibilityFilters?: VisibilityFilter;
}

export const findTagsInternal = async ({
  teamId,
  userId,
  parentId,
  type,
  visibilityFilters = {},
}: FindTagsOptions) => {
  const whereClause: TagWhereInput = {
    AND: [
      { parentId },
      {
        OR: [
          { teamId, ...visibilityFilters },
          { userId, teamId },
        ],
      },
    ],
  } as unknown as TagWhereInput;

  try {
    const tags = await prismaInner.tag.findMany({
      where: {
        ...whereClause,
        ...(type ? { type } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    const tagsWithDetails = await Promise.all(
      tags.map(async (tag) => {
        try {
          const [subtags, documentCount, templateCount] = await Promise.all([
            prismaInner.tag.findMany({
              where: { parentId: (tag as { id: number }).id, teamId, ...visibilityFilters },
              orderBy: { createdAt: 'desc' },
            }),
            prismaInner.envelope.count({
              where: {
                type: EnvelopeTypeEnum.DOCUMENT,
                folderId: (tag as { id: number }).id,
                deletedAt: null,
              },
            }),
            prismaInner.envelope.count({
              where: {
                type: EnvelopeTypeEnum.TEMPLATE,
                folderId: (tag as { id: number }).id,
                deletedAt: null,
              },
            }),
          ]);

          return {
            ...tag,
            subtags,
            documentCount,
            templateCount,
          };
        } catch {
          return tag;
        }
      }),
    );

    return tagsWithDetails;
  } catch (e) {
    throw e;
  }
};



declare const kyselyDb2: { $kysely: { selectFrom: (table: string) => unknown } };
declare const sqlLit2: { lit: (v: unknown) => unknown };
declare const jobRunner2: { trigger: (jobName: string, payload: unknown) => Promise<void> };
declare const dateLib2: { now: () => { minus: (opts: Record<string, number>) => { toJSDate: () => Date } } };
declare type SweepJobIO = { io: unknown };

export const runNotificationSweep = async ({ io }: SweepJobIO) => {
  const now = dateLib2.now();
  const fifteenMinutesAgo = now.minus({ minutes: 15 }).toJSDate();
  const sixHoursAgo = now.minus({ hours: 6 }).toJSDate();

  const pendingNotifications = await (kyselyDb2.$kysely
    .selectFrom('Notification') as unknown as {
      select: (cols: string[]) => unknown;
      where: (col: string, op: string, val: unknown) => unknown;
    })
    .select(['Notification.id', 'Notification.secondaryId'])
    .where('Notification.status', '=', 'PENDING')
    .where('Notification.deletedAt', 'is', null)
    .execute() as Promise<Array<{ id: number; secondaryId: string }>>;

  const unsent = await (pendingNotifications as unknown as Promise<Array<{ id: number; secondaryId: string }>>);

  for (const notification of await (pendingNotifications as unknown as Promise<Array<{ id: number; secondaryId: string }>>) ) {
    await jobRunner2.trigger('deliver-notification', {
      notificationId: notification.id,
      secondaryId: notification.secondaryId,
    });
  }
};



declare const zapierPrisma: { envelope: { findFirst: (opts: unknown) => Promise<unknown> }; envelopeItem: { findMany: (opts: unknown) => Promise<unknown[]> } };
declare const ZapierEnvelopeType: { DOCUMENT: string };
declare function validateZapierToken(opts: { authorization: string }): Promise<{ user: { id: number }; teamId: number }>;
declare function getZapierWebhooksByTeamId(teamId: number, userId: number): Promise<unknown[]>;

export const listTemplatesHandler = async (req: Request) => {
  try {
    const authorization = req.headers.get('authorization');

    if (!authorization) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { user, teamId } = await validateZapierToken({ authorization });

    const allWebhooks = await getZapierWebhooksByTeamId(teamId, user.id);

    const template = await zapierPrisma.envelope.findFirst({
      where: {
        userId: user.id,
        teamId,
        type: ZapierEnvelopeType.DOCUMENT,
      },
      include: {
        envelopeItems: {
          include: {
            documentData: true,
          },
        },
      },
    });

    return new Response(JSON.stringify({ webhooks: allWebhooks, template }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response('Internal Server Error', { status: 500 });
  }
};
