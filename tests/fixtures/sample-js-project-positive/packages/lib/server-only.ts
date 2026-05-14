
// --- FP shape 1b8baf0ca6c8: ORM $transaction with async callback ---
interface TransactionClient {
  user: {
    delete: (args: { where: { id: number } }) => Promise<{ id: number }>;
    findMany: (args: { where: { orgId: number } }) => Promise<Array<{ id: number }>>;
  };
  orgMembership: {
    deleteMany: (args: { where: { userId: number } }) => Promise<{ count: number }>;
  };
}

declare const db: {
  $transaction: <T>(callback: (tx: TransactionClient) => Promise<T>) => Promise<T>;
};

async function removeOrgMemberWithCleanup(orgId: number, userId: number): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.orgMembership.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
  });
}



// --- FP shape 1ba04e8b75fd: Hono route registration with validator middleware ---
interface HonoContext {
  req: {
    valid: (source: string) => unknown;
  };
  json: (body: unknown, status?: number) => Response;
}

interface RouterInstance {
  post: (path: string, ...handlers: Array<(c: HonoContext) => Response | Promise<Response>>) => RouterInstance;
  get: (path: string, ...handlers: Array<(c: HonoContext) => Response | Promise<Response>>) => RouterInstance;
}

declare function sValidator<T>(source: string, schema: T): (c: HonoContext, next: () => Promise<void>) => Promise<void>;

interface SignoutSessionInput {
  sessionToken: string;
}

declare const signoutSessionSchema: SignoutSessionInput;

declare const authRouter: RouterInstance;

authRouter.post('/signout-session', sValidator('json', signoutSessionSchema), async (c) => {
  const body = c.req.valid('json') as SignoutSessionInput;
  return c.json({ success: true, token: body.sessionToken });
});



// --- FP shape 1be1e8da34a3: Hono chained route handlers ---
interface AppContext {
  req: { json: () => Promise<unknown>; param: (key: string) => string };
  json: (body: unknown, status?: number) => Response;
}

interface AppRouter {
  get: (path: string, handler: (c: AppContext) => Response | Promise<Response>) => AppRouter;
  post: (path: string, handler: (c: AppContext) => Response | Promise<Response>) => AppRouter;
  delete: (path: string, handler: (c: AppContext) => Response | Promise<Response>) => AppRouter;
}

declare const apiV1: AppRouter;

apiV1
  .get('/documents', async (c) => {
    return c.json({ items: [] });
  })
  .post('/documents', async (c) => {
    const body = await c.req.json();
    return c.json({ created: body }, 201);
  })
  .delete('/documents/:id', async (c) => {
    const id = c.req.param('id');
    return c.json({ deleted: id });
  });



// FP shape 2e89724925f2: Prisma tx.model.create({data: {...}}) — standard ORM create
declare const db: { credential: { create: (opts: { data: { userId: string; publicKey: string; counter: number } }) => Promise<{ id: string }> } };
declare const userId: string;
declare const publicKey: string;

export async function storeCredential() {
  return db.credential.create({
    data: { userId, publicKey, counter: 0 },
  });
}



// --- FP shape: async service function returning Promise<void> (no explicit return, throws on error); trivially inferred ---
declare const prisma: { recipient: { findFirst(args: unknown): Promise<{ id: string; token: string } | null> } };
declare function sendEmail(to: string, subject: string, body: string): Promise<void>;

export async function rejectEnvelopeWithToken({ token, reason }: { token: string; reason: string }) {
  const recipient = await prisma.recipient.findFirst({
    where: { token },
  });

  if (!recipient) {
    throw new Error('Recipient not found');
  }

  await sendEmail(recipient.token, 'Rejected', reason);
}



// --- FP shape: async function returning result of SDK send() call; return type inferred from SDK generics ---
declare interface SdkCommand<TResult> { readonly _result: TResult }
declare function send<T>(command: SdkCommand<T>): Promise<T>
declare interface CreateDomainResult { DomainName?: string; VerificationToken?: string }
declare class CreateEmailIdentityCommand implements SdkCommand<CreateDomainResult> {
  readonly _result!: CreateDomainResult;
  constructor(input: { EmailIdentity: string; DkimSigningAttributes: { DomainSigningSelector: string; DomainSigningPrivateKey: string } });
}

