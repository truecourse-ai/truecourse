interface DatabaseClient {
  connected: boolean;
}

const state: { client: DatabaseClient | null } = { client: null };

export async function connectDatabase(): Promise<DatabaseClient> {
  if (!state.client) {
    await Promise.resolve();
    state.client = { connected: true };
  }
  return state.client;
}

export async function disconnectDatabase(): Promise<void> {
  if (state.client) {
    await Promise.resolve();
    state.client.connected = false;
    state.client = null;
  }
}
