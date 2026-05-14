export function alwaysReturn(x: number): number { if (x > 0) return x; return 0; }
export const normalString = 'hello world';
export function addNumbers(a: number, b: number): number { return a + b; }
export function safeParse(): unknown { try { return JSON.parse('{}'); } catch { return null; } }
export function staticRegex(): RegExp { return /hello/u; }
export const letterRegex = /\p{Letter}/u;
export class ReadAttribute {
  private readonly data_: string;
  constructor(initial: string = 'secret') { this.data_ = initial; }
  getData(): string { return this.data_; }
}
export class ArrowMethodClass {
  private readonly handleClick = (): boolean => true;
  getHandler(): () => boolean { return this.handleClick; }
}

// inconsistent-return: exhaustive switch where all cases return
export function exhaustiveSwitch(action: string): string {
  switch (action) {
    case 'start': return 'starting';
    case 'stop': return 'stopping';
    default: return 'unknown';
  }
}

// await-non-thenable: async function awaiting a method call on an object
export async function callMethod(client: { invoke: (s: string) => Promise<string> }): Promise<string> {
  try {
    return await client.invoke('test');
  } catch {
    return 'error';
  }
}

// constant-binary-expression: ternary on a nullable variable
export function nullableTernary(value: string | null): string {
  return value ? value.toUpperCase() : 'default';
}

// await-non-thenable: await on call with TS type wrapper (cast to Promise)
export async function awaitWithCast(client: { invoke: (s: string) => Promise<string> }): Promise<string> {
  try {
    return await client.invoke('test');
  } catch {
    return '';
  }
}



// argument-type-mismatch: dynamic import with destructuring and renaming
export async function loadFormatter(locale: string): Promise<string> {
  const { formatDate: formatDateFn } = await import('@intl/date-formatter');
  const timestamp = Date.now();
  return formatDateFn(timestamp, locale);
}

export async function loadValidator(schema: string): Promise<boolean> {
  const { validate: validateSchema } = await import('@schema/validator');
  return validateSchema(schema);
}



// argument-type-mismatch: map with conditional template literal then join
interface UserRecord {
  id: number;
  name?: string;
  email: string;
}

export function formatUserList(users: UserRecord[]): string {
  const formattedUsers = users
    .map((u) => (u.name ? `${u.name} (${u.email})` : u.email))
    .join(', ');
  return formattedUsers;
}



// argument-type-mismatch: path.join with rest parameters accepts string args
declare const path: { join(...paths: string[]): string };
declare const process: { cwd(): string };
const CACHE_DIR = '.cache';
export function getCachePath(): string {
  const cachePath = path.join(process.cwd(), CACHE_DIR);
  return cachePath;
}



// argument-type-mismatch: async map with early return inside Promise.all
declare const database: {
  task: {
    findMany: (query: object) => Promise<Array<{ id: string; scheduledAt: Date | null; lastRunAt: Date | null }>>;
    update: (params: { where: { id: string }; data: { nextRunAt: Date } }) => Promise<void>;
  };
};

declare function calculateNextRun(config: { scheduledAt: Date; lastRunAt: Date | null }): Date;

export async function scheduleTaskRuns(jobId: string): Promise<void> {
  const tasks = await database.task.findMany({
    where: { jobId, status: 'pending', scheduledAt: { not: null } },
  });

  await Promise.all(
    tasks.map(async (task) => {
      if (!task.scheduledAt) {
        return;
      }

      const nextRunAt = calculateNextRun({
        scheduledAt: task.scheduledAt,
        lastRunAt: task.lastRunAt,
      });

      await database.task.update({
        where: { id: task.id },
        data: { nextRunAt },
      });
    }),
  );
}



// argument-type-mismatch: calling SDK command with env() result for string property
declare const getConfig: (key: string) => string;
declare class StorageCommand {
  constructor(config: { Bucket: string; Key: string; Body: Buffer; ContentType: string });
}
declare const storageClient: { send: (cmd: StorageCommand) => Promise<unknown> };

export async function uploadFile(content: Buffer, filename: string, mimeType: string): Promise<void> {
  await storageClient.send(
    new StorageCommand({
      Bucket: getConfig('STORAGE_BUCKET'),
      Key: filename,
      Body: content,
      ContentType: mimeType,
    }),
  );
}



// argument-type-mismatch: standard array.map with object literal return
declare const productData: Array<{ name: string; price: number; id: string }>;
export const transformedProducts = productData.map((product) => ({
  displayName: product.name,
  formattedPrice: `$${product.price}`,
  productId: product.id,
}));

