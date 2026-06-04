// `return await foo()` on a call / method chain is the modern preferred
// shape — the await is what makes the stack trace include the current
// function frame and lets errors throw in-frame instead of surfacing as
// unhandled rejections. The rule should only flag the truly redundant
// `return await variableHoldingPromise` shape.

interface QueryClient {
  findMany(args: { where: { orgId: string } }): Promise<{ id: string }[]>;
  findFirst(args: { where: { token: string } }): Promise<{ id: string } | null>;
}

interface Runner {
  x(cmd: string, argv: readonly string[]): Promise<{ stdout: string }>;
}

export async function listInvites(client: QueryClient, orgId: string): Promise<{ id: string }[]> {
  return await client.findMany({ where: { orgId } });
}

export async function findInvite(client: QueryClient, token: string): Promise<{ id: string } | null> {
  return await client.findFirst({ where: { token } });
}

export async function runAddInline(runner: Runner, container: string, src: string, dest: string): Promise<{ stdout: string }> {
  return await runner.x('builder', ['add', container, src, dest]);
}

export async function runPushInline(runner: Runner, imageRef: string): Promise<{ stdout: string }> {
  return await runner.x('builder', ['push', imageRef]);
}
