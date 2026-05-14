// --- unused-export shape: non-exported-symbol-misclassified-as-export (file-private classes used internally) ---

// File-private error classes — no export keyword; used within this file only
class TaskExecutionFailedError extends Error {
  constructor(message: string, public readonly taskId: string) {
    super(message);
    this.name = 'TaskExecutionFailedError';
  }
}

class TaskMaxRetriesExceededError extends Error {
  constructor(message: string, public readonly taskId: string, public readonly attempts: number) {
    super(message);
    this.name = 'TaskMaxRetriesExceededError';
  }
}

async function runTaskWithRetry(
  taskId: string,
  fn: () => Promise<void>,
  maxRetries: number,
): Promise<void> {
  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      await fn();
      return;
    } catch (err) {
      attempts++;
      if (attempts >= maxRetries) {
        throw new TaskMaxRetriesExceededError(
          `Task ${taskId} exceeded retry limit`,
          taskId,
          attempts,
        );
      }
    }
  }
  throw new TaskExecutionFailedError(`Task ${taskId} failed`, taskId);
}



// G09: task runner callback with local variable — no type mismatch
declare const io: { runTask: (name: string, fn: () => Promise<void>) => Promise<void> };
declare function sendNotificationEmail(opts: { userId: string }): Promise<void>;
declare const userId: string;

async function dispatchNotifications(): Promise<void> {
  await io.runTask('send-notification-email', async () => {
    let shouldSendEmail = true;
    if (shouldSendEmail) {
      await sendNotificationEmail({ userId });
    }
  });
}



// G36: setTimeout with async void handler — standard timer pattern; no type mismatch
declare function processBatch(): Promise<void>;
declare const INTERVAL_MS: number;

function scheduleRecurringBatch(tick: () => void): void {
  const delay = INTERVAL_MS;
  setTimeout(() => {
    void processBatch().finally(tick);
  }, delay);
}



// FP shape 2f60d9becf2a: io.runTask(taskId, async callback) — runTask accepts string id and async callback
declare const io: { runTask: (taskId: string, handler: () => Promise<unknown>) => Promise<unknown> };
declare function buildWelcomeEmail(params: { userId: string; name: string }): unknown;
declare const userId: string, name: string;

export async function sendWelcomeEmailTask() {
  await io.runTask('send-welcome-email', async () => {
    buildWelcomeEmail({ userId, name });
  });
}

export async function sendMemberJoinedTask() {
  await io.runTask('send-member-joined-email', async () => {
    buildWelcomeEmail({ userId, name });
  });
}



// --- FP shape: io.runTask with per-item unique key in for-of loop ---
declare const io: { runTask(key: string, fn: () => Promise<unknown>): Promise<unknown> };
declare function dispatchMemberJoinedEmail(opts: { memberId: string; orgId: string }): Promise<void>;
declare const newMembers: Array<{ id: string; orgId: string }>;

async function notifyMembersJoined(): Promise<void> {
  for (const member of newMembers) {
    await io.runTask(`notify-member-joined-${member.id}`, async () => {
      await dispatchMemberJoinedEmail({ memberId: member.id, orgId: member.orgId });
    });
  }
}



// --- FP shape: io.runTask with row-specific key for idempotency in for-of loop ---
declare const io: { runTask(key: string, fn: () => Promise<unknown>): Promise<unknown> };
declare function createEnvelopeFromTemplate(templateId: string, recipientEmail: string): Promise<{ id: string }>;
declare const templateRows: Array<{ id: string; recipientEmail: string }>;

async function bulkSendTemplates(): Promise<void> {
  for (const row of templateRows) {
    await io.runTask(`bulk-send-template-create-${row.id}`, async () => {
      await createEnvelopeFromTemplate(row.id, row.recipientEmail);
    });
  }
}



// --- FP shape: io.runTask wrapping each email dispatch as a named idempotent task ---
declare const io: { runTask(key: string, fn: () => Promise<unknown>): Promise<unknown> };
declare function sendWorkspaceDeletedEmail(opts: { email: string; workspaceName: string }): Promise<void>;
declare const affectedMembers: Array<{ email: string; workspaceName: string }>;

async function notifyWorkspaceDeletion(): Promise<void> {
  for (const member of affectedMembers) {
    await io.runTask(`send-workspace-deleted-${member.email}`, async () => {
      await sendWorkspaceDeletedEmail({ email: member.email, workspaceName: member.workspaceName });
    });
  }
}



// --- FP shape: second io.runTask in same iteration depends on first task's result ---
declare const io: { runTask(key: string, fn: () => Promise<unknown>): Promise<unknown> };
declare function createEnvelope(templateId: string, email: string): Promise<{ id: string }>;
declare function sendEnvelopeEmail(envelopeId: string): Promise<void>;
declare const bulkRows: Array<{ templateId: string; recipientEmail: string }>;

async function bulkSendWithCheckpointing(): Promise<void> {
  for (const row of bulkRows) {
    const envelope = await io.runTask(`bulk-create-envelope-${row.templateId}-${row.recipientEmail}`, async () => {
      return createEnvelope(row.templateId, row.recipientEmail);
    }) as { id: string };
    await io.runTask(`bulk-send-envelope-${envelope.id}`, async () => {
      await sendEnvelopeEmail(envelope.id);
    });
  }
}



// --- FP shape: private class method returning Promise<void>; trivially inferred, not a public API ---
declare interface Job { name: string; data: unknown }
declare interface JobDefinition { enabled: boolean; handler(data: unknown): Promise<void> }

class JobProcessor {
  private _definitions: Record<string, JobDefinition> = {};

  private async processJob(job: Job) {
    const definition = this._definitions[job.name];

    if (!definition) {
      throw new Error(`No definition found for job ${job.name}`);
    }

    if (!definition.enabled) {
      return;
    }

    await definition.handler(job.data);
  }
}



// --- FP shape: public class method returning an async function; return type inferred from the returned async arrow function ---
declare interface HonoContext { req: unknown; res: unknown }
declare function createHonoPagesRoute(opts: { client: unknown; functions: unknown[] }): (ctx: HonoContext) => Promise<void>;

class JobQueueClient {
  private _client: unknown;
  private _functions: unknown[] = [];

  public getApiHandler() {
    return async (context: HonoContext) => {
      const handler = createHonoPagesRoute({
        client: this._client,
        functions: this._functions,
      });

      await handler(context);
    };
  }
}
