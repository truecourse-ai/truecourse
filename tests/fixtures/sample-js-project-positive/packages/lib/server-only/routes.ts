
// Shape 70d5e074e526: Hono route definition with validator middleware — standard Hono API, no type mismatch
declare const Hono: new <T>() => { post: <R>(path: string, validator: unknown, handler: (c: T) => Promise<R>) => typeof Hono.prototype };
declare function sValidator(source: string, schema: unknown): unknown;
declare const ZLoginSchema: unknown;
interface AppContext { get: (key: string) => unknown; req: { valid: (source: string) => { email: string; password: string } } }
declare function authenticate(ctx: AppContext): Promise<{ userId: number; token: string }>;

const authRoute = new Hono<AppContext>()
  .post('/login', sValidator('json', ZLoginSchema), async (c) => {
    const { email, password } = c.req.valid('json');
    return await authenticate(c);
  });



// Shape 72a1368e0bb1: tRPC procedure.input().output().mutation() fluent builder chain — correct types, no mismatch
interface ZodSchema { _type: unknown; }
declare const adminProcedure: {
  input: (schema: ZodSchema) => {
    output: (schema: ZodSchema) => {
      mutation: <T>(handler: (opts: { input: unknown; ctx: unknown }) => Promise<T>) => unknown;
    };
  };
};
declare const ZCreateOrgRequestSchema: ZodSchema;
declare const ZCreateOrgResponseSchema: ZodSchema;

export const createOrgRoute = adminProcedure
  .input(ZCreateOrgRequestSchema)
  .output(ZCreateOrgResponseSchema)
  .mutation(async ({ input, ctx }) => {
    return { id: 1, name: 'New Org' };
  });


// Shape: adbe1d540101 — Thin server adapter with many imports + Zod schema validation
// that triggers too-many-lines due to type imports and schema boilerplate.

declare const z: {
  object: (s: Record<string, unknown>) => { parse: (v: unknown) => unknown; safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } };
  string: () => { min: (n: number, msg?: string) => unknown; max: (n: number, msg?: string) => unknown; email: () => unknown; uuid: () => unknown; optional: () => unknown };
  number: () => { int: () => unknown; positive: () => unknown; optional: () => unknown };
  boolean: () => unknown;
  array: (s: unknown) => unknown;
  enum: <T extends [string, ...string[]]>(values: T) => unknown;
  infer: <T>(schema: T) => T;
};
declare function authenticatedProcedure(): {
  meta: (m: unknown) => ReturnType<typeof authenticatedProcedure>;
  input: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  output: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  mutation: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
  query: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
};
declare const prisma: {
  record: {
    findUnique: (opts: unknown) => Promise<unknown>;
    create: (opts: unknown) => Promise<unknown>;
    update: (opts: unknown) => Promise<unknown>;
    delete: (opts: unknown) => Promise<unknown>;
  };
  team: {
    findFirst: (opts: unknown) => Promise<unknown>;
  };
};
declare class AppError extends Error {
  constructor(code: string, opts?: { message?: string; statusCode?: number });
}
declare const AppErrorCode: { NOT_FOUND: string; INVALID_REQUEST: string; FORBIDDEN: string };
declare function getWhereInput(opts: unknown): Promise<{ whereInput: unknown }>;
declare function performServiceOperation(opts: unknown): Promise<unknown>;
declare function checkPermissions(record: unknown, userId: string): { canEdit: boolean; canDelete: boolean; canView: boolean };
declare function getOrganisationClaim(teamId: string): Promise<{ maxItems: number; planTier: string }>;

interface ServerContext {
  user: { id: string; name: string | null; email: string };
  teamId: string | null;
  metadata: Record<string, unknown>;
  logger: { info: (v: unknown) => void; error: (v: unknown) => void; warn: (v: unknown) => void };
}

const ZcreateEnvelopeItemsRequestSchema = z.object({
  recordId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  payload: z.object({
    title: z.string().min(1, "Title is required").max(255),
    description: z.string().max(2000).optional(),
    status: z.enum(["draft", "active", "archived"]),
    metadata: z.object({
      source: z.string().optional(),
      externalId: z.string().optional(),
    }).optional(),
  }),
});

const ZcreateEnvelopeItemsResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

