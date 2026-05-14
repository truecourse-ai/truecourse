
// FP: Zod schema definition file — schemas may reference each other; this is hoisted ESM syntax.
declare const z: {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => unknown;
  number: () => unknown;
  boolean: () => unknown;
  array: (schema: unknown) => unknown;
  infer: <T>(schema: T) => T;
};

export type TEmbedConfigSchema = ReturnType<typeof z.infer<typeof ZEmbedConfigSchema>>;

export const ZEmbedConfigSchema = z.object({
  title: z.string(),
  mode: z.string(),
  redirectUrl: z.string(),
  allowedOrigins: z.array(z.string()),
  expiresIn: z.number(),
  requireAuthentication: z.boolean(),
});
