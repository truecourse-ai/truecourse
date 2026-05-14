
// E02: new Set(array.map()) — building Set from mapped IDs; no type mismatch.
interface Contract {
  id: string;
  ownerId: string;
}

declare const contracts: Contract[];

function getUniqueOwnerIds(items: Contract[]): Set<string> {
  return new Set(items.map((c) => c.ownerId));
}

const ownerIdSet = getUniqueOwnerIds(contracts);



// E04: typed .map() with block body — processing array items; no type mismatch.
interface Participant {
  id: number;
  email: string;
  role: string;
}

declare const participants: Participant[];
declare function resolveSigningUrl(participantId: number): string;

const participantSummaries = participants.map((participant) => {
  const participantId = participant.id;
  const signingUrl = resolveSigningUrl(participantId);
  return { participantId, signingUrl, email: participant.email };
});



// E05: array .map() spreading objects and augmenting — no type mismatch.
interface Signer {
  id: string;
  email: string;
  name: string;
}

declare const signers: Signer[];
declare function buildAccessLink(signerId: string): string;

const signersWithLinks = signers.map((signer) => ({
  ...signer,
  accessLink: buildAccessLink(signer.id),
}));



// E06: array .filter() with inner .find() — typed predicate; no type mismatch.
interface FormField {
  id: string;
  templateId: string;
  required: boolean;
}

interface SubmittedValue {
  fieldId: string;
  value: string;
}

declare const templateFields: FormField[];
declare const submittedValues: SubmittedValue[];

const unansweredRequiredFields = templateFields.filter((templateField) => {
  const submittedValue = submittedValues.find((sv) => sv.fieldId === templateField.id);
  return templateField.required && !submittedValue;
});



// E11: array .find() with equality predicate — typed find; no type mismatch.
interface Reviewer {
  id: string;
  name: string;
  email: string;
}

declare const reviewers: Reviewer[];
declare const targetId: string;

function findReviewerById(id: string, pool: Reviewer[]): Reviewer | undefined {
  return pool.find((r) => r.id === id);
}

const assignedReviewer = findReviewerById(targetId, reviewers);



// E12: .map() wrapping objects into upload records — no type mismatch.
interface UploadedFile {
  name: string;
  size: number;
  type: string;
}

declare const uploadedFiles: UploadedFile[];
declare const uploadSessionId: string;

const uploadRecords = uploadedFiles.map((file) => ({
  file,
  sessionId: uploadSessionId,
  uploadedAt: new Date(),
}));



// E14: conditional Promise.all() — no type mismatch.
declare const targetKind: string;
declare function allocateSequenceNumber(): Promise<{ sequenceId: number; prefix: string }>;
declare function createDraftRecord(): Promise<{ id: string }>;

async function prepareResources(kind: string) {
  const results = await Promise.all([
    kind === 'numbered'
      ? allocateSequenceNumber().then(({ sequenceId, prefix }) => ({ sequenceId, prefix }))
      : Promise.resolve(null),
    createDraftRecord(),
  ]);
  return results;
}



// E15: .forEach() with explicit cast in callback — no type mismatch.
interface LineItem {
  id: string;
  product: unknown;
  amount: number;
}

interface ProductInfo {
  name: string;
  sku: string;
}

declare const lineItems: LineItem[];
declare const invoiceTotals: Map<string, number>;

lineItems.forEach((item) => {
  const product = item.product as ProductInfo;
  invoiceTotals.set(product.sku, item.amount);
});



// E29: function receiving .map() result — correctly typed array; no type mismatch.
interface MemberGroup {
  id: string;
  name: string;
  role: string;
}

interface OrgMembership {
  id: string;
  group: MemberGroup;
}

declare const memberships: OrgMembership[];
declare function getRoleInHighestGroup(groups: MemberGroup[]): string;

const highestRole = getRoleInHighestGroup(
  memberships.map((membership) => membership.group)
);