export const createEnvelopeItemsRoute = authenticatedProcedure()
  .meta({ openapi: { method: "POST", path: "/createenvelopeitems" } })
  .input(ZcreateEnvelopeItemsRequestSchema)
  .output(ZcreateEnvelopeItemsResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { user, teamId, metadata } = ctx;
    const { recordId, payload } = input;

    ctx.logger.info({
      input: {
        recordId,
        teamId,
      },
    });

    const { whereInput } = await getWhereInput({
      id: recordId,
      userId: user.id,
      teamId,
    });

    const record = await prisma.record.findUnique({
      where: whereInput,
      include: {
        team: {
          select: {
            organisation: {
              select: { organisationClaim: true },
            },
          },
        },
      },
    });

    if (!record) {
      throw new AppError(AppErrorCode.NOT_FOUND, {
        message: "Record not found",
      });
    }

    const { canEdit } = checkPermissions(record, user.id);

    if (!canEdit) {
      throw new AppError(AppErrorCode.FORBIDDEN, {
        message: "You do not have permission to edit this record",
      });
    }

    const result = await performServiceOperation({
      record,
      payload,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      apiRequestMetadata: metadata,
    });

    return {
      data: result,
    };
  });


// Shape: af7ddc151227 — Thin server adapter with many imports + Zod schema validation
// that triggers too-many-lines due to type imports and schema boilerplate.

declare const z: {
  object: (s: Record<string, unknown>) => { parse: (v: unknown) => unknown; safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } };
  string: () => { min: (n: number, msg?: string) => unknown; max: (n: number, msg?: string) => unknown; email: () => unknown; uuid: () => unknown; optional: () => unknown };
  number: () => { int: () => unknown; positive: () => unknown; optional: () => unknown };
  boolean: () => unknown;
  array: (s: unknown) => unknown;
  enum: <T extends [string, ...string[]]>(values: T) => unknown;
  infer: <T>(schema: T) => T;
};
declare function authenticatedProcedure(): {
  meta: (m: unknown) => ReturnType<typeof authenticatedProcedure>;
  input: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  output: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  mutation: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
  query: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
};
declare const prisma: {
  record: {
    findUnique: (opts: unknown) => Promise<unknown>;
    create: (opts: unknown) => Promise<unknown>;
    update: (opts: unknown) => Promise<unknown>;
    delete: (opts: unknown) => Promise<unknown>;
  };
  team: {
    findFirst: (opts: unknown) => Promise<unknown>;
  };
};
declare class AppError extends Error {
  constructor(code: string, opts?: { message?: string; statusCode?: number });
}
declare const AppErrorCode: { NOT_FOUND: string; INVALID_REQUEST: string; FORBIDDEN: string };
declare function getWhereInput(opts: unknown): Promise<{ whereInput: unknown }>;
declare function performServiceOperation(opts: unknown): Promise<unknown>;
declare function checkPermissions(record: unknown, userId: string): { canEdit: boolean; canDelete: boolean; canView: boolean };
declare function getOrganisationClaim(teamId: string): Promise<{ maxItems: number; planTier: string }>;

interface ServerContext {
  user: { id: string; name: string | null; email: string };
  teamId: string | null;
  metadata: Record<string, unknown>;
  logger: { info: (v: unknown) => void; error: (v: unknown) => void; warn: (v: unknown) => void };
}

const ZgetRecipientSuggestionsRequestSchema = z.object({
  recordId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  payload: z.object({
    title: z.string().min(1, "Title is required").max(255),
    description: z.string().max(2000).optional(),
    status: z.enum(["draft", "active", "archived"]),
    metadata: z.object({
      source: z.string().optional(),
      externalId: z.string().optional(),
    }).optional(),
  }),
});

const ZgetRecipientSuggestionsResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

export const getRecipientSuggestionsRoute = authenticatedProcedure()
  .meta({ openapi: { method: "POST", path: "/getrecipientsuggestions" } })
  .input(ZgetRecipientSuggestionsRequestSchema)
  .output(ZgetRecipientSuggestionsResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { user, teamId, metadata } = ctx;
    const { recordId, payload } = input;

    ctx.logger.info({
      input: {
        recordId,
        teamId,
      },
    });

    const { whereInput } = await getWhereInput({
      id: recordId,
      userId: user.id,
      teamId,
    });

    const record = await prisma.record.findUnique({
      where: whereInput,
      include: {
        team: {
          select: {
            organisation: {
              select: { organisationClaim: true },
            },
          },
        },
      },
    });

    if (!record) {
      throw new AppError(AppErrorCode.NOT_FOUND, {
        message: "Record not found",
      });
    }

    const { canEdit } = checkPermissions(record, user.id);

    if (!canEdit) {
      throw new AppError(AppErrorCode.FORBIDDEN, {
        message: "You do not have permission to edit this record",
      });
    }

    const result = await performServiceOperation({
      record,
      payload,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      apiRequestMetadata: metadata,
    });

    return {
      data: result,
    };
  });


