/**
 * Positive fixture for bugs/deterministic/await-in-loop.
 *
 * Two FP shapes:
 *
 *   1. A while loop whose iteration condition reads a property via
 *      optional chaining (`while (node?.parent)`). Each iteration depends
 *      on the awaited result of the previous one — a linked-list walk
 *      that is inherently sequential and cannot be parallelised.
 *
 *   2. (Tested separately in `await-in-loop-seed.ts` below.) Seed
 *      scripts where sequential execution is intentional.
 */

type FolderRecord = { id: string; parentId: string | null };

declare function loadFolder(id: string): Promise<FolderRecord | null>;

export async function walkBreadcrumbs(startId: string): Promise<FolderRecord[]> {
  const trail: FolderRecord[] = [];
  let current: FolderRecord | null = await loadFolder(startId);
  while (current?.parentId !== null && current?.parentId !== undefined) {
    const parent = await loadFolder(current.parentId);
    if (!parent) break;
    trail.unshift(parent);
    current = parent;
  }
  return trail;
}