// E31: array .filter() with .includes() — string[] .includes(string) is correct; no type mismatch.
declare const selectedFormIds: string[];

interface LocalField {
  id: string;
  formId: string;
  pageIndex: number;
}

declare const localFields: LocalField[];

const selectedPageFields = localFields.filter((field) =>
  selectedFormIds.includes(field.formId)
);



// E32: array .find() with enum equality predicate — typed find; no type mismatch.
const enum MemberRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

interface OrgGroup {
  id: string;
  name: string;
  memberRole: MemberRole;
}

declare const orgGroups: OrgGroup[];
declare const targetRole: MemberRole;

const matchingGroup = orgGroups.find(
  (group) => group.memberRole === targetRole
);



// E43: conditional update inside .map() — no type mismatch.
declare const attachmentId: string;
declare const newPayload: Uint8Array;

interface Attachment {
  id: string;
  payload: Uint8Array;
}

declare let localAttachments: Attachment[];

localAttachments = localAttachments.map((att) =>
  att.id === attachmentId ? { ...att, payload: newPayload } : att
);



// E47: chained .filter().map() on typed array — no type mismatch.
const enum SigningStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  DECLINED = 'DECLINED',
}

interface ContractRecipient {
  id: string;
  email: string;
  signingStatus: SigningStatus;
}

declare const contractRecipients: ContractRecipient[];
declare function buildResendPayload(recipientId: string): { recipientId: string; priority: number };

const resendPayloads = contractRecipients
  .filter((recipient) => recipient.signingStatus === SigningStatus.PENDING)
  .map((recipient) => buildResendPayload(recipient.id));



// E49: while loop with array index access and typed predicate function — no type mismatch.
interface QueueItem {
  id: string;
  priority: number;
  locked: boolean;
}

declare const queueItems: QueueItem[];
declare function canItemBeProcessed(itemId: string): boolean;

function findNextProcessableIndex(items: QueueItem[], startFrom: number): number {
  let insertIndex = startFrom;
  while (insertIndex < items.length && !canItemBeProcessed(items[insertIndex].id)) {
    insertIndex++;
  }
  return insertIndex;
}



// Shape: (arr ?? []).map spread pattern on nullable array — correct types, no mismatch
declare const recipient: { attachments: string[] | null | undefined };

export function buildAttachmentList(recipient: { attachments: string[] | null | undefined }): string[] {
  return (recipient.attachments ?? []).map((url) => url.trim());
}



// --- FP shape: while loop where each iteration's result determines next iteration's input (linked-list traversal) ---
declare const db: {
  folder: { findUnique(opts: { where: { id: string } }): Promise<{ id: string; name: string; parentId: string | null } | null> };
};

async function buildFolderBreadcrumbs(folderId: string): Promise<Array<{ id: string; name: string }>> {
  const breadcrumbs: Array<{ id: string; name: string }> = [];
  let currentId: string | null = folderId;
  while (currentId !== null) {
    const folder = await db.folder.findUnique({ where: { id: currentId } });
    if (!folder) break;
    breadcrumbs.unshift({ id: folder.id, name: folder.name });
    currentId = folder.parentId;
  }
  return breadcrumbs;
}



// --- FP shape: while loop traversing parent chain where each iteration drives the next (cycle detection) ---
declare const db: {
  folder: { findUnique(opts: { where: { id: string }; select: object }): Promise<{ id: string; parentId: string | null } | null> }
};

async function detectAncestorCycle(folderId: string, targetParentId: string): Promise<boolean> {
  let currentParentId: string | null = targetParentId;
  const visited = new Set<string>();
  while (currentParentId !== null) {
    if (currentParentId === folderId) return true;
    if (visited.has(currentParentId)) break;
    visited.add(currentParentId);
    const currentParent = await db.folder.findUnique({
      where: { id: currentParentId },
      select: { id: true, parentId: true },
    });
    currentParentId = currentParent?.parentId ?? null;
  }
  return false;
}
