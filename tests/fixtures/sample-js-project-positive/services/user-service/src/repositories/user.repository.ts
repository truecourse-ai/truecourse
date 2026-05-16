import { PrismaClient, User } from '@prisma/client';

export class UserRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  findAll(): Promise<User[]> {
    return this.prisma.user.findMany();
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(data: { name: string; email: string }): Promise<User> {
    return this.prisma.user.create({ data });
  }

  archive(id: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { archived: true } });
  }
}



  // Positive FP: Promise.all with multiple Prisma query builder calls
  // This is a valid pattern for running ORM queries in parallel
  async findUserWithProfile(userId: string, organizationId: string) {
    const userWhereClause = { id: userId, active: true };
    const profileInclude = { include: { preferences: true, avatar: true } };

    const [userRecord, organizationProfile] = await Promise.all([
      this.prisma.user.findFirst({
        where: userWhereClause,
        include: profileInclude,
      }),
      this.prisma.user.findFirst({
        where: {
          organizationId: organizationId,
          role: 'admin',
        },
        include: profileInclude,
      }),
    ]);

    return userRecord ?? organizationProfile;
  }

  // Positive FP: Promise.all with different Prisma query methods
  async getUserStats(userId: string) {
    const [userDetails, activityCount, associatedProjects] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.activity.count({ where: { userId } }),
      this.prisma.project.findMany({ where: { ownerId: userId }, take: 10 }),
    ]);

    return { userDetails, activityCount, projects: associatedProjects };
  }



// Bulk member management operations
interface TeamMember {
  id: string;
  userId: string;
  teamId: string;
  role: string;
}

declare const db: {
  teamMember: {
    findMany(args: any): Promise<TeamMember[]>;
    deleteMany(args: any): Promise<{ count: number }>;
  };
};