// Shape: afa700308b7a — Thin server adapter with many imports + Zod schema validation
// that triggers too-many-lines due to type imports and schema boilerplate.

declare const z: {
  object: (s: Record<string, unknown>) => { parse: (v: unknown) => unknown; safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } };
  string: () => { min: (n: number, msg?: string) => unknown; max: (n: number, msg?: string) => unknown; email: () => unknown; uuid: () => unknown; optional: () => unknown };
  number: () => { int: () => unknown; positive: () => unknown; optional: () => unknown };
  boolean: () => unknown;
  array: (s: unknown) => unknown;
  enum: <T extends [string, ...string[]]>(values: T) => unknown;
  infer: <T>(schema: T) => T;
};
declare function authenticatedProcedure(): {
  meta: (m: unknown) => ReturnType<typeof authenticatedProcedure>;
  input: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  output: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  mutation: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
  query: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
};
declare const prisma: {
  record: {
    findUnique: (opts: unknown) => Promise<unknown>;
    create: (opts: unknown) => Promise<unknown>;
    update: (opts: unknown) => Promise<unknown>;
    delete: (opts: unknown) => Promise<unknown>;
  };
  team: {
    findFirst: (opts: unknown) => Promise<unknown>;
  };
};
declare class AppError extends Error {
  constructor(code: string, opts?: { message?: string; statusCode?: number });
}
declare const AppErrorCode: { NOT_FOUND: string; INVALID_REQUEST: string; FORBIDDEN: string };
declare function getWhereInput(opts: unknown): Promise<{ whereInput: unknown }>;
declare function performServiceOperation(opts: unknown): Promise<unknown>;
declare function checkPermissions(record: unknown, userId: string): { canEdit: boolean; canDelete: boolean; canView: boolean };
declare function getOrganisationClaim(teamId: string): Promise<{ maxItems: number; planTier: string }>;

interface ServerContext {
  user: { id: string; name: string | null; email: string };
  teamId: string | null;
  metadata: Record<string, unknown>;
  logger: { info: (v: unknown) => void; error: (v: unknown) => void; warn: (v: unknown) => void };
}

const ZupdateDocumentSettingsRequestSchema = z.object({
  recordId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  payload: z.object({
    title: z.string().min(1, "Title is required").max(255),
    description: z.string().max(2000).optional(),
    status: z.enum(["draft", "active", "archived"]),
    metadata: z.object({
      source: z.string().optional(),
      externalId: z.string().optional(),
    }).optional(),
  }),
});

const ZupdateDocumentSettingsResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

export const updateDocumentSettingsRoute = authenticatedProcedure()
  .meta({ openapi: { method: "POST", path: "/updatedocumentsettings" } })
  .input(ZupdateDocumentSettingsRequestSchema)
  .output(ZupdateDocumentSettingsResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { user, teamId, metadata } = ctx;
    const { recordId, payload } = input;

    ctx.logger.info({
      input: {
        recordId,
        teamId,
      },
    });

    const { whereInput } = await getWhereInput({
      id: recordId,
      userId: user.id,
      teamId,
    });

    const record = await prisma.record.findUnique({
      where: whereInput,
      include: {
        team: {
          select: {
            organisation: {
              select: { organisationClaim: true },
            },
          },
        },
      },
    });

    if (!record) {
      throw new AppError(AppErrorCode.NOT_FOUND, {
        message: "Record not found",
      });
    }

    const { canEdit } = checkPermissions(record, user.id);

    if (!canEdit) {
      throw new AppError(AppErrorCode.FORBIDDEN, {
        message: "You do not have permission to edit this record",
      });
    }

    const result = await performServiceOperation({
      record,
      payload,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      apiRequestMetadata: metadata,
    });

    return {
      data: result,
    };
  });


// Shape: b9c1988478a2 — Thin server adapter with many imports + Zod schema validation
// that triggers too-many-lines due to type imports and schema boilerplate.

