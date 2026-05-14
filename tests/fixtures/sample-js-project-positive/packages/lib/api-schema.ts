
declare const z: {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => { optional: () => unknown; default: (v: string) => unknown };
  nativeEnum: (e: object) => { optional: () => unknown };
  boolean: () => { optional: () => unknown; default: (v: boolean) => unknown };
  union: (members: unknown[]) => { transform: (fn: (v: unknown) => unknown) => unknown };
  array: (inner: unknown) => unknown;
};

enum AccessLevel { READ = 'READ', WRITE = 'WRITE', ADMIN = 'ADMIN' }
enum ActionType { VIEW = 'VIEW', EDIT = 'EDIT', DELETE = 'DELETE' }

const ZCreateResourceRequestSchema = z.object({
  title: z.string().default(''),
  accessLevel: z.nativeEnum(AccessLevel).optional(),
  actionTypes: z
    .union([z.nativeEnum(ActionType), z.array(z.nativeEnum(ActionType))])
    .transform((val) => (Array.isArray(val) ? val : [val])),
  isPublic: z.boolean().optional().default(false),
});
