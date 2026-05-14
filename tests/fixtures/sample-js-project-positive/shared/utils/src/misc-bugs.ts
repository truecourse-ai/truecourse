export const templateLiteral = 'user is a user';
export function throwError(): never { throw new Error('bad input'); }
export function normalPermissions(): number { return 0o644; }
export const safeNumber = 9007199254740991;
export function properIndexCheck(arr: readonly string[]): boolean { return arr.includes('item'); }
export function symbolWithDesc(): symbol { return Symbol('description'); }
export function safeNew(): Map<string, number> { return new Map(); }
export function addAndReturn(x: number): number { return x + 1; }
export function checkMapSize(map: Map<string, number>): boolean { return map.size > 0; }
export function parseWithRadix(input: string): number { return parseInt(input, 10); }
export function consistentType(x: number): string {
  if (x > 0) return 'positive';
  if (x < 0) return 'negative';
  return 'zero';
}
export function addNumbers(x: number, y: number): number { return x + y; }
export function toArray(s: string): string[] { return s.split(''); }



// FP shape: results.filter(r => !r.success).map(r => r.id) — chained filter/map on typed array
declare const batchResults: Array<{ success: boolean; jobId: string; error?: string }>;

function getFailedJobIds(): string[] {
  return batchResults.filter((r) => !r.success).map((r) => r.jobId);
}



// FP: $transaction() with Promise.all(map) — standard async transaction
declare const db: {
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
};
declare const recipientsToUpdate: Array<{ id: string; name: string }>;

async function persistRecipients() {
  const updated = await db.$transaction(async (tx) => {
    return await Promise.all(
      recipientsToUpdate.map(async (recipient) => {
        return recipient;
      }),
    );
  });
  return updated;
}



// FP: flatMap with find inside — standard nested lookup
declare const catalog: Array<{ id: string; variants: Array<{ sku: string; price: number }> }>;
declare const cartItems: Array<{ productId: string; sku: string }>;

const resolvedItems = cartItems.flatMap((cartItem) => {
  const product = catalog.find((p) => p.id === cartItem.productId);
  if (!product) return [];
  const variant = product.variants.find((v) => v.sku === cartItem.sku);
  return variant ? [{ ...cartItem, price: variant.price }] : [];
});



// FP: $transaction() with for...of loop — standard Prisma transaction
declare const db: { $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> };
declare const pendingUpdates: Array<{ id: string; status: string }>;

async function flushPendingUpdates() {
  await db.$transaction(async (tx: unknown) => {
    for (const update of pendingUpdates) {
      void update;
    }
  });
}



// FP: Object.assign to attach related data — known pattern, comment notes intentional typing bypass
declare const updatedRecord: { id: string; value: string };
declare const auditEntry: { timestamp: Date; userId: string };

// Dirty but I don't want to deal with type information here
Object.assign(updatedRecord, { auditEntry });



// FP: Array.map(async ...) with early return guard — standard async map
declare const documents: Array<{ id: string; status: string; ownerId: string }>;
declare function processDocument(id: string): Promise<void>;

async function batchProcess() {
  await Promise.all(
    documents.map(async (doc) => {
      if (doc.status === 'ARCHIVED') {
        return;
      }
      await processDocument(doc.id);
    }),
  );
}



// FP: $transaction with async update callback — standard Prisma usage
declare const db: { $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> };
declare const userId: string;

async function enableFeatureFlag(flagName: string) {
  await db.$transaction(async (tx: unknown) => {
    void tx; void userId; void flagName;
  });
}



// FP: Object.values(meta).length > 0 — Object.values returns any[]; length is number; comparison is valid
declare function updateResourceMeta(opts: { id: string; meta: Record<string, unknown> }): Promise<void>;
declare const resourceId: string;

async function distributeResource(meta: Record<string, unknown> = {}) {
  if (Object.values(meta).length > 0) {
    await updateResourceMeta({ id: resourceId, meta });
  }
}
