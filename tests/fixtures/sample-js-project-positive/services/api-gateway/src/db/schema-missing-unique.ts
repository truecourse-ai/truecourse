import { pgTable, varchar, integer } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: integer("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  username: varchar("username", { length: 100 }).notNull(),
});

export const accounts = pgTable("accounts", {
  id: integer("id").primaryKey(),
  apiKey: varchar("api_key", { length: 64 }).notNull(),
  externalId: varchar("external_id", { length: 100 }).notNull(),
});
