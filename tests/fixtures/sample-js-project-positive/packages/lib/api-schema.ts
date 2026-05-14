
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


// hardcoded-url FP: URL inside OpenAPI spec description string — documentation text embedded in spec, not a runtime endpoint
const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'TrueCourse Public API',
    version: '1.0.0',
    description:
      'Full REST API reference for TrueCourse. Interactive playground: https://api.truecourse.io/docs.',
  },
  servers: [{ url: '/api/v1' }],
  paths: {} as Record<string, unknown>,
};

