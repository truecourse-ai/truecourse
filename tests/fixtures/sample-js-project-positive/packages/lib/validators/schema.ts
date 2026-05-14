
// cbb8978483f0: z.object() Zod schema definition with optional fields
declare const z: {
  object: (shape: Record<string, unknown>) => { optional(): unknown; parse(v: unknown): unknown };
  string: () => { optional(): unknown; min(n: number): unknown };
  number: () => { optional(): unknown; int(): unknown };
  boolean: () => { optional(): unknown };
  enum: <T extends [string, ...string[]]>(values: T) => { optional(): unknown };
};

const updateProjectSchema = z.object({
  title: z.string().optional(),
  externalId: z.string().optional(),
  description: z.string().optional(),
  isArchived: z.boolean().optional(),
  priority: z.number().optional(),
});