declare const z: {
  object: (s: Record<string, unknown>) => { parse: (v: unknown) => unknown; safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } };
  string: () => { min: (n: number, msg?: string) => unknown; max: (n: number, msg?: string) => unknown; email: () => unknown; uuid: () => unknown; optional: () => unknown };
  number: () => { int: () => unknown; positive: () => unknown; optional: () => unknown };
  boolean: () => unknown;
  array: (s: unknown) => unknown;
  enum: <T extends [string, ...string[]]>(values: T) => unknown;
  infer: <T>(schema: T) => T;
};
declare function authenticatedProcedure(): {
  meta: (m: unknown) => ReturnType<typeof authenticatedProcedure>;
  input: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  output: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  mutation: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
  query: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
};
declare const prisma: {
  record: {
    findUnique: (opts: unknown) => Promise<unknown>;
    create: (opts: unknown) => Promise<unknown>;
    update: (opts: unknown) => Promise<unknown>;
    delete: (opts: unknown) => Promise<unknown>;
  };
  team: {
    findFirst: (opts: unknown) => Promise<unknown>;
  };
};
declare class AppError extends Error {
  constructor(code: string, opts?: { message?: string; statusCode?: number });
}
declare const AppErrorCode: { NOT_FOUND: string; INVALID_REQUEST: string; FORBIDDEN: string };
declare function getWhereInput(opts: unknown): Promise<{ whereInput: unknown }>;
declare function performServiceOperation(opts: unknown): Promise<unknown>;
declare function checkPermissions(record: unknown, userId: string): { canEdit: boolean; canDelete: boolean; canView: boolean };
declare function getOrganisationClaim(teamId: string): Promise<{ maxItems: number; planTier: string }>;

interface ServerContext {
  user: { id: string; name: string | null; email: string };
  teamId: string | null;
  metadata: Record<string, unknown>;
  logger: { info: (v: unknown) => void; error: (v: unknown) => void; warn: (v: unknown) => void };
}

const ZdeleteTeamMemberRequestSchema = z.object({
  recordId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  payload: z.object({
    title: z.string().min(1, "Title is required").max(255),
    description: z.string().max(2000).optional(),
    status: z.enum(["draft", "active", "archived"]),
    metadata: z.object({
      source: z.string().optional(),
      externalId: z.string().optional(),
    }).optional(),
  }),
});

const ZdeleteTeamMemberResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

export const deleteTeamMemberRoute = authenticatedProcedure()
  .meta({ openapi: { method: "POST", path: "/deleteteammember" } })
  .input(ZdeleteTeamMemberRequestSchema)
  .output(ZdeleteTeamMemberResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { user, teamId, metadata } = ctx;
    const { recordId, payload } = input;

    ctx.logger.info({
      input: {
        recordId,
        teamId,
      },
    });

    const { whereInput } = await getWhereInput({
      id: recordId,
      userId: user.id,
      teamId,
    });

    const record = await prisma.record.findUnique({
      where: whereInput,
      include: {
        team: {
          select: {
            organisation: {
              select: { organisationClaim: true },
            },
          },
        },
      },
    });

    if (!record) {
      throw new AppError(AppErrorCode.NOT_FOUND, {
        message: "Record not found",
      });
    }

    const { canEdit } = checkPermissions(record, user.id);

    if (!canEdit) {
      throw new AppError(AppErrorCode.FORBIDDEN, {
        message: "You do not have permission to edit this record",
      });
    }

    const result = await performServiceOperation({
      record,
      payload,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      apiRequestMetadata: metadata,
    });

    return {
      data: result,
    };
  });


// Shape: bb982606c352 — Thin server adapter with many imports + Zod schema validation
// that triggers too-many-lines due to type imports and schema boilerplate.

declare const z: {
  object: (s: Record<string, unknown>) => { parse: (v: unknown) => unknown; safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } };
  string: () => { min: (n: number, msg?: string) => unknown; max: (n: number, msg?: string) => unknown; email: () => unknown; uuid: () => unknown; optional: () => unknown };
  number: () => { int: () => unknown; positive: () => unknown; optional: () => unknown };
  boolean: () => unknown;
  array: (s: unknown) => unknown;
  enum: <T extends [string, ...string[]]>(values: T) => unknown;
  infer: <T>(schema: T) => T;
};
declare function authenticatedProcedure(): {
  meta: (m: unknown) => ReturnType<typeof authenticatedProcedure>;
  input: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  output: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  mutation: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
  query: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
};
declare const prisma: {
  record: {
    findUnique: (opts: unknown) => Promise<unknown>;
    create: (opts: unknown) => Promise<unknown>;
    update: (opts: unknown) => Promise<unknown>;
    delete: (opts: unknown) => Promise<unknown>;
  };
  team: {
    findFirst: (opts: unknown) => Promise<unknown>;
  };
};
declare class AppError extends Error {
  constructor(code: string, opts?: { message?: string; statusCode?: number });
}
declare const AppErrorCode: { NOT_FOUND: string; INVALID_REQUEST: string; FORBIDDEN: string };
declare function getWhereInput(opts: unknown): Promise<{ whereInput: unknown }>;
declare function performServiceOperation(opts: unknown): Promise<unknown>;
declare function checkPermissions(record: unknown, userId: string): { canEdit: boolean; canDelete: boolean; canView: boolean };
declare function getOrganisationClaim(teamId: string): Promise<{ maxItems: number; planTier: string }>;

