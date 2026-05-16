
// Standard Zod schema definition — nested z.object call, no type mismatch
declare const z: {
  object: (shape: Record<string, any>) => any;
  string: () => any;
  number: () => any;
  boolean: () => any;
  array: (schema: any) => any;
  optional: () => any;
};

export const ZUpdatePayloadSchema = z.object({
  requestId: z.string(),
  data: z.object({
    title: z.string(),
    priority: z.number(),
    archived: z.boolean(),
  }),
});



// z.object({}).refine() — standard Zod cross-field validation, no type mismatch
declare const z: {
  object: (shape: Record<string, any>) => {
    refine: (fn: (data: any) => boolean, opts: { message: string; path: string[] }) => any;
  };
  string: () => { min: (n: number) => any };
};

export const ZResetPasswordSchema = z
  .object({
    currentPassword: z.string().min(8),
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
