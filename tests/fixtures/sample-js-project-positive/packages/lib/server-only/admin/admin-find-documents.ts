// Imported by @myapp/trpc/server/admin-router/find-documents.ts
// dead-module rule fails to resolve @myapp/lib cross-package alias

export interface AdminFindDocumentsInput {
  query?: string;
  status?: 'draft' | 'pending' | 'completed';
  page: number;
  pageSize: number;
}

export interface AdminDocument {
  id: string;
  title: string;
  status: string;
  ownerId: string;
  createdAt: Date;
}

export async function adminFindDocuments(
  input: AdminFindDocumentsInput
): Promise<{ documents: AdminDocument[]; total: number }> {
  const results = await queryDocumentsAsAdmin(input);
  return results;
}

declare function queryDocumentsAsAdmin(input: AdminFindDocumentsInput): Promise<{ documents: AdminDocument[]; total: number }>;



// --- argument-type-mismatch FP: Object.fromEntries() passed to a fill/configure function ---
declare function fillPdfForm(formData: Record<string, string | boolean | number>): Promise<Buffer>;

async function applyFieldValues(fieldEntries: Array<[string, string | boolean | number]>): Promise<Buffer> {
  const formData = Object.fromEntries(fieldEntries);
  return fillPdfForm(formData);
}



// --- argument-type-mismatch FP: nested .map() with .find() lookup ---
interface Template { id: number; name: string; }
interface RecipientMapping { templateRecipientId: number; email: string; name: string; }
interface TemplateRecipient { id: number; role: string; }

function buildRecipientList(
  template: Template & { recipients: TemplateRecipient[] },
  mappings: RecipientMapping[],
) {
  return template.recipients.map((templateRecipient) => {
    const mapping = mappings.find((m) => m.templateRecipientId === templateRecipient.id);
    return {
      role: templateRecipient.role,
      email: mapping?.email ?? '',
      name: mapping?.name ?? '',
    };
  });
}



// --- argument-type-mismatch FP: Prisma-style create with typed helper function ---
declare function createAuditLogEntry(opts: { type: string; userId: number; metadata?: Record<string, unknown> }): { type: string; userId: number; metadata?: Record<string, unknown> };
declare const db: { auditLog: { create: (args: { data: { type: string; userId: number; metadata?: Record<string, unknown> } }) => Promise<{ id: number }> } };

async function recordAuditEvent(type: string, userId: number, metadata?: Record<string, unknown>) {
  return db.auditLog.create({
    data: createAuditLogEntry({ type, userId, metadata }),
  });
}



// --- argument-type-mismatch FP: Promise.all with prisma findMany + count pattern ---
declare const prisma: {
  contract: {
    findMany: (args: { where: { ownerId: number }; skip: number; take: number }) => Promise<Array<{ id: number; title: string }>>;
    count: (args: { where: { ownerId: number } }) => Promise<number>;
  };
};

