/**
 * Positive fixture for code-quality/deterministic/missing-env-validation.
 *
 * Inside a zod (or valibot/yup/class-validator) env schema, passing
 * `process.env.X` as the `.default(...)` / `.catch(...)` argument IS the
 * validation — the schema consumes the env var and surfaces a typed,
 * validated value (with the env var as the fallback when undefined).
 * Flagging the read as "unvalidated" misses that the surrounding
 * `z.object({...}).parse(process.env)` IS the guard.
 */

interface ZodLike {
  default(value: string | undefined): ZodLike;
  catch(value: string): ZodLike;
  optional(): ZodLike;
}

declare const z: {
  string(): ZodLike;
};

export const envSchema = {
  APP_ENV: z.string().default(process.env.NODE_ENV),
  REGION: z.string().catch(process.env.AWS_REGION ?? 'us-east-1'),
};