export async function removeBulkTeamMembers(
  teamId: string,
  memberIdsToRemove: string[]
): Promise<string[]> {
  const currentMembers = await db.teamMember.findMany({
    where: { teamId }
  });

  const membersToDelete = currentMembers.filter((member) =>
    memberIdsToRemove.includes(member.id)
  );

  const removedUserIds = membersToDelete.map((member) => member.userId);

  await db.teamMember.deleteMany({
    where: {
      id: {
        in: memberIdsToRemove
      }
    }
  });

  return removedUserIds;
}



  async createBulkPreferences(
    userId: string,
    preferences: Array<{ category: string; enabled: boolean; metadata?: Record<string, unknown> }>
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    // Standard Prisma batch insert pattern - map input to create data
    const createdPreferences = await this.prisma.userPreference.createMany({
      data: preferences.map((pref) => ({
        userId: user.id,
        category: pref.category,
        enabled: pref.enabled,
        settings: pref.metadata || {},
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    });

    return createdPreferences;
  }

  async bulkCreateTags(
    items: Array<{ name: string; color?: string; priority?: number }>
  ) {
    // Another common pattern: transforming input array for batch creation
    await this.prisma.tag.createMany({
      data: items.map((item) => ({
        name: item.name,
        color: item.color ?? '#000000',
        priority: item.priority ?? 0,
        slug: item.name.toLowerCase().replace(/\s+/g, '-'),
      })),
    });
  }



// ---- argument-type-mismatch FP: Promise.all with ORM findMany + count (b6af359cbbfc) ----
declare const db: {
  document: {
    findMany(opts: {
      where: Record<string, unknown>;
      include?: Record<string, unknown>;
      skip?: number;
      take?: number;
      orderBy?: Record<string, string>;
    }): Promise<unknown[]>;
    count(opts: { where: Record<string, unknown> }): Promise<number>;
  };
};

async function listDocuments(
  filter: Record<string, unknown>,
  page: number,
  perPage: number,
) {
  const include = {
    owner: { select: { id: true, name: true, email: true } },
    tags: true,
    metadata: true,
  } as const;

  const where = filter;

  const [items, total] = await Promise.all([
    db.document.findMany({
      where,
      include,
      skip: Math.max(page - 1, 0) * perPage,
      take: perPage,
      orderBy: { createdAt: 'desc' },
    }),
    db.document.count({ where }),
  ]);

  return {
    items,
    total,
    currentPage: Math.max(page, 1),
    perPage,
    totalPages: Math.ceil(total / perPage),
  };
}


// --- argument-type-mismatch FP: pMap over contacts creating DB records ---
// pMap(sourceReport.contacts, async (contact) => prisma.contact.create({...})) — valid p-map usage.
declare function pMap2<T, R>(arr: T[], fn: (item: T) => Promise<R>): Promise<R[]>;
declare const prisma4: {
  contact: {
    create(args: { data: object }): Promise<{ id: string }>;
  };
};
declare const duplicatedReport: { id: string };
declare const sourceReport: {
  contacts: Array<{ email: string; name: string; role: string; notificationPreference: string }>;
};
declare const withContacts: boolean;

export async function duplicateReportContacts(): Promise<void> {
  if (withContacts) {
    await pMap2(
      sourceReport.contacts,
      async (contact) =>
        prisma4.contact.create({
          data: {
            reportId: duplicatedReport.id,
            email: contact.email,
            name: contact.name,
            role: contact.role,
            notificationPreference: contact.notificationPreference,
          },
        }),
    );
  }
}



// FP: prisma.$transaction with nested async map via Promise.all — correct usage, no type mismatch
declare const prismaClient: {
  $transaction: <T>(fn: (tx: PrismaTx) => Promise<T>) => Promise<T>;
};
interface PrismaTx {
  contactRecord: {
    upsert(opts: { where: object; create: object; update: object }): Promise<ContactRecord>;
  };
}
interface ContactRecord { id: number; email: string; role: string; formId: string }

declare const linkedContacts: Array<{
  id?: number;
  email: string;
  role: string;
  formId: string;
}>;

export async function persistContacts(): Promise<ContactRecord[]> {
  return prismaClient.$transaction(async (tx) => {
    return await Promise.all(
      linkedContacts.map(async (contact) => {
        return tx.contactRecord.upsert({
          where: { id: contact.id ?? -1 },
          create: { email: contact.email, role: contact.role, formId: contact.formId },
          update: { email: contact.email, role: contact.role },
        });
      }),
    );
  });
}



// FP shape: PasswordResetToken model intentionally allows multiple rows per userId —
// users may request multiple resets. findFirst with orderBy selects the most recent
// from a multi-row set; the code uses deleteMany on userId. Not a unique-constraint violation.
declare const prismaClient: {
  passwordResetToken: {
    findFirst: (args: {
      where: { userId: string };
      orderBy: { createdAt: 'desc' };
    }) => Promise<{ id: string; token: string; expiresAt: Date; createdAt: Date } | null>;
    deleteMany: (args: { where: { userId: string } }) => Promise<{ count: number }>;
  };
};

export async function findLatestPasswordResetToken(
  userId: string
): Promise<{ id: string; token: string; expiresAt: Date } | null> {
  return prismaClient.passwordResetToken.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function clearPasswordResetTokens(userId: string): Promise<void> {
  await prismaClient.passwordResetToken.deleteMany({ where: { userId } });
}



// async map with ORM findFirst call inside Promise.all — standard async map pattern
declare const db: {
  documentData: {
    findFirst(opts: { where: { id: string } }): Promise<{ id: string; content: string; mimeType: string } | null>;
  };
};

interface UploadRecord { documentDataId: string; fileName: string; recipientId: number; }

async function resolveDocumentDataForUploads(uploads: UploadRecord[]) {
  return Promise.all(
    uploads.map(async (upload) => {
      const documentData = await db.documentData.findFirst({
        where: {
          id: upload.documentDataId,
        },
      });
      return { ...upload, documentData };
    }),
  );
}



// Typed object lookup with bracket notation — exhaustively safe because the key type is an enum
// and the map satisfies Record<OrgMemberRole, TemplateVisibility[]> with all enum values covered.
declare const enum OrgMemberRole { ADMIN = 'ADMIN', MANAGER = 'MANAGER', MEMBER = 'MEMBER' }
declare const enum TemplateAccessLevel { ALL = 'ALL', MANAGERS_AND_ABOVE = 'MANAGERS_AND_ABOVE', ADMINS_ONLY = 'ADMINS_ONLY' }

const ORG_TEMPLATE_ACCESS_MAP = {
  [OrgMemberRole.ADMIN]: [
    TemplateAccessLevel.ALL,
    TemplateAccessLevel.MANAGERS_AND_ABOVE,
    TemplateAccessLevel.ADMINS_ONLY,
  ],
  [OrgMemberRole.MANAGER]: [
    TemplateAccessLevel.ALL,
    TemplateAccessLevel.MANAGERS_AND_ABOVE,
  ],
  [OrgMemberRole.MEMBER]: [
    TemplateAccessLevel.ALL,
  ],
} satisfies Record<OrgMemberRole, TemplateAccessLevel[]>;

export function getAccessibleTemplateLevels(role: OrgMemberRole): TemplateAccessLevel[] {
  return ORG_TEMPLATE_ACCESS_MAP[role];
}



// FP 3feaca27f400: new Stripe(apiKey ?? '', { apiVersion, typescript }) — SDK constructor call.
// Arguments are correctly typed; no argument type mismatch at the Stripe constructor call site.
declare class StripeSDK_3feac {
  constructor(apiKey: string, opts: { apiVersion: string; typescript: boolean }): void;
  customers: { create(data: { email: string }): Promise<{ id: string }> };
}
declare const STRIPE_API_KEY_3feac: string | undefined;
export const stripeClient_3feac = new StripeSDK_3feac(STRIPE_API_KEY_3feac ?? '', {
  apiVersion: '2022-11-15',
  typescript: true,
});



// FP fb45706ded7f: titleToUse.endsWith('.pdf') ? titleToUse.slice(0,-4) : titleToUse — ternary on string methods.
// putPdfFileServerSide called with normalizedPdf (Uint8Array) as Promise.resolve arg — no type mismatch.
type PutFileInput_fb457 = { name: string; type: string; arrayBuffer: () => Promise<ArrayBuffer> };
declare function putPdfFileServerSide_fb457(f: PutFileInput_fb457): Promise<{ documentData: { id: string } }>;
declare const normalizedPdf_fb457: Uint8Array;
export async function createEnvelopeDoc_fb457(item: { title?: string }, envelopeTitle: string) {
  const titleToUse = item.title || envelopeTitle;
  const { documentData } = await putPdfFileServerSide_fb457({
    name: titleToUse,
    type: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(normalizedPdf_fb457),
  });
  return { title: titleToUse.endsWith('.pdf') ? titleToUse.slice(0, -4) : titleToUse, id: documentData.id };
}



// FP c89946df6731: path.join(process.cwd(), 'public/static/logo.png') — string args to path.join.
// Both args are strings; path.join(...string[]) is the correct overload; no mismatch.
declare const nodePath_c899: { join: (...parts: string[]) => string };
declare const nodeFs_c899: { readFileSync: (p: string) => Buffer };
function loadBrandLogo_c899(): Buffer {
  const logoPath = nodePath_c899.join(process.cwd(), 'public/assets/brand-logo.png');
  return nodeFs_c899.readFileSync(logoPath);
}



// FP 50bb902ba0b3: Promise.allSettled([triggerWebhook({...}), ...]) — allSettled accepts Promise[].
// triggerWebhook returns Promise<void>; allSettled<T>(values: Iterable<T | PromiseLike<T>>) is correct.
declare function triggerWebhook_50bb9(config: { event: string; payload: Record<string, unknown>; subscriptionId: string }): Promise<void>;
export async function notifySubscribers_50bb9(
  eventType: string,
  subscriptionIds: string[],
  payload: Record<string, unknown>,
): Promise<void> {
  await Promise.allSettled(
    subscriptionIds.map((id) => triggerWebhook_50bb9({ event: eventType, payload, subscriptionId: id })),
  );
}



// FP a6a848b31b07: Object.assign(updatedField, { signature }) — intentional type escape hatch.
// Object.assign() accepts (target: object, source: object); valid call; not a type mismatch.
declare const updatedField_a6a848: { id: string; type: string; pageNumber: number };
declare const signatureData_a6a848: { signatureImageBase64: string; signatureType: string };
// Dirty but I don't want to deal with type information
Object.assign(updatedField_a6a848, { signatureData: signatureData_a6a848 });



// FP 39b2ec1ef18d: Object.values(data).length === 0 && Object.keys(meta).length === 0 — emptiness check.
// Object.values/keys accept any object; .length on resulting arrays is correct; no type mismatch.
export function isUpdateNoop_39b2ec(
  fieldsUpdate: Record<string, unknown>,
  metaUpdate: Record<string, string>,
): boolean {
  return Object.values(fieldsUpdate).length === 0 && Object.keys(metaUpdate).length === 0;
}



// FP f4c16e26a062: putPdfFileServerSide({ name, type, arrayBuffer: async () => buffer }) — valid typed call.
// putPdfFileServerSide expects File type with arrayBuffer: () => Promise<ArrayBuffer>; call is correctly typed.
type PutFileInput_f4c16 = { name: string; type: string; arrayBuffer: () => Promise<ArrayBuffer> };
declare function putPdfFileServerSide_f4c16(f: PutFileInput_f4c16): Promise<{ documentData: { id: string } }>;
declare const templateBuffer_f4c16: Uint8Array;
export async function storeTemplateDoc_f4c16(title: string) {
  const { documentData } = await putPdfFileServerSide_f4c16({
    name: `${title}.pdf`,
    type: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(templateBuffer_f4c16),
  });
  return documentData.id;
}



// FP 75d47a3de5ea: hostname.startsWith('[') ? hostname.slice(1, -1) : hostname — String.slice with two args.
// Both args are valid number literals; String.prototype.slice(start, end) is the correct signature.
export function normalizeWebhookHostname_75d47(rawHost: string): string {
  const hostname = rawHost.toLowerCase();
  // Strip IPv6 brackets if present: [::1] -> ::1
  const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  return bare.replace(/\.+$/u, '');
}



// FP shape 75d7eb6cd5f3: putPdfFileServerSide with arrayBuffer: async () => Promise.resolve(cleanedPdf)
// cleanedPdf is Uint8Array; File.arrayBuffer expects () => Promise<ArrayBuffer>.
// TS 2345: Promise<Uint8Array> not assignable to Promise<ArrayBuffer> — runtime safe (Uint8Array wraps ArrayBuffer).
type PutFileInput_75d7eb = { name: string; type: string; arrayBuffer: () => Promise<ArrayBuffer> };
declare function putPdfFileServerSide_75d7eb(f: PutFileInput_75d7eb): Promise<{ documentData: { id: string } }>;
declare const cleanedPdf_75d7eb: Uint8Array;
export async function uploadEnvelopeItem_75d7eb(name: string) {
  const { documentData } = await putPdfFileServerSide_75d7eb({
    name,
    type: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(cleanedPdf_75d7eb),
  });
  return documentData.id;
}



// FP 384bd1cd84e7: existingFields.filter(e => !fields.find(f => f.id === e.id)) — diff pattern.
// Standard Array.filter with nested Array.find predicate; not an argument type mismatch.
declare const existingFields_384bd: Array<{ id: string; type: string; value: string }>;
declare const updatedFields_384bd: Array<{ id: string; type: string; value: string }>;
declare function removeField_384bd(id: string): Promise<void>;
export async function reconcileFields_384bd(): Promise<void> {
  const removedFields = existingFields_384bd.filter(
    (existing) => !updatedFields_384bd.find((field) => field.id === existing.id),
  );
  for (const field of removedFields) { await removeField_384bd(field.id); }
}



// FP 46aaf5655f1b: recipient.fields.map((field) => ({...})) building Prisma createMany data.
// field properties correctly mapped; no argument type mismatch at the map() call site.
declare const sourceRecipient_46aaf: { fields: Array<{ type: string; page: number; positionX: number; positionY: number; width: number; height: number }> };
declare const newEnvelopeId_46aaf: string;
const fieldsData_46aaf = sourceRecipient_46aaf.fields.map((field) => ({
  envelopeId: newEnvelopeId_46aaf,
  type: field.type,
  page: field.page,
  positionX: field.positionX,
  positionY: field.positionY,
  width: field.width,
  height: field.height,
  customText: '',
  inserted: false,
}));



// FP 7c49af16e84f: fields.flatMap() with find() to validate field against recipient list.
// Standard Array.flatMap with Array.find predicate — no argument type mismatch.
declare const formFields_7c49af: Array<{ id: string; recipientId: string }>;
declare const recipients_7c49af: Array<{ id: string; name: string; email: string }>;
export function validateFieldRecipients_7c49af() {
  return formFields_7c49af.flatMap((field) => {
    const recipient = recipients_7c49af.find((r) => r.id === field.recipientId);
    if (!recipient) return [];
    return [{ ...field, recipient }];
  });
}



// FP 0a3674a7d3f6: putFileServerSide({ name, type: 'application/pdf', arrayBuffer: async () => Promise.resolve(normalized) }).
// Correctly typed object arg; File.arrayBuffer expects () => Promise<ArrayBuffer>; normalized is Uint8Array.
type PutFileInput_0a367 = { name: string; type: string; arrayBuffer: () => Promise<ArrayBuffer> };
declare function putFileServerSide_0a367(f: PutFileInput_0a367): Promise<{ type: string; data: string }>;
declare const normalizedBuffer_0a367: Uint8Array;
export async function storePdfDocument_0a367(fileName: string) {
  return putFileServerSide_0a367({
    name: fileName,
    type: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(normalizedBuffer_0a367),
  });
}



// FP f87ad8752325: Buffer.from(await file.arrayBuffer()) — file is Web API File; arrayBuffer() returns Promise<ArrayBuffer>.
// Buffer.from(ArrayBuffer) is a valid Node.js Buffer constructor overload; no type mismatch.
declare function normalizePdf_f87ad(buf: Buffer, opts?: { flattenForm?: boolean }): Promise<Buffer>;
export async function uploadNormalizedPdf_f87ad(file: File, opts: { flattenForm?: boolean } = {}): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const normalized = await normalizePdf_f87ad(buffer, opts);
  return normalized.toString('base64');
}



// FP 9d57f0484c4c: AUTO_SIGNABLE_FIELD_TYPES.includes(field.type) — standard Array.includes check.
// field.type is string; includes() parameter is string; no type mismatch at this call.
declare const AUTO_SIGNABLE_FIELD_TYPES_9d57: readonly string[];
interface EnvelopeField_9d57 { id: string; type: string; fieldMeta?: { readOnly?: boolean } }
export function canAutoSignField_9d57(field: EnvelopeField_9d57): boolean {
  if (!AUTO_SIGNABLE_FIELD_TYPES_9d57.includes(field.type)) {
    throw new Error(`Field type "${field.type}" does not support auto-sign`);
  }
  return true;
}



// FP d5b83e8e45c0: dynamic import with template literal — await import(`../translations/${locale}/web.${ext}`).
// import() with template literal is valid; no argument type mismatch at the import call site.
declare function getNodeEnv_d5b83(): string;
export async function loadLocaleBundle_d5b83(locale: string): Promise<Record<string, string>> {
  const ext = getNodeEnv_d5b83() === 'development' ? 'po' : 'mjs';
  const { messages } = await import(`../translations/${locale}/app.${ext}`);
  return messages as Record<string, string>;
}



// FP 77ad1cebe217: sharp(Buffer.from(bytes, 'base64')) — Buffer.from(string, encoding) returns Buffer.
// sharp(Buffer) is the canonical usage; Buffer.from(s, 'base64') is the correct overload.
declare function processImage_77ad1(input: Buffer): { resize: (w: number, h: number) => { toBuffer: () => Promise<Buffer> } };
export async function resizeAvatar_77ad1(base64Bytes: string): Promise<Buffer> {
  return processImage_77ad1(Buffer.from(base64Bytes, 'base64'))
    .resize(256, 256)
    .toBuffer();
}



// FP 54828755f3d3: putPdfFileServerSide({ name, type, arrayBuffer: async () => Promise.resolve(cleanedPdf) })
// file.arrayBuffer() returns Promise<ArrayBuffer>; putPdfFileServerSide expects same; no mismatch at call site.
type PutFileInput_54828 = { name: string; type: string; arrayBuffer: () => Promise<ArrayBuffer> };
declare function putPdfFileServerSide_54828(f: PutFileInput_54828): Promise<{ documentData: { id: string } }>;
declare const uploadedFileBytes_54828: Uint8Array;
export async function replaceEnvelopeItemPdf_54828(fileName: string) {
  const { documentData } = await putPdfFileServerSide_54828({
    name: fileName,
    type: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(uploadedFileBytes_54828),
  });
  return documentData.id;
}



// FP 3caadc03221b: path.join(process.cwd(), LICENSE_FILE_NAME) — two string args to path.join.
// Standard Node.js path construction; types match; no argument type mismatch.
declare const nodePath_3caad: { join: (...parts: string[]) => string };
const LICENSE_FILE_NAME_3caad = 'truecourse.lic';
export function getLicenseFilePath_3caad(): string {
  return nodePath_3caad.join(process.cwd(), LICENSE_FILE_NAME_3caad);
}

