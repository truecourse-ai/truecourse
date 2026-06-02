// `db.users.update(req.body)` writes untrusted request data into the
// database without schema validation — the canonical shape this rule
// must catch.

interface ExpressLikeRequest {
  readonly body: { readonly id: string; readonly name: string };
}

interface OrmTable {
  update(_data: { id: string; name: string }): Promise<void>;
}

interface DbHandle {
  readonly users: OrmTable;
}

declare const db: DbHandle;

export async function renameUser(req: ExpressLikeRequest): Promise<void> {
  // VIOLATION: database/deterministic/unvalidated-external-data
  await db.users.update(req.body);
}
