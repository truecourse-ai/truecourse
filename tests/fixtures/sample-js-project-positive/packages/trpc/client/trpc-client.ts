// Single tRPC client checks typeof id === 'string' — standalone type check, not extractable
declare function createTRPCClient(config: {
  transformer?: unknown;
  headers?: () => Record<string, string>;
}): unknown;

function buildClientHeaders(teamId?: string | number) {
  return {
    ...(typeof teamId === 'string' ? { 'x-team-id': teamId } : {}),
    'content-type': 'application/json',
  };
}



// --- FP shape: tRPC errorFormatter callback; type constrained by outer API, return type inferred from returned shape ---
declare function initTRPC(): { create(opts: { errorFormatter(opts: { shape: { data: Record<string, unknown>; code: string }; error: { cause?: unknown; message: string } }): unknown }): unknown };

const tRPC = initTRPC();
tRPC.create({
  errorFormatter(opts) {
    const { shape, error } = opts;
    const originalError = error.cause;
    const data: Record<string, unknown> = shape.data;

    return {
      ...shape,
      data: {
        ...data,
        originalError: originalError instanceof Error ? originalError.message : undefined,
      },
    };
  },
});