// argument-type-mismatch: conditional with array.map returning object literal
declare const userRecords: Array<{ username: string; email: string; role: string }> | undefined;
declare const hasValidData: boolean;
export const usersList =
  hasValidData && userRecords
    ? userRecords.map((user) => ({
        display: user.username,
        contact: user.email,
        permission: user.role,
      }))
    : [];



// argument-type-mismatch FP: Promise.allSettled with async map - standard parallel execution pattern
declare const eventHandlers: Array<{ id: string; execute: (data: unknown) => Promise<void> }>;

export async function dispatchEvents(data: unknown): Promise<void> {
  await Promise.allSettled(
    eventHandlers.map(async (handler) => {
      await handler.execute(data);
    }),
  );
}



// argument-type-mismatch: map with spread operator and additional properties
declare const userRecords: Array<{ id: string; name: string; tags?: string[] }> | undefined;
export function enrichUserRecords(teamId: string): Array<{ id: string; name: string; tags: string[]; teamId: string }> {
  return (userRecords ?? []).map((record) => ({
    ...record,
    tags: record.tags ?? [],
    teamId,
  }));
}

// argument-type-mismatch: nested map within flatMap, spreading fields
declare interface DocumentField { fieldId: string; type: string; width: number; height: number; }
declare interface AssignedUser { userId: string; email: string; fields?: DocumentField[] };
export function transformAssignedFields(
  users: AssignedUser[],
  documentId: string
): Array<DocumentField & { ownerId: string; ownerEmail: string }> {
  return users.flatMap((user) => {
    return (user.fields ?? []).map((field) => ({
      ...field,
      ownerId: user.userId,
      ownerEmail: user.email,
    }));
  });
}



// argument-type-mismatch: function call with array-indexed argument from typed const array
type LocalizedMessage = { id: string; defaultText: string };

const STATUS_MESSAGES = [
  { id: 'loading', defaultText: 'Loading your data' },
  { id: 'processing', defaultText: 'Processing request' },
  { id: 'validating', defaultText: 'Validating inputs' },
  { id: 'finalizing', defaultText: 'Finalizing changes' },
] as const;

declare function formatMessage(msg: LocalizedMessage): string;

export function displayStatusMessage(stepIndex: number): string {
  return formatMessage(STATUS_MESSAGES[stepIndex]);
}



// argument-type-mismatch: ts-pattern match().with().exhaustive() for nullable enum pattern matching
declare const match: <T>(value: T) => {
  with: <P>(pattern: P, handler: () => boolean) => any;
  exhaustive: () => boolean;
};

enum UserRole {
  ADMIN = 'ADMIN',
  VIEWER = 'VIEWER',
  EDITOR = 'EDITOR',
}

export function validateUserAccess(
  roles: UserRole[],
  currentUser: { name?: string; email: string } | null
): boolean {
  const primaryRole = roles.at(0);
  
  const hasValidAccess = match(primaryRole)
    .with(UserRole.ADMIN, () => currentUser !== null && currentUser.email.endsWith('@company.com'))
    .with(UserRole.EDITOR, () => currentUser !== null)
    .with(UserRole.VIEWER, () => true)
    .with(undefined, () => false)
    .exhaustive();
  
  return hasValidAccess;
}



// argument-type-mismatch: chained filter/flatMap with typed array transformations
declare const OrderStatus: { COMPLETED: string; PENDING: string; CANCELLED: string };

interface OrderItem {
  id: number;
  name: string;
  quantity: number;
  processed: boolean;
}

interface Order {
  orderId: string;
  customerName: string;
  customerEmail: string;
  status: string;
  priority: string;
  items: OrderItem[];
}

interface ProcessingContext {
  orders: Order[];
}

export function getProcessedItemsFromCompletedOrders(context: ProcessingContext): Array<OrderItem & { order: { customerName: string; customerEmail: string; status: string; priority: string } }> {
  const processedItems = context.orders
    .filter(({ status }) => status === OrderStatus.COMPLETED)
    .flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        order: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          status: order.status,
          priority: order.priority,
        },
      })),
    )
    .filter((item) => item.processed);
  
  return processedItems;
}



// argument-type-mismatch: Array.filter() with boolean property predicate
declare const tasks: Array<{ id: string; completed: boolean }>;
declare const notifications: Array<{ id: number; read: boolean }>;

export function getPendingTasks(): Array<{ id: string; completed: boolean }> {
  return tasks.filter((task) => !task.completed);
}

export function getUnreadNotifications(): Array<{ id: number; read: boolean }> {
  return notifications.filter((notification) => !notification.read);
}



