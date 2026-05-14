declare const pgTable: <T>(name: string, cols: T) => T;
declare const varchar: (opts: { length: number }) => unknown;
declare const integer: () => unknown;
export const users_3a8e99ea = pgTable("users_3a8e99ea", {
  id: integer(),
  email: varchar({ length: 255 }),
  username: varchar({ length: 100 }),
});
