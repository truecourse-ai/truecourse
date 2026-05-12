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


// Missing-transaction false-positive patterns from real codebases.

// tx-client-already-in-transaction: multiple tx.* writes are already executing
// inside a prisma.$transaction((tx) => ...) callback. The caller wraps them in
// a transaction, so the rule's intra-callback flagging is a FP.
declare const prismaTx: {
  $transaction: <T>(fn: (tx: {
    documentAuditLog: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> };
    recipient: { update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown> };
    field: { update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown> };
    signature: { deleteMany: (args: { where: { fieldId: string } }) => Promise<unknown> };
  }) => Promise<T>) => Promise<T>;
};
declare const envelopeId: string;
declare const recipientId: string;
declare const fieldId: string;
export async function completeRecipientStep(): Promise<void> {
  await prismaTx.$transaction(async (tx) => {
    await tx.recipient.update({
      where: { id: recipientId },
      data: { signedAt: new Date().toISOString() },
    });
    await tx.documentAuditLog.create({
      data: { envelopeId, type: 'RECIPIENT_UPDATED' },
    });
    await tx.field.update({
      where: { id: fieldId },
      data: { value: 'signed' },
    });
    await tx.signature.deleteMany({
      where: { fieldId },
    });
    await tx.documentAuditLog.create({
      data: { envelopeId, type: 'FIELD_UPDATED' },
    });
  });
}

// seed-script-sequential-writes: sequential prisma.* writes are intentional
// seeding patterns. Transactions are deliberately avoided so partial seeds
// can be resumed after a failure.
declare const seedPrisma: {
  user: { create: (args: { data: { email: string; name: string } }) => Promise<{ id: string }> };
  team: { create: (args: { data: { name: string; ownerId: string } }) => Promise<{ id: string }> };
  document: { create: (args: { data: { title: string; teamId: string } }) => Promise<{ id: string }> };
};
export async function seedDocumentsFixture(): Promise<void> {
  const owner = await seedPrisma.user.create({
    data: { email: 'owner@example.test', name: 'Owner' },
  });
  const team = await seedPrisma.team.create({
    data: { name: 'Seed Team', ownerId: owner.id },
  });
  await seedPrisma.document.create({
    data: { title: 'Welcome', teamId: team.id },
  });
  await seedPrisma.document.create({
    data: { title: 'Onboarding', teamId: team.id },
  });
}

// single-write-or-mutually-exclusive: only one prisma write occurs per code
// path. The second "write-shaped" call is an external Stripe API call (not a
// DB write), and the audit-log create lives in a separate failure branch that
// never co-executes with the happy-path delete.
declare const orgPrisma: {
  organisation: { update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown> };
  passkey: { delete: (args: { where: { id: string } }) => Promise<unknown> };
  auditLog: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> };
};
declare const stripe: {
  customers: { update: (id: string, data: Record<string, unknown>) => Promise<unknown> };
};
declare const organisationId: string;
declare const customerId: string;
declare const passkeyId: string;
declare const passkeyExists: boolean;
export async function removeTeamMember(): Promise<void> {
  await orgPrisma.organisation.update({
    where: { id: organisationId },
    data: { memberCount: { decrement: 1 } },
  });
  // External API call — not a DB write, but the rule treats .update on any
  // member-access expression as a write candidate.
  await stripe.customers.update(customerId, { metadata: { archived: 'true' } });
}
export async function deletePasskey(): Promise<void> {
  if (passkeyExists) {
    // Happy path: single delete, no co-executing write.
    await orgPrisma.passkey.delete({ where: { id: passkeyId } });
    return;
  }
  // Mutually-exclusive failure branch: only reached when the delete above
  // never executes.
  await orgPrisma.auditLog.create({
    data: { type: 'PASSKEY_NOT_FOUND', passkeyId },
  });
}

// non-db-method-call-false-match: .destroy() / .reload() / .load() on PDF and
// canvas lifecycle objects are not database writes. The rule's method-name
// match is too broad and incorrectly groups them with prisma writes.
declare const loadedPdf: { destroy: () => Promise<void>; reload: () => Promise<void> };
declare const pdfDoc: { reload: () => Promise<void>; load: (bytes: Uint8Array) => Promise<void> };
declare const pdfBytes: Uint8Array;
declare const canvas: { destroy: () => void; load: (src: string) => Promise<void> };
declare const previewUrl: string;
export async function refreshPdfPreview(): Promise<void> {
  await loadedPdf.destroy();
  await pdfDoc.reload();
  await pdfDoc.load(pdfBytes);
  canvas.destroy();
  await canvas.load(previewUrl);
}



