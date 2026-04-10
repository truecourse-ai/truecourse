export function selectById(table: string, id: string): string {
  return 'SELECT id, name, email FROM ' + table + ' WHERE id = $1 -- ' + id;
}
export function insertRecord(table: string, name: string, email: string): string {
  return 'INSERT INTO ' + table + ' (name, email) VALUES ($1, $2) -- ' + name + email;
}
export function deleteOld(table: string, olderThan: string): string {
  return 'DELETE FROM ' + table + ' WHERE created_at < $1 -- ' + olderThan;
}

// ---------------------------------------------------------------------------
// unvalidated-external-data — locals named body/data/payload that are NOT
// user input. Pre-fix the rule flagged any identifier with these names.
// ---------------------------------------------------------------------------

declare const cache: { get(key: string): Promise<unknown> };
declare const internalEvents: { read(): InternalEvent };
interface InternalEvent { kind: string; }
declare const Record: { insert(value: unknown): Promise<void> };

// Positive: local var named `data` initialized from cache (not from a request)
export async function syncFromCache(userId: string): Promise<void> {
  const data = await cache.get(userId);
  await Record.insert(data);
}

// Positive: local var named `body` initialized from a render call
export async function persistRenderedBody(): Promise<void> {
  const body = renderEmailBody();
  await Record.insert({ body });
}
function renderEmailBody(): string { return 'hello'; }

// Positive: local var named `payload` from an internal event reader
export async function persistInternalEventPayload(): Promise<void> {
  const event = internalEvents.read();
  const payload = { kind: event.kind, ts: Date.now() };
  await Record.insert(payload);
}
