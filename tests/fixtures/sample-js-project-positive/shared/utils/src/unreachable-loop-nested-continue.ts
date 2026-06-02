interface Snapshot {
  version: number;
  payload: unknown;
}

interface Store {
  read(id: string): Promise<Snapshot | null>;
  writeIfUnchanged(
    id: string,
    expectedVersion: number,
    next: unknown,
  ): Promise<{ updated: number }>;
}

export async function applyWithOptimisticRetry(
  store: Store,
  id: string,
  mutate: (input: unknown) => unknown,
): Promise<unknown> {
  const MAX_RETRIES = 3;
  let attempts = 0;

  while (attempts <= MAX_RETRIES) {
    const current = await store.read(id);
    if (!current) {
      throw new Error(`missing ${id}`);
    }

    const next = mutate(current.payload);
    const result = await store.writeIfUnchanged(id, current.version, next);

    if (result.updated === 0) {
      if (attempts === MAX_RETRIES) {
        return next;
      }
      attempts++;
      continue;
    }

    return next;
  }
  return undefined;
}
