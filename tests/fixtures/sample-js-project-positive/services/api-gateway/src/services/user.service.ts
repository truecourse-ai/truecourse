export class UserService {
  private readonly baseUrl = 'http://localhost:3001';
  findAll(): string { return `${this.baseUrl}/users`; }
  findById(id: string): string | null {
    if (id.length === 0) return null;
    return `${this.baseUrl}/users/${id}`;
  }
  create(input: { name: string; email: string }): string {
    return `${this.baseUrl}/users/${input.name}`;
  }
}



// FP shape: prisma.$transaction with conditional Prisma ops — standard transaction
declare const db: {
  $transaction: (fn: (tx: any) => Promise<void>) => Promise<void>;
};
declare const sourceId: string;
declare const targetId: string;

async function transferSubscription() {
  await db.$transaction(async (tx) => {
    const source = await tx.account.findUnique({ where: { id: sourceId } });
    if (source?.subscriptionId) {
      await tx.subscription.update({
        where: { id: source.subscriptionId },
        data: { accountId: targetId },
      });
    }
    await tx.account.update({
      where: { id: sourceId },
      data: { subscriptionId: null },
    });
    await tx.account.update({
      where: { id: targetId },
      data: { customerId: source?.customerId ?? null },
    });
  });
}



// FP shape: func(obj.relation.flatMap(item => item.nested)) — flatMap returns correct type
declare function getHighestPermissionLevel(permissions: string[]): string;
declare const memberToUpdate: { roleAssignments: Array<{ role: { name: string } }> };

function resolveEffectivePermission() {
  const effectiveRole = getHighestPermissionLevel(
    memberToUpdate.roleAssignments.flatMap((assignment) => assignment.role.name),
  );
  return effectiveRole;
}



// FP shape: array.some with enum comparison — standard array some predicate
declare enum ApprovalStatus { REJECTED = 'REJECTED', APPROVED = 'APPROVED', PENDING = 'PENDING' }
declare const contract: { approvers: Array<{ approvalStatus: ApprovalStatus }> };

function checkIfContractRejected() {
  const isRejected = contract.approvers.some(
    (approver) => approver.approvalStatus === ApprovalStatus.REJECTED,
  );
  return isRejected;
}



// FP shape: file.name.endsWith('.ext') with template literal — standard string method
declare const attachment: { name: string; size: number };
declare const storagePrefix: string;

async function uploadAttachment(): Promise<string> {
  if (attachment.name.endsWith('.pdf')) {
    const storedName = `${storagePrefix}/pdf/${attachment.name}`;
    return storedName;
  }
  return `${storagePrefix}/other/${attachment.name}`;
}



// FP shape: array.filter with conditional predicate — standard array filter
declare const workspace: { allowedDomains: Array<{ domain: string; isVerified: boolean }> };
declare const showUnverified: boolean;

function getEffectiveDomains() {
  return workspace.allowedDomains.filter(
    (entry) => showUnverified ? true : entry.isVerified,
  );
}



// FP shape: Promise.all([db.model.count(...), db.model.count(...)]) — standard concurrent queries
declare const db: {
  order: { count: (opts: { where: Record<string, unknown> }) => Promise<number> };
};
declare const teamId: number;
declare const startDate: Date;
declare const endDate: Date;

async function getOrderStats() {
  const [total, completed] = await Promise.all([
    db.order.count({ where: { teamId } }),
    db.order.count({ where: { teamId, completedAt: { gte: startDate, lte: endDate } } }),
  ]);
  return { total, completed };
}



// FP shape: db.$transaction(async tx => tx.model.delete({...})) — standard Prisma transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<void>) => Promise<void> };
declare const groupMemberId: number;

async function removeMemberFromGroup() {
  await db.$transaction(async (tx) => {
    await tx.groupMember.delete({
      where: { id: groupMemberId },
    });
  });
}



// FP shape: updateParticipants({userId, teamId, documentId, ...}) — function with named params
declare function updateDocumentParticipants(opts: {
  userId: number;
  teamId: number;
  documentId: number;
  participants: Array<{ email: string; role: string }>;
}): Promise<void>;
declare const currentUserId: number;
declare const currentTeamId: number;
declare const documentId: number;
declare const participants: Array<{ email: string; role: string }>;

