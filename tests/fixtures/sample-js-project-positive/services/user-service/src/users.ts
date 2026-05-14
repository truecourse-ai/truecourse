
// FP: Promise.all(itemsToUpdate.map(async ({original, patch}) => {...})) — destructured async map
interface UserRecord { id: string; email: string; role: string; }
interface UpdatePair { original: UserRecord; patch: Partial<UserRecord>; }
declare const itemsToUpdate: UpdatePair[];
declare function applyUserUpdate(id: string, patch: Partial<UserRecord>): Promise<UserRecord>;

async function batchUpdateUsers() {
  return Promise.all(
    itemsToUpdate.map(async ({ original, patch }) => {
      return applyUserUpdate(original.id, patch);
    }),
  );
}
