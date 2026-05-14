// ── Fixture: data-layer-depends-on-api FP (shape ad37b7afe1a1) ──────────────
// This is an API route handler, not a data-layer module.
// `handleAttachmentPdfRequest` is a route-helper that formats HTTP responses;
// the `getOptionalSession` import is used only in the inline route handler,
// not in a data-layer function.

declare const router: {
  get: (path: string, ...handlers: Array<(ctx: RouteContext) => Promise<unknown> | unknown>) => void;
};
declare function getOptionalSession(ctx: RouteContext): Promise<{ user?: { id: string } | null }>;
declare function verifyPresignToken(opts: { token: string }): Promise<{ userId: string } | undefined>;
declare const db: {
  attachments: {
    findFirst: (opts: {
      where: { id: string; containerId: string; dataId: string };
      include: { data: boolean; container: { select: { id: boolean; ownerId: boolean; teamId: boolean } } };
    }) => Promise<AttachmentRow | null>;
  };
};
declare function checkContainerAccess(opts: { userId: string; teamId: string | null }): Promise<boolean>;
declare function computeEtag(content: string): string;
declare function fetchFileContent(opts: { type: string; data: string }): Promise<Buffer | null>;

type RouteContext = {
  req: {
    valid: (part: string) => Record<string, string>;
    header: (name: string) => string | undefined;
  };
  json: (body: unknown, status?: number) => unknown;
  body: (data: Buffer) => unknown;
  header: (name: string, value: string) => void;
  status: (code: number) => unknown;
};

type AttachmentRow = {
  id: string;
  dataId: string;
  data: { type: string; data: string; initialData: string };
  container: { id: string; ownerId: string; teamId: string | null };
};

const ZAttachmentParamsSchema = { containerId: '', attachmentId: '', dataId: '', version: 'current' as 'current' | 'initial' };
const ZAttachmentQuerySchema = { presignToken: '' };

router.get(
  '/containers/:containerId/attachments/:attachmentId/data/:dataId/:version/attachment.pdf',
  async (ctx) => {
    const { containerId, attachmentId, dataId, version } = ctx.req.valid('param') as typeof ZAttachmentParamsSchema;
    const { presignToken } = ctx.req.valid('query') as typeof ZAttachmentQuerySchema;

    const session = await getOptionalSession(ctx);
    let userId = session.user?.id;

    if (presignToken) {
      const verified = await verifyPresignToken({ token: presignToken }).catch(() => undefined);
      userId = verified?.userId;
    }

    if (!userId) {
      return ctx.json({ error: 'Not found' }, 404);
    }

    const attachment = await db.attachments.findFirst({
      where: { id: attachmentId, containerId, dataId },
      include: {
        data: true,
        container: { select: { id: true, ownerId: true, teamId: true } },
      },
    });

    if (!attachment) {
      return ctx.json({ error: 'Not found' }, 404);
    }

    const hasAccess = await checkContainerAccess({
      userId,
      teamId: attachment.container.teamId,
    });

    if (!hasAccess) {
      return ctx.json({ error: 'Not found' }, 404);
    }

    return handleAttachmentPdfRequest({
      ctx,
      attachment,
      version,
      cacheStrategy: 'private',
    });
  },
);

type HandleAttachmentPdfRequestOptions = {
  ctx: RouteContext;
  attachment: AttachmentRow;
  version: 'current' | 'initial';
  cacheStrategy: 'private' | 'public';
};

export const handleAttachmentPdfRequest = async ({
  ctx,
  attachment,
  version,
  cacheStrategy,
}: HandleAttachmentPdfRequestOptions): Promise<unknown> => {
  const rawData = version === 'current' ? attachment.data.data : attachment.data.initialData;
  const etag = computeEtag(rawData);

  if (ctx.req.header('If-None-Match') === etag) {
    return ctx.status(304);
  }

  const file = await fetchFileContent({
    type: attachment.data.type,
    data: rawData,
  }).catch((err) => {
    console.error(err);
    return null;
  });

  if (!file) {
    return ctx.json({ error: 'Not found' }, 404);
  }

  ctx.header('Content-Type', 'application/pdf');
  ctx.header('ETag', etag);
  ctx.header('Cache-Control', `${cacheStrategy}, max-age=31536000, immutable`);

  return ctx.body(file);
};


// --- argument-type-mismatch FP: Hono route.get with multiple sValidator middleware handlers ---
// route.get(path, sValidator(...), sValidator(...), async handler) — standard Hono pattern; no type mismatch.
declare const zRoute: { object: (shape: Record<string, any>) => any; string: () => { optional(): any } };
declare function sValidator2(target: string, schema: any): (c: any, next: () => Promise<void>) => Promise<void>;
declare const reportRoute: { get: (path: string, ...handlers: any[]) => any };

const ZReportParamsSchema = zRoute.object({
  reportId: zRoute.string(),
  tokenId: zRoute.string(),
  dataId: zRoute.string(),
  version: zRoute.string(),
});

const ZReportQuerySchema = zRoute.object({
  accessToken: zRoute.string().optional(),
});

reportRoute.get(
  '/report/:reportId/token/:tokenId/data/:dataId/:version/report.pdf',
  sValidator2('param', ZReportParamsSchema),
  sValidator2('query', ZReportQuerySchema),
  async (c: any) => {
    const { reportId, tokenId, dataId, version } = c.req.valid('param');
    const { accessToken } = c.req.valid('query');
    return c.json({ reportId, tokenId, dataId, version, accessToken });
  },
);



// argument-type-mismatch: typed route handler with argument type error at call site
function parseAttachmentVersion(version: 'current' | 'initial', strict: boolean): string {
  return strict ? version.toUpperCase() : version;
}
// TS2345: Argument of type 'number' is not assignable to parameter of type 'boolean'
const _ver = parseAttachmentVersion('current', 1);

