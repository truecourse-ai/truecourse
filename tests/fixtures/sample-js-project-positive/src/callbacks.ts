/**
 * Callback patterns that should NOT trigger any rules.
 *
 * Arrow functions in find and map that USE their parameter.
 * Shorthand properties in return statements.
 * Proper use of array methods with concise callbacks.
 */

interface User {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

interface PaginationOptions {
  limit: number;
  offset: number;
}

export function findUserById(users: readonly User[], id: string): User | undefined {
  return users.find((user) => user.id === id);
}

export function findActiveUser(users: readonly User[]): User | undefined {
  return users.find((user) => user.active && user.name.length >= 0);
}

export function getUserNames(users: readonly User[]): string[] {
  return users.map((user) => user.name);
}

export function getUserEmails(users: readonly User[]): string[] {
  return users.map((user) => user.email.toLowerCase());
}

export function getActiveUsers(users: readonly User[]): User[] {
  return users.filter((user) => user.active && user.id.length > 0);
}

export function hasActiveUsers(users: readonly User[]): boolean {
  return users.some((user) => user.active);
}

export function allUsersActive(users: readonly User[]): boolean {
  return users.every((item) => item.active);
}

export function createPagination(page: number, pageSize: number): PaginationOptions {
  const limit = pageSize;
  const offset = (page - 1) * pageSize;
  return { limit, offset };
}

export function getActiveUserIds(users: readonly User[]): string[] {
  return users
    .filter((user) => user.active && user.name.length > 0)
    .map((user) => user.id);
}

export function groupByActive(users: readonly User[]): { active: User[]; inactive: User[] } {
  return users.reduce<{ active: User[]; inactive: User[] }>(
    (groups, user) => {
      if (user.active) {
        groups.active.push(user);
      } else {
        groups.inactive.push(user);
      }
      return groups;
    },
    { active: [], inactive: [] },
  );
}

export function sortByName(users: readonly User[]): User[] {
  return [...users].sort((a, b) => a.name.localeCompare(b.name));
}



// FP shape 0204839722a8: Object.values().filter() — filter predicate returns boolean, no type mismatch
interface TaskDefinition { trigger: { name: string }; handler: () => void; }
declare const _taskRegistry: Record<string, TaskDefinition>;

function findTasksByName(targetName: string): TaskDefinition[] {
  return Object.values(_taskRegistry).filter((task) => task.trigger.name === targetName);
}



// FP shape 02634f0f6c40: typed filter predicate narrowing enum type — no type mismatch
enum EventLogType { EMAIL_SENT = 'EMAIL_SENT', EMAIL_OPENED = 'EMAIL_OPENED', LINK_CLICKED = 'LINK_CLICKED' }
interface EventLog { id: string; type: EventLogType; timestamp: Date; }
declare const auditTrail: EventLog[];

const sentEvents = auditTrail.filter((log) => log.type === EventLogType.EMAIL_SENT);



// FP shape 027ad1daf90e: typed filter predicate with compound condition — no type mismatch
interface SignatureEvent { fieldId: string; userId: string; hasEncryption: boolean; }
interface GroupedEvents { SIGNATURE_ADDED: SignatureEvent[]; }
declare const eventGroups: GroupedEvents;
declare const targetUserId: string;

const encryptedSignatures = eventGroups.SIGNATURE_ADDED.filter(
  (evt) => evt.userId === targetUserId && evt.hasEncryption
);



// FP shape 03367c5eeda6: Promise.allSettled(Array.from(Set)) — correct argument type, no mismatch
declare const pendingUploads: { current: Set<Promise<void>> };

async function flushUploads(): Promise<void> {
  await Promise.allSettled(Array.from(pendingUploads.current));
}



// FP shape 0373b7652625: typed filter + .length — no type mismatch
enum MembershipTier { PREMIUM = 'PREMIUM', STANDARD = 'STANDARD', FREE = 'FREE' }
interface Membership { userId: string; tier: MembershipTier; }
interface Account { memberships: Membership[] }
declare const account: Account;

const premiumCount = account.memberships.filter(
  (m) => m.tier === MembershipTier.PREMIUM
).length;



// FP shape 03a882ebccd4: Array.filter with Array.includes — same element types, no type mismatch
interface WorkspaceUser { id: string; email: string; role: string; }
declare const workspace: { users: WorkspaceUser[] };
declare const selectedUserIds: string[];

const selectedUsers = workspace.users.filter(
  (user) => selectedUserIds.includes(user.id)
);



// FP shape 03c8b3b1f53c: async callback in Promise.all — no type mismatch
interface AttachmentFile { name: string; data: ArrayBuffer; mimeType: string; }
declare function uploadFile(data: ArrayBuffer, mimeType: string): Promise<string>;
declare const attachments: AttachmentFile[];

async function uploadAllAttachments() {
  const urls = await Promise.all(
    attachments.map(async (item) => {
      const url = await uploadFile(item.data, item.mimeType);
      return url;
    })
  );
  return urls;
}



// FP shape 04a5450ec2ac: Array.some with typed predicate — no type mismatch
interface LineItem { id: string; title?: string; quantity: number; price: number; }
declare const lineItems: LineItem[];

const hasTitledItems = lineItems.some((item) => item.title !== undefined);



// FP shape 04cb2246392d: Array.some with enum-inequality predicate — no type mismatch
enum SubmissionStatus { PENDING = 'PENDING', APPROVED = 'APPROVED', REJECTED = 'REJECTED' }
interface Submission { id: string; status: SubmissionStatus; }
declare const submissions: Submission[];

const hasPending = submissions.some(
  (sub) => sub.status !== SubmissionStatus.APPROVED
);



// FP shape 051267c9157e: async map with guard clause — no type mismatch
enum DeliveryStatus { PENDING = 'PENDING', SENT = 'SENT', FAILED = 'FAILED' }
interface Notification { id: string; recipientId: string; deliveryStatus: DeliveryStatus; }
declare function sendNotification(id: string, recipientId: string): Promise<void>;
declare const pendingNotifications: Notification[];

async function dispatchPending() {
  await Promise.all(
    pendingNotifications.map(async (notification) => {
      if (
        notification.deliveryStatus === DeliveryStatus.SENT ||
        notification.deliveryStatus === DeliveryStatus.FAILED
      ) return;
      await sendNotification(notification.id, notification.recipientId);
    })
  );
}



// FP shape 0579bb425a74: void-wrapped callback assigned to onDrop — no type mismatch
declare function processDroppedFiles(files: File[]): Promise<void>;
declare function useDropzone(opts: { onDrop: (files: File[]) => void }): { getRootProps: () => object };

function FileDropArea() {
  const { getRootProps } = useDropzone({
    onDrop: (files) => void processDroppedFiles(files),
  });
  return getRootProps();
}



// FP shape 05cbdbcb1a1a: optional-chained Array.find for email lookup — no type mismatch
interface Contact { id: string; email: string; phone?: string; }
declare const contacts: Contact[];
declare const assignment: { contactId: string };

const assignedEmail = contacts.find(
  (contact) => contact.id === assignment.contactId
)?.email ?? '';


// FP shape: .catch((error) => { console.error(error) }) — promise error handler
declare function uploadFile(data: Uint8Array): Promise<{ id: string }>;

function safeUpload(data: Uint8Array): void {
  uploadFile(data)
    .then((result) => {
      console.log('Uploaded:', result.id);
    })
    .catch((error) => {
      console.error(error);
    });
}



// D01: async map callback — no type mismatch
declare function resolveDocumentId(secondaryId: string): string;

interface PendingEnvelope {
  id: string;
  secondaryId: string;
  status: string;
}

declare const pendingEnvelopes: PendingEnvelope[];

export async function processPendingEnvelopes(): Promise<void> {
  await Promise.all(
    pendingEnvelopes.map(async (envelope) => {
      const documentId = resolveDocumentId(envelope.secondaryId);
      // process documentId
      return documentId;
    })
  );
}



// D04: typed find predicate on recipients array — no type mismatch
interface Recipient {
  id: string;
  email: string;
  role: string;
}

interface TemplateRecipient {
  id: string;
  placeholder: string;
}

export function matchRecipientToTemplate(
  recipients: Recipient[],
  templateRecipient: TemplateRecipient
): Recipient | undefined {
  return recipients.find((recipient) => recipient.id === templateRecipient.id);
}



// D05: forEach with nested find — no type mismatch
interface OrgMember {
  id: string;
  name: string;
}

interface Organisation {
  members: OrgMember[];
}

declare const organisation: Organisation;

export function validateMemberIds(memberIds: string[]): void {
  memberIds.forEach((memberId) => {
    const member = organisation.members.find(({ id }) => id === memberId);
    if (!member) {
      console.warn(`Member ${memberId} not found in organisation`);
    }
  });
}



// D07: .map().filter(x => x !== undefined) narrowing pattern — no type mismatch
interface FieldConfig {
  id: string;
  type: string;
  required: boolean;
}

declare function resolveFieldConfig(id: string): FieldConfig | undefined;

export function resolveAllFields(fieldIds: string[]): FieldConfig[] {
  return fieldIds
    .map((id) => resolveFieldConfig(id))
    .filter((field): field is FieldConfig => field !== undefined);
}



// D08: typed some predicate on group members — no type mismatch
interface GroupMember {
  id: string;
  userId: string;
}

interface Group {
  id: string;
  members: GroupMember[];
}

interface TeamMemberRow {
  original: { id: string };
}

export function isMemberInGroup(group: Group, row: TeamMemberRow): boolean {
  return group.members.some((member) => member.id === row.original.id);
}



// D09: optional-chained typed find predicate — no type mismatch
interface EnvelopeField {
  id: string;
  type: string;
  value: string | null;
}

interface RecipientWithFields {
  fields: EnvelopeField[];
}

declare const recipientWithFields: RecipientWithFields | null | undefined;

export function findFieldById(fieldId: string): EnvelopeField | undefined {
  return recipientWithFields?.fields.find((field) => field.id === fieldId);
}



// D10: flatMap returning typed objects, passed to function — no type mismatch
interface RoleGroup {
  role: string;
  permissions: string[];
}

interface GroupMembership {
  group: RoleGroup;
}

interface Member {
  organisationGroupMembers: GroupMembership[];
}

declare function getHighestRole(groups: RoleGroup[]): string;

export function resolveMemberHighestRole(member: Member): string {
  return getHighestRole(member.organisationGroupMembers.flatMap((m) => m.group));
}



// D14: typed filter with includes check — no type mismatch
interface GroupMemberEntry {
  organisationMemberId: string;
  role: string;
}

export function findMembersToRemove(
  currentMembers: GroupMemberEntry[],
  updatedMemberIds: string[]
): GroupMemberEntry[] {
  return currentMembers.filter(
    (member) => !updatedMemberIds.includes(member.organisationMemberId)
  );
}



// D16: typed find with compound predicate — no type mismatch
interface Organisation {
  id: string;
  name: string;
  slug: string;
}

declare const organisations: Organisation[];
declare const hoveredOrgId: string | null;

export function resolveDisplayedOrganisation(): Organisation | undefined {
  return organisations.find(
    (org) => org.id === hoveredOrgId || organisations.length === 1
  );
}



// D18: type predicate callback in find — standard TypeScript narrowing, no type mismatch
namespace PageTree {
  export interface Folder {
    type: 'folder';
    name: string;
    children: (Folder | Page)[];
  }
  export interface Page {
    type: 'page';
    name: string;
    url: string;
  }
}

type TreeNode = PageTree.Folder | PageTree.Page;

export function findRootFolder(nodes: TreeNode[]): PageTree.Folder | undefined {
  return nodes.find((child): child is PageTree.Folder => child.type === 'folder');
}



// D20: typed async callback passed to custom hook — no type mismatch
interface UploadedFile {
  name: string;
  size: number;
  data: ArrayBuffer;
}

declare function useAutosave(callback: (files: UploadedFile[]) => Promise<void>): void;
declare function uploadFiles(files: UploadedFile[]): Promise<void>;

export function useEditorAutosave(): void {
  useAutosave(async (files: UploadedFile[]) => {
    await uploadFiles(files);
  });
}



// D25: nested some predicate on deeply typed objects — no type mismatch
interface OrgGroupMember {
  organisationMemberId: string;
  role: string;
}

interface OrgGroup {
  organisationGroupMembers: OrgGroupMember[];
}

interface TeamGroupAssignment {
  organisationGroup: OrgGroup;
}

export function isMemberInTeamGroup(
  groups: TeamGroupAssignment[],
  memberId: string
): boolean {
  return groups.some((group) =>
    group.organisationGroup.organisationGroupMembers.some(
      (member) => member.organisationMemberId === memberId
    )
  );
}



// D27: map shaping typed recipient objects into response format — no type mismatch
interface CreatedRecipient {
  id: string;
  name: string;
  email: string;
  role: string;
  documentId: string;
}

interface EnvelopeWithRecipients {
  id: string;
  recipients: CreatedRecipient[];
}

interface RecipientSummary {
  id: string;
  name: string;
  email: string;
}

export function extractRecipientSummaries(
  createdEnvelope: EnvelopeWithRecipients
): RecipientSummary[] {
  return createdEnvelope.recipients.map((recipient) => ({
    id: recipient.id,
    name: recipient.name,
    email: recipient.email,
  }));
}



// D32: string array find predicate — no type mismatch
declare const SUPPORTED_TIME_ZONES: readonly string[];

interface DocumentMeta {
  timezone?: string;
}

export function validateTimezone(meta: DocumentMeta): string | undefined {
  return SUPPORTED_TIME_ZONES.find((tz) => tz === meta.timezone);
}



// D40: filter with nested find predicate — no type mismatch
interface LocalFile {
  name: string;
  size: number;
  type: string;
}

interface ExistingItem {
  fileName: string;
  fileSize: number;
}

interface Envelope {
  envelopeItems: ExistingItem[];
}

export function filterNewFiles(localFiles: LocalFile[], envelope: Envelope): LocalFile[] {
  return localFiles.filter(
    (item) =>
      !envelope.envelopeItems.find(
        (existing) => existing.fileName === item.name && existing.fileSize === item.size
      )
  );
}



// D41: findIndex with typed predicate inside useCallback — no type mismatch
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;

interface FormField {
  formId: string;
  type: string;
  value: string | null;
}

declare const localFields: FormField[];

export function useFindFieldIndex(formId: string) {
  return useCallback(
    () => {
      return localFields.findIndex((field) => field.formId === formId);
    },
    [formId]
  );
}



// D42: map augmenting typed objects with spread — no type mismatch
interface Recipient {
  id: string;
  email: string;
  name: string;
}

interface DocumentField {
  id: string;
  type: string;
  pageNumber: number;
  positionX: number;
  positionY: number;
}

interface EnrichedField extends DocumentField {
  recipient: Recipient & { documentId: string; templateId: null };
  documentId: string;
  templateId: null;
}

export function enrichFieldsWithRecipient(
  fields: DocumentField[],
  recipient: Recipient,
  documentId: string
): EnrichedField[] {
  return fields.map((field) => ({
    ...field,
    recipient: {
      ...recipient,
      documentId,
      templateId: null,
    },
    documentId,
    templateId: null,
  }));
}



// D49: mapping IDs to insert records for createMany — no type mismatch
declare function generateEntityId(prefix: string): string;

declare const prisma: {
  groupMember: {
    createMany(args: {
      data: Array<{ id: string; groupId: string; organisationMemberId: string }>;
    }): Promise<{ count: number }>;
  };
};

export async function addMembersToGroup(
  groupId: string,
  membersToCreate: string[]
): Promise<void> {
  if (membersToCreate.length > 0) {
    await prisma.groupMember.createMany({
      data: membersToCreate.map((id) => ({
        id: generateEntityId('group_member'),
        groupId,
        organisationMemberId: id,
      })),
    });
  }
}



// --- FP shape 186f36cff1bf: Promise.all with async map over typed array ---
interface FormFieldData {
  id: string;
  name: string;
  value: string;
  required: boolean;
}

declare function saveFormField(data: FormFieldData): Promise<{ id: string }>;

async function persistFormFields(fields: FormFieldData[]): Promise<void> {
  await Promise.all(
    fields.map(async (fieldData) => {
      const result = await saveFormField(fieldData);
      return result.id;
    }),
  );
}



// --- FP shape 18a2ba94aebc: immutable update pattern in .map() ---
interface UploadedFile {
  id: string;
  name: string;
  storageKey: string | null;
}

interface FileUploadResult {
  id: string;
  storageKey: string;
}

function applyUploadResult(files: UploadedFile[], data: FileUploadResult): UploadedFile[] {
  return files.map((item) =>
    item.id === data.id ? { ...item, storageKey: data.storageKey } : item,
  );
}



// --- FP shape 18f145e71120: Array.includes with matching element type ---
interface Notification {
  id: number;
  recipientId: number;
  message: string;
}

function filterUnreadNotifications(
  notifications: Notification[],
  readIds: number[],
): Notification[] {
  return notifications.filter((notification) => !readIds.includes(notification.recipientId));
}



// --- FP shape 195f2c5dacab: nested map with object spread ---
interface FieldData {
  id: string;
  pageNumber: number;
  label: string;
}

interface RecipientData {
  id: string;
  name: string;
  fields?: FieldData[] | null;
}

interface NormalizedField extends FieldData {
  page: number;
}

interface NormalizedRecipient {
  id: string;
  name: string;
  fields: NormalizedField[];
}

function normalizeRecipients(recipients: RecipientData[] | null): NormalizedRecipient[] {
  return (recipients || []).map((recipient) => ({
    ...recipient,
    fields: (recipient.fields || []).map((field) => ({
      ...field,
      page: field.pageNumber,
    })),
  }));
}



// --- FP shape 197ebea17025: .some() with typed predicate comparing to method result ---
interface CanvasField {
  id: string;
  formId: string;
  x: number;
  y: number;
}

interface FieldGroup {
  id(): string;
  label: string;
}

function hasFieldsInGroup(canvasFields: CanvasField[], group: FieldGroup): boolean {
  return canvasFields.some((field) => field.formId === group.id());
}



// --- FP shape 19b7061ac9a6: Object.values().map() with keyof assertion in predicate ---
interface FeatureFlag {
  key: string;
  label: string;
  isEnterprise: boolean;
}

interface LicenseFeatures {
  analytics: boolean;
  apiAccess: boolean;
  ssoIntegration: boolean;
}

const FEATURE_FLAGS: Record<keyof LicenseFeatures, FeatureFlag> = {
  analytics: { key: 'analytics', label: 'Analytics', isEnterprise: false },
  apiAccess: { key: 'apiAccess', label: 'API Access', isEnterprise: true },
  ssoIntegration: { key: 'ssoIntegration', label: 'SSO Integration', isEnterprise: true },
};

function renderFeatureList(licenseFeatures?: Partial<LicenseFeatures>): string[] {
  return Object.values(FEATURE_FLAGS).map(({ key, label, isEnterprise }) => {
    const enabled = licenseFeatures?.[key as keyof LicenseFeatures] ?? false;
    return `${label}: ${enabled ? 'enabled' : isEnterprise ? 'enterprise-only' : 'disabled'}`;
  });
}



// --- FP shape 1a960bda5471: async map with early return guard ---
type SendStatus = 'PENDING' | 'SENT' | 'FAILED';

interface Subscriber {
  id: string;
  email: string;
  sendStatus: SendStatus;
}

declare function sendNotificationEmail(email: string): Promise<void>;

async function notifySubscribers(subscribers: Subscriber[]): Promise<void> {
  await Promise.allSettled(
    subscribers.map(async (subscriber) => {
      if (subscriber.sendStatus !== 'PENDING') return;
      await sendNotificationEmail(subscriber.email);
    }),
  );
}



// --- FP shape 1add35dbb87b: Object.values().some() with keyof cast ---
interface CapabilityFlag {
  key: string;
  label: string;
  isEnterprise: boolean;
}

interface LicenseCapabilities {
  analytics: boolean;
  bulkSend: boolean;
  customBranding: boolean;
}

const CAPABILITY_FLAGS: Record<keyof LicenseCapabilities, CapabilityFlag> = {
  analytics: { key: 'analytics', label: 'Analytics', isEnterprise: false },
  bulkSend: { key: 'bulkSend', label: 'Bulk Send', isEnterprise: true },
  customBranding: { key: 'customBranding', label: 'Custom Branding', isEnterprise: true },
};

function requiresEnterpriseLicense(licenseCapabilities?: Partial<LicenseCapabilities>): boolean {
  return Object.values(CAPABILITY_FLAGS).some(
    (flag) => flag.isEnterprise && !licenseCapabilities?.[flag.key as keyof LicenseCapabilities],
  );
}



// --- FP shape 1b3651e5bf11: typed map with local variable from external call ---
interface SignerRecord {
  id: number;
  name: string;
  email: string;
  completedAt: Date | null;
}

interface AuditEntry {
  action: string;
  timestamp: Date;
}

declare function getSignerAuditLog(signerId: number): AuditEntry[];

interface SignerSummary {
  name: string;
  auditLogCount: number;
  index: number;
}

function buildSignerSummaries(signers: SignerRecord[]): SignerSummary[] {
  return signers.map((signer, i) => {
    const auditLogs = getSignerAuditLog(signer.id);
    return {
      name: signer.name,
      auditLogCount: auditLogs.length,
      index: i,
    };
  });
}



// --- FP shape 1b54c0f322a1: .some() comparing enum field ---
type ParticipantRole = 'SIGNER' | 'APPROVER' | 'VIEWER' | 'CC';

interface FormParticipant {
  id: string;
  email: string;
  role: ParticipantRole;
}

function hasViewerParticipant(participants: FormParticipant[]): boolean {
  return participants.some((p) => p.role === 'VIEWER');
}



// --- FP shape 1b606317284d: typed forEach with index accumulator ---
interface CheckboxValue {
  label: string;
  checked: boolean;
}

function getCheckedIndices(values: CheckboxValue[]): number[] {
  const checkedIndices: number[] = [];
  values.forEach((value, index) => {
    if (value.checked) {
      checkedIndices.push(index);
    }
  });
  return checkedIndices;
}



// --- FP shape 1b85ff0cfd5a: destructured map to composite string key ---
interface GroupMembership {
  memberId: number;
  groupId: number;
  addedAt: Date;
}

function buildMembershipKeys(memberships: GroupMembership[]): string[] {
  return memberships.map(({ memberId, groupId }) => `${memberId}:${groupId}`);
}



// --- FP shape 1bbe944ebaa9: conditional transform in .map() ---
interface FormRecipient {
  id: string;
  name: string;
  email: string;
  confirmed: boolean;
}

function confirmRecipient(recipients: FormRecipient[], targetId: string): FormRecipient[] {
  return recipients.map((recipient) => {
    if (recipient.id === targetId) {
      return { ...recipient, confirmed: true };
    }
    return recipient;
  });
}



// --- FP shape 1c3a416bfee7: typed .find() predicate with optional chaining ---
interface DateFormatOption {
  value: string;
  label: string;
  pattern: string;
}

const DATE_FORMAT_OPTIONS: DateFormatOption[] = [
  { value: 'MM/DD/YYYY', label: 'US format', pattern: 'MM/dd/yyyy' },
  { value: 'DD/MM/YYYY', label: 'European format', pattern: 'dd/MM/yyyy' },
  { value: 'YYYY-MM-DD', label: 'ISO format', pattern: 'yyyy-MM-dd' },
];

interface FieldMeta {
  dateFormat?: string;
  timeZone?: string;
}

function resolveFieldDateFormat(meta?: FieldMeta): DateFormatOption | undefined {
  return DATE_FORMAT_OPTIONS.find((format) => format.value === meta?.dateFormat);
}



// --- FP shape 1c548be74674: chained .filter().map() with index ---
interface DropdownItem {
  label: string;
  value: string | null;
  disabled?: boolean;
}

interface RenderedOption {
  index: number;
  label: string;
  value: string;
}

function buildActiveOptions(items: DropdownItem[]): RenderedOption[] {
  return items
    .filter((item) => Boolean(item.value) && !item.disabled)
    .map((item, index) => ({
      index,
      label: item.label,
      value: item.value as string,
    }));
}



// --- FP shape 1c66413e6c7d: type predicate filter ---
interface BaseTemplate {
  id: string;
  title: string;
}

interface PublicTemplate extends BaseTemplate {
  publicLink: { enabled: boolean; slug: string };
}

interface AnyTemplate extends BaseTemplate {
  publicLink?: { enabled: boolean; slug: string } | null;
}

function getPublicTemplates(templates: AnyTemplate[]): PublicTemplate[] {
  return templates.filter(
    (template): template is PublicTemplate => template.publicLink?.enabled === true,
  );
}



// --- FP shape 1c84bfee40c7: typed .find() comparing email field ---
interface InboxEntry {
  id: string;
  title: string;
  recipients: Array<{ id: string; email: string; status: string }>;
}

interface CurrentUser {
  id: string;
  email: string;
}

function findCurrentUserRecipient(
  entry: InboxEntry,
  user: CurrentUser,
): { id: string; email: string; status: string } | undefined {
  return entry.recipients.find((recipient) => recipient.email === user.email);
}



// --- FP shape 1ce4fa529ced: .filter() with compound predicate on typed array ---
interface CanvasAnnotation {
  id: string;
  widgetId: string;
  page: number;
  x: number;
  y: number;
}

function getAnnotationsForWidget(
  annotations: CanvasAnnotation[],
  widgetId: string,
  fromPage: number,
): CanvasAnnotation[] {
  return annotations.filter(
    (annotation) => annotation.widgetId === widgetId && annotation.page > fromPage,
  );
}



// --- FP shape 1d36e96e2406: async map with guard condition ---
interface ReminderTarget {
  id: string;
  email: string;
  lastReminderSentAt: Date | null;
  nextReminderAt: Date | null;
}

declare function sendReminderEmail(email: string): Promise<void>;
declare function updateNextReminderAt(id: string, nextAt: Date): Promise<void>;

async function processReminderTargets(targets: ReminderTarget[]): Promise<void> {
  await Promise.all(
    targets.map(async (target) => {
      if (!target.nextReminderAt) {
        return;
      }
      await sendReminderEmail(target.email);
      const nextAt = new Date(target.nextReminderAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      await updateNextReminderAt(target.id, nextAt);
    }),
  );
}



// --- FP shape 1d78e847d318: typed .filter() with index and payload guard ---
interface AttachedFile {
  id: string;
  name: string;
  sizeBytes: number;
}

interface UploadPayload {
  includeCustomData?: boolean;
  maxFiles?: number;
}

function filterEligibleFiles(files: AttachedFile[], payload: UploadPayload): AttachedFile[] {
  return files.filter(
    (file, index) =>
      payload.includeCustomData &&
      index < (payload.maxFiles ?? Infinity) &&
      file.sizeBytes > 0,
  );
}



// --- FP shape 1d97f7b5c59b: typed .find() by id field ---
interface FileAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  storageKey: string;
}

interface Envelope {
  id: string;
  title: string;
  attachments: FileAttachment[];
}

function findEnvelopeAttachment(
  envelope: Envelope,
  attachment: Pick<FileAttachment, 'id'>,
): FileAttachment | undefined {
  return envelope.attachments.find((a) => a.id === attachment.id);
}



// FP shape 2b41791007f7: filter with a predicate function that accepts the element type
declare function isItemPendingAndRequired(item: { status: string; required: boolean }): boolean;
declare const pendingItems: Array<{ status: string; required: boolean }>;

export function getRequiredPendingItems() {
  return pendingItems.filter((item) => isItemPendingAndRequired(item));
}



// FP shape 2b9c25418d8b: setLocalItems with immutable map+find update pattern
declare function setLocalItems(updater: (prev: Array<{ id: string; value: string }>) => Array<{ id: string; value: string }>): void;
declare const incomingData: { items: Array<{ id: string; value: string }> };
declare const existingItems: Array<{ id: string; value: string }>;

export function applyItemUpdate() {
  setLocalItems((prev) =>
    prev.map((item) => {
      const updated = incomingData.items.find((d) => d.id === item.id);
      return updated ? { ...item, value: updated.value } : item;
    }),
  );
}



// FP shape 2bcf6edcca20: chained filter+map on array — standard pattern
declare const selectedOptions: Array<{ id: string; label: string; active: boolean }>;
declare function formatLabel(label: string): string;

export function getActiveLabels(): string[] {
  return selectedOptions
    .filter((opt) => opt.active)
    .map((opt) => formatLabel(opt.label));
}



// FP shape 2c0fd4e93c1a: map with destructuring rest spread — standard pattern
declare const currentRole: string;
declare const orgList: Array<{ id: string; name: string; groups: string[]; url: string }>;

export function normalizeOrgs() {
  return orgList.map(({ groups, ...org }) => ({ ...org, currentRole }));
}



// FP shape 2c1e45bd47dc: array.find with equality predicate — standard usage
declare const DATE_FORMATS: Array<{ value: string; label: string }>;
declare const selectedValue: string;

export function findSelectedFormat() {
  return DATE_FORMATS.find((format) => format.value === selectedValue);
}



// FP shape 2c3d251d84ea: array.find with property equality — standard usage
declare const tenants: Array<{ url: string; name: string; id: string }>;
declare const tenantSlug: string;

export function findCurrentTenant() {
  return tenants.find((tenant) => tenant.url === tenantSlug);
}



// FP shape 2d0d491ecb81: array.map with function call inside body — standard array transformation
declare function resolveTemplateId(legacyId: string): string;
declare const documents: Array<{ id: string; legacyId: string; title: string }>;

export function normalizeDocuments() {
  return documents.map((doc) => {
    const resolvedId = resolveTemplateId(doc.legacyId);
    return { ...doc, resolvedId };
  });
}



// FP shape 2da1b7425bb7: setState functional updater with filter+find pattern
declare function setUploadedFiles(updater: (prev: Array<{ id: string; name: string }>) => Array<{ id: string; name: string }>): void;
declare const removedFileId: string;

export function removeUploadedFile() {
  setUploadedFiles((prev) => prev.filter((file) => file.id !== removedFileId));
}



// FP shape 2e0621af8630: array.find with id equality — standard array lookup
declare const lineItems: Array<{ id: string; quantity: number; unitPrice: number }>;
declare const targetId: string;

export function findLineItemById() {
  return lineItems.find((lineItem) => lineItem.id === targetId);
}



// FP shape 2e0a192fcc58: array.map with .at(index) access — standard array map with indexed lookup
declare const contactRequests: Array<{ email: string; role: string }>;
declare const defaults: Array<{ name: string; phone: string }>;

export function mergeContactData() {
  return contactRequests.map((req, index) => ({
    ...req,
    name: defaults.at(index)?.name ?? '',
    phone: defaults.at(index)?.phone ?? '',
  }));
}



// FP shape 2e10daa2e37f: Array.every() with .includes() check — standard boolean predicate
const NON_AUTO_ACTION_TYPES = ['manual', 'deferred', 'blocked'] as const;
type ActionType = typeof NON_AUTO_ACTION_TYPES[number];
declare const pendingActions: ActionType[];

export function areAllActionsNonAuto(): boolean {
  return pendingActions.every((action) => (NON_AUTO_ACTION_TYPES as readonly string[]).includes(action));
}



// FP shape 2e7752d98cc2: array.map with spread and additional prop — standard transformation
declare const createdOrder: { lineItems: Array<{ id: string; sku: string; quantity: number }> };
declare const orderId: string;

export function attachOrderIdToLineItems() {
  return createdOrder.lineItems.map((lineItem) => ({ ...lineItem, orderId }));
}



// FP shape 2f737abca034: useState initializer with array.map — standard state initialization
declare function useState<T>(initial: T): [T, (val: T) => void];
declare const group: { members: Array<{ id: string; name: string; role: string }> };

export function useGroupMemberState() {
  const [members, setMembers] = useState(
    group.members.map((m) => ({ id: m.id, name: m.name, selected: false })),
  );
  return { members, setMembers };
}



// FP shape 2fc3154509d9: array.map with item.id.startsWith — standard array transformation with string method
declare const lineItems: Array<{ id: string; label: string; quantity: number }>;
const DRAFT_PREFIX = 'draft_';

export function filterDraftLineItems() {
  return lineItems
    .map((item) => ({ ...item, isDraft: item.id.startsWith(DRAFT_PREFIX) }))
    .filter((item) => !item.isDraft);
}



// FP shape 30188ab05969: array.find with compound predicate — standard lookup
declare const contacts: Array<{ email: string; name: string; verified: boolean }>;
declare const targetEmail: string;
declare const targetName: string;

export function findVerifiedContact() {
  return contacts.find((c) => c.email === targetEmail && c.name === targetName);
}



// FP shape 303dfcb45256: optional-chain filter with fallback — standard null-safe filtering
declare const foldersData: { folders: Array<{ id: string; name: string; pinned: boolean }> } | undefined;

export function getUnpinnedFolders() {
  return foldersData?.folders.filter((folder) => !folder.pinned) ?? [];
}



// Generic useCallback with typed parameter — no type mismatch
declare function useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly any[]): T;
type Ref<T> = { current: T };
declare function useRef<T>(init: T): Ref<T>;