async function paginateContracts(ownerId: number, page: number, pageSize: number) {
  const whereClause = { ownerId };
  const [contracts, total] = await Promise.all([
    prisma.contract.findMany({ where: whereClause, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.contract.count({ where: whereClause }),
  ]);
  return { contracts, total, pageCount: Math.ceil(total / pageSize) };
}



// --- argument-type-mismatch FP: .every() with enum comparisons as predicate ---
enum ParticipantRole { VIEWER = 'VIEWER', APPROVER = 'APPROVER', SIGNER = 'SIGNER' }
enum ApprovalStatus { APPROVED = 'APPROVED', PENDING = 'PENDING', REJECTED = 'REJECTED' }

interface Participant {
  id: number;
  role: ParticipantRole;
  approvalStatus: ApprovalStatus;
}

function allApproved(participants: Participant[]): boolean {
  return participants.every(
    (p) =>
      p.role === ParticipantRole.APPROVER &&
      p.approvalStatus === ApprovalStatus.APPROVED,
  );
}



// --- argument-type-mismatch FP: async map over recipients with status guard and email validation ---
enum NotificationStatus { SENT = 'SENT', PENDING = 'PENDING', SKIPPED = 'SKIPPED' }

interface Recipient { id: number; email: string; name: string; notificationStatus: NotificationStatus; }

declare function sendReminderEmail(to: string, name: string): Promise<void>;
declare function isValidEmail(email: string): boolean;

async function notifyPendingRecipients(recipients: Recipient[]): Promise<void> {
  await Promise.all(
    recipients.map(async (recipient) => {
      if (recipient.notificationStatus !== NotificationStatus.PENDING) return;
      if (!isValidEmail(recipient.email)) return;
      await sendReminderEmail(recipient.email, recipient.name);
    }),
  );
}



// --- argument-type-mismatch FP: Kysely string-based innerJoin with column references ---
declare function createKyselyDb(): {
  selectFrom: (table: string) => {
    innerJoin: (table: string, leftCol: string, rightCol: string) => {
      select: (cols: string[]) => {
        where: (col: string, op: string, val: unknown) => {
          execute: () => Promise<Array<Record<string, unknown>>>
        }
      }
    }
  }
};

const db = createKyselyDb();

async function getActiveUserSignups(minSignups: number) {
  return db
    .selectFrom('user')
    .innerJoin('enrollment', 'enrollment.userId', 'user.id')
    .select(['user.id', 'user.email', 'enrollment.signupCount'])
    .where('enrollment.signupCount', '>=', minSignups)
    .execute();
}



// --- argument-type-mismatch FP: Promise.all over async map with destructuring ---
interface AttachmentInput { file: { buffer: Buffer; originalname: string }; orderOverride?: number; clientId: string; }

declare function uploadToStorage(buffer: Buffer, name: string): Promise<{ url: string; key: string }>;

async function processAttachments(attachments: AttachmentInput[]) {
  return Promise.all(
    attachments.map(async ({ file, orderOverride, clientId }, index) => {
      const { url, key } = await uploadToStorage(file.buffer, file.originalname);
      return { url, key, clientId, order: orderOverride ?? index };
    }),
  );
}



// --- argument-type-mismatch FP: !Number.isNaN() check after Number() conversion ---
function parseIntegerSafe(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isNaN(id) && Number.isInteger(id) && id > 0) {
    return id;
  }
  return null;
}



// Shape: Promise.all([findQuery.execute(), countQuery.execute()]) tuple destructuring — correct types
declare const findQuery: { execute: () => Promise<Array<{ id: string; name: string; volume: number }>> };
declare const countQuery: { execute: () => Promise<Array<{ count: string }>> };
declare const perPage: number;

export async function fetchOrganisationStats() {
  const [results, [{ count }]] = await Promise.all([findQuery.execute(), countQuery.execute()]);

  return {
    organisations: results,
    totalPages: Math.ceil(Number(count) / perPage),
  };
}


declare const prisma: { document: { findMany: (args: unknown) => Promise<unknown[]>; count: (args: unknown) => Promise<number> } };
declare const DocumentStatus: { DRAFT: string; PENDING: string; COMPLETED: string; CANCELLED: string };

import { z } from 'zod';

const AdminFindDocumentsSchema = z.object({
  query: z.string().optional(),
  status: z.nativeEnum(DocumentStatus).optional(),
  userId: z.string().cuid().optional(),
  organisationId: z.string().cuid().optional(),
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(100).default(25),
  sortBy: z.enum(['createdAt', 'updatedAt', 'title']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export async function adminFindDocuments(input: z.infer<typeof AdminFindDocumentsSchema>) {
  const { query, status, userId, organisationId, page, perPage, sortBy, sortOrder } =
    AdminFindDocumentsSchema.parse(input);

  const where: Record<string, unknown> = {};
  if (query) {
    where.title = { contains: query, mode: 'insensitive' };
  }
  if (status) where.status = status;
  if (userId) where.userId = userId;
  if (organisationId) where.organisationId = organisationId;

  const [documents, total] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        userId: true,
      },
    }),
    prisma.document.count({ where }),
  ]);

  return {
    documents,
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  };
}
// processing step 1: validate and transform input
  // processing step 2: validate and transform input
  // processing step 3: validate and transform input
  // processing step 4: validate and transform input
  // processing step 5: validate and transform input
  // processing step 6: validate and transform input
  // processing step 7: validate and transform input
  // processing step 8: validate and transform input
  // processing step 9: validate and transform input
  // processing step 10: validate and transform input
  // processing step 11: validate and transform input
  // processing step 12: validate and transform input
  // processing step 13: validate and transform input
  // processing step 14: validate and transform input
  // processing step 15: validate and transform input
  // processing step 16: validate and transform input
  // processing step 17: validate and transform input
  // processing step 18: validate and transform input
  // processing step 19: validate and transform input
}

function _longFn_19932f3a(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}
