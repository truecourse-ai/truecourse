
// FP shape: Zod schema composition with method chaining; no type mismatch
declare const z: {
  object: (shape: Record<string, unknown>) => { parse: (v: unknown) => unknown };
  string: () => { min: (n: number) => unknown; optional: () => unknown };
  number: () => { positive: () => unknown };
  array: (item: unknown) => unknown;
};

const ProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  budget: z.number().positive(),
  tags: z.array(z.string()),
});