function useDataAutosave<T>(persistFn: (data: T) => Promise<void>, debounceMs = 500) {
  const pendingRef = useRef<T | null>(null);

  const scheduleFlush = useCallback(
    (data: T) => {
      pendingRef.current = data;
    },
    [persistFn],
  );

  return { scheduleFlush };
}



// Wave-M00: array.find with a side-effectful callback (parse + property access)
declare function parseAuthOptions(raw: unknown): { accessAuth: string[]; actionAuth: string[] };
declare const signers: Array<{ authOptions: unknown; actionAuth: string[] }>;

const signerHasAuthOptions = signers.find((signer) => {
  const authOptions = parseAuthOptions(signer.authOptions);
  return authOptions.accessAuth.length > 0 || authOptions.actionAuth.length > 0;
});

const formSignerHasActionAuth = signers.find((signer) => signer.actionAuth.length > 0);

const hasAuthSettings = signerHasAuthOptions !== undefined || formSignerHasActionAuth !== undefined;



// Wave-M01: array.filter with a permission-check predicate (string literal + enum arg)
declare function canExecuteTeamAction(action: 'MANAGE_SETTINGS' | 'MANAGE_BILLING', role: string): boolean;
declare const teams: Array<{ currentTeamRole: string; name: string }>;

const managedTeams = teams.filter((team) =>
  canExecuteTeamAction('MANAGE_SETTINGS', team.currentTeamRole)
);



// Wave-M04: .map() ternary replacement pattern — field.id === targetId ? updatedField : field
declare const fields: Array<{ id: string; value: string }>;
declare const targetId: string;
declare const updatedField: { id: string; value: string };

const updatedFields = fields.map((field) => (field.id === targetId ? updatedField : field));



// Wave-M11: array.find with enum equality check — both values are same enum type
declare enum MemberRole { ADMIN = 'ADMIN', MEMBER = 'MEMBER', VIEWER = 'VIEWER' }
declare const groups: Array<{ memberRole: MemberRole; id: string }>;
declare const targetRole: MemberRole;

const currentGroup = groups.find((group) => group.memberRole === targetRole);
const newGroup = groups.find((group) => group.memberRole === MemberRole.ADMIN);



// Wave-M25: array.filter(item => item.includes(substring)) — string array filter, correct types
declare function validateRangeField(value: string, meta: object, strict?: boolean): string[];
declare const parsedFieldMeta: object;
declare const inputText: string;

const validationErrors = validateRangeField(inputText, parsedFieldMeta, true);
const rangeErrors = {
  isValid: validationErrors.filter((error) => error.includes('valid number')),
  required: validationErrors.filter((error) => error.includes('required')),
  minValue: validationErrors.filter((error) => error.includes('minimum value')),
  maxValue: validationErrors.filter((error) => error.includes('maximum value')),
};



// Wave-M27: .map() over members building options objects — string fields mapped correctly
declare const members: Array<{ email: string; name: string | null }>;

const memberOptions = members.map((member) => ({
  value: member.email,
  label: member.name ? `${member.name} (${member.email})` : member.email,
}));



// Wave-M35: .map() with nested .find() to match items by id — id comparison between same types
declare const pages: Array<{ id: string; title: string }>;
declare const pageMetadata: Array<{ id: string; width: number; height: number }>;

const pagesWithDimensions = pages.map((page) => {
  const meta = pageMetadata.find((m) => m.id === page.id);
  return {
    ...page,
    width: meta?.width ?? 0,
    height: meta?.height ?? 0,
  };
});



// Wave-M39: setState updater with .map() ternary spread — functional setState returning same type array
declare function setLocalFiles(
  updater: (prev: Array<{ id: string; isUploading: boolean; name: string }>) => Array<{ id: string; isUploading: boolean; name: string }>
): void;
declare const fileId: string;

setLocalFiles((prev) =>
  prev.map((f) => (f.id === fileId ? { ...f, isUploading: false } : f))
);



// Wave-M44: .map() calling parser.setUA(item.userAgent || '') — string | null with fallback to empty string
declare class UAParser { setUA(ua: string): void; getResult(): { browser: { name?: string }; os: { name?: string } }; }
declare const auditLogs: Array<{ userAgent: string | null; action: string; timestamp: number }>;

const parser = new UAParser();
const parsedLogs = auditLogs.map((log) => {
  parser.setUA(log.userAgent || '');
  const result = parser.getResult();
  return {
    action: log.action,
    timestamp: log.timestamp,
    browser: result.browser.name,
    os: result.os.name,
  };
});



// Wave-M45: outer.data.map() with nested .map() on sub-array — all types correct
declare const orgMembers: {
  data: Array<{
    id: string;
    user: { id: number; email: string; name: string | null };
    groupMemberships: Array<{ group: { id: string; role: string } }>;
  }>;
};
declare function getHighestRole(groups: Array<{ id: string; role: string }>): string;

const mappedMembers = orgMembers.data.map((member) => {
  const groups = member.groupMemberships.map((gm) => gm.group);
  return {
    id: member.id,
    email: member.user.email,
    name: member.user.name ?? '',
    role: getHighestRole(groups),
  };
});



// Wave-M47: csvParser.parse(file, { comments: string, skipEmptyLines: boolean }) — valid parser API usage
declare const csvParser: {
  parse: <T>(input: unknown, options: { skipEmptyLines?: boolean; comments?: string | boolean; complete?: (results: { data: T[] }) => void }) => void;
};
declare const uploadedFile: unknown;

csvParser.parse(uploadedFile, {
  skipEmptyLines: true,
  comments: 'email,role',
  complete: (results) => {
    const rows = results.data as string[][];
    console.log('Parsed rows:', rows.length);
  },
});



// Wave-M48: array.filter((item) => item.recipientId === targetRecipientId) — same id types
declare const formFields: Array<{ id: string; recipientId: number; type: string }>;
declare const directRecipientId: number;

const recipientFields = formFields.filter(
  (field) => field.recipientId === directRecipientId
);



// Wave-M49: .filter() on audit log array for a specific event type — type-narrowing filter
declare const AUDIT_EVENT = { RECIPIENT_COMPLETED: 'RECIPIENT_COMPLETED', DOCUMENT_SENT: 'DOCUMENT_SENT' } as const;
type AuditEventType = typeof AUDIT_EVENT[keyof typeof AUDIT_EVENT];
declare const auditEvents: Array<{ type: AuditEventType; data: { recipientId?: number; timestamp: number } }>;
declare const recipientId: number;

const completionEvents = auditEvents.filter(
  (event) => event.type === AUDIT_EVENT.RECIPIENT_COMPLETED && event.data.recipientId === recipientId
);



// FP: .filter((item) => item.pinned) — valid boolean property filter predicate
interface GridItem { id: number; name: string; pinned: boolean; }
declare const gridItems: GridItem[];

const pinnedItems = gridItems.filter((item) => item.pinned);



// FP: .findIndex() callback (r) => r.id === target.id — same id type on both sides
interface Participant { id: number; name: string; role: string; }
declare const participants: Participant[];
declare const currentParticipant: Participant;

const participantIndex = participants.findIndex((r) => r.id === currentParticipant.id);



// FP: submitForm({fields: data.fields.map((field) => ({...}))}) — correctly typed mapped array passed to function
interface FormField { id: string; label: string; required: boolean; }
interface SubmitPayload { fields: Array<{ id: string; label: string; required: boolean; value: string }> }
declare function submitForm(payload: SubmitPayload): void;
declare const data: { fields: FormField[] };

function handleFormSubmit(values: Record<string, string>) {
  submitForm({
    fields: data.fields.map((field) => ({
      id: field.id,
      label: field.label,
      required: field.required,
      value: values[field.id] ?? '',
    })),
  });
}



// FP: callback ({ layer, canvas }) => renderToCanvas(layer, canvas) — destructured params with correct types
interface RenderContext { layer: number; canvas: HTMLCanvasElement; }
declare function renderToCanvas(layer: number, canvas: HTMLCanvasElement): void;
declare function onRender(callback: (ctx: RenderContext) => void): void;

onRender(({ layer, canvas }) => renderToCanvas(layer, canvas));



// FP: Object.values(FEATURE_FLAGS).filter((flag) => flag.isPremium && flag.enabled) — correctly typed callback
interface FeatureFlag { key: string; isPremium: boolean; enabled: boolean; label: string; }
declare const FEATURE_FLAGS: Record<string, FeatureFlag>;

const activePremuimFlags = Object.values(FEATURE_FLAGS).filter(
  (flag) => flag.isPremium && flag.enabled,
);



// FP: .map() with ZSchema.parse(item) — Zod parse call with correctly typed item
declare const ZAnnotationSchema: { parse: (val: unknown) => { id: string; text: string; page: number } };
declare const rawAnnotations: unknown[];

const annotations = rawAnnotations.map((item) => ZAnnotationSchema.parse(item));



// FP: (item.attachments ?? []).map((attachment) => {...}) — nullish coalescing with .map() is valid
interface Attachment { id: string; filename: string; size: number; mimeType: string; }
interface MessageItem { id: string; content: string; attachments?: Attachment[]; }
declare const messageItem: MessageItem;

const attachmentSummaries = (messageItem.attachments ?? []).map((attachment) => ({
  id: attachment.id,
  name: attachment.filename,
  sizeKb: Math.round(attachment.size / 1024),
}));



// FP: (item.fields ?? []).map((field) => ({...field, parentId})) — map with spread; types correct
interface FormField { id: string; label: string; type: string; required: boolean; }
interface FormSection { id: string; fields?: FormField[]; }
declare const section: FormSection;
declare const parentId: string;

const fieldsWithParent = (section.fields ?? []).map((field) => ({
  ...field,
  parentId,
}));



// FP: items.map((item) => transformItem(item, container)) — map passes item and container to mapping function; both correctly typed
interface LayoutItem { id: string; type: string; width: number; height: number; }
interface LayoutContainer { scale: number; padding: number; }
declare function transformItem(item: LayoutItem, container: LayoutContainer): LayoutItem & { scaledWidth: number };
declare const layoutItems: LayoutItem[];
declare const layoutContainer: LayoutContainer;

const scaledItems = layoutItems.map((item) => transformItem(item, layoutContainer));



// FP: collection.recipients.find((r) => r.id === targetField.recipientId) — both id types are the same
interface Assignee { id: number; name: string; email: string; }
interface TaskField { id: number; label: string; recipientId: number; }
interface TaskCollection { recipients: Assignee[] }
declare const taskCollection: TaskCollection;
declare const targetField: TaskField;

const assignee = taskCollection.recipients.find(
  (recipient) => recipient.id === targetField.recipientId,
);



// FP: .findIndex() with nested .filter() and length check — all arguments correctly typed
interface WorkflowStep { id: string; name: string; prerequisites: string[]; completed: boolean; }
declare const workflowSteps: WorkflowStep[];
declare const currentStepId: string;

const currentStepIndex = workflowSteps.findIndex((step) => {
  const completedPrereqs = step.prerequisites.filter((prereqId) =>
    workflowSteps.find((s) => s.id === prereqId)?.completed,
  );
  return step.id === currentStepId && completedPrereqs.length === step.prerequisites.length;
});



// FP: .map() ternary: (f.slotId === targetSlotId ? {...f, isActive: false} : f) — spreads same object type
interface SlotAssignment { slotId: string; userId: string; isActive: boolean; priority: number; }
declare const slotAssignments: SlotAssignment[];
declare const targetSlotId: string;

const updatedAssignments = slotAssignments.map((f) =>
  f.slotId === targetSlotId ? { ...f, isActive: false } : f,
);



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



interface Document {
  id: string;
  ownerId: string;
  pageCount: number;
  status: string;
}

export function filterValidDocuments(
  documents: readonly Document[],
  currentUser: { id: string },
  maxPages: number
): Document[] {
  return documents.filter(
    (doc) => doc.ownerId !== currentUser.id || doc.pageCount <= maxPages
  );
}

export function removeObsoleteItems<T extends { userId: string; version: number }>(
  items: readonly T[],
  targetUser: { userId: string },
  minVersion: number
): T[] {
  return items.filter(
    (item) => item.userId !== targetUser.userId || item.version <= minVersion
  );
}



// Promise.all with async map - standard pattern for parallel async operations
declare const fetchUserProfile: (id: string) => Promise<{ bio: string; avatar: string }>;
declare const fetchUserStats: (id: string) => Promise<{ posts: number; followers: number }>;

interface EnrichedUser extends User {
  profile: { bio: string; avatar: string };
  stats: { posts: number; followers: number };
}

export async function enrichUsersWithDetails(users: readonly User[]): Promise<EnrichedUser[]> {
  const enrichedUsers = await Promise.all(
    users.map(async (user) => {
      const [profile, stats] = await Promise.all([
        fetchUserProfile(user.id),
        fetchUserStats(user.id),
      ]);
      return {
        ...user,
        profile,
        stats,
      };
    })
  );
  return enrichedUsers;
}

export async function batchProcessUsers(users: readonly User[]): Promise<string[]> {
  const results = await Promise.all(
    users.map(async (user) => {
      const profile = await fetchUserProfile(user.id);
      return `${user.name}: ${profile.bio}`;
    })
  );
  return results;
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



// Shape 613486fb54ab: Array.includes() with enum value on string array.
enum AccessMethod { TWO_FACTOR = 'TWO_FACTOR', PASSKEY = 'PASSKEY', PASSWORD = 'PASSWORD' }
declare const allowedAuthMethods: string[];

function isAuthMethodAllowed(method: AccessMethod): boolean {
  return allowedAuthMethods.includes(method);
}



// Shape 6145a0501ad7: Chained filter().flatMap() with correct types.
interface Participant { role: string; items: Item[] }
interface Item { id: string; value: number }
declare const participants: Participant[];

function getActiveItems(participants: Participant[]): Item[] {
  return participants
    .filter((p) => p.role === 'active' && p.items.length > 0)
    .flatMap((p) => p.items.filter((item) => item.value > 0));
}



// Shape 61871bccb9ed: Array.find() comparing same-type ids.
interface OrderItem { id: number; sku: string }
interface OrderBundle { items: OrderItem[]; defaultItemId: number }
declare const orderBundle: OrderBundle;

function getDefaultItem(bundle: OrderBundle): OrderItem | undefined {
  return bundle.items.find((item) => item.id === bundle.defaultItemId);
}



// Shape 61b470be1b19: useForm defaultValues with fields.map() building default values array.
interface FormField { id: string; defaultValue: string }
declare function useForm(options: { defaultValues: { fields: Array<{ id: string; value: string }> } }): unknown;
declare const templateFields: FormField[];

const form = useForm({
  defaultValues: {
    fields: templateFields.map((field) => ({
      id: field.id,
      value: field.defaultValue,
    })),
  },
});



// Shape 61b70098a4d8: Array.find() ?? fallback index; setter accepts T | undefined.
interface Approver { id: number; name: string; tier: number }
declare const approverList: Approver[];
declare function setSelectedApprover(approver: Approver | undefined): void;
declare const targetTier: number;

function selectBestApprover(approvers: Approver[], tier: number): void {
  setSelectedApprover(approvers.find((a) => a.tier === tier) ?? approvers[0]);
}

selectBestApprover(approverList, targetTier);



// Shape 624641ebed9f: forEach with Set.has() check; item.value correct type for Set key lookup.
interface DropdownItem { label: string; value: string }
declare const dropdownItems: DropdownItem[];
declare const selectedValues: Set<string>;

function collectSelectedLabels(items: DropdownItem[], selected: Set<string>): string[] {
  const result: string[] = [];
  items.forEach((item) => {
    if (selected.has(item.value)) {
      result.push(item.label);
    }
  });
  return result;
}



// Shape 625e2add2e6b: void executeAuthProcedure with options object; actionTarget correctly typed.
enum ActionTarget { SIGN = 'SIGN', APPROVE = 'APPROVE', VIEW = 'VIEW' }
interface AuthProcedureOptions { actionTarget: ActionTarget; recipientId: number }
declare function executeAuthProcedure(options: AuthProcedureOptions): void;
declare const currentTarget: ActionTarget;
declare const recipientId: number;

void executeAuthProcedure({ actionTarget: currentTarget, recipientId });



// Shape 62a5ec3b1d8d: data.map(item => parseItem(item)); map passes element to typed function.
interface RawAuditEntry { id: string; payload: unknown; timestamp: string }
interface ParsedAuditEntry { id: string; data: Record<string, unknown>; createdAt: Date }
declare function parseAuditEntry(entry: RawAuditEntry): ParsedAuditEntry;
declare const rawEntries: RawAuditEntry[];

function parseAuditLog(entries: RawAuditEntry[]): ParsedAuditEntry[] {
  return entries.map((entry) => parseAuditEntry(entry));
}



// Shape 6303b2c66b3b: io.runTask with async callback containing Promise.all(.map(async ...)).
interface Subscriber { email: string; name: string }
interface TaskRunner { runTask(key: string, fn: () => Promise<unknown>): Promise<unknown> }
declare const io: TaskRunner;
declare const subscribers: Subscriber[];
declare function sendCancellationEmail(subscriber: Subscriber): Promise<void>;

async function notifyAllSubscribers(): Promise<void> {
  await io.runTask('send-cancellation-emails', async () => {
    await Promise.all(
      subscribers.map(async (subscriber) => {
        await sendCancellationEmail(subscriber);
      }),
    );
  });
}



// Shape 631bc038aba1: sort().map() chain assigning sequential order index; types correct.
interface Participant { id: number; name: string; priority: number; signingOrder?: number }
declare const participants: Participant[];

function assignSigningOrder(list: Participant[]): Participant[] {
  return list
    .sort((a, b) => a.priority - b.priority)
    .map((participant, index) => ({ ...participant, signingOrder: index + 1 }));
}



// Shape 638d18639d33: forEach callback with validation guard that throws.
interface CreatedItem { id: number; clientId?: string; value: string }
declare const createdItems: CreatedItem[];

function validateCreatedItems(items: CreatedItem[]): void {
  items.forEach((item) => {
    if (!item.clientId) {
      throw new Error(`Item ${item.id} is missing a clientId`);
    }
  });
}



// Shape 63a9cf56fdde: map() with two-arg mapping function; types correct.
interface Contact { id: number; email: string }
interface ContactBundle { contacts: Contact[]; bundleId: string }
interface LegacyContact { contactId: number; contactEmail: string; bundleId: string }
declare function mapContactToLegacy(contact: Contact, bundle: ContactBundle): LegacyContact;
declare const contactBundle: ContactBundle;

function toLegacyContacts(bundle: ContactBundle): LegacyContact[] {
  return bundle.contacts.map((contact) => mapContactToLegacy(contact, bundle));
}



// Shape 643852c79f0d: map() with Map.get(String(id)); correct string key lookup.
interface FieldSpec { envelopeItemId: number; fieldType: string; position: number }
interface IndexedField extends FieldSpec { displayIndex: number }
declare const fieldSpecs: FieldSpec[];
const itemIdToIndex = new Map<string, number>();

function buildIndexedFields(specs: FieldSpec[], idxMap: Map<string, number>): IndexedField[] {
  return specs.map((field) => ({
    ...field,
    displayIndex: idxMap.get(String(field.envelopeItemId)) ?? 0,
  }));
}



// Shape 644e8971c44d: value?.map().filter(Boolean) with 'as Type[]' narrowing cast.
interface SelectOption { label: string; value: string; disabled?: boolean }
declare const rawValues: Array<string | null | undefined> | undefined;

function toSelectOptions(values: Array<string | null | undefined> | undefined): SelectOption[] {
  return (values?.map((v) => v ? { label: v, value: v } : undefined).filter(Boolean) as SelectOption[]) ?? [];
}



// Shape 64a7480812ce: Array.find() with multi-condition predicate; types correct.
interface TeamGroup { groupId: number; teamId: number; role: string }
interface TeamWithGroups { id: number; teamGroups: TeamGroup[] }
declare const teams: TeamWithGroups[];
declare const currentUserId: number;
const targetRole = 'admin';

function findAdminGroupForTeam(team: TeamWithGroups, userId: number): TeamGroup | undefined {
  return team.teamGroups.find(
    (g) => g.groupId === userId && g.role === targetRole,
  );
}



// Shape 6513fec4e2f4: Math.max(...array.map(v => v.numericProp)); spread of mapped numbers.
interface CheckboxOption { id: number; label: string; checked: boolean }
declare const checkboxOptions: CheckboxOption[];

function getMaxOptionId(options: CheckboxOption[]): number {
  if (options.length === 0) return 0;
  return Math.max(...options.map((opt) => opt.id));
}



// Shape 652349348ed8: .map() over defaultRecipients with index; id: -(index+1) negative id is valid.
interface DefaultRecipient { email: string; name: string; role: string }
interface EditorRecipient { id: number; email: string; name: string; role: string }
declare const defaultRecipients: DefaultRecipient[];

function buildEditorRecipients(recipients: DefaultRecipient[]): EditorRecipient[] {
  return recipients.map((recipient, index) => ({
    id: -(index + 1),
    email: recipient.email,
    name: recipient.name,
    role: recipient.role,
  }));
}



// Shape 654538a0243c: Array.some() with compound condition on correctly typed enum values.
enum RecipientRole { SIGNER = 'SIGNER', APPROVER = 'APPROVER', VIEWER = 'VIEWER' }
enum SendStatus { SENT = 'SENT', NOT_SENT = 'NOT_SENT', BOUNCED = 'BOUNCED' }
interface EnvelopeRecipient { role: RecipientRole; sendStatus: SendStatus }
declare const envelopeRecipients: EnvelopeRecipient[];

function hasSentSigners(recipients: EnvelopeRecipient[]): boolean {
  return recipients.some(
    (r) => r.role === RecipientRole.SIGNER && r.sendStatus === SendStatus.SENT,
  );
}



// Shape 65798aebaba2: data.map(doc => maskTokensForDocument({document: doc, ...})); doc correctly typed.
interface DocumentRecord { id: number; title: string; recipientToken: string }
interface MaskedDocument { id: number; title: string; recipientToken: null }
interface MaskOptions { document: DocumentRecord; requestUserId: number }
declare function maskTokensForDocument(opts: MaskOptions): MaskedDocument;
declare const documentRecords: DocumentRecord[];
declare const requestingUserId: number;

function maskAllDocumentTokens(docs: DocumentRecord[], userId: number): MaskedDocument[] {
  return docs.map((document) => maskTokensForDocument({ document, requestUserId: userId }));
}



// Shape 65e7c8df5d5d: io.runTask with template string key and async callback; email helper called with correct args.
interface TaskRunner { runTask(key: string, fn: () => Promise<unknown>): Promise<unknown> }
declare const io: TaskRunner;
interface TeamInfo { id: number; name: string; ownerEmail: string }
declare function sendTeamDeleteEmail(opts: { teamName: string; recipientEmail: string }): Promise<void>;
declare const team: TeamInfo;

async function notifyTeamDeleted(t: TeamInfo): Promise<void> {
  await io.runTask(`send-team-deleted-${t.id}`, async () => {
    await sendTeamDeleteEmail({ teamName: t.name, recipientEmail: t.ownerEmail });
  });
}



// Shape 66107ea8c065: fields.map() with ZodSchema.parse(field.meta) when meta is non-null; parse accepts JsonValue.
interface TemplateField { id: number; meta: unknown; label: string }
interface ParsedField { id: number; label: string; parsedMeta: Record<string, unknown> }
declare const FieldMetaSchema: { parse(v: unknown): Record<string, unknown> };
declare const templateFields: TemplateField[];

function parseFieldMetas(fields: TemplateField[]): ParsedField[] {
  return fields.map((field) => ({
    id: field.id,
    label: field.label,
    parsedMeta: field.meta != null ? FieldMetaSchema.parse(field.meta) : {},
  }));
}



// Shape 6cd5c1a0c49c: filter() with function call inside callback returning boolean — valid predicate
declare function extractAuthMethods(opts: { docAuth: unknown; recipientAuth: unknown }): { requiresAction: boolean; requiresAccess: boolean };
declare const pendingRecipients: Array<{ email: string; authOptions: unknown }>;
declare const docAuthOptions: unknown;

const recipientsMissingEmail = pendingRecipients.filter((recipient) => {
  const auth = extractAuthMethods({
    docAuth: docAuthOptions,
    recipientAuth: recipient.authOptions,
  });
  return (auth.requiresAction || auth.requiresAccess) && !recipient.email;
});



// Shape 6cf53bb70ae2: Promise.all with array of async calls and destructured result — valid parallel execution
declare function renderNotificationEmail(template: unknown, opts: { lang: string; branding: unknown; plainText?: boolean }): Promise<string>;
declare const notificationTemplate: unknown;
declare const emailLanguage: string;
declare const brandingConfig: unknown;

async function sendParallelEmails() {
  const [html, text] = await Promise.all([
    renderNotificationEmail(notificationTemplate, {
      lang: emailLanguage,
      branding: brandingConfig,
    }),
    renderNotificationEmail(notificationTemplate, {
      lang: emailLanguage,
      branding: brandingConfig,
      plainText: true,
    }),
  ]);
  return { html, text };
}



// Shape 6d68f691d354: .filter() on boolean property then .length — valid boolean predicate filter
declare const jobResults: Array<{ success: boolean; jobId: string }>;

const succeededCount = jobResults.filter((r) => r.success).length;
const failedIds = jobResults.filter((r) => !r.success).map((r) => r.jobId);



// Shape 6d7e6801fc1a: tRPC useMutation onSuccess callback — standard React Query mutation pattern
declare const trpc: { user: { delete: { useMutation: (opts: { onSuccess: () => Promise<void> }) => { mutateAsync: (id: number) => Promise<void>; isPending: boolean } } } };
declare function showToast(opts: { title: string; description: string; duration: number }): void;
declare function navigateTo(path: string): void;

const { mutateAsync: deleteUser, isPending } = trpc.user.delete.useMutation({
  onSuccess: async () => {
    showToast({
      title: 'Success',
      description: 'User has been removed.',
      duration: 5000,
    });
    navigateTo('/users');
  },
});



// Shape 6dff089c7ea0: function receives result of .filter() — parameter type matches filtered array type
interface FormField { id: string; required: boolean; inserted: boolean; position: number; }
declare function sortFieldsByPosition(fields: FormField[]): FormField[];
declare function isFieldRequired(field: FormField): boolean;
declare const localFields: FormField[];

const [pendingFields, completedFields] = [
  sortFieldsByPosition(localFields.filter((field) => isFieldRequired(field) && !field.inserted)),
  localFields.filter((field) => field.inserted),
];



// Shape 6e2233bc479d: ts-pattern match().with() on enum — type-safe pattern match, no type mismatch
enum WidgetType { TEXT = 'TEXT', IMAGE = 'IMAGE', VIDEO = 'VIDEO', EMBED = 'EMBED' }
declare function match<T>(value: T): { with: <R>(pattern: T, fn: () => R) => { otherwise: (fn: () => R) => R } };
declare const widgetType: WidgetType;

const widgetLabel = match(widgetType)
  .with(WidgetType.TEXT, () => 'Text Widget')
  .otherwise(() => 'Unknown Widget');



// Shape 6e3e92c775fb: Promise.all(array.map(async (item) => {...})) — valid async seeding map
interface SeedRecord { type: string; value: string; order: number; }
declare const SEED_RECORDS: SeedRecord[];
declare function createRecord(data: { type: string; value: string; order: number; parentId: number }): Promise<void>;
declare const parentId: number;

await Promise.all(
  SEED_RECORDS.map(async (record) => {
    await createRecord({
      type: record.type,
      value: record.value,
      order: record.order,
      parentId,
    });
  }),
);



// Shape 6e5442e21036: validationErrors.filter((error) => error.includes(...)) — string array filter with includes
declare const validationErrors: string[];

const numberErrors = {
  isNumber: validationErrors.filter((error) => error.includes('valid number')),
  required: validationErrors.filter((error) => error.includes('required')),
  minValue: validationErrors.filter((error) => error.includes('minimum value')),
  maxValue: validationErrors.filter((error) => error.includes('maximum value')),
};



// Shape 6e94de5a981b: array.some() with typed callback — valid .some() usage with correctly typed predicate
enum FieldKind { SIGNATURE = 'SIGNATURE', TEXT = 'TEXT', DATE = 'DATE' }
interface DocumentField { type: FieldKind; id: string; }
declare function isSignatureKind(type: FieldKind): boolean;
declare const document: { fields: DocumentField[] } | null;

const hasSignatureField = document?.fields.some((field) => isSignatureKind(field.type));



// Shape 6ebb4cca5b6e: Promise.all(array.map(async (item) => {...})) inside $transaction — valid async map
interface Recipient { email: string; name: string; role: string; }
declare function createRecipientAuthOptions(opts: { accessAuth: string[]; actionAuth: string[] }): unknown;
declare const prisma: { $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> };
declare const normalizedRecipients: Recipient[];
declare const envelopeId: number;

const createdRecipients = await prisma.$transaction(async (tx) => {
  return await Promise.all(
    normalizedRecipients.map(async (recipient) => {
      const authOptions = createRecipientAuthOptions({
        accessAuth: [],
        actionAuth: [],
      });
      return { envelopeId, ...recipient, authOptions };
    }),
  );
});



// Shape 6ec4b59295db: _(message) lingui-style translation call — valid i18n with no type mismatch
declare function _<T>(msg: T): string;
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): string;

