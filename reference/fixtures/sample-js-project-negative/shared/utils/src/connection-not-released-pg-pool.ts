interface Conn {
  query(sql: string): Promise<unknown>;
  release(): void;
}

interface Pool {
  connect(): Promise<Conn>;
}

export async function runWithoutRelease(pool: Pool): Promise<unknown> {
  // VIOLATION: database/deterministic/connection-not-released
  const conn = await pool.connect();
  return conn.query("select 1");
}