interface ServerContext {
  user: { id: string; name: string | null; email: string };
  teamId: string | null;
  metadata: Record<string, unknown>;
  logger: { info: (v: unknown) => void; error: (v: unknown) => void; warn: (v: unknown) => void };
}

const ZinviteOrganisationMemberRequestSchema = z.object({
  recordId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  payload: z.object({
    title: z.string().min(1, "Title is required").max(255),
    description: z.string().max(2000).optional(),
    status: z.enum(["draft", "active", "archived"]),
    metadata: z.object({
      source: z.string().optional(),
      externalId: z.string().optional(),
    }).optional(),
  }),
});

const ZinviteOrganisationMemberResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

export const inviteOrganisationMemberRoute = authenticatedProcedure()
  .meta({ openapi: { method: "POST", path: "/inviteorganisationmember" } })
  .input(ZinviteOrganisationMemberRequestSchema)
  .output(ZinviteOrganisationMemberResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { user, teamId, metadata } = ctx;
    const { recordId, payload } = input;

    ctx.logger.info({
      input: {
        recordId,
        teamId,
      },
    });

    const { whereInput } = await getWhereInput({
      id: recordId,
      userId: user.id,
      teamId,
    });

    const record = await prisma.record.findUnique({
      where: whereInput,
      include: {
        team: {
          select: {
            organisation: {
              select: { organisationClaim: true },
            },
          },
        },
      },
    });

    if (!record) {
      throw new AppError(AppErrorCode.NOT_FOUND, {
        message: "Record not found",
      });
    }

    const { canEdit } = checkPermissions(record, user.id);

    if (!canEdit) {
      throw new AppError(AppErrorCode.FORBIDDEN, {
        message: "You do not have permission to edit this record",
      });
    }

    const result = await performServiceOperation({
      record,
      payload,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      apiRequestMetadata: metadata,
    });

    return {
      data: result,
    };
  });


// Shape: c22df3df927b — Thin server adapter with many imports + Zod schema validation
// that triggers too-many-lines due to type imports and schema boilerplate.

declare const z: {
  object: (s: Record<string, unknown>) => { parse: (v: unknown) => unknown; safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } };
  string: () => { min: (n: number, msg?: string) => unknown; max: (n: number, msg?: string) => unknown; email: () => unknown; uuid: () => unknown; optional: () => unknown };
  number: () => { int: () => unknown; positive: () => unknown; optional: () => unknown };
  boolean: () => unknown;
  array: (s: unknown) => unknown;
  enum: <T extends [string, ...string[]]>(values: T) => unknown;
  infer: <T>(schema: T) => T;
};
declare function authenticatedProcedure(): {
  meta: (m: unknown) => ReturnType<typeof authenticatedProcedure>;
  input: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  output: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  mutation: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
  query: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
};
declare const prisma: {
  record: {
    findUnique: (opts: unknown) => Promise<unknown>;
    create: (opts: unknown) => Promise<unknown>;
    update: (opts: unknown) => Promise<unknown>;
    delete: (opts: unknown) => Promise<unknown>;
  };
  team: {
    findFirst: (opts: unknown) => Promise<unknown>;
  };
};
declare class AppError extends Error {
  constructor(code: string, opts?: { message?: string; statusCode?: number });
}
declare const AppErrorCode: { NOT_FOUND: string; INVALID_REQUEST: string; FORBIDDEN: string };
declare function getWhereInput(opts: unknown): Promise<{ whereInput: unknown }>;
declare function performServiceOperation(opts: unknown): Promise<unknown>;
declare function checkPermissions(record: unknown, userId: string): { canEdit: boolean; canDelete: boolean; canView: boolean };
declare function getOrganisationClaim(teamId: string): Promise<{ maxItems: number; planTier: string }>;

