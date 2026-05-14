
// --- argument-type-mismatch shape: Promise.race with null timeout ---
// Promise.race<T | null>([promise, new Promise<null>(resolve => setTimeout(...))]) — valid race, no mismatch.
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return await Promise.race<T | null>([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
}



// --- argument-type-mismatch shape: Promise.race fetch with timeout ---
// Promise.race([fetch(...).catch(() => null), new Promise(resolve => setTimeout(resolve, N))]) — valid fire-and-forget pattern.
async function fireAndForget(url: string, payload: unknown, timeoutMs: number): Promise<void> {
  await Promise.race([
    fetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => null),
    new Promise((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}



// --- argument-type-mismatch FP: for-of over Object.entries with destructured value ---
declare const groupedOptions: Record<string, string[]>;

function collectAllOptionValues(): string[] {
  const results: string[] = [];
  for (const [, value] of Object.entries(groupedOptions)) {
    results.push(...value);
  }
  return results;
}



// --- argument-type-mismatch FP: Array.find with string equality predicate ---
interface Recipient {
  id: string;
  email: string;
  name: string;
}

function findRecipientByEmail(recipients: Recipient[], email: string): Recipient | undefined {
  return recipients.find((r) => r.email === email);
}



// --- argument-type-mismatch FP: Promise<Uint8Array> chained with Buffer.from ---
declare const pdfDoc: {
  save(opts: { incremental: boolean }): Promise<Uint8Array>;
};

async function savePdfIncremental(): Promise<Buffer> {
  return pdfDoc
    .save({ incremental: true })
    .then((buf) => Buffer.from(buf));
}



// --- argument-type-mismatch FP: Promise.all over typed number array mapped to async operations ---
declare function archiveWorkspace(opts: { workspaceId: number }): Promise<void>;

async function archiveAllWorkspaces(ownedWorkspaceIds: number[]): Promise<void> {
  await Promise.all(
    ownedWorkspaceIds.map(async (workspaceId) => archiveWorkspace({ workspaceId }))
  );
}



// --- argument-type-mismatch FP: new Map from array of [key, value] tuples ---
interface FieldSignature {
  fieldId: string;
  signatureData: string;
  signedAt: Date;
}

function buildSignatureMap(signatures: FieldSignature[]): Map<string, FieldSignature> {
  return new Map(signatures.map((signature) => [signature.fieldId, signature]));
}



// --- argument-type-mismatch FP: Promise.all with async map and conditional check ---
enum DeliveryStatus {
  SENT = 'SENT',
  PENDING = 'PENDING',
  FAILED = 'FAILED',
}

interface Subscriber {
  id: string;
  email: string;
  sendStatus: DeliveryStatus;
}

declare function sendNotificationEmail(subscriber: Subscriber): Promise<void>;

async function notifyPendingSubscribers(subscribers: Subscriber[]): Promise<void> {
  await Promise.all(
    subscribers.map(async (subscriber) => {
      if (subscriber.sendStatus !== DeliveryStatus.SENT) {
        await sendNotificationEmail(subscriber);
      }
    }),
  );
}



// --- argument-type-mismatch FP: Array.find with logical OR multi-email predicate ---
interface TeamMember {
  id: string;
  email: string;
  role: string;
}

function findCurrentUserMember(
  members: TeamMember[],
  userEmail: string,
  teamEmail?: string,
): TeamMember | undefined {
  return members.find(
    (m) => m.email === userEmail || (teamEmail && m.email === teamEmail),
  );
}



// --- argument-type-mismatch FP: trigger.dev io.runTask with async callback ---
declare const io: {
  runTask<T>(key: string, handler: () => Promise<T>): Promise<T>;
};
declare function dispatchBulkEmail(opts: {
  recipientId: string;
  subject: string;
}): Promise<void>;

async function processBulkEmailBatch(
  recipients: Array<{ id: string; subject: string }>,
): Promise<void> {
  for (const [rowIndex, recipient] of recipients.entries()) {
    await io.runTask(`send-email-${rowIndex}`, async () => {
      await dispatchBulkEmail({ recipientId: recipient.id, subject: recipient.subject });
    });
  }
}



// --- argument-type-mismatch FP: Bearer token split/filter string manipulation ---
function extractBearerTokens(authHeader: string): string[] {
  return authHeader
    .split(' ')
    .filter((part) => part.length > 0 && part !== 'Bearer');
}



// --- argument-type-mismatch FP: Array.some with enum comparison predicate ---
enum ReadStatus {
  OPENED = 'OPENED',
  UNREAD = 'UNREAD',
  ARCHIVED = 'ARCHIVED',
}

interface Envelope {
  id: string;
  recipient: {
    id: string;
    readStatus: ReadStatus;
  };
}

function hasUnviewedEnvelopes(envelopes: Envelope[]): boolean {
  return envelopes.some((envelope) => envelope.recipient.readStatus !== ReadStatus.OPENED);
}


// --- argument-type-mismatch FP: Array.map(async ...) with early-return guard, Promise.all ---
// Standard async map with a status guard — no type mismatch.
declare const reportBatch: Array<{ id: string; status: string; ownerId: string }>;
declare function processReport(id: string): Promise<void>;

export async function batchProcessReports(): Promise<void> {
  await Promise.all(
    reportBatch.map(async (report) => {
      if (report.status === 'ARCHIVED') {
        return;
      }
      await processReport(report.id);
    }),
  );
}



// --- argument-type-mismatch FP: Promise.all(items.map(async opts => fn(...))) ---
// Valid async map with spread; no type mismatch.
declare function seedDraftReport(opts: { title: string; context: unknown }): Promise<{ id: string; title: string }>;
declare const seedContext: unknown;

export async function seedMultipleDraftReports(
  reports: Array<{ title: string }>,
): Promise<Array<{ id: string; title: string }>> {
  return await Promise.all(
    reports.map(async (reportOptions) => seedDraftReport({ ...reportOptions, context: seedContext })),
  );
}



// --- argument-type-mismatch FP: async map with createElement for email templates ---
// recipients.map(async (r) => createElement(Template, props)) — standard async map, no type mismatch.
declare function createElement2(component: unknown, props: Record<string, unknown>): Promise<unknown>;
declare const ReportCancelledEmail: unknown;

export async function buildReportCancellationEmails(
  notifyList: Array<{ email: string; name: string }>,
): Promise<unknown[]> {
  return Promise.all(
    notifyList.map(async (recipient) =>
      createElement2(ReportCancelledEmail, {
        recipientName: recipient.name,
        recipientEmail: recipient.email,
      }),
    ),
  );
}



// --- argument-type-mismatch FP: files.map((file) => ({ file })) wrapping to object ---
// Mapping array items to a wrapper object with shorthand property — valid, no type mismatch.
declare const reportAttachments: Array<File>;
declare function uploadReportAttachments(items: Array<{ file: File }>): Promise<void>;

export async function prepareReportAttachments(): Promise<void> {
  await uploadReportAttachments(
    reportAttachments.map((file) => ({ file })),
  );
}



// --- argument-type-mismatch FP: function called with named object containing multiple ids ---
// detectContactsFromReport({ reportId, requesterId, workspaceId }) — valid named-arg call, no mismatch.
declare function detectContactsFromReport(opts: {
  reportId: number;
  requesterId: string;
  workspaceId: string;
  onProgress?: (p: { done: number; total: number }) => void;
}): Promise<string[]>;
declare const reportId: number;
declare const requesterId: string;
declare const workspaceId: string;

export async function runContactDetection(): Promise<string[]> {
  return await detectContactsFromReport({
    reportId,
    requesterId,
    workspaceId,
    onProgress: (progress) => {
      console.log(`${progress.done}/${progress.total}`);
    },
  });
}



// --- argument-type-mismatch FP: Promise.all(eligibleJobs.map(async (job) => {...})) ---
// Standard async map with Promise.all over an array of job definitions; no type mismatch.
declare const eligibleScheduledTasks: Array<{ id: string; name: string; version: string; payload: object }>;
declare function createPendingTask(opts: { taskId: string; name: string; version: string; payload: object }): Promise<{ id: string; status: string }>;
declare function dispatchTask(pendingId: string): Promise<void>;

async function runEligibleScheduledTasks(): Promise<void> {
  await Promise.all(
    eligibleScheduledTasks.map(async (task) => {
      const pendingTask = await createPendingTask({
        taskId: task.id,
        name: task.name,
        version: task.version,
        payload: task.payload,
      });
      await dispatchTask(pendingTask.id);
    }),
  );
}




// --- argument-type-mismatch FP: Array.find with destructured id comparison ---
// find() with destructured { id } parameter; returns item or undefined — valid predicate, no type mismatch.
interface ContactGroup {
  id: string;
  name: string;
  memberCount: number;
}

export function findContactGroupById(
  groups: ContactGroup[],
  targetId: string,
): string {
  const group = groups.find(({ id }) => id === targetId);
  return group?.name ?? 'Unknown Group';
}




// --- argument-type-mismatch FP: Promise.all with destructured async map callback ---
// Promise.all(items.map(async ({ fieldData, signatureData, authData }) => {...})); destructured async map.
declare function persistSignedField(opts: {
  fieldId: string;
  fieldType: string;
  value: string;
  authLevel: string;
}): Promise<{ id: string }>;

interface SignatureFieldInput {
  fieldData: { id: string; type: string };
  signatureData: { value: string } | null;
  authData: { level: string };
}

export async function persistAllSignedFields(
  signatureFields: SignatureFieldInput[],
): Promise<Array<{ id: string }>> {
  return Promise.all(
    signatureFields.map(async ({ fieldData, signatureData, authData }) => {
      if (!signatureData) {
        throw new Error(`Missing signature for field ${fieldData.id}`);
      }
      return persistSignedField({
        fieldId: fieldData.id,
        fieldType: fieldData.type,
        value: signatureData.value,
        authLevel: authData.level,
      });
    }),
  );
}




// --- argument-type-mismatch FP: Array.findIndex with optional chaining ---
// contacts.findIndex((c) => c.id === activeContact?.id); valid findIndex with optional chaining.
interface ContactRecord {
  id: string;
  email: string;
  displayName: string;
}

export function getActiveContactIndex(
  contacts: ContactRecord[],
  activeContact: { id: string } | null,
): number {
  return contacts.findIndex((c) => c.id === activeContact?.id);
}




// --- argument-type-mismatch FP: Promise.all(recipients.map(async (r) => {...})) ---
// Standard async map pattern — no type mismatch.
declare function sendReminderNotification(opts: {
  recipientId: string;
  email: string;
  displayName: string;
  locale: string;
}): Promise<void>;

interface PendingRecipient {
  id: string;
  email: string;
  displayName: string;
  locale: string;
}

export async function notifyPendingRecipients(
  recipients: PendingRecipient[],
): Promise<void> {
  await Promise.all(
    recipients.map(async (recipient) => {
      await sendReminderNotification({
        recipientId: recipient.id,
        email: recipient.email,
        displayName: recipient.displayName,
        locale: recipient.locale,
      });
    }),
  );
}




// --- argument-type-mismatch FP: flatMap with find inside — standard nested lookup pattern ---
interface PricingTier {
  id: string;
  variants: Array<{ sku: string; unitPrice: number }>;
}

interface CartLine {
  tierId: string;
  sku: string;
  quantity: number;
}

export function resolveCartLinePrices(
  tiers: PricingTier[],
  cartLines: CartLine[],
): Array<CartLine & { unitPrice: number }> {
  return cartLines.flatMap((line) => {
    const tier = tiers.find((t) => t.id === line.tierId);
    if (!tier) return [];
    const variant = tier.variants.find((v) => v.sku === line.sku);
    return variant ? [{ ...line, unitPrice: variant.unitPrice }] : [];
  });
}



// FP: Promise.all([renderEmail(opts1), renderEmail(opts2)]) — both calls return
// Promise<string>; destructuring [html, text] is correctly typed.
declare function renderLocalizedEmail(
  template: { kind: string; props: Record<string, unknown> },
  options: { locale: string; plainText?: boolean },
): Promise<string>;

declare const notificationMailer: {
  send(msg: { to: string; subject: string; html: string; text: string }): Promise<void>;
};

export async function dispatchReportReadyEmail(opts: {
  recipientEmail: string;
  reportTitle: string;
  reportUrl: string;
  locale: string;
}): Promise<void> {
  const template = {
    kind: 'ReportReady',
    props: { reportTitle: opts.reportTitle, reportUrl: opts.reportUrl },
  };

  const [html, text] = await Promise.all([
    renderLocalizedEmail(template, { locale: opts.locale }),
    renderLocalizedEmail(template, { locale: opts.locale, plainText: true }),
  ]);

  await notificationMailer.send({
    to: opts.recipientEmail,
    subject: `Your report "${opts.reportTitle}" is ready`,
    html,
    text,
  });
}



// FP: Promise.allSettled(array.map(async item => ...)) — correct usage, no type mismatch
declare const expiredTokens: Array<{ id: string; userId: string }>;
declare const taskQueue: {
  enqueue(opts: { name: string; payload: object }): Promise<void>;
};

export async function sweepExpiredTokens(): Promise<void> {
  await Promise.allSettled(
    expiredTokens.map(async (token) => {
      await taskQueue.enqueue({
        name: 'internal.revoke-token',
        payload: { tokenId: token.id, userId: token.userId },
      });
    }),
  );
}



// FP: Promise.all() with array destructuring — standard async pattern, no type mismatch
declare function updateReportMeta(opts: { reportId: number; meta: Record<string, unknown> }): Promise<void>;
declare function setReportParticipants(opts: { reportId: number; participants: unknown[] }): Promise<{ data: unknown[] }>;

type ParticipantSchema = { nativeId: number; actionAuth?: string[] };
type ReportFormSchema = { participants: ParticipantSchema[]; signingOrder: string; allowDictateNext: boolean };

export async function onReportFormSubmit(data: ReportFormSchema): Promise<void> {
  const reportId = 1;
  await Promise.all([
    updateReportMeta({
      reportId,
      meta: { allowDictateNext: data.allowDictateNext, signingOrder: data.signingOrder },
    }),
    setReportParticipants({
      reportId,
      participants: data.participants.map((p) => ({
        ...p,
        id: p.nativeId,
        actionAuth: p.actionAuth ?? [],
      })),
    }),
  ]);
}

export async function onReportAutoSave(data: ReportFormSchema): Promise<{ data: unknown[] }> {
  const reportId = 1;
  const [, participantsResponse] = await Promise.all([
    updateReportMeta({
      reportId,
      meta: { allowDictateNext: data.allowDictateNext, signingOrder: data.signingOrder },
    }),
    setReportParticipants({
      reportId,
      participants: data.participants.map((p) => ({
        ...p,
        id: p.nativeId,
        actionAuth: p.actionAuth ?? [],
      })),
    }),
  ]);
  return participantsResponse;
}



// FP: Promise.all with multiple independent async flush functions — no type mismatch
declare function flushPendingFields(): Promise<void>;
declare function flushPendingParticipants(): Promise<void>;
declare function flushPendingMetadata(): Promise<void>;

export async function flushAllPendingChanges(): Promise<void> {
  await Promise.all([
    flushPendingFields(),
    flushPendingParticipants(),
    flushPendingMetadata(),
  ]);
}



// pdf.destroy() is a document lifecycle call, not a DB write — should not trigger missing-transaction
declare const PdfDocument: {
  load(data: Uint8Array): Promise<{ numPages: number; getPage(n: number): Promise<unknown>; destroy(): Promise<void> }>;
};
declare function renderPdfPageToDataUrl(page: unknown, scale: number): Promise<string>;

export async function convertPdfToImages(
  pdfBytes: Uint8Array,
  scale = 2,
): Promise<string[]> {
  const doc = await PdfDocument.load(pdfBytes);
  const images: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const dataUrl = await renderPdfPageToDataUrl(page, scale);
    images.push(dataUrl);
  }

  void doc.destroy().catch((e: unknown) => console.error('pdf destroy failed:', e));

  return images;
}



// Promise.all with two correctly typed renderEmailWithI18N calls — both accept correct args, no type mismatch
declare function renderEmailTemplate(
  template: unknown,
  opts: { locale: string; branding?: Record<string, string>; textOnly?: boolean },
): Promise<string>;

export async function sendBilingualOrganisationEmail(
  template: unknown,
  locale: string,
  branding: Record<string, string>,
): Promise<[string, string]> {
  const [htmlContent, plainTextContent] = await Promise.all([
    renderEmailTemplate(template, { locale, branding }),
    renderEmailTemplate(template, { locale, branding, textOnly: true }),
  ]);
  return [htmlContent, plainTextContent];
}



// missing-transaction FP(retry): two destroy() calls on DIFFERENT objects in same function —
// PDF library lifecycle calls, not DB writes, but ORM_WRITE_METHODS matches 'destroy'.
declare const PdfDocument2: {
  load(data: Uint8Array): Promise<{ numPages: number; getPage(n: number): Promise<unknown>; destroy(): Promise<void> }>;
};
declare function renderPdfPage2(page: unknown, scale: number): Promise<string>;

export async function convertPdfToImagesBatch(
  mainPdfBytes: Uint8Array,
  thumbPdfBytes: Uint8Array,
  scale = 2,
): Promise<{ main: string[]; thumb: string[] }> {
  const mainDoc = await PdfDocument2.load(mainPdfBytes);
  const thumbDoc = await PdfDocument2.load(thumbPdfBytes);
  const mainImages: string[] = [];
  const thumbImages: string[] = [];

  for (let i = 1; i <= mainDoc.numPages; i++) {
    const page = await mainDoc.getPage(i);
    mainImages.push(await renderPdfPage2(page, scale));
  }

  for (let i = 1; i <= thumbDoc.numPages; i++) {
    const page = await thumbDoc.getPage(i);
    thumbImages.push(await renderPdfPage2(page, scale / 2));
  }

  void mainDoc.destroy().catch((e: unknown) => console.error('main destroy failed:', e));
  void thumbDoc.destroy().catch((e: unknown) => console.error('thumb destroy failed:', e));

  return { main: mainImages, thumb: thumbImages };
}

