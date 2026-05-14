// Request-boundary context factory for the API gateway — builds the per-request
// context that tRPC / Hono procedures receive. This is an API-layer entry point,
// not a data-layer module.

declare function getOptionalSession(c: GatewayEnv): Promise<{ session: AppSession | null; user: AuthUser | null }>;
declare function generateRequestId(): string;

type GatewayEnv = {
  req: { raw: Request; headers: { get(name: string): string | null } };
  res: Response;
  get(key: string): { requestMetadata: RequestMetadata };
};

type RequestMetadata = {
  ipAddress: string;
  userAgent: string;
};

type AppSession = {
  id: string;
  expiresAt: Date;
};

type AuthUser = {
  id: string;
  email: string;
  role: string;
};

type GatewayContext = ({
  session: null;
  user: null;
} | {
  session: AppSession;
  user: AuthUser;
}) & {
  requestId: string;
  teamId: number | undefined;
  req: Request;
  res: Response;
  metadata: RequestMetadata;
};

type CreateGatewayContextOptions = {
  c: GatewayEnv;
  requestSource: 'app' | 'apiV1' | 'apiV2';
};

export const createGatewayContext = async ({
  c,
  requestSource: _requestSource,
}: CreateGatewayContextOptions): Promise<GatewayContext> => {
  const { session, user } = await getOptionalSession(c);

  const req = c.req.raw;
  const res = c.res;
  const requestMetadata = c.get('context').requestMetadata;

  const rawTeamId = c.req.headers.get('x-team-id') || undefined;
  const teamId = rawTeamId !== undefined ? parseInt(rawTeamId, 10) || undefined : undefined;
  const requestId = generateRequestId();

  if (!session || !user) {
    return {
      requestId,
      session: null,
      user: null,
      teamId,
      req,
      res,
      metadata: requestMetadata,
    };
  }

  return {
    requestId,
    session,
    user,
    teamId,
    req,
    res,
    metadata: requestMetadata,
  };
};