// argument-type-mismatch FP: Array.map() extracting properties is a standard transform, no type mismatch
interface OrderItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount: number | null;
  taxRate: number;
  shippingCost: number;
  warehouseId: string;
  metadata: Record<string, unknown>;
}

declare function processOrder(payload: { items: OrderItem[] }): Promise<void>;

export async function submitOrder(items: OrderItem[]): Promise<void> {
  await processOrder({
    items: items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      taxRate: item.taxRate,
      shippingCost: item.shippingCost,
      warehouseId: item.warehouseId,
      metadata: item.metadata,
    })),
  });
}



// argument-type-mismatch: Array.filter() with enum equality check in predicate
enum TaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

interface Task {
  id: string;
  status: TaskStatus;
  assignee: { name: string; status: TaskStatus };
}

declare const project: { tasks: Task[] } | undefined;

export function getCompletedTasks(): Task[] {
  return project?.tasks.filter((task) => task.assignee.status === TaskStatus.COMPLETED) ?? [];
}

export function getPendingTasks(): Task[] {
  return project?.tasks.filter((task) => task.status === TaskStatus.PENDING) ?? [];
}



// argument-type-mismatch: Promise.all with async map pattern
declare function processMessage(batch: BatchJob, message: QueueMessage): Promise<void>;

interface QueueMessage {
  id: string;
  content: string;
}

interface BatchJob {
  id: string;
  messages: QueueMessage[];
  shouldEnrich: boolean;
}

export async function processBatchMessages(batch: BatchJob): Promise<void> {
  if (batch.shouldEnrich) {
    await Promise.all(
      batch.messages.map(async (message) => {
        await processMessage(batch, message);
      }),
    );
  }
}



// argument-type-mismatch: find() with destructured parameter — standard lookup pattern
interface Product {
  id: string;
  name: string;
  categories: Array<{ id: string; name: string }>;
}

export function findProductCategory(product: Product, categoryId: string): { id: string; name: string } | undefined {
  const matchedCategory = product.categories.find(({ id }) => id === categoryId);
  return matchedCategory;
}

// argument-type-mismatch: filter with destructured parameter
interface Workspace {
  members: Array<{ id: string; role: string }>;
}

export function filterActiveMembers(workspace: Workspace, activeMemberIds: string[]): Array<{ id: string; role: string }> {
  return workspace.members.filter(({ id }) => activeMemberIds.includes(id));
}



// argument-type-mismatch: chained filter+map on typed array with boolean and number properties
export function getActiveIds(items: Array<{ id: number, active: boolean }>): number[] {
  const activeItemIds = items.filter((item) => item.active).map((item) => item.id);
  return activeItemIds;
}

export function getEnabledIndexes(options: { label: string, enabled: boolean, order: number }[]): number[] {
  const enabledList = options.map((opt, idx) => ({
    index: idx,
    isEnabled: opt.enabled
  }));
  const result: number[] = enabledList.filter((v) => v.isEnabled).map((v) => v.index);
  return result;
}



// argument-type-mismatch: object literal with string literal type property
declare function uploadFile(options: { 
  name: string; 
  type: string; 
  data: () => Promise<Buffer> 
}): Promise<{ id: string }>;

export async function processReport(reportName: string, content: Buffer): Promise<void> {
  const result = await uploadFile({
    name: reportName,
    type: 'application/pdf',
    data: async () => Promise.resolve(content),
  });
}

// argument-type-mismatch: similar pattern with multiple string literal properties
declare function storeAsset(config: {
  filename: string;
  mimeType: string;
  loader: () => Promise<ArrayBuffer>;
}): Promise<void>;

export async function saveImage(imageName: string, imageData: ArrayBuffer): Promise<void> {
  await storeAsset({
    filename: imageName,
    mimeType: 'image/png',
    loader: async () => Promise.resolve(imageData),
  });
}



// argument-type-mismatch: function call with object literal using typed enum property
enum FileType {
  PDF = 'PDF',
  IMAGE = 'IMAGE',
  DOCUMENT = 'DOCUMENT'
}

interface FileMetadata {
  type: FileType;
  content: string;
  originalContent: string;
}

declare function fetchFileFromStorage(opts: { type: FileType; content: string }): Promise<ArrayBuffer>;

export async function loadDocumentFile(metadata: FileMetadata, useOriginal: boolean): Promise<ArrayBuffer | null> {
  const contentToUse = useOriginal ? metadata.originalContent : metadata.content;
  
  const fileData = await fetchFileFromStorage({
    type: metadata.type,
    content: contentToUse,
  }).catch((err) => {
    console.error(err);
    return null;
  });
  
  return fileData;
}
