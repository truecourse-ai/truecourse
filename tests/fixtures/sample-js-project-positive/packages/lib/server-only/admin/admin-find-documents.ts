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
