// Drizzle-style check-then-create query. The schema in ./schema.ts declares
// `subscribers.email` WITHOUT .unique(), so this is a real race condition.
import { eq } from 'drizzle-orm'
import { subscribers } from './schema'

declare const db: {
  query: { subscribers: { findFirst: (opts: unknown) => Promise<{ id: string } | null> } }
  insert: (table: typeof subscribers) => { values: (v: unknown) => Promise<void> }
}

// VIOLATION: database/deterministic/missing-unique-constraint
export async function subscribeIfNew(email: string, channel: string): Promise<void> {
  if (!(await db.query.subscribers.findFirst({ where: eq(subscribers.email, email) }))) {
    await db.insert(subscribers).values({ email, channel })
  }
}
