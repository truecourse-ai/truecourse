declare const pgTable: <T>(name: string, cols: T) => T;
declare const varchar: (opts: { length: number }) => unknown;
declare const integer: () => unknown;
export const users_d00f39c9 = pgTable("users_d00f39c9", {
  id: integer(),
  email: varchar({ length: 255 }),
  username: varchar({ length: 100 }),
});