export async function verifyDomainWithDKIM(domain: string, selector: string, privateKey: string) {
  const command = new CreateEmailIdentityCommand({
    EmailIdentity: domain,
    DkimSigningAttributes: {
      DomainSigningSelector: selector,
      DomainSigningPrivateKey: privateKey,
    },
  });

  return send(command);
}



// --- FP shape: private class method (prefixed _) returning a Canvas; trivially inferred from return statement, not a public API ---
declare class Canvas {
  constructor(width: number, height: number);
  gpu: boolean;
}

class ImageRenderer {
  _createCanvas(width: number, height: number) {
    const canvas = new Canvas(width, height);
    canvas.gpu = false;

    return canvas;
  }
}



// --- FP shape: simple arithmetic utility function returning number; return type trivially inferred from the expression ---
export function megabytesToBytes(megabytes: number) {
  return megabytes * 1_000_000;
}

export function kilobytesToBytes(kilobytes: number) {
  return kilobytes * 1_000;
}



type StripeEventObject = { object: 'subscription' | 'invoice' | 'payment_intent'; id: string };
type StripeEventWithPrev = StripeEventObject & { previous_attributes?: unknown };

declare function getStripeWebhookEvent(rawBody: Buffer, signature: string): Promise<{ type: string; data: { object: unknown; previous_attributes?: unknown } }>;

export async function handleStripeWebhook(rawBody: Buffer, signature: string): Promise<void> {
  const event = await getStripeWebhookEvent(rawBody, signature);

  if (event.type === 'subscription.updated') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const previousAttributes = event.data.previous_attributes as Record<string, any>;

    if (previousAttributes?.status) {
      const subscription = event.data.object as StripeEventObject;
      await processSubscriptionStatusChange(subscription.id, previousAttributes.status as string);
    }
  }
}

declare function processSubscriptionStatusChange(id: string, previousStatus: string): Promise<void>;



type PaymentProviderSubscription = { id: string; status: string; currentPeriodEnd: number };
type PaymentProviderInvoice = { id: string; amountDue: number; paid: boolean };
type PaymentEventData = { object: PaymentProviderSubscription | PaymentProviderInvoice };

declare function getPaymentWebhookEvent(rawBody: Buffer, sig: string): Promise<{ type: string; data: PaymentEventData }>;

export async function routePaymentWebhookEvent(rawBody: Buffer, sig: string): Promise<void> {
  const event = await getPaymentWebhookEvent(rawBody, sig);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  switch (event.type) {
    case 'subscription.created':
    case 'subscription.updated': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subscription = event.data.object as PaymentProviderSubscription;
      await handleSubscriptionChange(subscription);
      break;
    }

    case 'invoice.payment_succeeded': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoice = event.data.object as PaymentProviderInvoice;
      await handleInvoicePaid(invoice);
      break;
    }
  }
}

declare function handleSubscriptionChange(sub: PaymentProviderSubscription): Promise<void>;
declare function handleInvoicePaid(inv: PaymentProviderInvoice): Promise<void>;



type BillingSubscriptionEvent = { id: string; customerId: string; planId: string; status: 'active' | 'cancelled' | 'past_due' };
type BillingWebhookPayload = { type: string; data: { object: unknown } };

declare function parseBillingWebhookPayload(body: string, secret: string): Promise<BillingWebhookPayload>;

export async function processBillingWebhook(body: string, secret: string): Promise<void> {
  const payload = await parseBillingWebhookPayload(body, secret);

  if (payload.type.startsWith('subscription.')) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscription = payload.data.object as BillingSubscriptionEvent;
    await syncSubscriptionState(subscription);
  }
}

declare function syncSubscriptionState(subscription: BillingSubscriptionEvent): Promise<void>;



import * as fs from 'node:fs';
import * as path from 'node:path';