function renderEmptyState() {
  const title = _('No documents found');
  const description = _('You have no documents yet. Create one to get started.');
  return { title, description };
}



// Shape 6f2b174a8f90: array.find() with multi-condition predicate — valid find with multiple comparisons
interface TeamGroup { groupType: string; teamId: number; teamRole: string; }
declare const teamGroups: TeamGroup[];
declare const TARGET_TYPE: string;
declare const currentTeamId: number;
declare const requiredRole: string;

const matchingGroup = teamGroups.find(
  (group) =>
    group.groupType === TARGET_TYPE &&
    group.teamId === currentTeamId &&
    group.teamRole === requiredRole,
);



// Shape 6f2de2431210: useEffect with early return string comparison guard — standard string comparison pattern
declare function useEffect(fn: () => (() => void) | void, deps: unknown[]): void;
declare const processingState: string;
declare function setProgressIndex(fn: (prev: number) => number): void;
declare const MESSAGES: string[];

useEffect(() => {
  if (processingState !== 'PROCESSING') {
    return;
  }

  const interval = setInterval(() => {
    setProgressIndex((prev) => (prev + 1) % MESSAGES.length);
  }, 4000);

  return () => clearInterval(interval);
}, [processingState]);



// Shape 6f447be3b386: useState<NodeJS.Timeout | null>(null) — valid nullable timeout state declaration
declare function useState<T>(init: T): [T, (v: T) => void];

function CopyButton({ text }: { text: string }) {
  const [copyTimeout, setCopyTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    if (copyTimeout) clearTimeout(copyTimeout);
    setCopyTimeout(setTimeout(() => setCopyTimeout(null), 2000));
  };

  return <button onClick={handleCopy}>Copy</button>;
}



// Shape 6f967217e8a1: tRPC mutation onSuccess with invalidateQuery calls — standard tRPC mutation pattern
declare const trpc: { document: { bulkDelete: { useMutation: (opts: { onSuccess: () => Promise<void> }) => { mutateAsync: (ids: number[]) => Promise<void>; isPending: boolean } } }; useUtils: () => { document: { list: { invalidate: () => Promise<void> } } } };
declare function showToast(opts: { title: string }): void;

const trpcUtils = trpc.useUtils();
const { mutateAsync: bulkDelete, isPending } = trpc.document.bulkDelete.useMutation({
  onSuccess: async () => {
    await trpcUtils.document.list.invalidate();
    showToast({ title: 'Documents deleted' });
  },
});



// Shape 701dc6bf50f9: pMap(array, async (item) => {...}) — valid p-map async iteration
declare function pMap<T, R>(input: T[], mapper: (item: T) => Promise<R>, options?: { concurrency?: number }): Promise<R[]>;
interface BatchItem { id: string; url: string; payload: unknown; }
declare const batchItems: BatchItem[];
declare function processItem(item: BatchItem): Promise<{ id: string; status: string }>;

const results = await pMap(
  batchItems,
  async (item) => {
    return await processItem(item);
  },
  { concurrency: 5 },
);



// Shape 70f28624e2f8: tRPC mutation pattern (duplicate row variant) — standard tRPC mutation
declare const trpc: { webhook: { create: { useMutation: (opts: { onSuccess: () => void }) => { mutateAsync: (data: unknown) => Promise<void>; isPending: boolean } } }; useUtils: () => { webhook: { list: { invalidate: () => Promise<void> } } } };

const trpcUtils2 = trpc.useUtils();
const { mutateAsync: createWebhook } = trpc.webhook.create.useMutation({
  onSuccess: () => {
    void trpcUtils2.webhook.list.invalidate();
  },
});



// Shape 70fddbe6daaa: array.every() with nested .some() — valid every/some predicate
interface OrgMember { id: number; name: string; }
interface NewMember { orgMemberId: number; role: string; }
declare const membersToAdd: NewMember[];
declare const orgMembers: OrgMember[];

const allMembersArePartOfOrg = membersToAdd.every((member) =>
  orgMembers.some(({ id }) => id === member.orgMemberId),
);



// Shape 713e3a640e0c: prisma.$transaction(async (tx) => {...}) — valid Prisma transaction callback
interface Subscription { id: number; status: string; planId: string; }
declare const prisma: { $transaction: <T>(fn: (tx: { subscription: { delete: (opts: { where: { id: number } }) => Promise<void> }; account: { update: (opts: { where: { id: number }; data: { planId: string } }) => Promise<void> } }) => Promise<T>) => Promise<T> };
declare const existingSubscription: Subscription;
declare const accountId: number;

await prisma.$transaction(async (tx) => {
  await tx.subscription.delete({
    where: { id: existingSubscription.id },
  });
  await tx.account.update({
    where: { id: accountId },
    data: { planId: 'free' },
  });
});



// Shape 715000622a53: useCallback async flush with clearTimeout and pending promise — valid async callback
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare const timeoutRef: { current: ReturnType<typeof setTimeout> | null };
declare const pendingRef: { current: Promise<void> | null };
declare const delay: number;
declare function doSave(): Promise<void>;

const flush = useCallback(async () => {
  if (timeoutRef.current) {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }

  if (pendingRef.current) {
    await pendingRef.current;
    return;
  }

  pendingRef.current = doSave();
  await pendingRef.current;
  pendingRef.current = null;
}, [delay]);



// Shape 715e73e016f4: array.filter() with string comparison on status — valid string status filter
interface Recipient { id: number; signingStatus: string; name: string; }
declare const recipients: Recipient[];

const pendingRecipients = recipients.filter(
  (recipient) => recipient.signingStatus === 'NOT_SIGNED',
);

const pendingCount = pendingRecipients.length;



// Shape 7281d21d7bc2: _(msg`...`) lingui template tag translation — standard lingui pattern, types correct
declare function _<T>(msg: T): string;
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): { id: string; message: string };

function buildCertificateLabels() {
  return {
    signatureId: _(msg`Signature ID`),
    issuedAt: _(msg`Issued At`),
    verifiedBy: _(msg`Verified By`),
  };
}



// Shape 747ee2fba5a0: nested .map() transforms — valid nested map with typed items
interface GroupMember { group: { id: number; name: string; teamGroups: TeamGroupEntry[] } }
interface TeamGroupEntry { teamId: number; role: string; }
interface TeamMemberRecord { id: number; userId: number; groupMembers: GroupMember[] }
declare function getHighestRole(teamGroups: TeamGroupEntry[]): string;
declare const teamMembers: TeamMemberRecord[];

const mappedMembers = teamMembers.map((member) => {
  const groups = member.groupMembers.map(({ group }) => group);
  return {
    id: member.id,
    userId: member.userId,
    role: getHighestRole(groups.flatMap((g) => g.teamGroups)),
  };
});



// Shape 74a4d53fc832: filter with negated .some() predicate — valid negated some check
interface GroupMemberRecord { memberId: number; role: string; }
interface ExistingGroup { groupMembers: GroupMemberRecord[] }
declare const targetMemberIds: number[];
declare const existingGroup: ExistingGroup;

const membersToAdd = targetMemberIds.filter(
  (id) => !existingGroup.groupMembers.some((member) => member.memberId === id),
);

const membersToRemove = existingGroup.groupMembers.filter(
  (member) => !targetMemberIds.includes(member.memberId),
);



// Shape 753e532f4732: array.find() with id comparison callback — valid predicate with no type mismatch
interface Organisation { id: number; name: string; subscription: { status: string } | null; }
declare const eligibleOrgs: Organisation[];
declare const selectedOrgId: number | null;

const selectedOrg = eligibleOrgs.find((org) => org.id === selectedOrgId);



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}


// --- argument-type-mismatch FP: Array.includes() with enum value; valid, no type mismatch ---
enum RecipientStatusType { UNSIGNED = 'UNSIGNED', WAITING = 'WAITING', COMPLETED = 'COMPLETED', OPENED = 'OPENED' }

interface RecipientForType { statusType: RecipientStatusType; }

function hasUnsignedRecipients(recipients: RecipientForType[]): boolean {
  const types = recipients.map((r) => r.statusType);
  return types.includes(RecipientStatusType.UNSIGNED);
}


// --- argument-type-mismatch FP: useEffect with cancelled boolean flag and async render; idiomatic React, no type mismatch ---
declare function useEffect(effect: () => (() => void) | void, deps?: unknown[]): void;
declare const diagramSource: string;
declare const setRenderedSvg: (svg: string | null) => void;

useEffect(() => {
  let cancelled = false;

  const render = async () => {
    const renderer = await import('./diagram-renderer').then((m) => m.default);
    renderer.initialize({ theme: 'default' });

    const { svg } = await renderer.render('diagram-' + Date.now(), diagramSource);

    if (!cancelled) {
      setRenderedSvg(svg);
    }
  };

  void render();

  return () => {
    cancelled = true;
  };
}, [diagramSource]);


// --- argument-type-mismatch FP: tokens.map(async (token) => { ... }); valid async map, no type mismatch ---
interface TokenDocument { id: string; title: string; status: string }
interface TokenRecipient { id: string; email: string; readStatus: string }

declare function fetchDocumentByToken(opts: { token: string }): Promise<TokenDocument>;
declare function fetchRecipientByToken(opts: { token: string }): Promise<TokenRecipient>;

declare const signingTokens: string[];

const envelopes = await Promise.all(
  signingTokens.map(async (token) => {
    const document = await fetchDocumentByToken({ token });
    const recipient = await fetchRecipientByToken({ token });
    return { document, recipient };
  }),
);


// --- argument-type-mismatch FP: prisma.$transaction(async (tx) => tx.model.deleteMany()); valid Prisma transaction, no type mismatch ---
declare const db: {
  $transaction<T>(fn: (tx: {
    userAccount: { deleteMany(opts: { where: object }): Promise<{ count: number }> };
    organisation: { delete(opts: { where: { id: string } }): Promise<{ id: string }> };
  }) => Promise<T>): Promise<T>;
};

declare const organisationId: string;
declare const SYSTEM_ACCOUNT_TYPE: string;

await db.$transaction(async (tx) => {
  await tx.userAccount.deleteMany({
    where: { type: SYSTEM_ACCOUNT_TYPE, provider: organisationId },
  });

  await tx.organisation.delete({
    where: { id: organisationId },
  });
});


// --- argument-type-mismatch FP: data.values.filter((value) => value.checked).length; standard boolean filter, no type mismatch ---
interface CheckboxValue { value: string; checked: boolean }

declare function validateSelectionLength(count: number, rule: string, limit: number): boolean;

function validateCheckboxSelection(values: CheckboxValue[], rule: string, limit: number): boolean {
  const selectedCount = values.filter((value) => value.checked).length;
  return validateSelectionLength(selectedCount, rule, limit);
}


// --- argument-type-mismatch FP: useEffect with ref null guard; standard cleanup pattern, no type mismatch ---
declare function useEffect(effect: () => (() => void) | void, deps?: unknown[]): void;
declare const canvasRef: { current: HTMLDivElement | null };
declare const localPageFields: unknown[];
declare function renderFieldOnLayer(field: unknown): void;

useEffect(() => {
  if (!canvasRef.current) {
    return;
  }

  localPageFields.forEach((field) => {
    renderFieldOnLayer(field);
  });
}, [localPageFields]);


// --- argument-type-mismatch FP: Promise.all(removedItems.map(async (item) => {...})); valid async map, no type mismatch ---
interface RemovedRecipient { id: string; email: string; name: string; role: string }

declare function sendRemovedEmail(opts: { recipientName: string; recipientEmail: string; documentTitle: string }): Promise<void>;
declare const removedRecipients: RemovedRecipient[];
declare const documentTitle: string;

await Promise.all(
  removedRecipients.map(async (recipient) => {
    if (!recipient.email) return;

    await sendRemovedEmail({
      recipientName: recipient.name,
      recipientEmail: recipient.email,
      documentTitle,
    });
  }),
);


// --- argument-type-mismatch FP: recipients.find() with id comparison; valid find callback, no type mismatch ---
interface EnvelopeRecipient2 { id: string; email: string; role: string }
interface EnvelopeWithRecipients { recipients: EnvelopeRecipient2[] }

function findRecipientById(envelope: EnvelopeWithRecipients, recipientId: string): EnvelopeRecipient2 | undefined {
  return envelope.recipients.find((r) => r.id === recipientId);
}


// --- argument-type-mismatch FP: Promise.all with destructured results [, recipients]; valid parallel async, no type mismatch ---
interface TemplateRecipient { id: string; email: string; name: string }

declare function updateTemplateSettings(opts: { templateId: string; meta: object }): Promise<void>;
declare function setTemplateRecipients(opts: { templateId: string; recipients: TemplateRecipient[] }): Promise<TemplateRecipient[]>;

declare const templateId: string;
declare const settingsMeta: { signingOrder: number };
declare const recipientList: TemplateRecipient[];

const [, updatedRecipients] = await Promise.all([
  updateTemplateSettings({
    templateId,
    meta: { signingOrder: settingsMeta.signingOrder },
  }),
  setTemplateRecipients({
    templateId,
    recipients: recipientList,
  }),
]);


// --- argument-type-mismatch FP: Promise.all([getDoc, getFields, getRecipient]) with destructuring; valid parallel query, no type mismatch ---
interface SigningDocument { id: string; title: string; status: string }
interface SigningRecipient { id: string; token: string; email: string }
interface SigningField { id: string; type: string; page: number }

declare function fetchDocumentByToken(opts: { token: string; requireAuth: boolean }): Promise<SigningDocument | null>;
declare function fetchFieldsByToken(opts: { token: string }): Promise<SigningField[]>;
declare function fetchRecipientByToken(opts: { token: string }): Promise<SigningRecipient | null>;

declare const signingToken: string;

const [document2, fields2, recipient2] = await Promise.all([
  fetchDocumentByToken({ token: signingToken, requireAuth: false }).catch(() => null),
  fetchFieldsByToken({ token: signingToken }),
  fetchRecipientByToken({ token: signingToken }).catch(() => null),
]);


// --- argument-type-mismatch FP: sortFieldsByPosition() called with filter() result — both Field[]; no type mismatch ---
interface FieldWithStatus { id: string; type: string; inserted: boolean; signingStatus: string }

declare function sortFieldsByPosition(fields: FieldWithStatus[]): FieldWithStatus[];

declare const allDocumentFields: FieldWithStatus[];

const pendingFields2 = sortFieldsByPosition(
  allDocumentFields.filter((field) => field.signingStatus !== 'SIGNED'),
);

const completedFields2 = allDocumentFields.filter(
  (field) => field.signingStatus === 'SIGNED',
);


// --- argument-type-mismatch FP: organisation.members.find() with destructured id; standard lookup, no type mismatch ---
interface OrgMember { id: string; email: string; role: string }
interface Organisation { id: string; members: OrgMember[] }

function validateMembersExist(organisation: Organisation, memberIds: string[]): void {
  memberIds.forEach((memberId) => {
    const member = organisation.members.find(({ id }) => id === memberId);

    if (!member) {
      throw new Error(`Member ${memberId} not found in organisation`);
    }
  });
}


// --- argument-type-mismatch FP: Object.values().forEach() with find() inside; Object.values returns typed array, no type mismatch ---
interface TemplateField { id: string; envelopeItemId?: string; type: string }
interface TemplateRecipientRecord { email: string; fields: TemplateField[] }
interface CreatedRecipient { id: string; email: string }

declare const templateRecipientMap: Record<string, TemplateRecipientRecord>;
declare const createdEnvelope: { recipients: CreatedRecipient[] };

let fieldsToCreate: Array<{ recipientId: string; type: string }> = [];

Object.values(templateRecipientMap).forEach((templateRecipient) => {
  const recipient = createdEnvelope.recipients.find((r) => r.email === templateRecipient.email);

  if (!recipient) {
    throw new Error('Recipient not found.');
  }

  fieldsToCreate = fieldsToCreate.concat(
    templateRecipient.fields.map((field) => ({
      recipientId: recipient.id,
      type: field.type,
    })),
  );
});


// --- argument-type-mismatch FP: Array.at(0) on typed array via optional chaining; standard optional chaining, no type mismatch ---
type AccessAuthMethod = 'ACCOUNT' | 'TWO_FACTOR_AUTH' | undefined;

interface RecipientAuthInfo { derivedAccessAuth: AccessAuthMethod[] }

function getAccessAuthLabel(authInfo: RecipientAuthInfo): string {
  const primaryAuthMethod = authInfo.derivedAccessAuth.at(0);

  if (!primaryAuthMethod) return 'Email';
  if (primaryAuthMethod === 'ACCOUNT') return 'Account Authentication';
  if (primaryAuthMethod === 'TWO_FACTOR_AUTH') return 'Two-Factor Authentication';
  return 'Email';
}


// --- argument-type-mismatch FP: validationErrors.filter(e => e.includes('X')) returns string[]; correct type, no type mismatch ---
declare function validateTextInput(text: string, meta: object, strict: boolean): string[];

interface TextFieldErrors { required: string[]; characterLimit: string[] }

