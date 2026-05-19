// Paraphrased from documenso/documenso tRPC routes
// (packages/trpc/server/.../*-router/* — many examples).
//
// A tRPC procedure handler receives `{ input, ctx }` via destructuring. `ctx`
// here is a tRPC procedure context (db client, logged-in user, etc.) — it is
// NOT an HTTP request object even though the name overlaps with Koa's `ctx`.
// References to `ctx` from the destructured object pattern must not be treated
// as user input, otherwise every Prisma call inside the handler trips the rule.
// `.input(...)` validates the input via Zod before the handler ever runs.

type ProcedureContext = {
  user: { id: string };
  logger: { info: (x: unknown) => void };
};

type Input = { organisationId: string; teamId: string };

declare const prisma: {
  organisation: {
    findFirst: (args: unknown) => Promise<{ id: string; ownerId: string } | null>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
};

declare const adminProcedure: {
  input: (schema: unknown) => {
    query: (cb: (args: { input: Input; ctx: ProcedureContext }) => Promise<unknown>) => unknown;
    mutation: (cb: (args: { input: Input; ctx: ProcedureContext }) => Promise<unknown>) => unknown;
  };
};

declare const ZGetOrgRequestSchema: unknown;

export const getOrganisationRoute = adminProcedure.input(ZGetOrgRequestSchema).query(
  async ({ input, ctx }) => {
    const { organisationId } = input;
    const { user } = ctx;

    ctx.logger.info({ input: { organisationId } });

    const org = await prisma.organisation.findFirst({
      where: { id: organisationId, ownerId: user.id },
    });

    if (!org) return null;

    await prisma.organisation.update({
      where: { id: org.id },
      data: { ownerId: user.id },
    });

    return org;
  },
);
