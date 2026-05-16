export function selectById(table: string, id: string): string {
  return 'SELECT id, name, email FROM ' + table + ' WHERE id = $1 -- ' + id;
}
export function insertRecord(table: string, name: string, email: string): string {
  return 'INSERT INTO ' + table + ' (name, email) VALUES ($1, $2) -- ' + name + email;
}
export function deleteOld(table: string, olderThan: string): string {
  return 'DELETE FROM ' + table + ' WHERE created_at < $1 -- ' + olderThan;
}

// ---------------------------------------------------------------------------
// unvalidated-external-data — locals named body/data/payload that are NOT
// user input. Pre-fix the rule flagged any identifier with these names.
// ---------------------------------------------------------------------------

declare const cache: { get(key: string): Promise<unknown> };
declare const internalEvents: { read(): InternalEvent };
interface InternalEvent { kind: string; }
declare const Record: { insert(value: unknown): Promise<void> };

// Positive: local var named `data` initialized from cache (not from a request)
export async function syncFromCache(userId: string): Promise<void> {
  const data = await cache.get(userId);
  await Record.insert(data);
}

// Positive: local var named `body` initialized from a render call
export async function persistRenderedBody(): Promise<void> {
  const body = renderEmailBody();
  await Record.insert({ body });
}
function renderEmailBody(): string { return 'hello'; }

// Positive: local var named `payload` from an internal event reader
export async function persistInternalEventPayload(): Promise<void> {
  const event = internalEvents.read();
  const payload = { kind: event.kind, ts: Date.now() };
  await Record.insert(payload);
}



// FP shape: table.column string in a single DB join condition (single-usage-false-trigger)
declare const db: {
  selectFrom: (table: string) => {
    innerJoin: (table: string, left: string, right: string) => {
      select: (cols: string[]) => { execute: () => Promise<unknown[]> };
    };
  };
};

async function getSignerConversionStats() {
  return db
    .selectFrom('Recipient')
    .innerJoin('User', 'Recipient.email', 'User.email')
    .select(['User.createdAt', 'Recipient.email'])
    .execute();
}



// FP shape: standard sort direction strings in a single ORM query orderBy clause (single-usage-false-trigger)
declare const prisma: {
  folder: {
    findMany: (opts: {
      where?: Record<string, unknown>;
      orderBy?: Array<Record<string, string>>;
    }) => Promise<Array<{ id: string; name: string; pinned: boolean; createdAt: Date }>>;
  };
};

async function findUserFolders(userId: string, type?: string) {
  return prisma.folder.findMany({
    where: { userId, ...(type ? { type } : {}) },
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
  });
}



// z.string().max(255) is a standard DB VARCHAR(255) field length constraint
declare const z: {
  string: () => {
    max: (n: number, opts?: { message?: string }) => {
      optional: () => unknown;
      min: (n: number) => { max: (n: number) => unknown };
    };
  };
  object: (shape: Record<string, unknown>) => unknown;
};

const recipientSchema = z.object({
  name: z.string().max(255, { message: 'Name must be at most 255 characters' }).optional(),
  email: z.string().max(255).optional(),
});



// z.string().max(255) for envelope recipient fields - standard VARCHAR DB constraint
declare const z: {
  string: () => {
    min: (n: number) => { max: (n: number) => { optional: () => unknown } };
    max: (n: number) => { optional: () => unknown };
  };
  object: (shape: Record<string, unknown>) => unknown;
};

const envelopeRecipientSchema = z.object({
  signerName: z.string().min(1).max(255).optional(),
  signerEmail: z.string().max(255).optional(),
});



// z.string().email().max(254) - RFC 5321 maximum email address length
declare const z: {
  string: () => {
    email: () => { max: (n: number) => { optional: () => unknown } };
    max: (n: number) => unknown;
  };
  object: (shape: Record<string, unknown>) => unknown;
};

const emailMetaSchema = z.object({
  cc: z.string().email().max(254).optional(),
  bcc: z.string().email().max(254).optional(),
  replyTo: z.string().max(254),
});



// z.string().min(1).max(255).optional() is a standard DB VARCHAR(255) field constraint
declare const z: {
  string: () => {
    min: (n: number) => {
      max: (n: number) => { optional: () => unknown };
    };
    max: (n: number) => { optional: () => unknown };
  };
  object: (shape: Record<string, unknown>) => unknown;
};

const envelopeSchema = z.object({
  subject: z.string().min(1).max(255).optional(),
  message: z.string().max(255).optional(),
  signerName: z.string().min(1).max(255).optional(),
});


// --- void-return-value FP: Array.pop() returns the removed element, not void ---
// entries.pop() returns the next cursor item (LogRecord | undefined), used for nextCursor.
type AuditLogPage<T> = { data: T[]; count: number; currentPage: number; perPage: number; totalPages: number; nextCursor?: string };

type LogRecord = { id: string; action: string; actorEmail: string; createdAt: Date };

declare const dbClient: {
  auditLog: {
    findMany(q: object): Promise<LogRecord[]>;
    count(q: object): Promise<number>;
  };
};

export async function paginateAuditLogs(
  contactId: string,
  page: number,
  perPage: number,
): Promise<AuditLogPage<LogRecord>> {
  const whereClause = { contactId };

  const [entries, count] = await Promise.all([
    dbClient.auditLog.findMany({
      where: whereClause,
      skip: Math.max(page - 1, 0) * perPage,
      take: perPage + 1,
    }),
    dbClient.auditLog.count({ where: whereClause }),
  ]);

  let nextCursor: string | undefined;

  if (entries.length > perPage) {
    const nextItem = entries.pop();
    nextCursor = nextItem!.id;
  }

  return {
    data: entries,
    count,
    currentPage: Math.max(page, 1),
    perPage,
    totalPages: Math.ceil(count / perPage),
    nextCursor,
  };
}



// FP: loadedPdf.destroy() is a PDF document lifecycle call, not a database write.
// The rule must not fire on canvas/PDF library teardown calls.
declare const pdfjsLib: { getDocument(config: { data: ArrayBuffer }): { promise: Promise<PdfDoc> } };
interface PdfDoc {
  numPages: number;
  destroy(): Promise<void>;
  getPage(n: number): Promise<{ render(ctx: unknown): { promise: Promise<void> } }>;
}

export async function renderPdfPreview(
  pdfData: ArrayBuffer,
  onReady: (doc: PdfDoc) => void,
): Promise<void> {
  let cancelled = false;

  const loadedPdf = await pdfjsLib.getDocument({ data: pdfData }).promise;

  if (cancelled) {
    await loadedPdf.destroy();
    return;
  }

  onReady(loadedPdf);
}



// FP: two ORM writes to different tables in same function without transaction
declare const userRepo: { create(data: { email: string; name: string }): Promise<{ id: number }> };
declare const profileRepo: { create(data: { userId: number; bio: string }): Promise<void> };

export async function createUserWithProfile(email: string, name: string, bio: string): Promise<void> {
  const user = await userRepo.create({ email, name });
  await profileRepo.create({ userId: user.id, bio });
}

