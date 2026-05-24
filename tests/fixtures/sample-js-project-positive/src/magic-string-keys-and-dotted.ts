/**
 * Strings used as object literal property keys (e.g. HTTP header
 * names) and dotted-identifier strings (e.g. database column or
 * namespaced API references) are framework / schema tokens, not
 * domain strings worth extracting to a named constant.
 */

declare function post(
  url: string,
  opts: { headers: Record<string, string>; body: string },
): Promise<unknown>;

export async function sendBatch(): Promise<void> {
  await post('/route-a', { headers: { 'Content-Type': 'mime-alpha' }, body: '{}' });
  await post('/route-b', { headers: { 'Content-Type': 'mime-beta' }, body: '{}' });
  await post('/route-c', { headers: { 'Content-Type': 'mime-gamma' }, body: '{}' });
}

declare function selectCols(cols: readonly string[]): Promise<unknown>;

export async function readRows(): Promise<void> {
  await selectCols(['Account.id', 'Account.label']);
  await selectCols(['Account.id', 'Account.label']);
  await selectCols(['Account.id', 'Account.label']);
}
