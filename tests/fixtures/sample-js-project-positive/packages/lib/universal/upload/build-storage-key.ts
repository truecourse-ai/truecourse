declare function generateId(len: number): string;
declare function generateSlug(name: string): string;

export function buildStorageKey(fileName: string, contentType: string, userId?: number): string {
  let slugified = generateSlug(fileName);

  if (slugified.length === 0 || slugified.length > 100) {
    slugified = generateId(8);
  }

  let key = `${generateId(12)}/${slugified}`;

  if (userId) {
    key = `${userId}/${key}`;
  }

  return key;
}
