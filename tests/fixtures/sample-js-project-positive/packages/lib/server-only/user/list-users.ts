// list-users.ts — thin server adapter: validates input, calls service
// Line count inflated by type imports and schema boilerplate.

declare const z: {
  object: (shape: Record<string, unknown>) => ZodObj2;
  string: () => ZodStr2;
  number: () => ZodNum2;
  enum: (values: string[]) => ZodEnm2;
  optional: (s: unknown) => ZodOpt2;
  array: (s: unknown) => ZodArr2;
};
declare class ZodObj2 { parse(v: unknown): unknown; }
declare class ZodStr2 { parse(v: unknown): string; optional(): ZodOpt2; }
declare class ZodNum2 { parse(v: unknown): number; int(): ZodNum2; min(n: number): ZodNum2; max(n: number): ZodNum2; optional(): ZodOpt2; }
declare class ZodEnm2 { parse(v: unknown): string; }
declare class ZodOpt2 { parse(v: unknown): unknown; }
declare class ZodArr2 { parse(v: unknown): unknown[]; }

declare const prisma: {
  user: {
    findMany: (opts: { where?: Record<string, unknown>; skip?: number; take?: number; orderBy?: unknown; select?: unknown }) => Promise<UserSummary[]>;
    count: (opts: { where?: Record<string, unknown> }) => Promise<number>;
  };
};

type UserSummary = {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
  role: string;
};

type ListUsersInput = {
  page?: number;
  perPage?: number;
  search?: string;
  role?: string;
  orderBy?: 'name' | 'email' | 'createdAt';
  orderDir?: 'asc' | 'desc';
};

type ListUsersOutput = {
  users: UserSummary[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

const ZListUsersInputSchema = z.object({
  page: z.optional(z.number()),
  perPage: z.optional(z.number()),
  search: z.optional(z.string()),
  role: z.optional(z.string()),
  orderBy: z.optional(z.enum(['name', 'email', 'createdAt'])),
  orderDir: z.optional(z.enum(['asc', 'desc'])),
});

export async function listAllUsers(rawInput: unknown): Promise<ListUsersOutput> {
  const { page = 1, perPage = 20, search, role, orderBy = 'createdAt', orderDir = 'desc' } =
    ZListUsersInputSchema.parse(rawInput) as ListUsersInput;

  const where: Record<string, unknown> = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (role) where.role = role;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { [orderBy]: orderDir } as unknown,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    users,
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  };
}
