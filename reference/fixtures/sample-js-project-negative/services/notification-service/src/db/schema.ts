// Drizzle schema for the notification service. Used by the
// missing-unique-constraint negative fixture to verify that the rule
// correctly handles Drizzle-style queries.
//
// `subscribers.email` is intentionally NOT marked .unique() — the
// queries.ts file in this service has a check-then-create pattern on
// this column that should fire as a TP.
import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core'

export const subscribers = pgTable('subscribers', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  channel: text('channel').notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
