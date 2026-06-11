// `$connect` is a method on an already-constructed, managed client (the client
// itself is created before the try), not a raw resource-open that leaks. On the
// failure path the catch block disconnects and rethrows; on the success path the
// caller is handed a `stop` function that disconnects later. Cleanup is fully
// handled without a `finally`, so this must not be flagged.

interface ManagedClient {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
}

declare function createManagedClient(url: string): ManagedClient;

export async function openSession(url: string): Promise<() => Promise<void>> {
  const client = createManagedClient(url);
  try {
    await client.$connect();
  } catch (err) {
    await client.$disconnect();
    throw err;
  }
  return async () => {
    await client.$disconnect();
  };
}