export async function readCertificateFile(certPath: string): Promise<string> {
  const resolved = path.resolve(certPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Certificate file not found: ${resolved}`);
  }

  const stat = fs.statSync(resolved);

  if (!stat.isFile()) {
    throw new Error(`Path is not a file: ${resolved}`);
  }

  return fs.readFileSync(resolved, 'utf-8');
}

export function writeCertificateFile(certPath: string, contents: string): void {
  const dir = path.dirname(certPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(certPath, contents, { encoding: 'utf-8', mode: 0o600 });
}



import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export async function writeSignedDocument(fileName: string, content: Buffer): Promise<string> {
  const outDir = path.join(os.tmpdir(), 'signed-documents');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, fileName);
  fs.writeFileSync(outPath, content);

  return outPath;
}

export function readSignedDocument(filePath: string): Buffer {
  const resolved = path.resolve(filePath);
  return fs.readFileSync(resolved);
}



import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

declare const PDFJS_WORKER_URL: string;

export async function countPdfPages(pdfBuffer: ArrayBuffer): Promise<number> {
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;

  return pdf.numPages;
}

export async function extractPdfTextContent(pdfBuffer: ArrayBuffer, pageNumber: number): Promise<string> {
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();

  return content.items.map((item: { str?: string }) => item.str ?? '').join(' ');
}



declare function randomUUID(): string;
declare const DATA_DIR: string;

class AnalyticsSingleton {
  private static instance: AnalyticsSingleton;
  private installationId: string | null = null;
  private readonly dataDir: string;

  private constructor() {
    this.dataDir = DATA_DIR;
  }

  static getInstance(): AnalyticsSingleton {
    if (!AnalyticsSingleton.instance) {
      AnalyticsSingleton.instance = new AnalyticsSingleton();
    }
    return AnalyticsSingleton.instance;
  }

  private getOrCreateInstallationId(): string {
    if (this.installationId) {
      return this.installationId;
    }

    this.installationId = randomUUID();
    return this.installationId;
  }

  getInstallationId(): string {
    return this.getOrCreateInstallationId();
  }
}

export const analyticsSingleton = AnalyticsSingleton.getInstance();



declare const LICENSE_CACHE_PATH: string;
declare function readFileSync(path: string, encoding: string): string;
declare function writeFileSync(path: string, data: string, opts: object): void;

class LicenseManager {
  private cachedLicense: string | null = null;

  private writeLicenseToCache(licenseKey: string): void {
    writeFileSync(LICENSE_CACHE_PATH, licenseKey, { encoding: 'utf-8', mode: 0o600 });
  }

  async activateLicense(licenseKey: string): Promise<boolean> {
    const isValid = await this.validateLicenseKey(licenseKey);

    if (isValid) {
      this.writeLicenseToCache(licenseKey);
      this.cachedLicense = licenseKey;
    }

    return isValid;
  }

  private async validateLicenseKey(_key: string): Promise<boolean> {
    return true;
  }
}

export const licenseManager = new LicenseManager();



declare const AUTH_SESSION_COOKIE_NAME: string;
declare function parseSessionToken(token: string): { userId: string; expiresAt: Date } | null;

class AuthClient {
  private sessionCache = new Map<string, { userId: string; expiresAt: Date }>();

  async getSession(cookieHeader: string | null): Promise<{ userId: string } | null> {
    if (!cookieHeader) {
      return null;
    }

    const token = this.extractSessionToken(cookieHeader);

    if (!token) {
      return null;
    }

    const cached = this.sessionCache.get(token);

    if (cached && cached.expiresAt > new Date()) {
      return { userId: cached.userId };
    }

    return null;
  }

  // Private helper — kept for potential future use in session refresh flows
  private buildSessionCookieHeader(token: string, maxAge: number): string {
    return `${AUTH_SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
  }

  private extractSessionToken(cookieHeader: string): string | null {
    const match = cookieHeader.match(new RegExp(`${AUTH_SESSION_COOKIE_NAME}=([^;]+)`));
    return match?.[1] ?? null;
  }
}

export const authClient = new AuthClient();



declare const db: { licenseKey: { findFirst: (opts: object) => Promise<{ key: string; validUntil: Date } | null> } };
declare const LICENSE_SERVER_URL: string;

class LicenseVerifier {
  private cachedValidation: { valid: boolean; expires: Date } | null = null;

  async isLicenseActive(): Promise<boolean> {
    const stored = await this.fetchStoredLicenseKey();

    if (!stored) {
      return false;
    }

    return stored.validUntil > new Date();
  }

  private async fetchStoredLicenseKey(): Promise<{ key: string; validUntil: Date } | null> {
    return db.licenseKey.findFirst({
      where: { revoked: false },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const licenseVerifier = new LicenseVerifier();



declare function createSkiaCanvas(width: number, height: number): { getContext: (type: string) => CanvasRenderingContext2D };

interface CanvasFactoryInterface {
  create(width: number, height: number): { canvas: unknown; context: CanvasRenderingContext2D };
  reset(canvasAndCtx: { canvas: unknown; context: CanvasRenderingContext2D }, width: number, height: number): void;
  destroy(canvasAndCtx: { canvas: unknown; context: CanvasRenderingContext2D }): void;
}

class SkiaCanvasFactory implements CanvasFactoryInterface {
  create(width: number, height: number): { canvas: unknown; context: CanvasRenderingContext2D } {
    const canvas = createSkiaCanvas(width, height);
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    return { canvas, context };
  }

  reset(
    canvasAndCtx: { canvas: unknown; context: CanvasRenderingContext2D },
    width: number,
    height: number,
  ): void {
    canvasAndCtx.canvas = createSkiaCanvas(width, height);
    canvasAndCtx.context = (canvasAndCtx.canvas as ReturnType<typeof createSkiaCanvas>).getContext('2d') as CanvasRenderingContext2D;
  }

  destroy(_canvasAndCtx: { canvas: unknown; context: CanvasRenderingContext2D }): void {
    // No-op — skia-canvas handles GC
  }
}

export const skiaCanvasFactory = new SkiaCanvasFactory();



declare const LICENSE_API_BASE_URL: string;
declare function fetchJson<T>(url: string, opts?: RequestInit): Promise<T>;

class LicenseApiClient {
  private apiKey: string | null = null;

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  async checkLicenseValidity(licenseKey: string): Promise<boolean> {
    const result = await this.fetchLicenseStatus(licenseKey);
    return result.valid;
  }

  private async fetchLicenseStatus(licenseKey: string): Promise<{ valid: boolean; expiresAt: string }> {
    return fetchJson<{ valid: boolean; expiresAt: string }>(
      `${LICENSE_API_BASE_URL}/validate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey }),
      },
    );
  }
}

export const licenseApiClient = new LicenseApiClient();



declare function createOffscreenCanvas(width: number, height: number): { getContext: (t: string) => CanvasRenderingContext2D; toDataURL: () => string };

interface RenderCanvasFactory {
  create(width: number, height: number): { canvas: unknown; context: CanvasRenderingContext2D };
  reset(pair: { canvas: unknown; context: CanvasRenderingContext2D }, w: number, h: number): void;
  destroy(pair: { canvas: unknown; context: CanvasRenderingContext2D }): void;
}

class OffscreenCanvasFactory implements RenderCanvasFactory {
  create(width: number, height: number): { canvas: unknown; context: CanvasRenderingContext2D } {
    const canvas = createOffscreenCanvas(width, height);
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    return { canvas, context };
  }

  reset(
    pair: { canvas: unknown; context: CanvasRenderingContext2D },
    width: number,
    height: number,
  ): void {
    const canvas = createOffscreenCanvas(width, height);
    pair.canvas = canvas;
    pair.context = canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  destroy(_pair: { canvas: unknown; context: CanvasRenderingContext2D }): void {
    // cleanup handled by GC
  }
}

export const offscreenCanvasFactory = new OffscreenCanvasFactory();



declare function allocateNodeCanvas(width: number, height: number): { getContext: (t: string) => CanvasRenderingContext2D };

interface NodeCanvasFactory {
  create(width: number, height: number): { canvas: unknown; context: CanvasRenderingContext2D };
  reset(pair: { canvas: unknown; context: CanvasRenderingContext2D }, w: number, h: number): void;
  destroy(pair: { canvas: unknown; context: CanvasRenderingContext2D }): void;
}

class NodeCanvasFactoryImpl implements NodeCanvasFactory {
  create(width: number, height: number): { canvas: unknown; context: CanvasRenderingContext2D } {
    const canvas = allocateNodeCanvas(width, height);
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    return { canvas, context };
  }

  reset(
    pair: { canvas: unknown; context: CanvasRenderingContext2D },
    width: number,
    height: number,
  ): void {
    const canvas = allocateNodeCanvas(width, height);
    pair.canvas = canvas;
    pair.context = canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  destroy(_pair: { canvas: unknown; context: CanvasRenderingContext2D }): void {
    // node-canvas manages memory lifecycle
  }
}

export const nodeCanvasFactory = new NodeCanvasFactoryImpl();



type DateRange = 'last30days' | 'last90days' | 'lastYear' | 'allTime';

type InsightWindow = {
  startDate: Date;
  endDate: Date;
  label: string;
};

export function getInsightWindow(dateRange: DateRange): InsightWindow {
  const now = new Date();
  const endDate = now;
  let startDate: Date;
  let label: string;

  switch (dateRange) {
    case 'last30days':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      label = 'Last 30 Days';
      break;
    case 'last90days':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      label = 'Last 90 Days';
      break;
    case 'lastYear':
      startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      label = 'Last Year';
      break;
    default:
      startDate = new Date(0);
      label = 'All Time';
      break;
  }

  return { startDate, endDate, label };
}



declare const prisma: {
  subscription: {
    findUnique: (opts: { where: { planId: string }; include?: object }) => Promise<{
      id: string;
      status: string;
      organisation: { organisationClaim: { id: string } };
    } | null>;
    delete: (opts: { where: { id: string } }) => Promise<void>;
    update: (opts: { where: { id: string }; data: object }) => Promise<void>;
  };
  $transaction: <T>(fn: (tx: typeof prisma) => Promise<T>) => Promise<T>;
};
declare function extractClaimId(priceItem: unknown): Promise<string | null>;
declare function buildFreeClaimData(claimId: string): object;
declare const FREE_PLAN_CLAIM_ID = 'free';
declare const INDIVIDUAL_PLAN_CLAIM_ID = 'individual';
declare const INACTIVE_STATUS = 'INACTIVE';

export type OnSubscriptionCancelledOptions = {
  subscriptionId: string;
  priceItem: unknown;
};

export const onSubscriptionCancelled = async ({
  subscriptionId,
  priceItem,
}: OnSubscriptionCancelledOptions) => {
  const existingSubscription = await prisma.subscription.findUnique({
    where: {
      planId: subscriptionId,
    },
    include: {
      organisation: {
        include: {
          organisationClaim: true,
        },
      },
    },
  });

  if (!existingSubscription) {
    return;
  }

  const claimId = await extractClaimId(priceItem);

  if (claimId === INDIVIDUAL_PLAN_CLAIM_ID) {
    await prisma.$transaction(async (tx) => {
      await tx.subscription.delete({
        where: {
          id: existingSubscription.id,
        },
      });

      await tx.subscription.update({
        where: {
          id: existingSubscription.organisation.organisationClaim.id,
        },
        data: {
          originalClaimId: FREE_PLAN_CLAIM_ID,
          ...buildFreeClaimData(FREE_PLAN_CLAIM_ID),
        },
      });
    });

    return;
  }

  await prisma.subscription.update({
    where: {
      id: existingSubscription.id,
    },
    data: {
      status: INACTIVE_STATUS,
    },
  });
};




// --- FP shape 62378e69ce2e: thin server adapter arrow function; line count inflated by type declarations and schema validation boilerplate ---
export type GetContractByTokenOptions = {
  token: string;
  requesterId?: string;
  accessAuth?: string[];
  requireAccessAuth?: boolean;
};

export type ContractAccessMode = 'VIEW' | 'SIGN' | 'ADMIN';

export type ContractParty = {
  id: string;
  token: string;
  email: string;
  role: string;
  accessAuthEnabled: boolean;
};

export type ContractBranding = {
  logoUrl?: string;
  primaryColor?: string;
  companyName?: string;
};

export type ContractMeta = {
  subject?: string;
  message?: string;
  redirectUrl?: string;
  signingOrder?: 'SEQUENTIAL' | 'PARALLEL';
};

export type ContractAndRequesterResult = {
  id: string;
  envelopeId: string;
  partyData: ContractParty;
  branding: ContractBranding;
  meta: ContractMeta;
  requester: { id: string; email: string; name: string };
};

declare const db: {
  envelope: {
    findFirstOrThrow: (opts: {
      where: object;
      include?: object;
    }) => Promise<{
      id: string;
      secondaryId: string;
      authOptions: unknown;
      parties: ContractParty[];
      branding: ContractBranding | null;
      meta: ContractMeta | null;
      requester: { id: string; email: string; name: string };
      envelopeItems: Array<{ id: string; title: string; order: number; documentDataId: string; documentData: { id: string; data: string } | null }>;
      team: { name: string; url: string; branding: ContractBranding | null } | null;
    }>;
  };
};

declare const ContractAccessSchema: {
  safeParse: (data: unknown) => { success: boolean; data?: { mode: ContractAccessMode } };
};

declare function resolveSecondaryId(secondaryId: string): string;
declare function isPartyAuthorized(opts: { type: string; authOptions: unknown; party: ContractParty; requesterId?: string; authData?: string[] }): Promise<boolean>;
declare class UnauthorizedError extends Error { constructor(opts: { message: string }); }

export const getContractAndRequesterByToken = async ({
  token,
  requesterId,
  accessAuth,
  requireAccessAuth = true,
}: GetContractByTokenOptions): Promise<ContractAndRequesterResult> => {
  if (!token) {
    throw new Error('Missing token');
  }

  const parsed = ContractAccessSchema.safeParse({ mode: accessAuth?.[0] });

  const result = await db.envelope.findFirstOrThrow({
    where: {
      type: 'CONTRACT',
      parties: {
        some: { token },
      },
    },
    include: {
      requester: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      meta: true,
      parties: {
        where: { token },
      },
      envelopeItems: {
        select: {
          id: true,
          title: true,
          order: true,
          documentDataId: true,
          documentData: true,
        },
      },
      team: {
        select: {
          name: true,
          url: true,
          branding: {
            select: {
              logoUrl: true,
              primaryColor: true,
              companyName: true,
            },
          },
        },
      },
    },
  });

  const firstItem = result.envelopeItems[0]?.documentData;

  if (!firstItem) {
    throw new Error('Missing document data for contract');
  }

  const party = result.parties[0];

  if (!party) {
    throw new Error('Missing party for token');
  }

  let accessValid = true;

  if (requireAccessAuth) {
    accessValid = await isPartyAuthorized({
      type: 'ACCESS',
      authOptions: result.authOptions,
      party,
      requesterId,
      authData: accessAuth,
    });
  }

  if (!accessValid) {
    throw new UnauthorizedError({ message: 'Invalid access credentials' });
  }

  const contractId = resolveSecondaryId(result.secondaryId);

  return {
    ...result,
    id: contractId,
    envelopeId: result.id,
    partyData: party,
    branding: result.branding ?? result.team?.branding ?? {},
    meta: result.meta ?? {},
    requester: result.requester,
  };
};



// FP: var inside declare global block is required TypeScript syntax — const/let are invalid here
declare global {
  // eslint-disable-next-line no-var
  var __globalCacheStore: Map<string, unknown> | undefined;
}

if (!global.__globalCacheStore) {
  global.__globalCacheStore = new Map();
}

export const globalCache = global.__globalCacheStore;