interface ServerContext {
  user: { id: string; name: string | null; email: string };
  teamId: string | null;
  metadata: Record<string, unknown>;
  logger: { info: (v: unknown) => void; error: (v: unknown) => void; warn: (v: unknown) => void };
}

const ZresendVerificationEmailRequestSchema = z.object({
  recordId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  payload: z.object({
    title: z.string().min(1, "Title is required").max(255),
    description: z.string().max(2000).optional(),
    status: z.enum(["draft", "active", "archived"]),
    metadata: z.object({
      source: z.string().optional(),
      externalId: z.string().optional(),
    }).optional(),
  }),
});

const ZresendVerificationEmailResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

export const resendVerificationEmailRoute = authenticatedProcedure()
  .meta({ openapi: { method: "POST", path: "/resendverificationemail" } })
  .input(ZresendVerificationEmailRequestSchema)
  .output(ZresendVerificationEmailResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { user, teamId, metadata } = ctx;
    const { recordId, payload } = input;

    ctx.logger.info({
      input: {
        recordId,
        teamId,
      },
    });

    const { whereInput } = await getWhereInput({
      id: recordId,
      userId: user.id,
      teamId,
    });

    const record = await prisma.record.findUnique({
      where: whereInput,
      include: {
        team: {
          select: {
            organisation: {
              select: { organisationClaim: true },
            },
          },
        },
      },
    });

    if (!record) {
      throw new AppError(AppErrorCode.NOT_FOUND, {
        message: "Record not found",
      });
    }

    const { canEdit } = checkPermissions(record, user.id);

    if (!canEdit) {
      throw new AppError(AppErrorCode.FORBIDDEN, {
        message: "You do not have permission to edit this record",
      });
    }

    const result = await performServiceOperation({
      record,
      payload,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      apiRequestMetadata: metadata,
    });

    return {
      data: result,
    };
  });


// Shape: c8267a7e76fb — Thin server adapter with many imports + Zod schema validation
// that triggers too-many-lines due to type imports and schema boilerplate.

declare const z: {
  object: (s: Record<string, unknown>) => { parse: (v: unknown) => unknown; safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } };
  string: () => { min: (n: number, msg?: string) => unknown; max: (n: number, msg?: string) => unknown; email: () => unknown; uuid: () => unknown; optional: () => unknown };
  number: () => { int: () => unknown; positive: () => unknown; optional: () => unknown };
  boolean: () => unknown;
  array: (s: unknown) => unknown;
  enum: <T extends [string, ...string[]]>(values: T) => unknown;
  infer: <T>(schema: T) => T;
};
declare function authenticatedProcedure(): {
  meta: (m: unknown) => ReturnType<typeof authenticatedProcedure>;
  input: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  output: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  mutation: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
  query: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
};
declare const prisma: {
  record: {
    findUnique: (opts: unknown) => Promise<unknown>;
    create: (opts: unknown) => Promise<unknown>;
    update: (opts: unknown) => Promise<unknown>;
    delete: (opts: unknown) => Promise<unknown>;
  };
  team: {
    findFirst: (opts: unknown) => Promise<unknown>;
  };
};
declare class AppError extends Error {
  constructor(code: string, opts?: { message?: string; statusCode?: number });
}
declare const AppErrorCode: { NOT_FOUND: string; INVALID_REQUEST: string; FORBIDDEN: string };
declare function getWhereInput(opts: unknown): Promise<{ whereInput: unknown }>;
declare function performServiceOperation(opts: unknown): Promise<unknown>;
declare function checkPermissions(record: unknown, userId: string): { canEdit: boolean; canDelete: boolean; canView: boolean };
declare function getOrganisationClaim(teamId: string): Promise<{ maxItems: number; planTier: string }>;

interface ServerContext {
  user: { id: string; name: string | null; email: string };
  teamId: string | null;
  metadata: Record<string, unknown>;
  logger: { info: (v: unknown) => void; error: (v: unknown) => void; warn: (v: unknown) => void };
}

const ZdownloadDocumentCertificateRequestSchema = z.object({
  recordId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  payload: z.object({
    title: z.string().min(1, "Title is required").max(255),
    description: z.string().max(2000).optional(),
    status: z.enum(["draft", "active", "archived"]),
    metadata: z.object({
      source: z.string().optional(),
      externalId: z.string().optional(),
    }).optional(),
  }),
});

const ZdownloadDocumentCertificateResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

