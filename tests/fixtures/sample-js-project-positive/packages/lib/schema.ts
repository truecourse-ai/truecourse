
// --- FP shape: zod nested schema definition z.array(z.object()) ---
declare const z: {
  array<T>(schema: T): T;
  object<S extends Record<string, unknown>>(shape: S): S;
  string(): { optional(): unknown };
  number(): unknown;
};

const recipientsSchema = z.array(
  z.object({
    id: z.number(),
    email: z.string().optional(),
    name: z.string().optional(),
  }),
);



// --- FP shape: zod-form-data refine with file.size check ---
declare const zfd: {
  file(): {
    refine(
      check: (file: { size: number; type: string }) => boolean,
      message: string,
    ): unknown;
  };
};

const fileSchema = zfd
  .file()
  .refine((file) => file.size <= 5 * 1024 * 1024, 'File must be 5MB or less');



// --- FP shape: zod refine with length check or regex test ---
declare const z2: {
  string(): {
    min(n: number): {
      refine(check: (value: string) => boolean, message: string): unknown;
    };
  };
};

const passwordSchema = z2
  .string()
  .min(8)
  .refine(
    (value) => value.length > 25 || /\d/.test(value),
    'Password must be longer than 25 characters or contain a number',
  );