// --- positive cases for database/deterministic/missing-unique-constraint ---

declare const prisma: {
  post: {
    findFirst: (args: unknown) => Promise<{ id: string; authorId: string; title: string } | null>;
    create: (args: unknown) => Promise<{ id: string }>;
  };
  postTag: {
    findFirst: (args: unknown) => Promise<{ id: string; tag_id: string; label: string | null } | null>;
    create: (args: unknown) => Promise<{ id: string }>;
  };
};

// shape-d00f39c90ee9 analog: PK+FK-style lookup but on NON-unique columns.
// `authorId` is a non-unique foreign key on Post and `title` is non-unique text;
// neither is verified unique in the Prisma schema, so the check-then-create here
// is race-prone (uniqueness enforced only in application code).
export async function ensurePostForAuthor(
  authorId: string,
  title: string,
): Promise<{ id: string }> {
  if (authorId.length > 0) {
    const existing = await prisma.post.findFirst({
      where: { authorId, title },
    });
    if (existing) return existing;
  }
  return prisma.post.create({
    data: { authorId, title, content: '' },
  });
}

// shape-3a8e99ea31bf analog: findFirst with orderBy on a NON-unique column,
// followed by a create in the same function. `tag_id` is non-unique on PostTag,
// so this is a textbook check-then-insert race (no DB-level UNIQUE on tag_id).
export async function appendLatestPostTag(
  tagId: string,
  label: string,
): Promise<{ id: string }> {
  if (tagId.length > 0) {
    const latest = await prisma.postTag.findFirst({
      where: { tag_id: tagId },
      orderBy: { id: 'desc' },
    });
    if (latest && latest.label === label) {
      return latest;
    }
  }
  return prisma.postTag.create({
    data: { tag_id: tagId, label },
  });
}


// orm-lazy-load-in-loop false-positive patterns from real codebases.
// All three shapes are PDF-library calls (pdf-lib's `PDF.load(buffer)`) that
// happen to share the trigger method name `load` and run inside loops. None
// of them are ORM lazy loads; they parse in-memory binary buffers.

declare const PDF: {
  load: (bytes: Uint8Array | ArrayBuffer) => Promise<{
    embedPage: (page: unknown) => Promise<unknown>;
    save: () => Promise<Uint8Array>;
  }>;
};

// shape-1554dd84d2cf: PDF.load(pdfData) inside a for-of loop where the
// binary blobs are pre-fetched OUTSIDE the loop via Promise.all. The await
// is in-process PDF parsing, not a per-iteration database round-trip.
declare const documentIdsForSeal: ReadonlyArray<string>;
declare const fetchPdfBytes: (id: string) => Promise<Uint8Array>;
export async function loadSealedDocuments(): Promise<Array<Uint8Array>> {
  const pdfBlobs = await Promise.all(documentIdsForSeal.map(fetchPdfBytes));
  const sealed: Array<Uint8Array> = [];
  for (const pdfData of pdfBlobs) {
    const pdfDoc = await PDF.load(pdfData);
    sealed.push(await pdfDoc.save());
  }
  return sealed;
}

// shape-7afc564f5293: PDF.load(overlayBytes) inside a for-of loop over PDF
// pages grouped by page number. The loop walks an in-memory grouping; each
// iteration parses an overlay buffer and embeds it into the host document.
declare const overlayBytesByPage: ReadonlyMap<number, Uint8Array>;
declare const hostPdf: {
  embedPdfPage: (page: unknown) => Promise<void>;
};
export async function applyPageOverlays(): Promise<void> {
  for (const [, overlayBytes] of overlayBytesByPage) {
    const overlayPdf = await PDF.load(overlayBytes);
    await hostPdf.embedPdfPage(overlayPdf);
  }
}

// shape-0235c30982be: PDF.load(new Uint8Array(bytes)) inside a for-of loop
// over envelope items, building an in-memory cache keyed by document id.
// No ORM accessor is involved; the awaited value is a parsed PDF, not a
// related entity fetched lazily from the database.
declare const envelopeItems: ReadonlyArray<{ documentId: string; bytes: ArrayBuffer }>;
export async function buildPdfCache(): Promise<Map<string, unknown>> {
  const pdfCache = new Map<string, unknown>();
  for (const item of envelopeItems) {
    const pdfDoc = await PDF.load(new Uint8Array(item.bytes));
    pdfCache.set(item.documentId, pdfDoc);
  }
  return pdfCache;
}