export const downloadDocumentCertificateRoute = authenticatedProcedure()
  .meta({ openapi: { method: "POST", path: "/downloaddocumentcertificate" } })
  .input(ZdownloadDocumentCertificateRequestSchema)
  .output(ZdownloadDocumentCertificateResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { user, teamId, metadata } = ctx;
    const { recordId, payload } = input;

    ctx.logger.info({
      input: {
        recordId,
        teamId,
      },
    });

    const { whereInput } = await getWhereInput({
      id: recordId,
      userId: user.id,
      teamId,
    });

    const record = await prisma.record.findUnique({
      where: whereInput,
      include: {
        team: {
          select: {
            organisation: {
              select: { organisationClaim: true },
            },
          },
        },
      },
    });

    if (!record) {
      throw new AppError(AppErrorCode.NOT_FOUND, {
        message: "Record not found",
      });
    }

    const { canEdit } = checkPermissions(record, user.id);

    if (!canEdit) {
      throw new AppError(AppErrorCode.FORBIDDEN, {
        message: "You do not have permission to edit this record",
      });
    }

    const result = await performServiceOperation({
      record,
      payload,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      apiRequestMetadata: metadata,
    });

    return {
      data: result,
    };
  });


// Shape: cb5a6ce71b9e — Thin server adapter with many imports + Zod schema validation
// that triggers too-many-lines due to type imports and schema boilerplate.

declare const z: {
  object: (s: Record<string, unknown>) => { parse: (v: unknown) => unknown; safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } };
  string: () => { min: (n: number, msg?: string) => unknown; max: (n: number, msg?: string) => unknown; email: () => unknown; uuid: () => unknown; optional: () => unknown };
  number: () => { int: () => unknown; positive: () => unknown; optional: () => unknown };
  boolean: () => unknown;
  array: (s: unknown) => unknown;
  enum: <T extends [string, ...string[]]>(values: T) => unknown;
  infer: <T>(schema: T) => T;
};
declare function authenticatedProcedure(): {
  meta: (m: unknown) => ReturnType<typeof authenticatedProcedure>;
  input: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  output: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  mutation: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
  query: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
};
declare const prisma: {
  record: {
    findUnique: (opts: unknown) => Promise<unknown>;
    create: (opts: unknown) => Promise<unknown>;
    update: (opts: unknown) => Promise<unknown>;
    delete: (opts: unknown) => Promise<unknown>;
  };
  team: {
    findFirst: (opts: unknown) => Promise<unknown>;
  };
};
declare class AppError extends Error {
  constructor(code: string, opts?: { message?: string; statusCode?: number });
}
declare const AppErrorCode: { NOT_FOUND: string; INVALID_REQUEST: string; FORBIDDEN: string };
declare function getWhereInput(opts: unknown): Promise<{ whereInput: unknown }>;
declare function performServiceOperation(opts: unknown): Promise<unknown>;
declare function checkPermissions(record: unknown, userId: string): { canEdit: boolean; canDelete: boolean; canView: boolean };
declare function getOrganisationClaim(teamId: string): Promise<{ maxItems: number; planTier: string }>;

interface ServerContext {
  user: { id: string; name: string | null; email: string };
  teamId: string | null;
  metadata: Record<string, unknown>;
  logger: { info: (v: unknown) => void; error: (v: unknown) => void; warn: (v: unknown) => void };
}

const ZgetInternalClaimPlansRequestSchema = z.object({
  recordId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  payload: z.object({
    title: z.string().min(1, "Title is required").max(255),
    description: z.string().max(2000).optional(),
    status: z.enum(["draft", "active", "archived"]),
    metadata: z.object({
      source: z.string().optional(),
      externalId: z.string().optional(),
    }).optional(),
  }),
});

const ZgetInternalClaimPlansResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

export const getInternalClaimPlansRoute = authenticatedProcedure()
  .meta({ openapi: { method: "POST", path: "/getinternalclaimplans" } })
  .input(ZgetInternalClaimPlansRequestSchema)
  .output(ZgetInternalClaimPlansResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { user, teamId, metadata } = ctx;
    const { recordId, payload } = input;

    ctx.logger.info({
      input: {
        recordId,
        teamId,
      },
    });

    const { whereInput } = await getWhereInput({
      id: recordId,
      userId: user.id,
      teamId,
    });

    const record = await prisma.record.findUnique({
      where: whereInput,
      include: {
        team: {
          select: {
            organisation: {
              select: { organisationClaim: true },
            },
          },
        },
      },
    });

    if (!record) {
      throw new AppError(AppErrorCode.NOT_FOUND, {
        message: "Record not found",
      });
    }

    const { canEdit } = checkPermissions(record, user.id);

    if (!canEdit) {
      throw new AppError(AppErrorCode.FORBIDDEN, {
        message: "You do not have permission to edit this record",
      });
    }

    const result = await performServiceOperation({
      record,
      payload,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      apiRequestMetadata: metadata,
    });

    return {
      data: result,
    };
  });