function computeTextFieldErrors(text: string, fieldMeta: object): TextFieldErrors {
  const validationErrors = validateTextInput(text, fieldMeta, true);
  return {
    required: validationErrors.filter((error) => error.includes('required')),
    characterLimit: validationErrors.filter((error) => error.includes('character limit')),
  };
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



// FP shape: Promise.all with conditional function calls producing nullable — standard async pattern
declare function generateCertPdf(payload: object): Promise<unknown>;
declare function getAuditLogsPdf(opts: { documentId: string; language: string }): Promise<Buffer>;
declare function generateAuditLogPdf(payload: object): Promise<unknown>;
declare const useRemotePdf: boolean;
declare const documentId: string;
declare const language: string;
declare const certPayload: object;
declare const needsCert: boolean;
declare const needsAudit: boolean;

async function runPdfGeneration() {
  const makeCertPdf = async () =>
    useRemotePdf
      ? getAuditLogsPdf({ documentId, language }).then(async (buf) => buf)
      : generateCertPdf(certPayload);

  const makeAuditPdf = async () =>
    useRemotePdf
      ? getAuditLogsPdf({ documentId, language }).then(async (buf) => buf)
      : generateAuditLogPdf(certPayload);

  const [certDoc, auditDoc] = await Promise.all([
    needsCert ? makeCertPdf() : null,
    needsAudit ? makeAuditPdf() : null,
  ]);

  return { certDoc, auditDoc };
}



// FP shape: array.map(async (job) => {...}) passed to Promise.all — map of async functions returns Promise[]
declare const pendingTasks: Array<{ id: string; name: string; priority: number }>;
declare function processTask(task: { id: string; name: string; priority: number }): Promise<void>;
declare function logCompletion(taskId: string): Promise<void>;

async function runAllPendingTasks() {
  await Promise.all(
    pendingTasks.map(async (task) => {
      await processTask(task);
      await logCompletion(task.id);
    })
  );
}



// --- FP shape: Array.find() comparing id fields in a lookup callback ---
declare const envelope: { recipients: Array<{ id: number; email: string }> };
declare const localFields: Array<{ formId: string; recipientId: number }>;
declare const selectedFormIds: string[];

const selectedFields = localFields.filter((field) => selectedFormIds.includes(field.formId));
const matchedRecipient = envelope.recipients.find(
  (recipient) => recipient.id === selectedFields[0].recipientId,
);



// --- FP shape: Array.some() with string literal and enum value passed to typed function ---
declare function canPerformWorkspaceAction(action: string, role: string): boolean;
declare const workspaces: Array<{ currentRole: string; name: string }>;

const hasBillingAccess = workspaces.some((ws) =>
  canPerformWorkspaceAction('MANAGE_BILLING', ws.currentRole),
);



// --- FP shape: Array.every() predicate checking a boolean property ---
declare const checkboxValues: Array<{ checked: boolean; label: string }>;

const allChecked = checkboxValues.every((item) => item.checked === true);
const noneRequired = checkboxValues.every((item) => !item.checked);



// --- FP shape: Array.some() with lowercase string comparison ---
declare const existingSigners: Array<{ email: string; name: string }>;
declare const newEmail: string;

const isDuplicate = existingSigners.some(
  (signer) => signer.email.toLowerCase() === newEmail.toLowerCase(),
);



// --- FP shape: Array.map() over fields with let variable initialization ---
declare const fields: Array<{ id: number; fieldMeta: unknown; type: string }>;
declare function parseFieldMeta(meta: unknown): { label?: string } | null;

const parsedFields = fields.map((field) => {
  let parsedMeta = null;
  if (field.fieldMeta) {
    parsedMeta = parseFieldMeta(field.fieldMeta);
  }
  return { ...field, parsedMeta };
});



// --- FP shape: form.getValues() result chained with Array.find() predicate ---
declare const form: { getValues(field: string): Array<{ actionAuth: string[]; email: string }> };

const formHasActionAuth = form.getValues('signers').find((signer) => signer.actionAuth.length > 0);



// --- FP shape: Array.some() checking a numeric property ---
declare const envelopeItems: Array<{ order: number | null; id: number; title: string }>;

const hasOrderedItems = envelopeItems.some((item) => item.order !== null);
const hasUnorderedItems = envelopeItems.some((item) => item.order === null);



// --- FP shape: Array.findIndex() comparing id property ---
declare const recipients2: Array<{ id: number; email: string; name: string }>;
declare const targetRecipientId: number;

const recipientIndex = recipients2.findIndex((r) => r.id === targetRecipientId);



// --- FP shape: Array.map() spreading item and adding computed property ---
declare const emailDomains: Array<{ domain: string; verified: boolean; id: number }>;
declare function computeVerificationStatus(domain: string): string;

const enrichedDomains = emailDomains.map((item) => ({
  ...item,
  verificationStatus: computeVerificationStatus(item.domain),
}));



// --- FP shape: Array.map() with async callback calling an async function ---
declare async function signFieldWithToken(fieldId: number, token: string): Promise<{ success: boolean }>;
declare const signatureFields2: Array<{ id: number; token: string }>;

const results = await Promise.all(
  signatureFields2.map(async (field) => signFieldWithToken(field.id, field.token))
);



// --- FP shape: Array.map() extracting specific fields from each item into new object ---
declare const recipientEntries2: Array<{
  id: number;
  email: string;
  name: string;
  fields: Array<{ id: number; type: string }>;
}>;

const simplifiedRecipients = recipientEntries2.map((recipient) => ({
  recipientId: recipient.id,
  recipientEmail: recipient.email,
  fieldCount: recipient.fields.length,
}));



// --- FP shape: Array.map() with nested Array.map() inside ---
declare const organizationGroups: Array<{
  id: number;
  name: string;
  teamGroups: Array<{ teamId: number; teamName: string }>;
}>;

const groupsWithTeams = organizationGroups.map((group) => ({
  groupId: group.id,
  groupName: group.name,
  teams: group.teamGroups.map((tg) => ({ id: tg.teamId, name: tg.teamName })),
}));



// --- FP shape: Array.find() matching id to a foreign-key property ---
declare const envelopeItems2: Array<{ id: number; content: string; order: number }>;
declare const fields2: Array<{ envelopeItemId: number; type: string }>;

const matchedItem = envelopeItems2.find((item) => item.id === fields2[0].envelopeItemId);



declare const navigationRoutes: Array<{ routeId?: string; name: string }>;

export function shouldHideNavigation(routes: typeof navigationRoutes): boolean {
  return routes.some(
    (route) =>
      route?.routeId === 'admin/users/bulk-edit' ||
      route?.routeId === 'admin/reports/export',
  );
}

export function hasSpecialPermission(permissions: Array<{ scope?: string }>): boolean {
  return permissions.some(
    (perm) =>
      perm?.scope === 'system.maintenance' ||
      perm?.scope === 'system.audit',
  );
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



// Array.filter() with a single boolean property access predicate — no type mismatch.
interface TaskOption {
  id: string;
  label: string;
  selected: boolean;
}

interface TaskGroup {
  name: string;
  options: TaskOption[];
}

function getSelectedOptions(group: TaskGroup): TaskOption[] {
  if (group.options) {
    const selectedOptions = group.options.filter((option) => option.selected);
    return selectedOptions.length <= 1 ? selectedOptions : selectedOptions.slice(0, 1);
  }
  return [];
}



// Transforms internal participant records to the recipient shape expected by the
// server contract. internalId is intentionally mapped to the id field.

declare const agreementPayload: {
  participants: Array<{
    internalId: number;
    displayName: string;
    emailAddress: string;
    role: string;
    signingOrder: number;
  }>;
};

declare const fieldItems: Array<{
  assigneeEmail: string;
  nativeId: number;
  pageX: number;
  pageY: number;
  pageWidth: number;
  pageHeight: number;
}>;

declare function submitAgreement(options: {
  recipients: Array<{
    id: number;
    name: string;
    email: string;
    role: string;
    signingOrder: number;
    fields: any[];
  }>;
}): Promise<void>;

async function prepareAndSubmitAgreement(): Promise<void> {
  await submitAgreement({
    recipients: agreementPayload.participants.map((participant) => ({
      id: participant.internalId,
      name: participant.displayName,
      email: participant.emailAddress,
      role: participant.role,
      signingOrder: participant.signingOrder,
      fields: fieldItems
        .filter((field) => field.assigneeEmail === participant.emailAddress)
        .map<any>((f) => ({
          ...f,
          id: f.nativeId,
          pageX: f.pageX,
          pageY: f.pageY,
          width: f.pageWidth,
          height: f.pageHeight,
        })),
    })),
  });
}



// Map raw DB rows into a typed view model — String() conversion is intentional,
// no argument type mismatch.
interface TeamSummary {
  id: string;
  name: string;
  memberCount: number;
  createdAt: Date;
  ownerId: string;
  planStatus: string | null;
  projectCount: number;
}

declare const rawTeamRows: Array<{
  id: number | string;
  name: string | null;
  memberCount: number | null;
  createdAt: Date | null;
  ownerId: number | string | null;
  planStatus: string | null;
  projectCount: number | null;
}>;

const typedTeams: TeamSummary[] = rawTeamRows.map((row) => ({
  id: String(row.id),
  name: row.name || '',
  memberCount: row.memberCount || 0,
  createdAt: row.createdAt || new Date(),
  ownerId: String(row.ownerId || ''),
  planStatus: row.planStatus,
  projectCount: row.projectCount || 0,
}));



// Filtering a string[] with .filter() and passing the result where string[] is expected.
// The return type of .filter() on string[] is string[] — no argument-type mismatch.

declare const rawMessages: string[];
declare function applyFieldConstraints(opts: {
  requiredErrors: string[];
  rangeErrors: string[];
  formatErrors: string[];
  lengthErrors: string[];
}): void;

export function validateAndApply(): void {
  applyFieldConstraints({
    requiredErrors: rawMessages.filter((msg) => msg.includes('required')),
    rangeErrors: rawMessages.filter((msg) => msg.includes('out of range')),
    formatErrors: rawMessages.filter((msg) => msg.includes('invalid format')),
    lengthErrors: rawMessages.filter((msg) => msg.includes('too long')),
  });
}



// Object.entries with a function-call argument, chained filter using array
// destructuring in the callback parameter - standard stdlib pattern; no type
// mismatch is present.

declare const TaskAssigneeRole: {
  readonly OBSERVER: string;
  readonly REVIEWER: string;
  readonly OWNER: string;
  readonly COLLABORATOR: string;
};
type TaskAssigneeRoleKey = keyof typeof TaskAssigneeRole;

interface TaskItem {
  id: number;
  assigneeRole: TaskAssigneeRoleKey;
  signingOrder?: number;
}

declare function getTasksByAssigneeRole(): Record<TaskAssigneeRoleKey, TaskItem[]>;

function getActiveAssigneeGroups(): [TaskAssigneeRoleKey, TaskItem[]][] {
  return Object.entries(getTasksByAssigneeRole())
    .filter(
      ([role]) =>
        role !== TaskAssigneeRole.OBSERVER &&
        role !== TaskAssigneeRole.REVIEWER,
    )
    .map(
      ([role, items]) =>
        [role, items.slice().sort((a, b) => (a.signingOrder ?? Number.MAX_SAFE_INTEGER) - (b.signingOrder ?? Number.MAX_SAFE_INTEGER))] as [TaskAssigneeRoleKey, TaskItem[]],
    );
}



// Array.find with id-equality predicate inside some() — standard lookup, no type mismatch.
interface Participant {
  id: string;
  email: string;
  role: string;
  signingOrder: number;
}

interface FormEntry {
  id: string;
  email: string;
  role: string;
  signingOrder: number;
}

declare const currentParticipants: Participant[];

export function haveParticipantsChanged(
  formEntries: readonly FormEntry[],
  savedParticipants: readonly Participant[],
): boolean {
  if (formEntries.length !== savedParticipants.length) return true;
  return formEntries.some((entry) => {
    const participant = currentParticipants.find((participant) => participant.id === entry.id);
    if (!participant) return true;
    return (
      entry.email !== participant.email ||
      entry.role !== participant.role ||
      entry.signingOrder !== participant.signingOrder
    );
  });
}



// Array.find with compound enum-property predicate -- no type mismatch.

declare const TeamRoleType: { INTERNAL_TEAM: string; EXTERNAL_TEAM: string };

interface TeamGroup {
  id: string;
  type: string;
  teamRole: string;
}

export function resolveTeamGroup(
  teamGroups: TeamGroup[],
  memberRole: string,
): TeamGroup | undefined {
  return teamGroups.find(
    (group) =>
      group.type === TeamRoleType.INTERNAL_TEAM && group.teamRole === memberRole,
  );
}



// --- argument-type-mismatch FP: forEach over typed array where element type matches the acceptor ---
interface LayerItem {
  id: string;
  type: string;
  visible: boolean;
}

declare function renderItemOnCanvas(item: LayerItem): void;

export function renderAllItems(items: LayerItem[]): void {
  items.forEach((item) => {
    renderItemOnCanvas(item);
  });
}



// Array.some with case-insensitive string comparison -- no argument type mismatch.

interface Attendee {
  id: string;
  name: string;
  email: string;
}

interface Candidate {
  name: string;
  email: string;
}

declare const registeredAttendees: Attendee[];
declare const incomingCandidate: Candidate;

const nameAlreadyRegistered = registeredAttendees.some(
  (a) => a.name.toLowerCase() === incomingCandidate.name.toLowerCase(),
);

const emailAlreadyRegistered = registeredAttendees.some(
  (a) => a.email.toLowerCase() === incomingCandidate.email.toLowerCase(),
);



// Grouped option filtering — Array.find with property-equality callback inside
// Array.filter. No type mismatch: both sides of === are the same property type.

interface SelectOption {
  value: string;
  label: string;
}

type GroupedOptions = Record<string, SelectOption[]>;

declare const groupedOptions: GroupedOptions;
declare const selectedItems: SelectOption[];

function removeSelectedFromGroups(
  groups: GroupedOptions,
  selected: SelectOption[],
): GroupedOptions {
  const clone = JSON.parse(JSON.stringify(groups)) as GroupedOptions;
  for (const [key, items] of Object.entries(clone)) {
    clone[key] = items.filter((item) => !selected.find((s) => s.value === item.value));
  }
  return clone;
}

function hasOverlap(groups: GroupedOptions, targets: SelectOption[]): boolean {
  for (const [, items] of Object.entries(groups)) {
    if (items.some((item) => targets.find((t) => t.value === item.value))) {
      return true;
    }
  }
  return false;
}

export { removeSelectedFromGroups, hasOverlap, groupedOptions, selectedItems };



declare function isPendingAndMandatory(task: WorkflowTask): boolean;

interface WorkflowTask {
  id: string;
  status: "pending" | "completed" | "skipped";
  required: boolean;
  assigneeId: string;
}

interface WorkflowQueue {
  tasks: WorkflowTask[];
}

export function getPendingRequiredTasks(queue: WorkflowQueue): WorkflowTask[] {
  return queue.tasks.filter((task) => isPendingAndMandatory(task));
}



interface GroupSettings {
  notificationsEnabled: boolean;
  maxMembers: number;
}

interface GroupMember {
  userId: string;
  role: string;
}

interface TeamGroup {
  id: string;
  name: string;
  groupSettings: GroupSettings;
  members: GroupMember[];
}

declare const teamGroups: TeamGroup[];
declare function removeMembersByUserIds(groupId: string, userIds: string[]): Promise<void>;
declare function bulkApplyGroupSettings(
  updates: Array<{ groupId: string; settings: GroupSettings }>,
): Promise<void>;

async function syncGroupMembership(groupId: string, keepUserIds: string[]): Promise<void> {
  const group = teamGroups.find((g) => g.id === groupId);
  if (!group) return;

  const toRemove = group.members.filter(
    (member) => !keepUserIds.includes(member.userId),
  );

  await removeMembersByUserIds(groupId, toRemove.map((m) => m.userId));

  await bulkApplyGroupSettings(
    teamGroups.map((tg) => {
      const { groupSettings } = tg;
      return {
        groupId: tg.id,
        settings: {
          notificationsEnabled: groupSettings.notificationsEnabled,
          maxMembers: groupSettings.maxMembers,
        },
      };
    }),
  );
}



// Async map over ORM-fetched records — standard Promise.all pattern; no argument
// type mismatch despite the async callback returning Promise<void> inside map.
declare interface SubscriberRecord {
  id: string;
  email: string;
  readPermissions: string[];
  writePermissions: string[];
  fields: Array<{ templateId?: string; value: string }>;
}

declare interface SubscriberAuthConfig {
  readPermissions: string[];
  writePermissions: string[];
}

declare function buildSubscriberAuthConfig(opts: {
  readPermissions: string[];
  writePermissions: string[];
}): SubscriberAuthConfig;

declare const allSubscribers: SubscriberRecord[];
declare const db: { subscriber: { create: (args: object) => Promise<void> } };

export async function persistAllSubscribers(): Promise<void> {
  await Promise.all(
    allSubscribers.map(async (subscriber) => {
      const authConfig = buildSubscriberAuthConfig({
        readPermissions: subscriber.readPermissions ?? [],
        writePermissions: subscriber.writePermissions ?? [],
      });

      const fieldsToCreate = (subscriber.fields || []).map((field) => ({
        templateId: field.templateId ?? null,
        value: field.value,
      }));

      await db.subscriber.create({
        data: {
          id: subscriber.id,
          email: subscriber.email,
          authConfig,
          fields: { createMany: { data: fieldsToCreate } },
        },
      });
    }),
  );
}



// Keepalive timer: setInterval returns NodeJS.Timeout assigned to NodeJS.Timeout | null
// -- correct assignment, no argument type mismatch.
declare const HEARTBEAT_INTERVAL_MS: number;

interface HeartbeatWriter {
  writeln(data: string): Promise<void>;
}

export function startHeartbeat(writer: HeartbeatWriter): NodeJS.Timeout | null {
  let heartbeatTimer: NodeJS.Timeout | null = setInterval(() => {
    void writer.writeln(JSON.stringify({ type: "heartbeat", ts: Date.now() }));
  }, HEARTBEAT_INTERVAL_MS);

  return heartbeatTimer;
}

export function stopHeartbeat(timer: NodeJS.Timeout | null): void {
  if (timer !== null) {
    clearInterval(timer);
  }
}



// Array.some with a typed predicate — verifies that no pending escalation
// exceeds the current member's permission tier.

declare type TeamRole = 'viewer' | 'editor' | 'admin' | 'owner';

interface PendingEscalation {
  id: string;
  requestedRole: TeamRole;
}

declare function isRoleWithinMemberTier(currentRole: TeamRole, requestedRole: TeamRole): boolean;

export function hasUnauthorizedEscalation(
  currentRole: TeamRole,
  pendingEscalations: PendingEscalation[],
): boolean {
  return pendingEscalations.some(
    (escalation) => !isRoleWithinMemberTier(currentRole, escalation.requestedRole),
  );
}



// Array spread + sort with nullish-coalescing comparator.
// Standard pattern: optional numeric field defaulted via ?? before arithmetic.
// No type mismatch -- the rule must not fire here.

interface Task {
  id: number;
  priority?: number;
}

declare const pendingTasks: Task[];

function sortTasksByPriority(items: Task[]): Task[] {
  return [...items].sort((a, b) => {
    const aPriority = a.priority ?? Number.MAX_SAFE_INTEGER;
    const bPriority = b.priority ?? Number.MAX_SAFE_INTEGER;

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    return a.id - b.id;
  });
}

export { sortTasksByPriority };



// map with find-and-fallback — no type mismatch; find returns T|undefined and || supplies a default
declare const AssignmentStatus: { UNASSIGNED: string };

interface ProjectTask {
  id: string;
  assigneeId: string | null;
  title: string;
  priority: number;
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  status: string;
}

interface ProjectBoard {
  tasks: ProjectTask[];
  members: TeamMember[];
}

declare const board: ProjectBoard;

const displayTasks = board.tasks.map((task) => {
  const assignee = board.members.find((member) => member.id === task.assigneeId) || {
    name: '',
    email: '',
    status: AssignmentStatus.UNASSIGNED,
  };

  return {
    ...task,
    assignee,
    completedAt: null,
  };
});



// --- argument-type-mismatch FP: array transformation where all branches return compatible types ---

interface FormField {
  id: number;
  name: string;
  value: string;
  completed: boolean;
}

interface SignPayload {
  fieldId: number;
  value?: string;
}

declare function cloneDeep<T>(obj: T): T;

function applyFieldValue(fields: FormField[], payload: SignPayload): FormField[] {
  return fields.map((field) => {
    if (field.id !== payload.fieldId) {
      return field;
    }

    const updatedField: FormField = cloneDeep({
      ...field,
      value: payload.value ?? '',
      completed: true,
    });

    return updatedField;
  });
}



// Merging server-returned records back into local state by id.
// Array.find with id equality inside a map callback - no type mismatch.
declare const localItems: { id: number; title: string; quantity: number }[];
declare const responseItems: { id: number; title: string; quantity: number }[];
declare function setLocalItems(items: { id: number; title: string; quantity: number }[]): void;

function mergeUpdatedItems(): void {
  setLocalItems(
    localItems.map((existingItem) => {
      const refreshedItem = responseItems.find((item) => item.id === existingItem.id);

      if (refreshedItem) {
        return {
          ...existingItem,
          ...refreshedItem,
        };
      }

      return existingItem;
    }),
  );
}



interface Reviewer {
  id: string;
  displayName: string;
  status: 'pending' | 'approved' | 'declined';
}

export function findReviewerIndex(
  reviewers: readonly Reviewer[],
  activeReviewer: Reviewer | null,
): number {
  return reviewers.findIndex((r) => r.id === activeReviewer?.id);
}

export function findCommentIndexById(
  comments: ReadonlyArray<{ id: string; body: string }>,
  selected: { id: string; body: string } | undefined,
): number {
  return comments.findIndex((c) => c.id === selected?.id);
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



interface ChecklistItem {
  id: string;
  label: string;
  completed: boolean;
}

export function getPendingChecklistItems(items: readonly ChecklistItem[]): ChecklistItem[] {
  return items.filter((item) => !item.completed);
}

export function getOutstandingChecklistItems(
  primaryItems: readonly ChecklistItem[],
  delegatedItems: readonly ChecklistItem[],
  isDelegatedView: boolean,
): ChecklistItem[] {
  if (isDelegatedView) {
    return delegatedItems.filter((item) => !item.completed);
  }

  return primaryItems.filter((item) => !item.completed);
}



interface CartLinePatch {
  cartLineId: string;
  quantity: number;
}

interface CartSnapshot {
  cartLines: ReadonlyArray<{ id: string; sku: string }>;
}

export function patchedLinesBelongToCart(
  patch: readonly CartLinePatch[],
  cart: CartSnapshot,
): boolean {
  return patch.every((line) =>
    cart.cartLines.some(({ id }) => line.cartLineId === id),
  );
}



interface DocumentField {
  recipientId: string;
  inserted: boolean;
  type: string;
}

interface SignerRecipient {
  id: string;
  email: string;
}

declare const documentFields: readonly DocumentField[];
declare const activeRecipient: SignerRecipient;

export function getRecipientFieldsRequiringSignature(): DocumentField[] {
  const requiringValidation = documentFields.filter((field) => !field.inserted);
  return requiringValidation.filter((field) => field.recipientId === activeRecipient.id);
}



// Standard Array.find with a logical-OR predicate whose right-hand side is a
// short-circuit `&&` against a nullable string. The predicate is plain boolean
// logic over a generic element constrained to have a `username` field - there
// is no type mismatch on the callback or its return value.
export const findAccountByUsername = <T extends { username: string }>({
  accounts,
  primaryUsername,
  fallbackUsername,
}: {
  accounts: T[];
  primaryUsername: string;
  fallbackUsername?: string | null;
}) => accounts.find((a) => a.username === primaryUsername || (fallbackUsername && a.username === fallbackUsername));



declare const currentTeam: { id: string } | undefined;

interface Membership {
  id: string;
  teamId: string;
  page: number;
  status: 'active' | 'pending';
}

interface MembershipState {
  localMemberships: readonly Membership[];
}

interface PageContext {
  scale: number;
  pageNumber: number;
}

declare const membershipState: MembershipState;
declare const pageContext: PageContext;

export function getMembershipsForPage(): readonly Membership[] {
  const { scale, pageNumber } = pageContext;
  void scale;
  return membershipState.localMemberships.filter(
    (membership) => membership.page === pageNumber && membership.teamId === currentTeam?.id,
  );
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



// Array.some with logical OR predicate across multiple properties — no type mismatch
declare const attachmentMappings: Array<{ fieldKey: string; fieldLabel: string }>;
declare const uploadedFile: { name: string; index: number };

export function hasMatchingAttachment(mappings: typeof attachmentMappings, file: typeof uploadedFile): boolean {
  return mappings.some(
    (mapping) => mapping.fieldKey === file.name || mapping.fieldKey === file.index
  );
}



// Array.from with Map.entries() and a mapFn — correctly destructured tuple, no type mismatch
declare const contactRefs: Map<number, string>;

export function buildContactList(refs: typeof contactRefs): Array<{ index: number; label: string }> {
  return Array.from(refs.entries(), ([contactIndex, name]) => ({
    index: contactIndex,
    label: name,
  }));
}



// tRPC fluent builder chain — useQuery with typed options object, no type mismatch
declare const trpc: {
  settings: {
    domains: {
      list: {
        useQuery: (opts: { workspaceId: string; page?: number }) => { data: unknown };
      };
    };
  };
};
declare const workspace: { id: string };

export function useDomainList(page?: number) {
  return trpc.settings.domains.list.useQuery({ workspaceId: workspace.id, page });
}



// trigger.dev runTask with an async callback — standard ORM usage, no type mismatch
declare const io: { runTask: <T>(name: string, fn: () => Promise<T>) => Promise<T> };
declare const db: { recipient: { update: (args: { where: { id: string }; data: { status: string } }) => Promise<{ id: string }> } };
declare const recipientId: string;

export async function markRecipientDone(recipientId: string): Promise<void> {
  await io.runTask('update-recipient', async () => {
    await db.recipient.update({ where: { id: recipientId }, data: { status: 'completed' } });
  });
}



// Lingui i18n.date() receiving a Date value from a row — types match, no mismatch
declare const i18n: { date: (d: Date, opts?: object) => string };
declare const tableRows: Array<{ original: { submittedAt: Date } }>;

export function formatRowDate(row: { original: { submittedAt: Date } }): string {
  return i18n.date(row.original.submittedAt);
}



// Buffer.from() receiving an ArrayBuffer returned from a server utility — compatible types, no mismatch
declare function fetchFileBytes(path: string): Promise<ArrayBuffer>;

export async function downloadAsBuffer(path: string): Promise<Buffer> {
  const bytes = await fetchFileBytes(path);
  return Buffer.from(bytes);
}



// Lingui t() receiving a MessageDescriptor from a lookup map — types match, no mismatch
interface MessageDescriptor { id: string; message?: string }
declare function t(msg: MessageDescriptor): string;
declare const ROLE_LABEL_MAP: Record<string, MessageDescriptor>;
declare const member: { role: string };

export function formatMemberRole(member: { role: string }): string {
  return t(ROLE_LABEL_MAP[member.role]);
}



// Array.find with string equality on id — standard find, no type mismatch
interface WizardStep { id: string; label: string }
declare const wizardSteps: WizardStep[];
declare const activeStepId: string;

export function getActiveStep(steps: WizardStep[], stepId: string): WizardStep | undefined {
  return steps.find((step) => step.id === stepId);
}

export const currentStep = getActiveStep(wizardSteps, activeStepId);



// Prisma $transaction with Promise.all — standard transaction, no type mismatch
declare const prisma: {
  $transaction: <T>(fn: (tx: typeof prisma) => Promise<T>) => Promise<T>;
  tag: { update: (args: { where: { id: string }; data: { name: string } }) => Promise<{ id: string }> };
};
declare const tagUpdates: Array<{ id: string; name: string }>;

export async function bulkUpdateTags(updates: typeof tagUpdates): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await Promise.all(
      updates.map(async (update) => {
        await tx.tag.update({ where: { id: update.id }, data: { name: update.name } });
      })
    );
  });
}



// Typed Array.map with explicit return type and inner find — standard map, no type mismatch
interface SelectOption<T> { value: T; label: string }
declare const selectedValues: string[];
declare const availableOptions: Array<SelectOption<string>>;

export function resolveSelectedOptions(values: string[], options: Array<SelectOption<string>>): Array<SelectOption<string>> {
  return values.map((value): SelectOption<string> => {
    const found = options.find((option) => option.value === value);
    return found ?? { value, label: value };
  });
}



// Array.filter with boolean property — truthy check on boolean, correctly typed
interface Folder { id: string; name: string; pinned: boolean }
declare const folderList: Folder[];

export function getPinnedFolders(folders: Folder[]): Folder[] {
  return folders.filter((folder) => folder.pinned);
}

export const pinnedFolders = getPinnedFolders(folderList);



// Array.map with conditional guard — standard conditional map, no type mismatch
declare function canItemBeEdited(id: string): boolean;
interface FormItem { id: string; name: string; locked?: boolean }

export function buildEditableList(items: FormItem[]): FormItem[] {
  return items.map((item) => {
    if (!canItemBeEdited(item.id)) {
      return { ...item, locked: true };
    }
    return item;
  });
}



// Typed destructured async callback passed to a hook — correct parameter typing, no type mismatch
interface SavePayload { data: Record<string, unknown>; meta: { timestamp: number } }
declare function useAutoSave(fn: (payload: SavePayload) => Promise<void>): void;

export function useFormAutoSave(): void {
  useAutoSave(async ({ data, meta }: SavePayload) => {
    await fetch('/api/save', { method: 'POST', body: JSON.stringify({ data, ts: meta.timestamp }) });
  });
}



// Array.includes with string element type — correctly typed, no type mismatch
declare const allowedCategories: string[];
declare const items: Array<{ id: string; category: string }>;

export function filterByAllowedCategory(items: Array<{ id: string; category: string }>, allowed: string[]): typeof items {
  return items.filter((item) => allowed.includes(item.category));
}

export const filteredItems = filterByAllowedCategory(items, allowedCategories);



// Array.includes with string argument — standard includes, no type mismatch
declare const blockedEmails: string[];
declare const candidateEmail: string;

export function isEmailBlocked(blocked: string[], email: string): boolean {
  return blocked.includes(email);
}

export const blocked = isEmailBlocked(blockedEmails, candidateEmail);



// Array.some with nested find — standard some + find combo, no type mismatch
interface Signer { id: string; email: string }
interface Recipient { signerId: string; status: string }
declare const signers: Signer[];
declare const recipients: Recipient[];

export function hasUnsignedSigner(signerList: Signer[], recipientList: Recipient[]): boolean {
  return signerList.some((signer) => {
    const recipient = recipientList.find((r) => r.signerId === signer.id);
    return recipient?.status !== 'signed';
  });
}



// Array.find with id equality matching a related id field — standard find, no type mismatch
interface FormField { id: string; fieldType: string; ownerId: string }
interface Owner { id: string; name: string }
declare const formFields: FormField[];
declare const owners: Owner[];

export function getFieldOwner(field: FormField, ownerList: Owner[]): Owner | undefined {
  return ownerList.find((owner) => owner.id === field.ownerId);
}



// Kysely fn.sum(fn.count()) intentional aggregate — devs aware, using type cast, no real bug
declare const fn: {
  sum: (expr: unknown) => unknown;
  count: (col: string) => unknown;
};
declare const db: {
  selectFrom: (table: string) => {
    select: (col: unknown) => { executeTakeFirst: () => Promise<{ total: string }> };
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getTotalDocumentCount(): Promise<number> {
  const result = await db
    .selectFrom('documents')
    .select(fn.sum(fn.count('id') as any) as any)
    .executeTakeFirst();
  return Number(result?.total ?? 0);
}



// new Uint8Array(Buffer.from(base64, 'base64')) — correctly chained Buffer and Uint8Array, no type mismatch
declare const credentialId: string;

export function decodeCredentialId(base64Id: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64Id, 'base64'));
}

export const decodedId = decodeCredentialId(credentialId);



// Function called with typed properties from another typed object — types match, no mismatch
interface ApiToken { userId: string; teamId: string }
interface FieldsPayload { userId: string; teamId: string; fieldIds: string[] }
declare function applyFieldsForDocument(payload: FieldsPayload): Promise<void>;
declare const apiToken: ApiToken;

export async function processApiFields(token: ApiToken, fieldIds: string[]): Promise<void> {
  await applyFieldsForDocument({ userId: token.userId, teamId: token.teamId, fieldIds });
}



// Array.some with enum comparison — standard some with string enum, no type mismatch
const enum UploadError { FileTooLarge = 'file-too-large', TooManyFiles = 'too-many-files' }
interface FileError { code: string }
interface RejectedFile { errors: FileError[] }

export function hasTooManyFilesError(rejected: RejectedFile): boolean {
  return rejected.errors.some((error) => error.code === UploadError.TooManyFiles);
}



// Hono generic instantiation with typed context — correct generic usage, no type mismatch
interface AppContext { Variables: { userId: string } }
declare class Hono<T> {
  post(path: string, handler: (c: { var: T }) => Promise<Response>): this;
}

const router = new Hono<AppContext>().post('/logout', async (c) => {
  return new Response(JSON.stringify({ ok: true }));
});
export { router };



// Standard array transformation mapping items to a new shape — no type mismatch
interface RawEntry { id: string; name: string; sourceId: string }
interface NormalizedEntry { id: string; entryId: string; label: string }

export function normalizeEntries(items: RawEntry[]): NormalizedEntry[] {
  return items.map((item) => ({
    id: item.id,
    entryId: item.id,
    label: item.name,
  }));
}



// Luxon DateTime method chain with string arguments — all correctly typed strings, no type mismatch
declare const DateTime: {
  fromJSDate: (d: Date) => {
    setLocale: (locale: string) => {
      toFormat: (fmt: string) => string;
    };
  };
};
declare const eventDate: Date;
declare const userLocale: string;

export function formatEventDate(date: Date, locale: string): string {
  return DateTime.fromJSDate(date).setLocale(locale).toFormat('dd MMM yyyy');
}

export const formatted = formatEventDate(eventDate, userLocale);



// ts-pattern match().with() on enum — correct exhaustive enum pattern matching, no type mismatch
declare const match: <T>(value: T) => {
  with: <R>(pattern: T, fn: () => R) => { otherwise: (fn: () => R) => R };
};
const enum ActivityKind { Created = 'created', Updated = 'updated', Deleted = 'deleted' }
declare const ACTIVITY_KIND_CREATED: ActivityKind.Created;

export function describeActivity(kind: ActivityKind): string {
  return match(kind)
    .with(ACTIVITY_KIND_CREATED, () => 'Item was created')
    .otherwise(() => 'Item was modified');
}



// Immutable Array.map with spread and overriding a property — standard spread update, no type mismatch
interface FormEntry { id: string; value: string; legacyId: string; order: number }
declare const formEntries: FormEntry[];
declare const legacyFormId: string;

export function migrateEntries(entries: FormEntry[], legacyId: string): FormEntry[] {
  return entries.map((entry) => ({ ...entry, legacyId }));
}



// String.prototype.startsWith with string literal — standard startsWith, no type mismatch
declare const requestPath: string;

export function isJobBoardRequest(path: string): boolean {
  return path.startsWith('/api/jobs/');
}

export const isJobRoute = isJobBoardRequest(requestPath);



// Array spread + sort with nullish coalescing fallback — standard sort, no type mismatch
interface Participant { id: string; name: string; priority?: number }

export function sortParticipants(participants: Participant[]): Participant[] {
  return [...participants].sort((a, b) => {
    const aPriority = a.priority ?? Number.MAX_SAFE_INTEGER;
    const bPriority = b.priority ?? Number.MAX_SAFE_INTEGER;
    return aPriority - bPriority;
  });
}



// Immutable Array.map assigning a fixed enum value — typed spread, no type mismatch
const enum ApprovalStatus { Pending = 'pending', Approved = 'approved' }
interface Reviewer { id: string; name: string; status: ApprovalStatus }
declare const reviewers: Reviewer[];

export function approveAllReviewers(reviewers: Reviewer[]): Reviewer[] {
  return reviewers.map((reviewer) => ({ ...reviewer, status: ApprovalStatus.Approved }));
}



// Node.js file read operation — stdlib usage, no type mismatch
import type { } from 'node:fs';
declare const fs: { readFileSync: (path: string, encoding: BufferEncoding) => string };
declare const configPath: string;

export function readConfigFile(path: string): string {
  return fs.readFileSync(path, 'utf-8');
}

export const configContents = readConfigFile(configPath);



// Array.includes with type assertion for narrowing — intentional narrowing cast, no real bug
type ValidLocale = 'en' | 'fr' | 'de';
const VALID_LOCALES: ValidLocale[] = ['en', 'fr', 'de'];

export function isValidLocale(locale: string): locale is ValidLocale {
  return VALID_LOCALES.includes(locale as ValidLocale);
}



// Lingui tagged msg template passed to _ function — MessageDescriptor accepted, types match
interface MessageDescriptor { id: string }
declare function _(msg: MessageDescriptor): string;
declare function msg(strings: TemplateStringsArray): MessageDescriptor;

export function getStatusLabel(status: string): string {
  return _({ id: `status.${status}` });
}

export const activeLabel = getStatusLabel('active');



// Kysely fn() with string column reference as second argument — intended API, no type mismatch
declare const fn: {
  count: (col: string) => unknown;
  coalesce: (expr: unknown, fallback: unknown) => unknown;
};
declare const sql: { lit: (val: number) => unknown };
declare const db: {
  selectFrom: (table: string) => {
    select: (col: unknown) => { executeTakeFirst: () => Promise<{ conversions: string }> };
  };
};

export async function getConversionCount(): Promise<number> {
  const result = await db
    .selectFrom('conversions')
    .select(fn.coalesce(fn.count('id'), sql.lit(0)))
    .executeTakeFirst();
  return Number(result?.conversions ?? 0);
}



// tRPC httpBatchLink configuration with headers callback — standard tRPC setup, no type mismatch
declare function httpBatchLink(opts: {
  url: string;
  transformer?: unknown;
  headers?: (opts: { opList: unknown[] }) => Record<string, string>;
}): unknown;
declare const dataTransformer: unknown;
declare function getBaseApiUrl(): string;

export const apiLink = httpBatchLink({
  url: `${getBaseApiUrl()}/api/trpc`,
  transformer: dataTransformer,
  headers: (opts) => ({
    'x-request-count': String(opts.opList.length),
  }),
});



// ts-pattern match().with() on enum for JSX rendering — correct enum pattern, no type mismatch
declare const match: <T>(value: T) => {
  with: <P extends T, R>(pattern: P, fn: () => R) => { exhaustive: () => R; with: (p2: Exclude<T, P>, fn2: () => R) => { exhaustive: () => R } };
};
const enum RecipientKind { Signer = 'SIGNER', Viewer = 'VIEWER' }
declare const role: RecipientKind;

export function getRoleDescription(kind: RecipientKind): string {
  return match(kind)
    .with(RecipientKind.Signer, () => 'Must sign the document')
    .with(RecipientKind.Viewer, () => 'Can view the document')
    .exhaustive();
}



// Lingui _ function called with a MessageDescriptor — types match the _ function signature
interface MessageDescriptor { id: string; comment?: string }
declare function _(descriptor: MessageDescriptor): string;
declare const fieldDescription: MessageDescriptor;

export function translateFieldDescription(descriptor: MessageDescriptor): string {
  return _(descriptor);
}

export const translatedDesc = translateFieldDescription(fieldDescription);



// Immutable update pattern: Array.map with conditional ternary — standard immutable update, no type mismatch
interface SigningEntry { id: string; signerId: string; isSigned: boolean; signedAt?: Date }
declare const currentEntries: SigningEntry[];
declare const signedId: string;

export function markEntrySigned(entries: SigningEntry[], targetSignerId: string): SigningEntry[] {
  return entries.map((entry) =>
    entry.signerId === targetSignerId
      ? { ...entry, isSigned: true, signedAt: new Date() }
      : entry
  );
}



// Object.assign to add a property to a canvas-like node — standard Object.assign, no type mismatch
interface CanvasNode { width: number; height: number; style?: Record<string, unknown> }
declare const canvasNode: CanvasNode;

export function applyNodeStyle(node: CanvasNode): CanvasNode & { style: Record<string, unknown> } {
  return Object.assign(node, { style: {} });
}

export const styledNode = applyNodeStyle(canvasNode);



// Zod schema with union + transform — valid schema definition, no type mismatch
declare const z: {
  object: <S extends Record<string, unknown>>(shape: S) => { parse: (v: unknown) => unknown };
  union: <T extends unknown[]>(types: T) => { transform: (fn: (v: unknown) => unknown) => unknown };
  string: () => { optional: () => unknown };
  literal: (val: unknown) => unknown;
};

export const authOptionsSchema = z.object({
  method: z.union([z.literal('password'), z.literal('passkey')]),
  credentials: z.string().optional(),
});



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



// --- argument-type-mismatch shape: Array.some() with nested Array.find() inside callback ---
interface LineItem { id: string; productId: string; quantity: number }
interface OrderItem { lineItemId: string; quantity: number }

function hasOrderQuantityChanged(orderItems: OrderItem[], lineItems: LineItem[]): boolean {
  return orderItems.some((item) => {
    const existing = lineItems.find((l) => l.id === item.lineItemId);
    return !existing || item.quantity !== existing.quantity;
  });
}



// --- argument-type-mismatch shape: optional-chained array find by id ---
interface Category { id: number; slug: string }
interface PageConfig { categories: Category[]; featuredLink?: { featuredCategoryId: number } }

function getFeaturedCategory(config: PageConfig): Category | undefined {
  return config.categories.find(
    (category) => category.id === config.featuredLink?.featuredCategoryId,
  );
}



// --- argument-type-mismatch shape: typed array .includes() with enum constant ---
const enum VerificationMethod {
  SMS = 'SMS',
  EMAIL = 'EMAIL',
  TOTP = 'TOTP',
  NONE = 'NONE',
}

function requiresUserVerification(methods: VerificationMethod[]): boolean {
  return methods.length > 0 && !methods.includes(VerificationMethod.NONE);
}



// --- argument-type-mismatch shape: Array.find by id in list ---
interface Attachment { id: string; filename: string; size: number }
interface UploadedFile { attachmentId: string; displayName: string }

function resolveAttachmentForFile(files: UploadedFile[], attachments: Attachment[], fileAttachmentId: string): Attachment | undefined {
  return attachments.find((attachment) => attachment.id === fileAttachmentId);
}



// --- argument-type-mismatch shape: enum array .includes() check as type guard ---
const enum WidgetKind {
  COUNTER = 'COUNTER',
  CHART = 'CHART',
  TABLE = 'TABLE',
  METRIC = 'METRIC',
}

const CONFIGURABLE_WIDGET_KINDS: WidgetKind[] = [
  WidgetKind.COUNTER,
  WidgetKind.CHART,
  WidgetKind.TABLE,
];

interface Widget { id: string; kind: WidgetKind; title: string }

function isWidgetConfigurable(widget: Widget): boolean {
  if (!CONFIGURABLE_WIDGET_KINDS.includes(widget.kind)) {
    return false;
  }
  return true;
}



// --- argument-type-mismatch shape: Array.map building initialData objects with spread and placeholder property ---
interface Workspace { id: string; name: string; slug: string }
interface WorkspaceTableRow extends Workspace { currentUserId: string }

function buildWorkspaceTableRows(workspaces: Workspace[]): WorkspaceTableRow[] {
  return workspaces.map((ws) => ({
    ...ws,
    currentUserId: '', // placeholder filled in by query result
  }));
}



// --- argument-type-mismatch shape: useCallback returning Object.entries().filter() functional composition ---
declare function useCallback<T extends (...args: any[]) => any>(fn: T, deps: any[]): T;

const enum MemberRole { VIEWER = 'VIEWER', EDITOR = 'EDITOR', ADMIN = 'ADMIN', OWNER = 'OWNER' }
interface TeamMember { id: string; role: MemberRole; name: string }

function buildEditableMembersGetter(members: TeamMember[]) {
  const getEditableMembers = useCallback(() => {
    return Object.entries(
      members.reduce<Record<MemberRole, TeamMember[]>>(
        (acc, member) => { acc[member.role].push(member); return acc; },
        { VIEWER: [], EDITOR: [], ADMIN: [], OWNER: [] },
      ),
    ).filter(([role]) => role !== MemberRole.OWNER);
  }, [members]);

  return getEditableMembers;
}



// --- argument-type-mismatch shape: findIndex result passed as argument to style helper ---
interface Member { id: number; name: string; email: string }
declare function getMemberColorStyles(index: number): { comboBoxItem: string; avatar: string };

function MemberColoredItem({ member, members }: { member: Member; members: Member[] }) {
  const memberIndex = members.findIndex((m) => m.id === member.id);
  const styles = getMemberColorStyles(memberIndex);
  return (
    <span className={styles.comboBoxItem}>{member.name}</span>
  );
}



// --- argument-type-mismatch shape: Array.find with multi-condition predicate ---
type PricingPeriod = 'monthly' | 'annual';
interface PricingPlan { id: string; name: string; monthly?: { id: string }; annual?: { id: string } }

function findActivePlan(plans: PricingPlan[], selectedId: string, period: PricingPeriod): PricingPlan | undefined {
  return plans.find(
    (plan) =>
      plan[period === 'monthly' ? 'annual' : 'monthly']?.id === selectedId,
  );
}



// --- argument-type-mismatch shape: Array.map extracting single property from object array ---
interface ProjectMember { id: number; name: string; role: string }

function extractMemberIds(members: ProjectMember[]): number[] {
  return members.map((member) => member.id);
}



// --- argument-type-mismatch shape: ternary in object property for conditional assignment based on modifiability ---
interface WorkflowStep { id: string; order?: number; locked: boolean }
declare function canStepBeModified(stepId: string): boolean;

function reorderWorkflowSteps(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((step, index) => ({
    ...step,
    order: !canStepBeModified(step.id) ? step.order : index + 1,
  }));
}



// --- argument-type-mismatch shape: generic Array.includes check where element type matches array element type ---
function MultiTagSelector<T extends string | number>({
  selectedValues,
  options,
  onChange,
}: {
  selectedValues: T[];
  options: T[];
  onChange: (values: T[]) => void;
}) {
  const handleToggle = (option: T) => {
    let next = [...selectedValues, option];
    if (selectedValues.includes(option)) {
      next = selectedValues.filter((v) => v !== option);
    }
    onChange(next);
  };

  return null;
}



// --- shape da7ae7771fce: forEach + find inside an iteration callback ---
declare const attachments: Array<{ id: string; label: string; data: string }>;
declare const existingAttachments: Array<{ id: string; label: string; data: string }>;
declare let hasChanged: boolean;

function detectAttachmentChanges(): void {
  attachments.forEach((attachment) => {
    const found = existingAttachments.find((a) => a.id === attachment.id);
    if (!found) {
      hasChanged = true;
      return;
    }
    if (found.label !== attachment.label || found.data !== attachment.data) {
      hasChanged = true;
    }
  });
}



// Array.find in an if condition guard
declare interface TeamMember { userId: string; email: string; role: string; }
declare const teamMembers: TeamMember[];
declare const currentUser: { id: string; email: string } | null;

function checkUserIsMember(): boolean {
  if (currentUser && teamMembers.find((member) => member.userId === currentUser!.id)) {
    return true;
  }
  return false;
}



// Array.filter with string predicate (toLowerCase includes)
declare interface FolderItem { id: string; name: string; parentId: string | null; }
declare function getFolders(): FolderItem[];
declare let searchQuery: string;

function getFilteredFolders(): FolderItem[] {
  const folders = getFolders();
  return folders.filter((folder) =>
    folder.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );
}



// Array.find with string equality check
declare interface WorkspaceUser { id: string; email: string; status: string; }
declare const workspaceUsers: WorkspaceUser[];
declare const currentUserEmail: string;

function findCurrentWorkspaceUser(): WorkspaceUser | undefined {
  return workspaceUsers.find((user) => user.email === currentUserEmail);
}



// Chained optional-call find (.find(...)?.prop.find(...))
declare interface FieldDef { id: number; type: string; }
declare interface RecipientRecord { id: number; email: string; fields: FieldDef[]; }
declare const records: RecipientRecord[];

function findSignatureField(recipientId: number): FieldDef | undefined {
  return records
    .find((r) => r.id === recipientId)
    ?.fields.find((f) => f.type === 'SIGNATURE' || f.type === 'FREE_SIGNATURE');
}



// filter().map() chain
declare interface Invitation { email: string | undefined; role: string; }

function getUniqueEmails(invitations: Invitation[]): string[] {
  return invitations
    .filter((inv) => inv.email !== undefined)
    .map((inv) => inv.email as string);
}

function hasNoDuplicateEmails(invitations: Invitation[]): boolean {
  const emails = getUniqueEmails(invitations);
  return new Set(emails).size === emails.length;
}



// ts-pattern match().with() exhaustive pattern match
declare function match<T>(value: T): { with<R>(pattern: unknown, fn: () => R): { exhaustive(): R } };
declare const fieldType: 'SIGNATURE' | 'TEXT' | 'DATE' | 'CHECKBOX';

type FieldHandler = () => JSX.Element;

declare function SignatureField(): JSX.Element;
declare function TextField(): JSX.Element;
declare function DateField(): JSX.Element;
declare function CheckboxField(): JSX.Element;

function renderField(type: 'SIGNATURE' | 'TEXT' | 'DATE' | 'CHECKBOX'): JSX.Element {
  return match(type)
    .with('SIGNATURE', () => SignatureField())
    .with('TEXT', () => TextField())
    .with('DATE', () => DateField())
    .with('CHECKBOX', () => CheckboxField())
    .exhaustive();
}



// ts-pattern match in every() callback
declare function match<T>(value: T): { with<P, R>(p1: P, fn: () => R): { with<P2>(p2: P2, fn2: () => R): { exhaustive(): R } } };

type AccessAuth = 'ACCOUNT' | 'TWO_FACTOR_AUTH';

declare const sessionUser: { id: string } | null;
declare const requiredAuths: AccessAuth[];

function isAccessValid(): boolean {
  return requiredAuths.every((auth) =>
    match(auth)
      .with('ACCOUNT', () => Boolean(sessionUser))
      .with('TWO_FACTOR_AUTH', () => true)
      .exhaustive(),
  );
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



// Dropzone onDrop callback - standard file drop handler (argument-type-mismatch FP)
declare function useDropzone(options: any): any;
declare function processUploadedFiles(files: File[]): void;

function useFileDropZone() {
  const { getRootProps, getInputProps } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 5,
    onDrop: (files: File[]) => void processUploadedFiles(files),
    onDropRejected: (rejected: any[]) => {
      console.warn('Rejected files:', rejected.length);
    },
  });
  return { getRootProps, getInputProps };
}



