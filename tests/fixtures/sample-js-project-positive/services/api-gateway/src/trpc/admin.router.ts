/**
 * tRPC procedure builder ending with `.query(handler)`. The
 * `unvalidated-external-data` rule treats `.query(...)` as a SQL write
 * (it's in SQL_WRITE_METHODS) and inspects the argument's body for
 * user-input access — flagging the entire procedure as unvalidated.
 *
 * This is wrong: `.query` here is the tRPC builder method that registers
 * a query procedure. The actual user input is already validated by the
 * preceding `.input(ZodSchema)`. The rule must not fire on builder
 * `.query()` unless the receiver is an actual DB client.
 *
 * Mirrors documenso's
 *   packages/trpc/server/admin-router/get-admin-organisation.ts:10
 *   packages/trpc/server/api-token-router/get-api-tokens.ts:6
 */

interface ZodLike<T> { parse(input: unknown): T }
interface Logger { info: (msg: object) => void }
interface ProcedureBuilder<TInput, TOutput> {
  input<S>(schema: ZodLike<S>): ProcedureBuilder<S, TOutput>;
  output<S>(schema: ZodLike<S>): ProcedureBuilder<TInput, S>;
  query(handler: (args: { input: TInput; ctx: { logger: Logger } }) => Promise<TOutput>): unknown;
}

declare const adminProcedure: ProcedureBuilder<unknown, unknown>;
declare const ZGetUserSchema: ZodLike<{ userId: string }>;
declare const ZGetUserResponseSchema: ZodLike<{ id: string }>;

export const getUserRoute = adminProcedure
  .input(ZGetUserSchema)
  .output(ZGetUserResponseSchema)
  .query(async ({ input, ctx }) => {
    const { userId } = input;
    ctx.logger.info({ userId });
    await Promise.resolve();
    return { id: userId };
  });
