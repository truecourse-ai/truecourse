
// H40: z.string().trim() — standard Zod schema chain, no type mismatch
declare const z: {
  string(): {
    trim(): { min(n: number, msg: string): { max(n: number, msg: string): unknown } };
    email(msg?: string): { min(n: number, msg: string): unknown };
    uuid(): unknown;
    optional(): unknown;
  };
  object<T extends Record<string, unknown>>(shape: T): unknown;
};

const createTeamSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(64, 'Name too long'),
  slug: z.string().trim().min(2, 'Slug must be at least 2 characters').max(32, 'Slug too long'),
  ownerEmail: z.string().email('Invalid email address').min(5, 'Email too short'),
  parentTeamId: z.string().uuid().optional(),
});