async function saveParticipants() {
  await updateDocumentParticipants({ userId: currentUserId, teamId: currentTeamId, documentId, participants });
}



// FP shape: db.model.createMany({data: filteredItems.map(item => ({...}))}) — standard Prisma createMany
declare const db: { teamRole: { createMany: (opts: { data: unknown[] }) => Promise<void> } };
declare const validRoles: Array<{ name: string; permissions: string[] }>;
declare const teamId: number;

async function seedTeamRoles() {
  await db.teamRole.createMany({
    data: validRoles.map((role) => ({
      name: role.name,
      teamId,
      permissions: role.permissions.join(','),
    })),
  });
}



// FP shape: Promise.all([db.a.findFirstOrThrow(...), db.b.findFirstOrThrow(...)]) — parallel Prisma queries
declare const db: {
  order: { findFirstOrThrow: (opts: { where: Record<string, unknown> }) => Promise<{ id: number; status: string }> };
  invoice: { findFirstOrThrow: (opts: { where: Record<string, unknown> }) => Promise<{ id: number; total: number }> };
};
declare const orderId: number;
declare const invoiceId: number;

async function loadOrderAndInvoice() {
  const [order, invoice] = await Promise.all([
    db.order.findFirstOrThrow({ where: { id: orderId } }),
    db.invoice.findFirstOrThrow({ where: { id: invoiceId } }),
  ]);
  return { order, invoice };
}



// FP shape: db.model.createMany({data: items.map(item => ({...}))}) — standard Prisma createMany with map
declare const db: { orderAttachment: { createMany: (opts: { data: unknown[] }) => Promise<void> } };
declare const attachments: Array<{ fileName: string; url: string; mimeType: string }>;
declare const orderId: number;

async function saveOrderAttachments() {
  await db.orderAttachment.createMany({
    data: attachments.map((attachment) => ({
      fileName: attachment.fileName,
      url: attachment.url,
      mimeType: attachment.mimeType,
      orderId,
    })),
  });
}



// FP shape: array.some(({id}) => id === target.relationId) — standard destructuring some
declare const workspace: { members: Array<{ id: number; role: string }> };
declare const newInvite: { workspaceMemberId: number; inviteeEmail: string };

function isAlreadyMember(): boolean {
  return workspace.members.some(
    ({ id }) => id === newInvite.workspaceMemberId,
  );
}



// FP shape: items.map(async item => asyncProcess(...)) — standard async map
declare function applyTemplateValues(item: { id: string; template: string }, values: Record<string, string>): Promise<string>;
declare const contract: { clauses: Array<{ id: string; template: string }> };
declare const formValues: Record<string, string>;

async function renderContractClauses() {
  const rendered = await Promise.all(
    contract.clauses.map(async (clause) => applyTemplateValues(clause, formValues)),
  );
  return rendered;
}



// FP shape: promise.then(items => items.map(item => item.id)) — promise chain with map
declare const db: { authSession: { findMany: (opts: { where: Record<string, unknown> }) => Promise<Array<{ id: string; userId: number }>> } };
declare const userId: number;

async function getActiveSessionIds(): Promise<string[]> {
  return db.authSession
    .findMany({ where: { userId, isActive: true } })
    .then((sessions) => sessions.map((session) => session.id));
}



// FP shape: db.$transaction(async tx => tx.model.update({...})) — standard Prisma interactive transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<void>) => Promise<void> };
declare const signatureId: number;
declare const signatureData: string;

async function saveSignatureWithAudit() {
  await db.$transaction(async (tx) => {
    await tx.signature.update({
      where: { id: signatureId },
      data: { data: signatureData, signedAt: new Date() },
    });
  });
}



// FP shape: idsToAdd.map(id => ({id: generateId(...), groupId, ...})) — map creating DB records
declare function generateDatabaseId(prefix: string): string;
declare const memberIdsToAdd: number[];
declare const targetGroupId: number;
declare const addedByUserId: number;

function buildGroupMemberRecords() {
  return memberIdsToAdd.map((memberId) => ({
    id: generateDatabaseId('gm'),
    groupId: targetGroupId,
    memberId,
    addedBy: addedByUserId,
    joinedAt: new Date(),
  }));
}
