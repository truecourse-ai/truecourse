/**
 * The shelf's schema, as the app reads and writes it.
 *
 * `migrations/` holds the SQL that creates exactly these tables; the two are kept
 * in step by hand, and `bookclub config` prints the database they both target.
 */

import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core'

/** A person in the club. Members are created by the seed or by hand — the service
 *  exposes no sign-up endpoint. */
export const members = pgTable('members', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

/** A book on the shared shelf. */
export const books = pgTable('books', {
  id: serial('id').primaryKey(),
  isbn: text('isbn').notNull().unique(),
  title: text('title').notNull(),
  author: text('author').notNull(),
  status: text('status').notNull().default('unread'),
  addedBy: integer('added_by').notNull().references(() => members.id),
  addedAt: timestamp('added_at').notNull().defaultNow(),
  finishedAt: timestamp('finished_at'),
  archivedAt: timestamp('archived_at'),
})