// useAutoSave with async no-op fallback - passing optional async callback (argument-type-mismatch FP)
declare function useAutoSave(callback: () => Promise<void>): void;

function FieldAdvancedSettings({
  onSave,
}: {
  onSave?: () => Promise<void>;
}) {
  useAutoSave(onSave || (async () => {}));
  return null;
}



// Promise.allSettled with async map batch processing (argument-type-mismatch FP)
declare function syncDomain(domain: string): Promise<{ success: boolean }>;

async function syncDomainsBatch(domains: string[]): Promise<void> {
  const batchSize = 10;
  for (let i = 0; i < domains.length; i += batchSize) {
    const batch = domains.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(async (domain) => syncDomain(domain))
    );
  }
}



// pMap with async callback for controlled concurrency (argument-type-mismatch FP)
declare function pMap<T, R>(
  input: T[],
  mapper: (item: T, index: number) => Promise<R>,
  options?: { concurrency?: number }
): Promise<R[]>;
declare function deleteStorageObject(key: string): Promise<void>;

async function deleteObjectsBatch(objectKeys: string[]): Promise<void> {
  await pMap(
    objectKeys,
    async (key) => deleteStorageObject(key),
    { concurrency: 5 }
  );
}



// argument-type-mismatch FP: standard object map in .map callback
declare function generateId(length: number): string;
declare const documentData: { recipients: Array<{ id: number; email: string }> };

function mapRecipientsToFormData(
  recipients: Array<{ id: number; email: string }>
): Array<{ nativeId: number; formId: string; email: string }> {
  return recipients.map((recipient) => ({
    nativeId: recipient.id,
    formId: generateId(8),
    email: recipient.email,
  }));
}

export const recipientFormData = mapRecipientsToFormData(documentData.recipients);



// argument-type-mismatch FP: enum value comparison in .find callback
enum MemberRole { ADMIN = 'ADMIN', MEMBER = 'MEMBER', VIEWER = 'VIEWER' }
interface GroupMember { organisationRole: MemberRole; groupId: string }
declare const orgData: { groups: GroupMember[] };

function findAdminGroup(groups: GroupMember[]): GroupMember | undefined {
  return groups.find((group) => group.organisationRole === MemberRole.ADMIN);
}

export const adminGroup = findAdminGroup(orgData.groups);



// argument-type-mismatch FP: functional state update callback
declare function useSearchState(): [URLSearchParams, (updater: (prev: URLSearchParams) => URLSearchParams) => void];

function updateSearchFilter(key: string, value: string): void {
  const [, setSearchParams] = useSearchState();
  setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    next.set(key, value);
    return next;
  });
}

export { updateSearchFilter };



// argument-type-mismatch FP: array.map with nullish coalesce in mapped object
interface GroupItem { id: string; name: string | null }
interface SelectOption { value: string; label: string }
declare function toOption(params: { id: string; name: string }): SelectOption;

function groupsToOptions(groups: GroupItem[]): SelectOption[] {
  return groups.map((group) => toOption({ id: group.id, name: group.name ?? '' }));
}

export { groupsToOptions };



// argument-type-mismatch FP: immutable update with conditional spread in .map
interface ListItem { id: string; name: string; value: number }

function updateItemById(items: ListItem[], updated: ListItem): ListItem[] {
  return items.map((item) =>
    item.id === updated.id ? { ...item, ...updated } : item
  );
}

export { updateItemById };



// argument-type-mismatch FP: .find where callback passes property to boolean function
interface Organisation { id: string; url: string; name: string }
declare function isActiveOrgUrl(url: string): boolean;
declare const userOrgs: Organisation[];

function findCurrentOrg(orgs: Organisation[]): Organisation | undefined {
  return orgs.find((org) => isActiveOrgUrl(org.url));
}

export const currentOrg = findCurrentOrg(userOrgs);



// argument-type-mismatch FP: optional-chained .find by clientId
interface Recipient { id: string; clientId: string; email: string }
declare const updatedRecipients: Recipient[];
declare const currentRecipient: { clientId: string };

function resolveRecipientId(recipients: Recipient[], clientId: string): string | undefined {
  return recipients.find((r) => r.clientId === clientId)?.id;
}

export const resolvedId = resolveRecipientId(updatedRecipients, currentRecipient.clientId);



// argument-type-mismatch FP: string filter/sort comparator returning 1 or -1
interface SelectOption { value: string; label: string }

function filterAndRankOptions(options: SelectOption[], search: string): SelectOption[] {
  return options
    .filter((opt) => opt.label.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) =>
      a.label.toLowerCase().includes(search.toLowerCase()) ? 1 : -1
    );
}

export { filterAndRankOptions };



// argument-type-mismatch FP: array.filter with enum not-equal comparison
enum SigningStatus { PENDING = 'PENDING', SIGNED = 'SIGNED', DECLINED = 'DECLINED' }
interface FieldItem { id: string; recipientSigningStatus: SigningStatus }

function getPendingFields(fields: FieldItem[]): FieldItem[] {
  return fields.filter((field) => field.recipientSigningStatus !== SigningStatus.SIGNED);
}

export { getPendingFields };



// argument-type-mismatch FP: standard Array.map with unused value and index
function buildIndexedLabels(values: string[]): string[] {
  return values.map((_value, i) => `item-${i + 1}`);
}

export { buildIndexedLabels };



// argument-type-mismatch FP: chained flatMap + find by id
interface TemplateField { id: string; type: string; value: string | null }
interface TemplateRecipient { id: string; fields: TemplateField[] }
declare const templateRecipients: TemplateRecipient[];
declare const prefillFieldId: string;

function findPrefillField(
  recipients: TemplateRecipient[],
  fieldId: string
): TemplateField | undefined {
  return recipients.flatMap((r) => r.fields).find((field) => field.id === fieldId);
}

export const targetField = findPrefillField(templateRecipients, prefillFieldId);



// argument-type-mismatch FP: typed object map adding clientId to each recipient
declare function generateClientId(): string;
interface RecipientBase { id: string; email: string; name: string }
interface RecipientWithClientId extends RecipientBase { clientId: string }

function assignClientIds(recipients: RecipientBase[]): RecipientWithClientId[] {
  return recipients.map((recipient) => ({
    id: recipient.id,
    clientId: generateClientId(),
    email: recipient.email,
    name: recipient.name,
  }));
}

export { assignClientIds };



// argument-type-mismatch FP: standard array.find by id comparison
interface Recipient { id: string; email: string; name: string }
interface Field { id: string; recipientId: string; type: string }
declare const recipients: Recipient[];

function findRecipientForField(allRecipients: Recipient[], field: Field): Recipient | undefined {
  return allRecipients.find((recipient) => recipient.id === field.recipientId);
}

export { findRecipientForField };



// argument-type-mismatch FP: array.filter with destructured param predicate
enum GroupType { INTERNAL = 'INTERNAL', EXTERNAL = 'EXTERNAL' }
interface Group { id: string; type: GroupType; name: string }
interface GroupMembership { group: Group; joinedAt: string }
declare const userGroupMemberships: GroupMembership[];

function getInternalGroupMemberships(memberships: GroupMembership[]): GroupMembership[] {
  return memberships.filter(({ group }) => group.type === GroupType.INTERNAL);
}

export const internalGroups = getInternalGroupMemberships(userGroupMemberships);



// argument-type-mismatch FP: optional-chained .find by id on nullable result
interface GroupData { id: string; name: string; memberCount: number }
interface ApiResponse<T> { data: T[] | null; total: number }

function findGroupById(
  response: ApiResponse<GroupData> | null | undefined,
  id: string
): GroupData | undefined {
  return response?.data?.find((g) => g.id === id);
}

export { findGroupById };



// argument-type-mismatch FP: Array.find with multi-condition enum comparison predicate
enum RecipientRole { SIGNER = 'SIGNER', APPROVER = 'APPROVER', VIEWER = 'VIEWER', CC = 'CC' }
interface Recipient { id: string; role: RecipientRole; email: string }
declare const recipients: Recipient[];

function findSignerOrApprover(allRecipients: Recipient[]): Recipient | undefined {
  return allRecipients.find(
    (r) => r.role === RecipientRole.SIGNER || r.role === RecipientRole.APPROVER
  );
}

export const signerOrApprover = findSignerOrApprover(recipients);


// Array.map building flat team list with spread and nested object — valid data transformation.
interface Team { id: string; name: string; }
interface TeamMember { userId: string; team: Team; }
interface FlatTeamEntry { teamId: string; teamName: string; userId: string; }

function flattenTeamMembers(members: TeamMember[]): FlatTeamEntry[] {
  return members.map((m) => ({
    ...{ teamId: m.team.id, teamName: m.team.name },
    userId: m.userId,
  }));
}


// validationErrors.filter(error => error.includes('valid number')) — string array filter with string method.
function getNumericErrors(validationErrors: string[]): string[] {
  return validationErrors.filter((error) => error.includes('valid number'));
}


// Array.filter with type predicate — valid typed filter callback.
const SHARED_SECTIONS = ['overview', 'reference', 'guides'];

interface PageNode { name: string; }
interface FolderNode extends PageNode { children: PageNode[]; }

function isFolderNode(node: PageNode): node is FolderNode {
  return 'children' in node;
}

function getSharedFolders(nodes: PageNode[]): FolderNode[] {
  return nodes.filter((node): node is FolderNode =>
    isFolderNode(node) && SHARED_SECTIONS.includes(node.name.toLowerCase()),
  );
}


// Object.entries(params).forEach(([key, value]) => ...) — valid typed record iteration.
function applySearchParams(searchParams: URLSearchParams, params: Record<string, string | null>) {
  Object.entries(params).forEach(([key, value]) => {
    if (value === null) {
      searchParams.delete(key);
    } else {
      searchParams.set(key, value);
    }
  });
}


// Chained array find+some with id equality — no type mismatch.
interface DocumentField { id: string; fieldType: string; }
interface Recipient { id: string; fields: DocumentField[]; }
interface Envelope { recipients?: Recipient[]; }

function recipientHasField(envelope: Envelope | null | undefined, recipientId: string, fieldId: string): boolean {
  return envelope?.recipients
    .find((r) => r.id === recipientId)
    ?.fields.some((field) => field.id === fieldId) ?? false;
}


// Array.sort comparator with null-first logic returning numeric differences — valid comparator.
interface FormField { order: number | null; label: string; }

function sortFieldsNullFirst(fields: FormField[]): FormField[] {
  return [...fields].sort((a, b) => {
    if (a.order === null) return -1;
    if (b.order === null) return 1;
    return a.order - b.order;
  });
}


// fieldMeta.values?.map((value) => value.value) ?? [] — optional chaining map with nullish fallback.
interface FieldMeta { values?: Array<{ value: string; label: string }>; }

function getDropdownValues(fieldMeta: FieldMeta): string[] {
  return fieldMeta.values?.map((value) => value.value) ?? [];
}


// array.find with optional chaining and nullish coalescing — no type mismatch.
interface Recipient { id: string; email: string; }
interface FieldAssignment { recipientId: string; fieldKey: string; }

function getRecipientEmail(assignments: FieldAssignment[], recipients: Recipient[], fieldKey: string): string {
  return recipients.find((r) => r.id === assignments.find((a) => a.fieldKey === fieldKey)?.recipientId)?.email ?? '';
}


// Standard array.find by email — no type mismatch.
interface RecipientInput { email: string; name: string; role: string; }

function findRecipientByEmail(recipients: RecipientInput[], email: string): RecipientInput | undefined {
  return recipients.find((recipient) => recipient.email === email);
}


// array.map extracting typed properties into a new object — valid transformation.
interface EnvelopeItem { id: string; order: number; title: string; }
interface ItemSummary { id: string; order: number; }

function summariseItems(items: EnvelopeItem[]): ItemSummary[] {
  return items.map((item) => ({ id: item.id, order: item.order }));
}


// Array.map building defaultValues with includes(index) || false — valid boolean expression.
function buildCheckboxDefaults(totalCount: number, preselectedIndices: number[]): boolean[] {
  return Array.from({ length: totalCount }, (_, index) =>
    preselectedIndices.includes(index) || false,
  );
}


// Nested Array.some predicate — no type mismatch.
interface UploadError { code: string; message: string; }
interface FileRejection { file: File; errors: UploadError[]; }

const ERROR_CODE_TOO_MANY = 'too-many-files';

function hasTooManyFilesError(rejections: FileRejection[]): boolean {
  return rejections.some((rejection) =>
    rejection.errors.some((error) => error.code === ERROR_CODE_TOO_MANY),
  );
}


// Promise.all(array.map(async (item) => ...)) — typed array mapped to async operations.
interface EmailRecord { id: string; address: string; }
declare function verifyEmailDomain(emailId: string): Promise<boolean>;

async function verifyAllEmailDomains(emails: EmailRecord[]): Promise<boolean[]> {
  return Promise.all(emails.map(async (email) => verifyEmailDomain(email.id)));
}


// (Object.entries(record) as [Key, Value[]][]).filter(([key]) => ...) — explicit cast then filter.
type RecipientRole = 'SIGNER' | 'APPROVER' | 'CC';
interface LiteRecipient { id: string; email: string; }

function getSignerGroups(
  recipientsByRole: Record<string, LiteRecipient[]>,
  allowedRoles: RecipientRole[],
): [RecipientRole, LiteRecipient[]][] {
  return (Object.entries(recipientsByRole) as [RecipientRole, LiteRecipient[]][]).filter(
    ([role]) => allowedRoles.includes(role),
  );
}


// Array.from(iterable) where iterable comes from useFieldArray — valid conversion.
interface SignerField { id: string; email: string; name: string; }

function flattenSigners(watchedSigners: Iterable<SignerField>): SignerField[] {
  return Array.from(watchedSigners);
}


// array.map building objects with data: undefined intentionally — valid transformation.
interface EnvelopeItem { id: string; title: string; }
interface ItemSlot { title: string; data: unknown; envelopeItemId: string; }
declare const useFieldArray: { replace(items: ItemSlot[]): void };

function fillItemSlots(envelopeItems: EnvelopeItem[], sharedTitle: string) {
  useFieldArray.replace(
    envelopeItems.map((item) => ({ title: sharedTitle, data: undefined, envelopeItemId: item.id })),
  );
}


// array.filter with boolean predicate on page number — no type mismatch.
interface PageField { id: string; page: number; required: boolean; }

