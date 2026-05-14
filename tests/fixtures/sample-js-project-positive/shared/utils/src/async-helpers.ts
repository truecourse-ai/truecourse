
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