// Shape: ce7e5cbaa0a3 — Thin server adapter with many imports + Zod schema validation
// that triggers too-many-lines due to type imports and schema boilerplate.

declare const z: {
  object: (s: Record<string, unknown>) => { parse: (v: unknown) => unknown; safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } };
  string: () => { min: (n: number, msg?: string) => unknown; max: (n: number, msg?: string) => unknown; email: () => unknown; uuid: () => unknown; optional: () => unknown };
  number: () => { int: () => unknown; positive: () => unknown; optional: () => unknown };
  boolean: () => unknown;
  array: (s: unknown) => unknown;
  enum: <T extends [string, ...string[]]>(values: T) => unknown;
  infer: <T>(schema: T) => T;
};
declare function authenticatedProcedure(): {
  meta: (m: unknown) => ReturnType<typeof authenticatedProcedure>;
  input: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  output: (s: unknown) => ReturnType<typeof authenticatedProcedure>;
  mutation: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
  query: (fn: (opts: { input: unknown; ctx: ServerContext }) => Promise<unknown>) => unknown;
};
declare const prisma: {
  record: {
    findUnique: (opts: unknown) => Promise<unknown>;
    create: (opts: unknown) => Promise<unknown>;
    update: (opts: unknown) => Promise<unknown>;
    delete: (opts: unknown) => Promise<unknown>;
  };
  team: {
    findFirst: (opts: unknown) => Promise<unknown>;
  };
};
declare class AppError extends Error {
  constructor(code: string, opts?: { message?: string; statusCode?: number });
}
declare const AppErrorCode: { NOT_FOUND: string; INVALID_REQUEST: string; FORBIDDEN: string };
declare function getWhereInput(opts: unknown): Promise<{ whereInput: unknown }>;
declare function performServiceOperation(opts: unknown): Promise<unknown>;
declare function checkPermissions(record: unknown, userId: string): { canEdit: boolean; canDelete: boolean; canView: boolean };
declare function getOrganisationClaim(teamId: string): Promise<{ maxItems: number; planTier: string }>;

interface ServerContext {
  user: { id: string; name: string | null; email: string };
  teamId: string | null;
  metadata: Record<string, unknown>;
  logger: { info: (v: unknown) => void; error: (v: unknown) => void; warn: (v: unknown) => void };
}

const ZcreateSignatureFieldRequestSchema = z.object({
  recordId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  payload: z.object({
    title: z.string().min(1, "Title is required").max(255),
    description: z.string().max(2000).optional(),
    status: z.enum(["draft", "active", "archived"]),
    metadata: z.object({
      source: z.string().optional(),
      externalId: z.string().optional(),
    }).optional(),
  }),
});

const ZcreateSignatureFieldResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

export const createSignatureFieldRoute = authenticatedProcedure()
  .meta({ openapi: { method: "POST", path: "/createsignaturefield" } })
  .input(ZcreateSignatureFieldRequestSchema)
  .output(ZcreateSignatureFieldResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { user, teamId, metadata } = ctx;
    const { recordId, payload } = input;

    ctx.logger.info({
      input: {
        recordId,
        teamId,
      },
    });

    const { whereInput } = await getWhereInput({
      id: recordId,
      userId: user.id,
      teamId,
    });

    const record = await prisma.record.findUnique({
      where: whereInput,
      include: {
        team: {
          select: {
            organisation: {
              select: { organisationClaim: true },
            },
          },
        },
      },
    });

    if (!record) {
      throw new AppError(AppErrorCode.NOT_FOUND, {
        message: "Record not found",
      });
    }

    const { canEdit } = checkPermissions(record, user.id);

    if (!canEdit) {
      throw new AppError(AppErrorCode.FORBIDDEN, {
        message: "You do not have permission to edit this record",
      });
    }

    const result = await performServiceOperation({
      record,
      payload,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      apiRequestMetadata: metadata,
    });

    return {
      data: result,
    };
  });