function getPageFields(fields: PageField[], pageNumber: number): PageField[] {
  return fields.filter((field) => field.page === pageNumber && !field.required);
}


// event.composedPath().includes($el.current) — EventTarget[] includes HTMLDivElement — valid.
declare const containerRef: { current: HTMLDivElement | null };

function isClickInsideContainer(event: MouseEvent): boolean {
  if (!containerRef.current) return false;
  return event.composedPath().includes(containerRef.current);
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



// --- array-callback-missing-return shape: async-map-promise-all-early-return-guard ---
declare function triggerNotificationJob(opts: { userId: string; recipientId: string; documentId: string }): Promise<void>;
interface NotificationRecipient { id: string; sendStatus: string; role: string; userId: string; documentId: string; }

export async function dispatchSigningNotifications(
  recipients: NotificationRecipient[],
  userId: string,
) {
  await Promise.all(
    recipients.map(async (recipient) => {
      if (recipient.sendStatus === 'SENT' || recipient.role === 'CC') {
        return;
      }

      await triggerNotificationJob({
        userId,
        documentId: recipient.documentId,
        recipientId: recipient.id,
      });
    }),
  );
}



// --- array-callback-return shape: async-map-promise-all-early-return-guard (signing notifications) ---
declare function triggerSigningRequestedEmail(opts: { userId: string; recipientId: string; documentId: string; requestMetadata?: unknown }): Promise<void>;
interface SigningRecipient { id: string; sendStatus: string; role: string; userId: string; documentId: string; }

export async function sendSigningRequestEmails(
  recipients: SigningRecipient[],
  userId: string,
  requestMetadata?: unknown,
) {
  await Promise.all(
    recipients.map(async (recipient) => {
      if (recipient.sendStatus === 'SENT' || recipient.role === 'CC') {
        return;
      }

      await triggerSigningRequestedEmail({
        userId,
        documentId: recipient.documentId,
        recipientId: recipient.id,
        requestMetadata,
      });
    }),
  );
}



// --- array-callback-return shape: async-map-promise-allsettled-side-effect (seal jobs) ---
declare function triggerDocumentSealJob(opts: { documentId: string; isResealing: boolean }): Promise<void>;
declare function extractDocumentId(secondaryId: string): string;
interface UnsealedDocument { id: string; secondaryId: string; }
declare const logger: { info(msg: string): void };

export async function sealPendingDocuments(unsealedDocuments: UnsealedDocument[]) {
  logger.info(`Sealing ${unsealedDocuments.length} documents`);

  await Promise.allSettled(
    unsealedDocuments.map(async (doc) => {
      const documentId = extractDocumentId(doc.secondaryId);
      logger.info(`Triggering seal for ${documentId}`);
      await triggerDocumentSealJob({ documentId, isResealing: true });
    }),
  );
}



// --- array-callback-return shape: async-map-promise-all-side-effect (seed field records) ---
declare const db: {
  fieldRecord: {
    create(opts: { data: object }): Promise<{ id: string }>;
  };
};
interface FieldTemplate { type: string; customText: string; positionX: number; positionY: number; }
declare const FIELD_TEMPLATES: FieldTemplate[];

export async function seedEnvelopeFields(
  envelopeId: string,
  recipientId: string,
  envelopeItemId: string,
  insertFields: boolean,
) {
  await Promise.all(
    FIELD_TEMPLATES.map(async (field) => {
      await db.fieldRecord.create({
        data: {
          ...field,
          recipientId,
          envelopeItemId,
          envelopeId,
          customText: insertFields ? field.customText : '',
          inserted: insertFields && Boolean(field.customText),
        },
      });
    }),
  );
}



// Callback registration with void-returning handler parameter and void return type
declare class DrawingSurface { readonly width: number; readonly height: number; }

type DrawChangeHandler = (_surface: DrawingSurface, _reset: boolean) => void;

export class StrokeRecorder {
  private changeListeners: DrawChangeHandler[] = [];

  public registerChangeHandler(handler: (_surface: DrawingSurface, _reset: boolean) => void): void {
    this.changeListeners.push(handler);
  }

  public unregisterChangeHandler(handler: (_surface: DrawingSurface, _reset: boolean) => void): void {
    this.changeListeners = this.changeListeners.filter((l) => l !== handler);
  }

  public notifyChange(surface: DrawingSurface, wasReset: boolean): void {
    this.changeListeners.forEach((handler) => handler(surface, wasReset));
  }
}



// Promise<void> as a callback parameter type — valid TypeScript for async flush functions
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function useRef<T>(val: T): { current: T };

export function useFlushRegistry() {
  const flushCallbacksRef = useRef<Map<string, () => Promise<void>>>(new Map());

  const registerFlush = useCallback((key: string, flush: () => Promise<void>) => {
    flushCallbacksRef.current.set(key, flush);
    return () => {
      flushCallbacksRef.current.delete(key);
    };
  }, []);

  const flushAll = async (): Promise<void> => {
    const callbacks = Array.from(flushCallbacksRef.current.values());
    await Promise.all(callbacks.map((fn) => fn()));
  };

  return { registerFlush, flushAll };
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



// FP shape: void <callExpr> in dropzone onDrop callback prop (fire-and-forget, not void 0)
declare function processDroppedFiles(files: File[]): Promise<void>;
declare function useFileDropzone(opts: {
  accept: Record<string, string[]>;
  maxFiles: number;
  onDrop: (files: File[]) => void;
  onDropRejected: (fileRejections: unknown[]) => void;
}): { getRootProps: () => object; getInputProps: () => object; isDragActive: boolean };
declare function onFileDropRejected(fileRejections: unknown[]): void;

const { getRootProps: getFileRootProps, getInputProps: getFileInputProps, isDragActive: isFileDragActive } =
  useFileDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    onDrop: (files) => void processDroppedFiles(files),
    onDropRejected: onFileDropRejected,
  });



// FP shape: void stream.writeln() in setInterval callback (fire-and-forget stream write)
declare const KEEPALIVE_INTERVAL_MS: number;
declare const stream: { writeln: (s: string) => Promise<void> };

const keepaliveInterval = setInterval(() => {
  void stream.writeln(JSON.stringify({ type: 'keepalive' }));
}, KEEPALIVE_INTERVAL_MS);



// FP shape: void revalidate().then(...) in a plain function (fire-and-forget revalidation chain)
declare function revalidate(): Promise<void>;
declare function setIsFeatureDialogOpen(v: boolean): void;
declare function setIsSecondaryDialogOpen(v: boolean): void;

const onFeatureEnabled = () => {
  void revalidate().then(() => {
    setIsFeatureDialogOpen(false);
    setIsSecondaryDialogOpen(true);
  });
};



// FP shape: void exec() in useEffect body — fire-and-forget async function invocation
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare const debouncedSearchTerm: string;
declare const open: boolean;

useEffect(() => {
  const exec = async () => {
    if (debouncedSearchTerm) {
      // perform async search
    }
  };

  void exec();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [debouncedSearchTerm, open]);



// FP shape: void refetch() in useMutation onSuccess callback (fire-and-forget query refetch)
declare function useMutation(opts: {
  onSuccess: () => void;
  onError: () => void;
}): { mutateAsync: (args: unknown) => Promise<void>; isPending: boolean };
declare function toast(opts: { title: string; variant: string }): void;

const { mutateAsync: triggerJob, isPending: isTriggering } = useMutation({
  onSuccess: () => {
    toast({ title: 'Job triggered', variant: 'default' });
    void refetch();
  },
  onError: () => {
    toast({ title: 'Failed to trigger job', variant: 'destructive' });
  },
});

declare function refetch(): Promise<unknown>;



// FP shape: void promise.finally(() => ...) in a useCallback (fire-and-forget promise chain)
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;

const pendingMutations = new Set<Promise<unknown>>();

const registerPendingMutation = useCallback((promise: Promise<unknown>) => {
  pendingMutations.add(promise);

  void promise.finally(() => {
    pendingMutations.delete(promise);
  });
}, []);



// FP shape: void file.arrayBuffer().then(...) in onDropAccepted callback (fire-and-forget async chain)
declare function useDropzone(opts: {
  maxSize: number;
  accept: Record<string, string[]>;
  multiple: boolean;
  onDropAccepted: (files: File[]) => void;
  onDropRejected: (rejections: unknown[]) => void;
}): { getRootProps: () => object; getInputProps: () => object };
declare function encodeBuffer(buf: Uint8Array): string;
declare const form: {
  setValue: (key: string, value: string) => void;
  handleSubmit: (fn: (data: unknown) => Promise<void>) => () => Promise<void>;
};
declare function onFormSubmit(data: unknown): Promise<void>;

const { getRootProps, getInputProps } = useDropzone({
  maxSize: 1024 * 1024,
  accept: { 'image/*': ['.png', '.jpg', '.jpeg'] },
  multiple: false,
  onDropAccepted: ([file]) => {
    void file.arrayBuffer().then((buffer) => {
      const contents = encodeBuffer(new Uint8Array(buffer));
      form.setValue('bytes', contents);
      void form.handleSubmit(onFormSubmit)();
    });
  },
  onDropRejected: ([_file]) => {},
});



// FP shape: void refreshLimits() after await in async upload handler (fire-and-forget refresh)
declare function refreshLimits(): Promise<void>;
declare function createDocument(formData: FormData): Promise<{ envelopeId: string }>;
declare function navigate(path: string): Promise<void>;
declare const team: { url: string };

const handleDocumentUpload = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);

  const { envelopeId: id } = await createDocument(formData);

  void refreshLimits();

  await navigate(`/documents/${team.url}/${id}/edit`);
};



// FP shape: void handleAutoSave() standalone call after form.setValue (fire-and-forget)
declare function handleAutoSave(): Promise<void>;
declare const form: { setValue: (key: string, value: unknown) => void };

const applyFieldSettings = (fieldState: unknown) => {
  form.setValue('fields', fieldState);
  void handleAutoSave();
};



// FP shape: void handleStepChange(n) / void handleComplete() in stepper logic (fire-and-forget)
declare function handleStepChange(step: number): Promise<void>;
declare function handleComplete(): Promise<void>;
declare let currentStep: number;
declare const totalSteps: number;

const nextStep = () => {
  if (currentStep < totalSteps) {
    void handleStepChange(currentStep + 1);
  } else {
    void handleComplete();
  }
};

const previousStep = () => {
  if (currentStep > 1) {
    void handleStepChange(currentStep - 1);
  }
};



// FP shape: void flush() in window beforeunload event handler (fire-and-forget flush on unload)
declare function useEffect(fn: () => (() => void), deps?: unknown[]): void;
declare let timeoutRef: { current: ReturnType<typeof setTimeout> | null };
declare let pendingPromiseRef: { current: Promise<unknown> | null };
declare function flush(): Promise<void>;

useEffect(() => {
  const handleBeforeUnload = () => {
    if (timeoutRef.current || pendingPromiseRef.current) {
      void flush();
    }
  };

  window.addEventListener('beforeunload', handleBeforeUnload);

  return () => window.removeEventListener('beforeunload', handleBeforeUnload);
}, [flush]);



// FP shape: void onCompleteClick() inside useThrottleFn callback (fire-and-forget throttled action)
declare function useThrottleFn<T extends () => void>(fn: T, ms: number): [() => void, boolean];
declare function onCompleteClick(): Promise<void>;

const [throttledOnCompleteClick, isThrottled] = useThrottleFn(() => void onCompleteClick(), 500);



// FP shape: void handleAutoSave() after multiple form.setValue calls (fire-and-forget autosave)
declare function handleAutoSave(): Promise<void>;
declare const form: {
  setValue: (key: string, value: unknown, opts?: object) => void;
};

const resetSigningOrder = () => {
  form.setValue('signingOrder', null, { shouldValidate: true, shouldDirty: true });
  form.setValue('allowDictateNextSigner', false, { shouldValidate: true, shouldDirty: true });

  void handleAutoSave();
};



// FP shape: void handleStepChange(n) in conditional branch (fire-and-forget step navigation)
declare function handleStepChange(step: number): Promise<void>;
declare function handleComplete(): Promise<void>;
declare const currentStep: number;
declare const totalSteps: number;

function advanceStep() {
  if (currentStep < totalSteps) {
    void handleStepChange(currentStep + 1);
  } else {
    void handleComplete();
  }
}



// FP shape: void form.handleSubmit(fn)() in conditional handler (fire-and-forget form submit)
declare const form: {
  handleSubmit: (fn: (data: unknown) => void) => () => Promise<void>;
};
declare function onConfirm(data?: unknown): void;
declare const allowDictateNextSigner: boolean;

const handleAssistantConfirm = () => {
  if (allowDictateNextSigner) {
    void form.handleSubmit(onConfirm)();
    return;
  }

  onConfirm();
};



// FP shape: void refreshLimits() in window focus event handler (fire-and-forget on tab refocus)
declare function useEffect(fn: () => (() => void), deps?: unknown[]): void;
declare function refreshLimits(): Promise<void>;
declare const disableLimitsFetch: boolean;

useEffect(() => {
  if (disableLimitsFetch) {
    return () => {};
  }

  const onFocus = () => {
    void refreshLimits();
  };

  window.addEventListener('focus', onFocus);

  return () => {
    window.removeEventListener('focus', onFocus);
  };
}, [refreshLimits]);



// FP shape: void handleStepChange(n-1) in previousStep function (fire-and-forget step nav)
declare function handleStepChange(step: number): Promise<void>;
declare const currentStep: number;

function retreatStep() {
  if (currentStep > 1) {
    void handleStepChange(currentStep - 1);
  }
}



// FP shape: void launchEmbed(token) in useEffect with guard ref (fire-and-forget async launch)
declare function useEffect(fn: () => void, deps?: unknown[]): void;
declare const searchParams: { get: (key: string) => string | null };
declare const hasAutoLaunched: { current: boolean };
declare function launchEmbed(token: string): Promise<void>;

useEffect(() => {
  if (hasAutoLaunched.current) {
    return;
  }

  const initialToken = searchParams.get('token');

  if (initialToken) {
    hasAutoLaunched.current = true;
    void launchEmbed(initialToken);
  }
}, []);



// FP shape: void saveFormData(data, cb) inside setTimeout callback (fire-and-forget scheduled save)
declare function saveFormData(data: unknown, onResponse?: (r: unknown) => void): Promise<void>;
declare const delay: number;
declare const saveTimeoutRef: { current: ReturnType<typeof setTimeout> | null };

const scheduleSave = (data: unknown, onResponse?: (r: unknown) => void) => {
  if (saveTimeoutRef.current) {
    clearTimeout(saveTimeoutRef.current);
  }

  saveTimeoutRef.current = setTimeout(() => void saveFormData(data, onResponse), delay);
};



// FP shape: void revalidator.revalidate() in a plain function (fire-and-forget route revalidation)
declare const revalidator: { revalidate: () => Promise<void> };
declare function setSelectedDocument(doc: unknown): void;

const onBackToDocumentList = () => {
  setSelectedDocument(null);
  void revalidator.revalidate();
};



// FP shape: void SomeClient.start() at top level in module startup (fire-and-forget service init)
declare const TelemetryClient: { start: () => Promise<void> };
declare const LicenseClient: { start: () => Promise<void> };
declare function getNodeEnv(): string;

if (getNodeEnv() !== 'development') {
  void TelemetryClient.start();
}

void LicenseClient.start();



// FP shape: void animate(x, 0, opts) inside setTimeout callback (fire-and-forget animation)
declare function animate(target: unknown, to: number, opts: { duration: number; ease: string }): Promise<void>;
declare const cardX: unknown;
declare const cardY: unknown;
declare const sheenOpacity: unknown;
declare function setTrackMouse(v: boolean): void;
declare const timeoutRef: { current: ReturnType<typeof setTimeout> | undefined };

const onMouseMove = () => {
  clearTimeout(timeoutRef.current);

  timeoutRef.current = window.setTimeout(() => {
    void animate(cardX, 0, { duration: 2, ease: 'backInOut' });
    void animate(cardY, 0, { duration: 2, ease: 'backInOut' });
    void animate(sheenOpacity, 0, { duration: 2, ease: 'backInOut' });

    setTrackMouse(false);
  }, 1000);
};



// FP shape: void this.processCronTick().finally(tick) inside setTimeout (fire-and-forget cron poll)
declare const CRON_POLL_INTERVAL_MS: number;
declare const CRON_POLL_JITTER_MS: number;

class LocalJobsClient {
  private _cronPoller: ReturnType<typeof setTimeout> | undefined;

  async processCronTick(): Promise<void> {
    // process jobs
  }

  startCron() {
    const tick = () => {
      const jitter = Math.floor(Math.random() * CRON_POLL_JITTER_MS);

      this._cronPoller = setTimeout(() => {
        void this.processCronTick().finally(tick);
      }, CRON_POLL_INTERVAL_MS + jitter);
    };

    tick();
  }
}



// FP shape: void signField(id, data).finally(() => cleanup()) (fire-and-forget sign action)
declare function signField(id: string, data: { type: string; value: unknown }): Promise<void>;
declare function createLoadingGroup(): { add: (g: unknown) => void; destroy: () => void };
declare const loadingSpinnerGroup: { destroy: () => void };
declare const dateField: { id: string; inserted: boolean };

const handleDateFieldClick = () => {
  void signField(dateField.id, {
    type: 'DATE',
    value: !dateField.inserted,
  }).finally(() => {
    loadingSpinnerGroup.destroy();
  });
};



// FP shape: void executeActionAuthProcedure(...) in useEffect (fire-and-forget auth procedure)
declare function useEffect(fn: () => void, deps?: unknown[]): void;
declare function executeActionAuthProcedure(opts: {
  onReauthFormSubmit: (authOptions: unknown) => Promise<void>;
  actionTarget: string;
}): Promise<void>;
declare function onSign(authOptions: unknown): Promise<void>;
declare const shouldAutoSignField: boolean;
declare const field: { type: string };

useEffect(() => {
  if (shouldAutoSignField) {
    void executeActionAuthProcedure({
      onReauthFormSubmit: async (authOptions) => await onSign(authOptions),
      actionTarget: field.type,
    });
  }
}, [shouldAutoSignField]);



// FP shape: void onFormSubmit() in else branch (fire-and-forget form submission after validation)
declare function onFormSubmit(): Promise<void>;
declare function validateFieldsUninserted(): boolean;
declare function setValidateUninsertedFields(v: boolean): void;
declare const form: { trigger: () => Promise<boolean> };

const handleSubmitWithValidation = async () => {
  setValidateUninsertedFields(true);
  const isFieldsValid = validateFieldsUninserted();

  if (!isFieldsValid) {
    return;
  } else {
    void onFormSubmit();
  }
};



// FP shape: void launchEmbed() in form submit handler (fire-and-forget async embed launch)
declare function launchEmbed(opts?: { token?: string }): Promise<void>;

const handleEmbedFormSubmit = (e: Event) => {
  e.preventDefault();
  void launchEmbed();
};



// FP shape: void setView(value) in plain function (fire-and-forget async view setter)
declare function setView(view: string | null): Promise<void>;

const handleViewChange = (newView: string) => {
  if (newView !== 'team' && newView !== 'organisation') {
    return;
  }

  void setView(newView === 'team' ? null : newView);
};



// FP shape: void createOrGetShareLink(args) in onOpenChange conditional (fire-and-forget mutation)
declare function createOrGetShareLink(args: { token: string; documentId: number }): Promise<void>;
declare function setIsOpen(v: boolean): void;
declare const shareToken: string;
declare const documentId: number;

const onOpenChange = (nextOpen: boolean) => {
  if (nextOpen) {
    void createOrGetShareLink({
      token: shareToken,
      documentId,
    });
  }

  setIsOpen(nextOpen);
};



// FP shape: void stream.writeln(json) in setInterval inside streaming handler (fire-and-forget)
declare const STREAM_KEEPALIVE_INTERVAL_MS: number;
declare const streamWriter: { writeln: (s: string) => Promise<void> };

let keepaliveTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  void streamWriter.writeln(JSON.stringify({ type: 'keepalive', ts: Date.now() }));
}, STREAM_KEEPALIVE_INTERVAL_MS);



// FP shape: void refreshLimits() after await createEnvelope in upload handler (fire-and-forget)
declare function createEnvelope(formData: FormData): Promise<{ id: string }>;
declare function refreshLimits(): Promise<void>;
declare function toast(opts: { title: string; description: string; duration: number }): void;

const handleEnvelopeUpload = async (files: File[]) => {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }

  const { id } = await createEnvelope(formData);

  void refreshLimits();

  toast({
    title: 'Document uploaded',
    description: 'Your document has been uploaded successfully.',
    duration: 5000,
  });
};



// FP shape: void navigate(path) in useEffect conditional (fire-and-forget navigation)
declare function useEffect(fn: () => void, deps?: unknown[]): void;
declare function navigate(path: string): Promise<void>;
declare const isPersonalLayoutMode: boolean;
declare const team: unknown;

useEffect(() => {
  if (!isPersonalLayoutMode || !team) {
    void navigate('/settings/profile');
  }
}, []);



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



// Trivial find() inside a map() callback — single-expression predicate,
// no branching, body depth <= 1. Standard audit-log data mapping pattern.
type FieldRecord = { id: string; recipientId: string; type: string };
type ValidatedField = { recipientId: string; recipientEmail: string };

declare function createAuditEntry(opts: { fieldId: string; recipientEmail: string; fieldType: string }): object;
declare const createdFields: FieldRecord[];
declare const validatedFields: ValidatedField[];

const auditEntries = createdFields.map((createdField) => {
  const recipient = validatedFields.find((f) => f.recipientId === createdField.recipientId);
  return createAuditEntry({
    fieldId: createdField.id,
    recipientEmail: recipient?.recipientEmail ?? '',
    fieldType: createdField.type,
  });
});



// Nested map() callbacks where both return flat object literals —
// standard response-mapping pattern, no branching, depth <= 2.
type TemplateField = { id: string; type: string; pageNumber: number };
type Template = { id: string; title: string; fields: TemplateField[] };

declare function mapTemplateId(secondaryId: string): string;
declare const templates: Template[];

const responseBody = {
  templates: templates.map((template) => ({
    id: mapTemplateId(template.id),
    title: template.title,
    fields: template.fields.map((field) => ({
      id: field.id,
      type: field.type,
      pageNumber: field.pageNumber,
      templateId: mapTemplateId(template.id),
    })),
  })),
};



// Flat single-expression value-extraction callback inside a validation helper call
declare const ZCheckboxMeta: { parse: (raw: unknown) => { values?: Array<{ value: string }> } };
declare function validateCheckboxValues(values: string[], meta: { values?: Array<{ value: string }> }): string[];

function validateCheckboxFieldMeta(rawMeta: unknown): void {
  const parsedMeta = ZCheckboxMeta.parse(rawMeta);
  const errors = validateCheckboxValues(
    parsedMeta?.values?.map((item) => item.value) ?? [],
    parsedMeta,
  );
  if (errors.length > 0) {
    throw new Error(errors.join(', '));
  }
}



// filter() with inner some() — single-expression predicates for field filtering
interface FieldRecord { id: string; recipientId: string; }
interface RecipientRecord { id: string; }

function filterFieldsByRecipients(
  fields: FieldRecord[],
  recipients: RecipientRecord[],
): FieldRecord[] {
  return fields.filter((field) => recipients.some((recipient) => recipient.id === field.recipientId));
}



// ts-pattern .with() arm returning a plain object — flat pattern-match branch, not callback nesting
declare function match<T>(value: T): any;

function parseFieldTypeMeta(type: string, fieldMeta: unknown) {
  return match(type)
    .with('SIGNATURE', 'INITIALS', 'DATE', 'EMAIL', 'NAME', () => ({ success: true, data: undefined }))
    .exhaustive();
}



// values.forEach() with a simple if-push body inside a .with() pattern-match arm
declare function match<T>(value: T): any;
interface CheckboxValue { checked: boolean; }

function resolveCheckedIndices(fieldType: string, fieldMeta: { values?: CheckboxValue[], validationLength?: number }) {
  return match(fieldType)
    .with('CHECKBOX', ({ fieldMeta: meta }: any) => {
      let checkedValues: number[] = [];
      const values = (meta as typeof fieldMeta)?.values ?? [];
      values.forEach((value: CheckboxValue, index: number) => {
        if (value.checked) {
          checkedValues.push(index);
        }
      });
      return checkedValues;
    })
    .exhaustive();
}



// .find() with single-expression predicate inside a validation block — trivial option-chain find
declare const ZRadioMeta: { parse: (raw: unknown) => { values?: Array<{ checked: boolean; value: string }> } };
declare function validateRadioValue(val: string | undefined, meta: any): string[];

function validateRadioFieldMeta(rawMeta: unknown): void {
  const radioFieldParsedMeta = ZRadioMeta.parse(rawMeta);
  const checkedValue = radioFieldParsedMeta.values?.find((option) => option.checked)?.value;
  const errors = validateRadioValue(checkedValue, radioFieldParsedMeta);
  if (errors.length > 0) {
    throw new Error(errors.join('. '));
  }
}



// Kysely query builder DSL — recipientExists() with single reb() predicate inside .where() chain
declare function qb(): any;
declare function recipientExists(eb: any, email: string, predicate: (reb: any) => any): any;
declare const sql: { lit: (v: any) => any };

function buildRejectedDocumentsQuery(userId: string, userEmail: string) {
  return qb()
    .where((eb: any) =>
      eb.and([
        eb('Document.userId', '=', userId),
        eb.or([
          eb('Document.userId', '=', userId),
          recipientExists(eb, userEmail, (reb: any) =>
            reb('Recipient.signingStatus', '=', sql.lit('REJECTED')),
          ),
        ]),
      ]),
    );
}



// find() inside prev.map() inside error-state updater — single-expression find predicate, standard error-state pattern
declare function setLocalItems(updater: (prev: Array<{ id: string; isError?: boolean; isUploading?: boolean }>) => any[]): void;

function markItemsAsError(newErrorItems: Array<{ id: string }>): void {
  setLocalItems((prev) =>
    prev.map((item) =>
      item.id === newErrorItems.find((e) => e.id === item.id)?.id
        ? { ...item, isError: true, isUploading: false }
        : item,
    ),
  );
}



// Single .with('RADIO', () => ...) arm inside match(type) — flat pattern-match branch
declare function match<T>(value: T): any;
declare const ZRadioFieldSchema: { safeParse: (v: unknown) => any };

function parseFieldMetaByType(type: string, fieldMeta: unknown) {
  return match(type)
    .with('RADIO', () => ZRadioFieldSchema.safeParse(fieldMeta))
    .exhaustive();
}



// fields.map() inside Object.values().forEach() with internal match logic — map inside forEach, complexity is match() branching
declare function match<T>(value: T): any;
interface TemplateField { id: string; type: string; page: number; positionX: number; positionY: number; }
interface PrefillField { id: string; value: string; }

function buildFieldsToCreate(
  recipientMap: Record<string, { fields: TemplateField[] }>,
  prefillFields: PrefillField[],
  envelopeId: string,
): any[] {
  const fieldsToCreate: any[] = [];
  Object.values(recipientMap).forEach((recipient) => {
    fieldsToCreate.push(
      ...recipient.fields.map((field) => {
        const prefillField = prefillFields?.find((pf) => pf.id === field.id);
        return match(field.type)
          .with('TEXT', () => ({ envelopeId, type: field.type, page: field.page, value: prefillField?.value }))
          .otherwise(() => ({ envelopeId, type: field.type, page: field.page }));
      }),
    );
  });
  return fieldsToCreate;
}



// prefillFields?.find() with single-expression predicate inside fields.map() — trivial optional-chain find
interface SourceField { id: string; page: number; type: string; }
interface PrefillEntry { id: string; defaultValue: string; }

function buildFieldPayloads(
  fields: SourceField[],
  prefillFields: PrefillEntry[] | undefined,
  envelopeId: string,
): Array<{ envelopeId: string; type: string; page: number; defaultValue?: string }> {
  return fields.map((field) => {
    const prefill = prefillFields?.find((pf) => pf.id === field.id);
    return { envelopeId, type: field.type, page: field.page, defaultValue: prefill?.defaultValue };
  });
}



// recipient.fields.map() inside recipients.map() inside onSuccess callback — standard immutable state update
interface SignedField { id: string; recipientId: string; value: string; }
interface RecipientWithFields { id: string; fields: SignedField[]; }
interface EnvelopeState { recipients: RecipientWithFields[]; }
declare function setPrevState(updater: (prev: { envelope: EnvelopeState }) => any): void;

function applySignedField(signedField: SignedField): void {
  setPrevState((prev) => ({
    ...prev,
    envelope: {
      ...prev.envelope,
      recipients: prev.envelope.recipients.map((recipient) =>
        recipient.id === signedField.recipientId
          ? {
              ...recipient,
              fields: recipient.fields.map((field) =>
                field.id === signedField.id ? signedField : field,
              ),
            }
          : recipient,
      ),
    },
  }));
}



