
// JWT scope claim comparison — authorization scope string is not a cryptographic secret
declare const AppError: new (code: string, opts: any) => Error;
declare const AppErrorCode: { UNAUTHORIZED: string };

interface DecodedAccessToken { sub?: string; scope?: string; aud?: string; }

export function verifyScopeMatch(
  decodedToken: DecodedAccessToken,
  requiredScope: string | undefined,
) {
  if (decodedToken.scope && requiredScope && decodedToken.scope !== requiredScope) {
    throw new AppError(AppErrorCode.UNAUTHORIZED, {
      message: 'Access token scope does not match the required scope',
    });
  }
}



// DB integer IDs compared for authorization scope check — not cryptographic secrets
declare const AppError: new (code: string, opts: any) => Error;
declare const AppErrorCode: { UNAUTHORIZED: string };

interface ApiToken { teamId: number | null; userId: number; }

export function verifyAudienceMatch(audienceId: number, apiToken: ApiToken) {
  if (audienceId !== apiToken.teamId && audienceId !== apiToken.userId) {
    throw new AppError(AppErrorCode.UNAUTHORIZED, {
      message: 'API token does not match the requested audience',
    });
  }
}



// typeof check to validate JWT audience claim type — type assertion, not comparing secret values
declare const AppError: new (code: string, opts: any) => Error;
declare const AppErrorCode: { UNAUTHORIZED: string };

interface JWTPayload { sub?: unknown; aud?: unknown; exp?: number; }

export function validateJWTAudienceClaim(decoded: JWTPayload) {
  if (!decoded.aud || typeof decoded.aud !== 'string') {
    throw new AppError(AppErrorCode.UNAUTHORIZED, {
      message: 'Invalid token format: missing or invalid audience claim',
    });
  }
  return decoded.aud;
}



// typeof check to validate JWT subject claim type — type assertion on decoded claim, not comparing secrets
declare const AppError: new (code: string, opts: any) => Error;
declare const AppErrorCode: { UNAUTHORIZED: string };

interface JWTPayload { sub?: unknown; aud?: unknown; exp?: number; }

export function validateJWTSubjectClaim(decoded: JWTPayload) {
  if (!decoded.sub || typeof decoded.sub !== 'string') {
    throw new AppError(AppErrorCode.UNAUTHORIZED, {
      message: 'Invalid token format: missing or invalid subject claim',
    });
  }
  return decoded.sub;
}