// membersToCreate.map() returning flat object inside createMany({data:...}) — single-level flat data-prep transform
interface MemberEntry { userId: string; groupId: string; role: string; }
declare function createMany(args: { data: Array<{ userId: string; groupId: string; role: string }> }): Promise<void>;

async function bulkAddGroupMembers(membersToCreate: MemberEntry[], groupId: string): Promise<void> {
  await createMany({
    data: membersToCreate.map((m) => ({
      userId: m.userId,
      groupId,
      role: m.role,
    })),
  });
}



// .with(FieldType.SIGNATURE, FieldType.FREE_SIGNATURE, (type) => ({...})) ts-pattern arm in an audit-log match — flat pattern branch
declare function match<T>(value: T): any;
const FieldType = { SIGNATURE: 'SIGNATURE', FREE_SIGNATURE: 'FREE_SIGNATURE' } as const;

function buildAuditLogEntry(fieldType: string) {
  return match(fieldType)
    .with(FieldType.SIGNATURE, FieldType.FREE_SIGNATURE, (type: string) => ({
      type,
      data: null,
      category: 'signature',
    }))
    .otherwise((type: string) => ({ type, data: undefined, category: 'other' }));
}



// groups.flatMap((group) => group.teamGroups) inside getHighestTeamRole() — single-expression flatMap callback for role aggregation
interface TeamGroup { groupId: string; role: string; teamId: string; }
interface GroupMembership { id: string; teamGroups: TeamGroup[]; }

function getAllTeamGroupsForMember(groups: GroupMembership[]): TeamGroup[] {
  return groups.flatMap((group) => group.teamGroups);
}



// createDriver: () => driver is a one-liner config property in dialect object — not a callback nesting issue
declare const pgDriver: any;
declare class PgIntrospector { constructor(db: any): any; }
declare class PgQueryCompiler { constructor(): any; }
declare class PgAdapter { constructor(): any; }

const dialectConfig = {
  createDriver: () => pgDriver,
  createIntrospector: (db: any) => new PgIntrospector(db),
  createQueryCompiler: () => new PgQueryCompiler(),
  createAdapter: () => new PgAdapter(),
};



// recipientExists() with reb.and([]) inside team-filter .with() arm — Kysely DSL required structure
declare function queryBuilder(): any;
declare function recipientExistsInTeam(eb: any, email: string, predicate: (reb: any) => any): any;
declare function teamDeletedFilter(eb: any): any;

function buildTeamDocumentsQuery(teamId: string, userEmail: string) {
  return queryBuilder()
    .where((eb: any) =>
      eb.and([
        teamDeletedFilter(eb),
        eb.or([
          eb('Document.teamId', '=', teamId),
          recipientExistsInTeam(eb, userEmail, (reb: any) =>
            reb.and([
              reb('Recipient.teamId', '=', teamId),
              reb('Recipient.status', '=', 'ACTIVE'),
            ]),
          ),
        ]),
      ]),
    );
}



// .with(MemberRole.MANAGER, () => managerGroup.organisationGroupId) ts-pattern arm returning an identifier — trivial flat branch
declare function match<T>(value: T): any;
const MemberRole = { MANAGER: 'MANAGER', ADMIN: 'ADMIN', MEMBER: 'MEMBER' } as const;
declare const managerOrgGroup: { organisationGroupId: string };

function resolveGroupIdForRole(role: string): string {
  return match(role)
    .with(MemberRole.MANAGER, () => managerOrgGroup.organisationGroupId)
    .otherwise(() => '')
    .exhaustive();
}



// envelope.fields.map((field) => mapFieldToLegacyField(field, envelope)) inside result-mapping object — single-expression delegate callback
interface EnvelopeData { id: string; fields: Array<{ id: string; type: string }>; }
declare function mapFieldToLegacyFormat(field: { id: string; type: string }, envelope: EnvelopeData): any;
declare function mapRecipientToLegacyFormat(recipient: { id: string }, envelope: EnvelopeData): any;

function buildLegacyEnvelopeResponse(envelope: EnvelopeData & { recipients: Array<{ id: string }> }) {
  return {
    id: envelope.id,
    fields: envelope.fields.map((field) => mapFieldToLegacyFormat(field, envelope)),
    recipients: envelope.recipients.map((recipient) => mapRecipientToLegacyFormat(recipient, envelope)),
  };
}



// autoInsertedFields.map() returning flat object for audit log data — single-level flat transformation inside a transaction
interface AutoField { id: string; type: string; page: number; }
declare function createAuditLogData(args: { action: string; fieldData: Array<{ fieldId: string; fieldType: string; page: number }> }): any;

function buildAutoFieldAuditLog(autoInsertedFields: AutoField[]) {
  return createAuditLogData({
    action: 'AUTO_INSERT_FIELDS',
    fieldData: autoInsertedFields.map((field) => ({
      fieldId: field.id,
      fieldType: field.type,
      page: field.page,
    })),
  });
}



// prev.fields.filter() with recipients.some() inside — two single-expression predicate callbacks for immutable state update
interface FieldItem { id: string; recipientId: string; }
interface Recipient { id: string; }
declare function setEditorState(updater: (prev: { fields: FieldItem[] }) => { fields: FieldItem[] }): void;
declare function resetFieldForm(fields: FieldItem[]): void;

function pruneOrphanedFields(activeRecipients: Recipient[]): void {
  setEditorState((prev) => ({
    ...prev,
    fields: prev.fields.filter((field) =>
      activeRecipients.some((recipient) => recipient.id === field.recipientId),
    ),
  }));
}



// Kysely query builder DSL — destructured ({or: innerOr, eb: innerEb}) callback inside .where() inside .where() — API-mandated nesting
declare function buildQuery(): any;
declare function personalFilter(eb: any): any;

function buildPersonalDocumentsQuery(userId: string, userEmail: string) {
  return buildQuery()
    .where((eb: any) =>
      eb.and([
        personalFilter(eb),
        eb.or([
          eb('Document.userId', '=', userId),
          eb.exists(
            eb
              .selectFrom('Recipient')
              .where(({ or: innerOr, eb: innerEb }: any) =>
                innerOr([
                  innerEb('Recipient.email', '=', userEmail),
                  innerEb('Recipient.userId', '=', userId),
                ]),
              ),
          ),
        ]),
      ]),
    );
}



// envelope.recipients.map((recipient) => mapRecipientToLegacyRecipient(recipient, envelope)) — single-expression delegate callback
interface EnvelopeDocument { id: string; recipients: Array<{ id: string; email: string }>; }
declare function mapRecipientToLegacyRecipient(recipient: { id: string; email: string }, envelope: EnvelopeDocument): any;

function buildLegacyRecipientsResponse(envelope: EnvelopeDocument) {
  return {
    envelopeId: envelope.id,
    recipients: envelope.recipients.map((recipient) => mapRecipientToLegacyRecipient(recipient, envelope)),
  };
}



// flatMap(({group}) => group.teamGroups.filter()) inside a data.map() — both callbacks single-expression, standard group-role resolution
interface TeamGroupAssignment { teamId: string; role: string; }
interface GroupEntry { group: { teamGroups: TeamGroupAssignment[] }; }
interface MemberData { id: string; groupMemberships: GroupEntry[]; }

function resolveTeamGroupsForMembers(
  members: MemberData[],
  targetTeamId: string,
): Array<{ memberId: string; teamGroups: TeamGroupAssignment[] }> {
  return members.map((member) => ({
    memberId: member.id,
    teamGroups: member.groupMemberships.flatMap(({ group }) =>
      group.teamGroups.filter((tg) => tg.teamId === targetTeamId),
    ),
  }));
}



// Single .with('NUMBER', () => ...) arm inside match(type) — flat pattern-match branch
declare function match<T>(value: T): any;
declare const ZNumberFieldSchema: { safeParse: (v: unknown) => any };

function parseNumberFieldMeta(type: string, fieldMeta: unknown) {
  return match(type)
    .with('NUMBER', () => ZNumberFieldSchema.safeParse(fieldMeta))
    .exhaustive();
}



// .with({type:'date'}, (selector) => {...}) ts-pattern arm with date validation — pattern-match branch with simple sequential logic
declare function match<T>(value: T): any;
declare function parseDate(value: string): Date | null;
declare function isValidDateFormat(date: Date, format: string): boolean;

function validatePrefillSelector(selector: { type: string; value?: string; format?: string }) {
  return match(selector)
    .with({ type: 'date' }, (s) => {
      const parsedDate = parseDate(s.value ?? '');
      const valid = parsedDate !== null && isValidDateFormat(parsedDate, s.format ?? 'MM/DD/YYYY');
      return { valid, error: valid ? undefined : 'Invalid date format' };
    })
    .otherwise(() => ({ valid: true, error: undefined }));
}



// recipient.fields.map() inside allRecipients.map(async) for field creation — inner map creates field objects, standard data-prep pattern
interface FieldSpec { type: string; page: number; positionX: number; positionY: number; }
interface RecipientSpec { id: string; fields: FieldSpec[]; }
declare function createFields(data: Array<{ recipientId: string; type: string; page: number; positionX: number; positionY: number }>): Promise<void>;

async function createAllRecipientFields(allRecipients: RecipientSpec[], envelopeId: string): Promise<void> {
  await Promise.all(
    allRecipients.map(async (recipient) => {
      await createFields(
        recipient.fields.map((field) => ({
          recipientId: recipient.id,
          type: field.type,
          page: field.page,
          positionX: field.positionX,
          positionY: field.positionY,
        })),
      );
    }),
  );
}



// recipientExists() helper wrapping reb.and([]) inside .where() chain — Kysely query builder DSL requires this structure
declare function db(): any;
declare function recipientExistsWhere(eb: any, email: string, predicate: (reb: any) => any): any;
declare function notDeletedFilter(eb: any): any;

function buildUserDocumentsQuery(userId: string, userEmail: string) {
  return db()
    .where((eb: any) =>
      eb.and([
        notDeletedFilter(eb),
        eb.or([
          eb('Document.ownerId', '=', userId),
          recipientExistsWhere(eb, userEmail, (reb: any) =>
            reb.and([
              reb('Recipient.documentId', '=', eb.ref('Document.id')),
              reb('Recipient.email', '=', userEmail),
            ]),
          ),
        ]),
      ]),
    );
}



// fields.map() returning a flat object literal for ETag computation — single-level flat transformation inside a hash argument
interface DocumentField { id: string; type: string; page: number; positionX: number; positionY: number; }
declare function computeHash(data: Array<{ id: string; type: string; page: number }>): string;

function computeFieldsETag(fields: DocumentField[]): string {
  return computeHash(
    fields.map((field) => ({
      id: field.id,
      type: field.type,
      page: field.page,
    })),
  );
}



// DATE_FORMATS.map((format) => format.value) inside a schema config object — single-expression property accessor callback, zero nesting complexity
const DATE_FORMATS = [
  { label: 'MM/DD/YYYY', value: 'MM/DD/YYYY' },
  { label: 'DD/MM/YYYY', value: 'DD/MM/YYYY' },
  { label: 'YYYY-MM-DD', value: 'YYYY-MM-DD' },
] as const;

declare function z(): { enum: (values: string[]) => any };

const dateFormatSchema = {
  type: 'string',
  enum: DATE_FORMATS.map((format) => format.value),
  description: 'Accepted date format strings',
};



// Single .with('CHECKBOX', () => ...) arm inside match(type) — flat pattern-match branch
declare function match<T>(value: T): any;
declare const ZCheckboxFieldSchema: { safeParse: (v: unknown) => any };

function parseCheckboxFieldMeta(type: string, fieldMeta: unknown) {
  return match(type)
    .with('CHECKBOX', () => ZCheckboxFieldSchema.safeParse(fieldMeta))
    .exhaustive();
}



// fields.map()/recipients.map() with flat object-literal bodies inside a mutation handler — single level nesting, no branching inside callbacks
interface FieldInput { id: string; type: string; page: number; recipientId: string; }
interface RecipientInput { id: string; email: string; role: string; }
declare function updateEnvelope(args: { fields: any[]; recipients: any[] }): Promise<void>;

async function updateEnvelopeFieldsAndRecipients(
  fields: FieldInput[],
  recipients: RecipientInput[],
  envelopeId: string,
): Promise<void> {
  await updateEnvelope({
    fields: fields.map((field) => ({
      id: field.id,
      type: field.type,
      page: field.page,
      recipientId: field.recipientId,
      envelopeId,
    })),
    recipients: recipients.map((recipient) => ({
      id: recipient.id,
      email: recipient.email,
      role: recipient.role,
      envelopeId,
    })),
  });
}



// Single .with('DROPDOWN', () => ...) arm inside match(type) — flat pattern-match branch
declare function match<T>(value: T): any;
declare const ZDropdownFieldSchema: { safeParse: (v: unknown) => any };

function parseDropdownFieldMeta(type: string, fieldMeta: unknown) {
  return match(type)
    .with('DROPDOWN', () => ZDropdownFieldSchema.safeParse(fieldMeta))
    .exhaustive();
}



// fields.map() inside async .with() arm is a flat property-rename adapter — 3 levels max, no meaningful logic inside inner callback
declare function match<T>(value: T): any;
interface EmbeddingField { id: string; fieldType: string; pageNumber: number; xPos: number; yPos: number; }
declare function updateEmbeddingEnvelope(args: { fields: any[] }): Promise<void>;

async function applyEmbeddingFieldUpdate(envelopeType: string, fields: EmbeddingField[]) {
  return match(envelopeType)
    .with('STANDARD', async () => {
      await updateEmbeddingEnvelope({
        fields: fields.map((field) => ({
          id: field.id,
          type: field.fieldType,
          page: field.pageNumber,
          x: field.xPos,
          y: field.yPos,
        })),
      });
    })
    .otherwise(async () => { /* no-op */ });
}



// templateRecipient.fields.map() returning flat field-creation object inside Object.values().forEach() — flat data prep in field-copy pattern
interface TemplateRecipient { id: string; fields: Array<{ type: string; page: number; positionX: number; positionY: number }>; }
declare function createField(data: { recipientId: string; type: string; page: number; positionX: number; positionY: number }[]): Promise<void>;

async function copyTemplateFieldsToRecipients(
  templateRecipientMap: Record<string, TemplateRecipient>,
): Promise<void> {
  const allFieldsToCreate: any[] = [];
  Object.values(templateRecipientMap).forEach((templateRecipient) => {
    allFieldsToCreate.push(
      ...templateRecipient.fields.map((field) => ({
        recipientId: templateRecipient.id,
        type: field.type,
        page: field.page,
        positionX: field.positionX,
        positionY: field.positionY,
      })),
    );
  });
  await createField(allFieldsToCreate);
}



// data.recipients.map() with availableRecipients.find() inside — both callbacks simple expressions inside a helper call argument
interface RecipientRef { email: string; }
interface AvailableRecipient { id: string; email: string; name: string; }
declare function resolveRecipients(resolved: Array<AvailableRecipient | undefined>): AvailableRecipient[];

function matchRequestedRecipients(
  requestedRecipients: RecipientRef[],
  availableRecipients: AvailableRecipient[],
): AvailableRecipient[] {
  return resolveRecipients(
    requestedRecipients.map((ref) =>
      availableRecipients.find((ar) => ar.email === ref.email),
    ),
  );
}



// Array.from() with index-returning callback inside a .with() arm — inner callback (_, index) => index is trivial
declare function match<T>(value: T): any;
interface SelectionOption { label: string; checked: boolean; }

function buildDefaultSelectedIndices(fieldType: string, options: SelectionOption[], defaultCount: number) {
  return match(fieldType)
    .with('MULTI_SELECT', ({ options: opts }: any) => {
      const selectedCount = defaultCount || 1;
      return Array.from({ length: selectedCount }, (_, index) => index);
    })
    .otherwise(() => [])
    .exhaustive();
}



// fetch().then() inside a ClipboardItem value object inside navigator.clipboard.write() — required by Clipboard API design
declare function getResourceUrl(id: string): string;
declare const navigator: { clipboard: { write: (items: any[]) => Promise<void> } };
declare class ClipboardItem { constructor(data: Record<string, Promise<Blob>>): any; }

async function copyResourceToClipboard(resourceId: string): Promise<void> {
  await navigator.clipboard.write([
    new ClipboardItem({
      'image/png': fetch(getResourceUrl(resourceId)).then(async (response) => {
        const blob = await response.blob();
        return blob;
      }),
    }),
  ]);
}



// .otherwise((selector) => { payload.fieldMeta = ...; }) is a single-statement ts-pattern catch-all arm — not callback nesting
declare function match<T>(value: T): any;
declare function getUpdatedFieldMeta(selector: any, existingMeta: any): any;

function applyPrefillToField(
  selector: { type: string; value?: string },
  existingMeta: unknown,
): { fieldMeta: any } {
  const payload: { fieldMeta: any } = { fieldMeta: undefined };
  match(selector)
    .with({ type: 'date' }, (s) => {
      payload.fieldMeta = { format: s.value };
    })
    .otherwise((s) => {
      payload.fieldMeta = getUpdatedFieldMeta(s, existingMeta);
    });
  return payload;
}



// recipientExists() with single reb() predicate inside team REJECTED filter — Kysely DSL, API-required
declare function queryBuilder2(): any;
declare function recipientExistsForTeam(eb: any, email: string, predicate: (reb: any) => any): any;
declare function teamArchivedFilter(eb: any): any;

function buildTeamRejectedDocsQuery(teamId: string, userEmail: string) {
  return queryBuilder2()
    .where((eb: any) =>
      eb.and([
        teamArchivedFilter(eb),
        eb.or([
          eb('Document.teamId', '=', teamId),
          recipientExistsForTeam(eb, userEmail, (reb: any) =>
            reb('Recipient.signingStatus', '=', 'REJECTED'),
          ),
        ]),
      ]),
    );
}



// createIntrospector: (db) => new PostgresIntrospector(db) is a one-liner config property in Kysely dialect object — not callback nesting
declare const postgresDriver: any;
declare class PostgresIntrospector { constructor(db: any): any; }
declare class PostgresQueryCompiler { constructor(): any; }
declare class PostgresAdapter { constructor(): any; }

const postgresDialectConfig = {
  createDriver: () => postgresDriver,
  createIntrospector: (db: any) => new PostgresIntrospector(db),
  createQueryCompiler: () => new PostgresQueryCompiler(),
  createAdapter: () => new PostgresAdapter(),
};



// signatureFields.map(async (field) => signFieldWithToken({...})) inside Promise.all() inside envelopes.map() — inner map delegates to service call
interface SignatureField { id: string; token: string; }
interface EnvelopeBatch { id: string; signatureFields: SignatureField[]; }
declare function signFieldWithToken(args: { fieldId: string; token: string; envelopeId: string }): Promise<void>;

async function applyMultiEnvelopeSignatures(envelopes: EnvelopeBatch[]): Promise<void> {
  await Promise.all(
    envelopes.map(async (envelope) => {
      await Promise.all(
        envelope.signatureFields.map(async (field) =>
          signFieldWithToken({
            fieldId: field.id,
            token: field.token,
            envelopeId: envelope.id,
          }),
        ),
      );
    }),
  );
}



// fields.map() returning flat field object inside setFieldsForTemplate() argument — single-level flat transformation
interface TemplateFieldInput { id: string; type: string; page: number; required: boolean; }
declare function setFieldsForTemplate(templateId: string, fields: Array<{ fieldId: string; fieldType: string; fieldPage: number; required: boolean }>): Promise<void>;

async function updateTemplateFields(templateId: string, fields: TemplateFieldInput[]): Promise<void> {
  await setFieldsForTemplate(
    templateId,
    fields.map((field) => ({
      fieldId: field.id,
      fieldType: field.type,
      fieldPage: field.page,
      required: field.required,
    })),
  );
}



// fields.map() inside recipients.map(async) for batch field creation — inner map returns flat field-data objects for createMany
interface EmbeddingField { type: string; page: number; x: number; y: number; }
interface EmbeddingRecipient { id: string; fields: EmbeddingField[]; }
declare function createManyFields(data: Array<{ recipientId: string; type: string; page: number; x: number; y: number }>): Promise<void>;

async function createEmbeddingTemplateFields(recipients: EmbeddingRecipient[]): Promise<void> {
  await Promise.all(
    recipients.map(async (recipient) => {
      await createManyFields(
        recipient.fields.map((field) => ({
          recipientId: recipient.id,
          type: field.type,
          page: field.page,
          x: field.x,
          y: field.y,
        })),
      );
    }),
  );
}



// recipientExists() with reb.and([]) inside team PENDING filter — Kysely DSL required structure
declare function getQueryBuilder(): any;
declare function recipientExistsCheck(eb: any, email: string, predicate: (reb: any) => any): any;
declare function pendingFilter(eb: any): any;

function buildTeamPendingDocsQuery(teamId: string, userEmail: string) {
  return getQueryBuilder()
    .where((eb: any) =>
      eb.and([
        pendingFilter(eb),
        eb.or([
          eb('Document.teamId', '=', teamId),
          recipientExistsCheck(eb, userEmail, (reb: any) =>
            reb.and([
              reb('Recipient.teamId', '=', teamId),
              reb('Recipient.signingStatus', '=', 'PENDING'),
            ]),
          ),
        ]),
      ]),
    );
}



// recipients.findIndex() single-expression predicate inside cn() className arg inside JSX map — style lookup pattern
interface RecipientEntry { id: string; name: string; color: string; }
declare function cn(...args: any[]): string;
declare const RECIPIENT_COLORS: string[];

function buildRecipientClassNames(
  recipients: RecipientEntry[],
  selectedRecipientId: string,
): string[] {
  return recipients.map((recipient) => {
    const colorIndex = recipients.findIndex((r) => r.id === recipient.id);
    return cn(
      'recipient-pill',
      RECIPIENT_COLORS[colorIndex % RECIPIENT_COLORS.length],
      recipient.id === selectedRecipientId && 'recipient-pill--selected',
    );
  });
}



// values.findIndex() with single-expression predicate inside a .with() pattern-match arm — 3 levels max, no logic inside findIndex callback
declare function match<T>(value: T): any;
interface SelectOption { id: string; label: string; checked: boolean; }

function findDefaultCheckedIndex(fieldType: string, values: SelectOption[], defaultId: string) {
  return match(fieldType)
    .with('RADIO', () => {
      const idx = values.findIndex((opt) => opt.id === defaultId);
      return idx >= 0 ? idx : 0;
    })
    .otherwise(() => -1)
    .exhaustive();
}



// .with(MemberRole.ADMIN, () => adminGroup.organisationGroupId) ts-pattern arm returning an identifier — trivial flat branch
declare function match<T>(value: T): any;
const TeamMemberRole = { ADMIN: 'ADMIN', MANAGER: 'MANAGER', MEMBER: 'MEMBER' } as const;
declare const teamAdminGroup: { organisationGroupId: string };

function resolveAdminGroupId(role: string): string | undefined {
  return match(role)
    .with(TeamMemberRole.ADMIN, () => teamAdminGroup.organisationGroupId)
    .otherwise(() => undefined);
}



// membersToDelete.map((m) => m.organisationMemberId) inside a where.in clause — single-expression property-access callback
interface OrgMemberToRemove { organisationMemberId: string; userId: string; }
declare function deleteOrgGroupMembers(args: { where: { organisationMemberId: { in: string[] } } }): Promise<void>;

async function removeOrgGroupMembers(membersToDelete: OrgMemberToRemove[]): Promise<void> {
  await deleteOrgGroupMembers({
    where: {
      organisationMemberId: {
        in: membersToDelete.map((m) => m.organisationMemberId),
      },
    },
  });
}



// Single .with('TEXT', () => ...) arm inside match(type) — flat pattern-match branch
declare function match<T>(value: T): any;
declare const ZTextFieldSchema: { safeParse: (v: unknown) => any };

function parseTextFieldMeta(type: string, fieldMeta: unknown) {
  return match(type)
    .with('TEXT', () => ZTextFieldSchema.safeParse(fieldMeta))
    .exhaustive();
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



// flat-array-transform-callbacks: find inside map inside onSuccess handler
declare const trpc: { attachment: { item: { updateMany: { useMutation: (opts: any) => any } } } };
declare function setLocalAttachments(opts: { attachmentItems: any[] }): void;
declare const attachmentContext: { attachmentItems: any[] };

const { mutateAsync: updateAttachmentItems } = trpc.attachment.item.updateMany.useMutation({
  onSuccess: ({ data }: { data: Array<{ id: string; [key: string]: any }> }) => {
    setLocalAttachments({
      attachmentItems: attachmentContext.attachmentItems.map((originalItem) => {
        const updatedItem = data.find((item) => item.id === originalItem.id);
        if (updatedItem) {
          return { ...originalItem, ...updatedItem };
        }
        return originalItem;
      }),
    });
  },
});



// flat-array-transform-callbacks: spread recipients.map() inside array literal inside function argument
declare function assignDocumentRecipients(opts: { id: { type: string; id: number }; userId: string; recipients: any[] }): Promise<{ recipients: any[] }>;
declare const currentParticipants: Array<{ email: string; name: string; role: string; signingOrder?: number; authOptions?: any }>;
declare const newParticipant: { email: string; name: string; role: string; signingOrder?: number; authOptions?: any };
declare const docId: number;
declare const currentUserId: string;

async function addParticipant() {
  const { recipients: updatedParticipants } = await assignDocumentRecipients({
    id: { type: 'documentId', id: docId },
    userId: currentUserId,
    recipients: [
      ...currentParticipants.map((participant) => ({
        email: participant.email,
        name: participant.name,
        role: participant.role,
        signingOrder: participant.signingOrder,
        actionAuth: participant.authOptions?.actionAuth ?? [],
      })),
      {
        email: newParticipant.email,
        name: newParticipant.name,
        role: newParticipant.role,
        signingOrder: newParticipant.signingOrder,
        actionAuth: newParticipant.authOptions?.actionAuth ?? [],
      },
    ],
  });
  return updatedParticipants;
}



// flat-array-transform-callbacks: availableContacts.find() with single-expression email predicate inside data.participants.map()
declare const availableContacts: Array<{ email: string; id: string; name: string }>;
declare const requestData: { participants: Array<{ email: string; role: string }> };
declare class AppError { constructor(code: string, opts?: any) {} }
declare const ErrorCode: { NOT_FOUND: string };

function mapParticipantsToContacts() {
  return requestData.participants.map((p) => {
    const found = availableContacts.find((c) => c.email === p.email);
    if (!found) {
      throw new AppError(ErrorCode.NOT_FOUND, { message: `Contact not found: ${p.email}` });
    }
    return found;
  });
}



// ts-pattern-match-arms: .with() arm returning plain object — not genuine callback nesting
declare function match<T>(val: T): any;
declare const WidgetType: { NUMBER: string; TEXT: string; DATE: string; RADIO: string };
declare const updatedWidget: { customText: string };

function buildWidgetAuditEntry(widgetType: string) {
  return match(widgetType)
    .with(WidgetType.NUMBER, WidgetType.RADIO, (type: string) => ({
      type,
      data: updatedWidget.customText,
    }))
    .with(WidgetType.DATE, WidgetType.TEXT, (type: string) => ({
      type,
      data: updatedWidget.customText,
    }))
    .exhaustive();
}



// flat-array-transform-callbacks: .map().filter() chain inside form.handleSubmit() callback; inner callbacks are single-expression lambdas
declare const form: { handleSubmit: (fn: (data: any) => void) => (e: any) => void; formState: { isSubmitting: boolean; errors: any } };
declare function submitSelections(selected: number[]): void;

function ChoiceSubmitForm({ optionValues }: { optionValues: Array<{ checked: boolean }> }) {
  const handleFormSubmit = form.handleSubmit((data: { values: Array<{ checked: boolean }> }) =>
    submitSelections(
      data.values.map((value, i) => (value.checked ? i : null)).filter((value) => value !== null) as number[],
    ),
  );
  return handleFormSubmit;
}



// ts-pattern-match-arms: .otherwise() catch-all arm returning plain object
declare function match<T>(val: T): any;
declare const SlotType: { SIGNATURE: string; FREE_SIGNATURE: string; DATE: string };
declare const currentSlot: { customText: string };

function buildSlotAuditPayload(slotType: string) {
  return match(slotType)
    .with(SlotType.SIGNATURE, SlotType.FREE_SIGNATURE, (type: string) => ({
      type,
      data: '',
    }))
    .with(SlotType.DATE, (type: string) => ({
      type,
      data: currentSlot.customText,
    }))
    .otherwise((selector: string) => ({
      type: selector,
      data: currentSlot.customText,
    }));
}



// ts-pattern-match-arms: .with('TRIAL_PLAN', () => ({success:false,...})) arm returns plain error object
declare function match<T>(val: T): any;
declare const ZRadioMetaSchema: { safeParse: (v: any) => any };
declare const fieldMeta: any;

function resolveFieldMetaSchema(type: string) {
  const result = match(type)
    .with('RADIO', () => ZRadioMetaSchema.safeParse(fieldMeta))
    .with('DROPDOWN', () => ({ success: true, data: undefined }))
    .with('FREE_SIGNATURE', () => ({
      success: false,
      error: 'FREE_SIGNATURE is not supported',
      data: undefined,
    }))
    .exhaustive();
  return result;
}



// ts-pattern-match-arms: .with(Role.MEMBER, () => groupId) arm returning an identifier; trivial flat branch
declare function match<T>(val: T): any;
declare const MemberRole: { VIEWER: string; EDITOR: string; ADMIN: string };
declare const viewerGroup: { organisationGroupId: string };
declare const editorGroup: { organisationGroupId: string };
declare const adminGroup: { organisationGroupId: string };
declare const newRole: string;

function resolveGroupForRole() {
  return match(newRole)
    .with(MemberRole.VIEWER, () => viewerGroup.organisationGroupId)
    .with(MemberRole.EDITOR, () => editorGroup.organisationGroupId)
    .with(MemberRole.ADMIN, () => adminGroup.organisationGroupId)
    .exhaustive();
}



// ts-pattern-match-arms: .with(FieldType.DATE,...) arm returning plain object
declare function match<T>(val: T): any;
declare const SlotKind: { TIMESTAMP: string; INITIALS: string; LABEL: string; TEXTBOX: string };
declare const currentSlot: { customText: string };

function buildSlotDataPayload(slotKind: string) {
  return match(slotKind)
    .with(SlotKind.TIMESTAMP, SlotKind.INITIALS, (type: string) => ({
      type,
      data: currentSlot.customText,
    }))
    .with(SlotKind.LABEL, SlotKind.TEXTBOX, (type: string) => ({
      type,
      data: currentSlot.customText,
    }))
    .exhaustive();
}



// flat-array-transform-callbacks: recipient.slots.map() inside participants.map() — two-level nested map for field normalization; both callbacks return plain object literals with no logic
declare const participants: Array<{ id: string; email: string; slots: Array<{ id: string; pageNumber: number; pageX: number; pageY: number; width: number; height: number }> }>;
declare const documentDataId: string;

function normalizeParticipantSlots() {
  return (participants || []).map((participant) => ({
    ...participant,
    slots: (participant.slots || []).map((slot) => ({
      ...slot,
      page: slot.pageNumber,
      positionX: slot.pageX,
      positionY: slot.pageY,
      documentDataId,
    })),
  }));
}



// object-literal-config-arrow-properties: arrow functions as config object properties — not callback nesting
declare class SqliteAdapter {}
declare class SqliteDriver { constructor(opts: any) {} }
declare class SqliteIntrospector { constructor(db: any) {} }
declare class SqliteQueryCompiler {}
declare class Database<T> { constructor(opts: any) {} }
declare function getConnectionString(): string;

function createDbDialect(rawDriver: any) {
  return new Database<any>({
    dialect: {
      createAdapter: () => new SqliteAdapter(),
      createDriver: () => rawDriver,
      createIntrospector: (db: any) => new SqliteIntrospector(db),
      createQueryCompiler: () => new SqliteQueryCompiler(),
    },
  });
}



// flat-array-transform-callbacks: memberGroups.flatMap((group) => group.projectGroups.filter()) for role lookup; single-expression flatMap+filter callbacks
declare function getHighestProjectRoleInGroup(groups: any[]): string;
declare const projectMembers: Array<{ id: string; userId: string; projectGroupMembers: Array<{ group: { projectGroups: Array<{ projectId: string }> } }> }>;
declare const projectId: string;

function resolveProjectRoles() {
  return projectMembers.map((member) => {
    const memberGroups = member.projectGroupMembers.map((pg) => pg.group);
    return {
      id: member.id,
      userId: member.userId,
      projectRole: getHighestProjectRoleInGroup(
        memberGroups.flatMap((group) => group.projectGroups.filter((pg) => pg.projectId === projectId)),
      ),
    };
  });
}



// flat-array-transform-callbacks: bundle.assets.find() with single-expression predicate inside recipient.slots.map(); single-line find inside a map, no logic inside find callback
declare const bundle: { assets: Array<{ documentDataId: string; id: string }> };
declare const assignees: Array<{ slots: Array<{ documentDataId?: string; type: string }> }>;
declare class AppError { constructor(code: string, opts?: any) {} }
declare const AppErrorCode: { NOT_FOUND: string };

function mapAssigneeSlotsToAssets() {
  return assignees.map(async (assignee) => {
    const slotsToCreate = (assignee.slots || []).map((slot) => {
      let assetId = bundle.assets[0]?.id;
      if (slot.documentDataId) {
        const foundAsset = bundle.assets.find(
          (asset) => asset.documentDataId === slot.documentDataId,
        );
        if (!foundAsset) {
          throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Asset not found' });
        }
        assetId = foundAsset.id;
      }
      return { assetId, type: slot.type };
    });
    return slotsToCreate;
  });
}



// ts-pattern-match-arms: participants.map() returning flat object inside .with(PackageType.DOCUMENT, async () => setPackageParticipants({participants: ...}))
declare function match<T>(val: T): any;
declare const PackageType: { DOCUMENT: string; TEMPLATE: string };
declare function setPackageParticipants(opts: { participants: any[] }): Promise<{ participants: any[] }>;
declare function setTemplateParticipants(opts: { participants: any[] }): Promise<{ participants: any[] }>;
declare const participantsWithToken: Array<{ id?: string; email: string; name: string; role: string; signingOrder?: number }>;
declare const packageType: string;

async function syncParticipants() {
  const { participants: updated } = await match(packageType)
    .with(PackageType.DOCUMENT, async () =>
      setPackageParticipants({
        participants: participantsWithToken.map((p) => ({
          id: p.id,
          email: p.email,
          name: p.name ?? '',
          role: p.role,
          signingOrder: p.signingOrder,
        })),
      }),
    )
    .with(PackageType.TEMPLATE, async () =>
      setTemplateParticipants({
        participants: participantsWithToken.map((p) => ({
          id: p.id,
          email: p.email,
          name: p.name ?? '',
          role: p.role,
        })),
      }),
    )
    .exhaustive();
  return updated;
}



// flat-array-transform-callbacks: opList.find((op) => ...) with single-expression predicate inside headers() callback; 3 levels deep but inner find callback is a simple boolean expression
declare function httpBatchLink(opts: any): any;
declare function getBaseUrl(): string;
declare const dataTransformer: any;

const batchLink = httpBatchLink({
  url: `${getBaseUrl()}/api/trpc`,
  transformer: dataTransformer,
  headers: (opts: { opList: Array<{ context: { workspaceId?: string } }> }) => {
    const opWithWorkspace = opts.opList.find(
      (op) => op.context.workspaceId && typeof op.context.workspaceId === 'string',
    );
    if (opWithWorkspace && typeof opWithWorkspace.context.workspaceId === 'string') {
      return { 'x-workspace-id': opWithWorkspace.context.workspaceId };
    }
    return {};
  },
});



// api-mandated-async-protocol-nesting: Zod .refine() callback with a two-branch boolean return; schema-validation glue, not callback nesting
declare const z: { string: () => any; object: (shape: any) => any; array: (schema: any) => any; nativeEnum: (e: any) => any; number: () => any };
declare function isPlaceholderEmail(email: string): boolean;
declare function zEmail(): { safeParse: (v: string) => { success: boolean } };
declare const ParticipantRole: { SIGNER: string; VIEWER: string; APPROVER: string };

const ZAddParticipantSchema = z.object({
  participants: z.array(
    z.object({
      id: z.number(),
      email: z
        .string()
        .refine(
          (email) => {
            return isPlaceholderEmail(email) || zEmail().safeParse(email).success;
          },
          { message: 'Please enter a valid email address' },
        ),
      name: z.string(),
      role: z.nativeEnum(ParticipantRole),
    }),
  ),
});



// object-literal-config-arrow-properties: createQueryCompiler one-liner config property in dialect object
declare class MysqlAdapter {}
declare class MysqlDriver { constructor(opts: any) {} }
declare class MysqlIntrospector { constructor(db: any) {} }
declare class MysqlQueryCompiler {}
declare class KyselyDb<T> { constructor(opts: any) {} }

function buildKyselyDialect(driver: any) {
  return new KyselyDb<any>({
    dialect: {
      createAdapter: () => new MysqlAdapter(),
      createDriver: () => driver,
      createIntrospector: (db: any) => new MysqlIntrospector(db),
      createQueryCompiler: () => new MysqlQueryCompiler(),
    },
  });
}



// flat-array-transform-callbacks: memberIds.map() returning flat object inside createMany({data: ...}); single-level flat data-prep transform
declare const tx: { workspaceGroupMember: { createMany: (opts: { data: any[] }) => Promise<any> } };
declare const memberIds: string[];
declare const groupId: string;
declare function generateId(prefix: string): string;

async function addMembersToGroup() {
  await tx.workspaceGroupMember.createMany({
    data: memberIds.map((memberId) => ({
      id: generateId('group_member'),
      workspaceMemberId: memberId,
      groupId,
    })),
  });
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



// Copy-link feedback: reset the active state after a short UI delay
let _copyResetHandle: ReturnType<typeof setTimeout> | null = null;

function triggerCopyFeedback(setActive: (v: boolean) => void): void {
  setActive(true);

  if (_copyResetHandle !== null) {
    clearTimeout(_copyResetHandle);
  }

  _copyResetHandle = setTimeout(() => {
    setActive(false);
    _copyResetHandle = null;
  }, 2000);
}



// Debounced autosave — numeric delay literal triggers magic-number rule
declare function debounce<T extends (...args: unknown[]) => unknown>(fn: T, delay: number): T & { flush: () => void };

interface DraftPayload {
  title: string;
  body: string;
  lastModified: number;
}

declare function persistDraft(payload: DraftPayload): Promise<void>;
declare function notifySaveStatus(success: boolean): void;
declare function logError(err: unknown): void;

export function createDraftAutosaver() {
  const saveDraft = debounce(async (payload: DraftPayload) => {
    try {
      await persistDraft(payload);
      notifySaveStatus(true);
    } catch (err) {
      logError(err);
      notifySaveStatus(false);
    }
  }, 2000);

  const flushDraft = () => saveDraft.flush();

  return { saveDraft, flushDraft };
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



declare const executeAuthProcedure: () => Promise<void>;

function handleSigningDropdownChange(value: string) {
  if (value === 'authenticate') {
    void executeAuthProcedure();
  }
}



declare const handleSync: () => Promise<void>;

function onSyncClick() {
  void handleSync();
}



declare const processFiles: (files: File[]) => Promise<void>;

const dropzoneOptions = {
  onDrop: (files: File[]) => void processFiles(files),
};



declare const autoSaveFields: (fields: unknown[]) => Promise<void>;

function buildFieldChangeHandler(fields: unknown[]) {
  return function onFieldChange(_fieldId: string) {
    void autoSaveFields(fields);
  };
}



declare const autoSaveSigners: (signers: unknown[]) => Promise<void>;

function buildSignerChangeHandler(signers: unknown[]) {
  return function onSignerChange(_signerId: string) {
    void autoSaveSigners(signers);
  };
}



declare const revalidate: () => Promise<void>;
declare const setIsUpdating: (v: boolean) => void;

function onFieldPositionChange() {
  void revalidate().then(() => setIsUpdating(false));
}

function onLayoutComplete() {
  void revalidate().then(() => setIsUpdating(false));
}



declare const autoSaveTemplateFields: (fields: unknown[]) => Promise<void>;

function buildTemplateFieldChangeHandler(fields: unknown[]) {
  return function onFieldUpdate(_fieldId: string, _value: unknown) {
    void autoSaveTemplateFields(fields);
  };
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



// FP: void used to intentionally discard a chained Promise (tRPC/cache-invalidation pattern)
declare const queryClient: { invalidateQueries: (key: string) => Promise<void> };

export function invalidateCacheOnChange(key: string): void {
  void queryClient.invalidateQueries(key).then(() => {
    // cache invalidated
  });
}



// FP: void in event handler callback to fire-and-forget async autosave
declare function autoSaveDraft(): Promise<void>;

export function createFieldChangeHandler() {
  return {
    onChange: () => { void autoSaveDraft(); },
    onBlur: () => { void autoSaveDraft(); },
  };
}



// FP: non-null assertion inside .map() chained after .filter() that tests the same property — safe by filter predicate
interface FormField {
  name: string;
  signedValue: string | null;
  required: boolean;
}

export function getSignedValues(fields: FormField[]): string[] {
  return fields
    .filter((field) => field.signedValue && field.required)
    .map((field) => field.signedValue!);
}



// require-await FP: .with() async callback delegates to upload fn; async for match callback type conformance
declare function uploadToStorage(fileKey: string, buffer: Buffer): Promise<{ url: string }>;
declare const match: { with: (pattern: unknown, fn: (...args: unknown[]) => Promise<unknown>) => unknown };

function processUpload(fileType: string, fileKey: string, buffer: Buffer) {
  return match.with('s3', async () => uploadToStorage(fileKey, buffer));
}



// require-await FP: .with() async callback delegates to processFields returning Promise; async for match callback conformance
declare function applyFieldUpdates(docId: string, fields: string[]): Promise<void>;
declare const patternMatch: { with: (p: unknown, fn: (...a: unknown[]) => Promise<unknown>) => unknown };

function handleEnvelopeUpdate(docId: string, fields: string[]) {
  return patternMatch.with('update', async () => applyFieldUpdates(docId, fields));
}



// require-await FP: $transaction async callback uses Promise.all with inner async map; outer async satisfies transaction callback type
declare const orm: { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> };
declare function createLineItem(tx: unknown, item: { sku: string }): Promise<{ id: string }>;

function batchCreateLineItems(items: { sku: string }[]) {
  return orm.$transaction(async (tx) =>
    Promise.all(items.map(async (item) => createLineItem(tx, item)))
  );
}



// require-await FP: async map callback delegates to db.update() returning Promise; async for map callback type conformance
declare const repository: { lineItem: { update: (args: { where: { id: string }; data: object }) => Promise<{ id: string }> } };

function updateLineItems(items: Array<{ id: string; quantity: number }>) {
  return Promise.all(
    items.map(async (item) =>
      repository.lineItem.update({ where: { id: item.id }, data: { quantity: item.quantity } })
    )
  );
}



// require-await FP: async map callback in Promise.all delegates to orphanRecords(); async for map callback type conformance
declare function archiveOrphanRecords(orgId: string): Promise<void>;

function cleanupOrganizations(orgIds: string[]) {
  return Promise.all(orgIds.map(async (orgId) => archiveOrphanRecords(orgId)));
}



// require-await FP: async arrow in .map() inside Promise.all delegates to seedDocument; async to conform to map callback type
declare function seedDraftDocument(index: number): Promise<{ id: string }>;

async function seedMultipleDraftDocuments(count: number) {
  const indices = Array.from({ length: count }, (_, i) => i);
  return Promise.all(indices.map(async (i) => seedDraftDocument(i)));
}



// require-await FP: async map callback delegates to signField returning Promise; async for map callback type conformance in Promise.all
declare function signFieldWithToken(fieldId: string, token: string): Promise<{ fieldId: string; signed: boolean }>;

function signAllFields(fieldIds: string[], token: string) {
  return Promise.all(fieldIds.map(async (fieldId) => signFieldWithToken(fieldId, token)));
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



// --- require-await shape: interface-conformance-and-map-callbacks (abstract stub throws not-implemented) ---
abstract class BaseJobClient {
  abstract triggerJob(name: string, payload: unknown): Promise<string>;
  async arrayBuffer(): Promise<ArrayBuffer> {
    throw new Error('Not implemented');
  }
}



// --- require-await shape: promise-chain-redundant-async (async fn with .then() chain) ---
declare function sealPdfDocument(id: string): Promise<{ url: string }>;
declare function notifyRecipients(url: string): Promise<void>;

async function processDocumentSealing(documentId: string, notify: boolean) {
  return notify
    ? sealPdfDocument(documentId).then((result) => notifyRecipients(result.url))
    : sealPdfDocument(documentId).then(() => Promise.resolve());
}



// --- require-await shape: delegate-return-no-await (async fn returns call directly without await) ---
declare function updateDocumentMetadata(id: string, data: Record<string, unknown>): Promise<{ id: string }>;

async function saveDocumentEdits(documentId: string, edits: Record<string, unknown>) {
  return updateDocumentMetadata(documentId, edits);
}



// --- require-await shape: promise-chain-redundant-async (.then async callback calling arrayBuffer on response) ---
declare function loadPdfFromUrl(url: string): Promise<Response>;

async function getPdfArrayBuffer(url: string): Promise<ArrayBuffer> {
  return loadPdfFromUrl(url).then(async (res) => res.arrayBuffer());
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



declare const NOTIFIABLE_USER_TYPES: readonly string[];
declare const SUPPRESSED_USER_TYPES: readonly string[];

interface NotificationCandidate {
  id: string;
  type: string;
  email: string | null;
  optedOut: boolean;
  bouncedAt: Date | null;
  unverifiedEmail: boolean;
}

export function selectNotifiableUsers(
  candidates: readonly NotificationCandidate[],
  hasContactPreference: boolean,
): NotificationCandidate[] {
  return candidates.filter((candidate) => {
    if (candidate.optedOut) {
      return false;
    }

    if (!NOTIFIABLE_USER_TYPES.includes(candidate.type)) {
      return false;
    }

    if (SUPPRESSED_USER_TYPES.includes(candidate.type) && !hasContactPreference) {
      return false;
    }

    if (candidate.bouncedAt !== null) {
      return false;
    }

    if (candidate.email === null || candidate.unverifiedEmail) {
      return false;
    }

    return true;
  });
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



// --- unknown-catch-variable shape: catch(err) only console.error(err) + fixed toast ---
declare function saveTemplateFields(templateId: string, fields: readonly { id: string; type: string }[]): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;
declare function navigateTo(path: string): Promise<void>;

async function submitTemplateFields(
  templateId: string,
  fields: readonly { id: string; type: string }[],
  redirectPath: string,
) {
  try {
    await saveTemplateFields(templateId, fields);

    showToast({ title: 'Template saved', description: 'Your template has been saved successfully.' });

    await navigateTo(redirectPath);
  } catch (err) {
    console.error(err);

    showToast({
      title: 'Error',
      description: 'An error occurred while saving fields.',
      variant: 'destructive',
    });
  }
}



// --- unknown-catch-variable shape: catch(err) console.error(err) + fixed toast (bulk operation) ---
declare function uploadBulkCsv(opts: { templateId: string; csv: string }): Promise<void>;
declare function showToast2(opts: { title: string; description: string; variant?: string }): void;
declare function resetForm(): void;

async function handleBulkCsvUpload(templateId: string, fileText: string) {
  try {
    await uploadBulkCsv({ templateId, csv: fileText });

    showToast2({
      title: 'Success',
      description: 'Your bulk send has been initiated. You will receive an email upon completion.',
    });

    resetForm();
  } catch (err) {
    console.error(err);

    showToast2({
      title: 'Error',
      description: 'Failed to upload CSV. Please check the file format and try again.',
      variant: 'destructive',
    });
  }
}



// --- unknown-catch-variable shape: catch(err) narrowed via parseError(); accesses on typed result ---
declare const AppError: { parseError(e: unknown): { code: string; message: string } };
declare function registerUser(opts: { email: string; name: string; password: string }): Promise<void>;
declare function showToast3(opts: { title: string; description: string; variant?: string }): void;
declare const ERROR_MESSAGES: Record<string, string>;

async function handleRegistration(email: string, name: string, password: string) {
  try {
    await registerUser({ email, name, password });

    showToast3({
      title: 'Registration Successful',
      description: 'Please verify your account by clicking the link in your email.',
    });
  } catch (err) {
    const error = AppError.parseError(err);

    const message = ERROR_MESSAGES[error.code] ?? ERROR_MESSAGES['INVALID_REQUEST'];

    showToast3({
      title: 'An error occurred',
      description: message,
      variant: 'destructive',
    });
  }
}



// --- unknown-catch-variable shape: catch(err) parseError() narrowing; error.code drives toast message ---
declare const AppError3: { parseError(e: unknown): { code: string; message: string } };
declare const AppErrorCode3: { NOT_FOUND: string; UNAUTHORIZED: string; INVALID_BODY: string };
declare function moveItemsToFolder(opts: { itemIds: string[]; folderId: string }): Promise<void>;
declare function showToast4(opts: { description: string; variant?: string }): void;
declare function matchCode(code: string, handlers: Record<string, () => string>, fallback: () => string): string;

async function handleBulkMoveItems(itemIds: string[], folderId: string) {
  try {
    await moveItemsToFolder({ itemIds, folderId });

    showToast4({ description: 'Selected items have been moved.' });
  } catch (err) {
    const error = AppError3.parseError(err);

    const message = matchCode(
      error.code,
      {
        [AppErrorCode3.NOT_FOUND]: () => 'The destination folder does not exist.',
        [AppErrorCode3.UNAUTHORIZED]: () => 'You are not allowed to move these items.',
        [AppErrorCode3.INVALID_BODY]: () => 'All items must be of the same type.',
      },
      () => 'An error occurred while moving the items.',
    );

    showToast4({ description: message, variant: 'destructive' });
  }
}



// --- unknown-catch-variable shape: catch(error) console.error('prefix:', error) + fixed toast ---
declare function saveToLocalStorage(key: string, value: string): void;
declare function showToast5(opts: { title: string; description: string; variant?: string }): void;
declare function onSave(state: Record<string, unknown>): void;

function persistFieldSettings(key: string, state: Record<string, unknown>) {
  try {
    saveToLocalStorage(key, JSON.stringify(state));
    onSave(state);
  } catch (error) {
    console.error('Failed to save to localStorage:', error);

    showToast5({
      title: 'Error',
      description: 'Failed to save settings.',
      variant: 'destructive',
    });
  }
}



// --- unknown-catch-variable shape: catch(err) never accessed; shows fixed toast only ---
declare function distributeEnvelope(envelopeId: string): Promise<void>;
declare function showToast11(opts: { title: string; description: string; variant?: string; duration?: number }): void;
declare function navigateTo2(path: string): Promise<void>;

async function handleEnvelopeDistribute(envelopeId: string, redirectPath: string) {
  try {
    await distributeEnvelope(envelopeId);

    await navigateTo2(redirectPath);

    showToast11({
      title: 'Envelope distributed',
      description: 'Your envelope has been distributed successfully.',
      duration: 5000,
    });
  } catch (err) {
    showToast11({
      title: 'Something went wrong',
      description: 'This envelope could not be distributed at this time. Please try again.',
      variant: 'destructive',
      duration: 7500,
    });
  }
}



// --- unknown-catch-variable shape: catch(_err) underscore-prefixed intentional discard; fixed toast only ---
declare function enableTwoFactor(opts: { code: string }): Promise<{ recoveryCodes: string[] }>;
declare function refreshSession2(): Promise<void>;
declare function setRecoveryCodes(codes: string[]): void;
declare function showToast12(opts: { title: string; description: string }): void;

async function handleEnable2FA(token: string) {
  try {
    const data = await enableTwoFactor({ code: token });
    await refreshSession2();

    setRecoveryCodes(data.recoveryCodes);

    showToast12({
      title: 'Two-factor authentication enabled',
      description: 'You will now be required to enter a code from your authenticator app when signing in.',
    });
  } catch (_err) {
    showToast12({
      title: 'Unable to setup two-factor authentication',
      description: 'Please ensure that you have entered your code correctly and try again.',
    });
  }
}



// --- unknown-catch-variable shape: catch(err) instanceof Error check on .name; then parseError for typed access ---
declare function startPasskeyAuthentication(opts: { optionsJSON: unknown }): Promise<{ id: string }>;
declare function createPasskeyOptions(): Promise<{ options: unknown; sessionId: string }>;
declare function signInWithPasskey(opts: { credential: string; csrfToken: string }): Promise<void>;
declare const AppError7: { parseError(e: unknown): { code: string; message: string } };
declare function setIsPasskeyLoading(v: boolean): void;

async function handlePasskeySignIn() {
  try {
    setIsPasskeyLoading(true);

    const { options, sessionId } = await createPasskeyOptions();
    const credential = await startPasskeyAuthentication({ optionsJSON: options });

    await signInWithPasskey({
      credential: JSON.stringify(credential),
      csrfToken: sessionId,
    });
  } catch (err) {
    setIsPasskeyLoading(false);

    if (err instanceof Error && err.name === 'NotAllowedError') {
      return;
    }

    const error = AppError7.parseError(err);
    console.error(error.message);
  }
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



// Short-circuit cond && fn() used as conditional call in event handler — side effect intended
declare class DrawingCanvas {
  isActive: boolean;
  startDrawing(event: MouseEvent): void;
}

export function attachCanvasHandlers(canvas: DrawingCanvas, element: HTMLElement): () => void {
  const onPointerEnter = (event: MouseEvent) => {
    event.buttons === 1 && canvas.startDrawing(event);
  };

  element.addEventListener('mouseenter', onPointerEnter);
  return () => element.removeEventListener('mouseenter', onPointerEnter);
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



/**
 * Async callback wrappers that forward parameters correctly.
 * These should NOT trigger argument-type-mismatch.
 */

interface AuthOptions {
  token?: string;
  mfaCode?: string;
}

interface FormSubmission {
  userId: string;
  data: Record<string, unknown>;
}

declare const performAction: (config: {
  onSubmit: (auth?: AuthOptions) => Promise<void>;
  target: string;
}) => Promise<void>;

declare const submitWithAuth: (submission: FormSubmission, auth?: AuthOptions) => Promise<void>;

export async function processFormWithAuth(submission: FormSubmission): Promise<void> {
  // Async callback wrapper that forwards auth options - correctly typed
  await performAction({
    onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
    target: 'user-form',
  });
}

export async function processFormWithReauth(submission: FormSubmission, requireAuth: boolean): Promise<void> {
  if (requireAuth) {
    // Another variant of the same pattern
    await performAction({
      onSubmit: async (authOptions) => await submitWithAuth(submission, authOptions),
      target: 'secure-form',
    });
  }
}



/**
 * Flattening line items from paid orders into a denormalized list, enriching
 * each item with a snapshot of its parent order. The inner `map` returns an
 * object expression that spreads the original line item and adds a nested
 * `order` property — a standard immutable-update pattern that must NOT trip
 * the argument-type-mismatch detector.
 */

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  inserted: boolean;
}

interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  channel: 'web' | 'pos' | 'phone';
  items: readonly LineItem[];
}

export interface EnrichedLineItem extends LineItem {
  order: {
    customerName: string;
    customerEmail: string;
    paymentStatus: Order['paymentStatus'];
    channel: Order['channel'];
  };
}

export function collectPaidLineItems(orders: readonly Order[]): EnrichedLineItem[] {
  return orders
    .filter(({ paymentStatus }) => paymentStatus === 'PAID')
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentStatus: order.paymentStatus,
          channel: order.channel,
        },
      })),
    )
    .filter((item) => item.inserted);
}



// map-callback-index-bounded: index from .map() callback used to access same-length copy
function updateOptionLabels(options: { label: string; value: string }[], index: number, newLabel: string) {
  const updatedOptions = [...options];
  updatedOptions[index].label = newLabel;
  return updatedOptions;
}

function handleOptionListChange(options: { label: string; value: string }[]) {
  return options.map((option, index) => {
    const updated = updateOptionLabels(options, index, option.label.trim());
    return updated[index];
  });
}



// map-callback-index-bounded: newValues[index] inside map callback where index comes from same array
function handleToggleItem(
  items: { label: string; enabled: boolean }[],
  toggleIndex: number,
  newEnabled: boolean
) {
  const newItems = [...items];
  newItems[toggleIndex].enabled = newEnabled;
  return newItems;
}

function syncItemStates(items: { label: string; enabled: boolean }[]) {
  return items.map((item, index) => {
    const synced = handleToggleItem(items, index, item.enabled);
    return synced[index];
  });
}



// map-callback-index-bounded: index from signers.map used inside handler to access form.getValues() array
declare function useFieldArrayForm<T>(): {
  getValues: (field: string) => T[];
  setValue: (field: string, value: T[], opts?: object) => void;
};

type Participant = { name: string; email: string; order: number; role: string; id: string };

function useParticipantOrdering() {
  const form = useFieldArrayForm<Participant>();

  function handleOrderChange(index: number, newOrderStr: string) {
    const trimmed = newOrderStr.trim();
    if (!trimmed) return;

    const newOrder = Number(trimmed);
    if (!Number.isInteger(newOrder) || newOrder < 1) return;

    const currentParticipants = form.getValues('participants');
    const participant = currentParticipants[index];

    const remaining = currentParticipants.filter((_, idx) => idx !== index);
    const newPos = Math.min(Math.max(0, newOrder - 1), currentParticipants.length - 1);
    remaining.splice(newPos, 0, participant);

    const updated = remaining.map((p, idx) => ({ ...p, order: idx + 1 }));
    form.setValue('participants', updated, { shouldValidate: true });
  }

  return { handleOrderChange };
}
