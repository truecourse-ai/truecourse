
declare const decodeJwt2: <T>(token: string) => T;
declare const prisma9: { apiToken: { findFirst: (opts: unknown) => Promise<{ id: number; token: string; user: { id: number } } | null> } };
declare const AppError3: new (code: string, opts?: { message: string }) => Error;
declare const AppErrorCode3: { UNAUTHORIZED: string };

type JWTPayload2 = {
  sub?: string;
  aud?: string;
  iat?: number;
  exp?: number;
};

type VerifyEmbeddingPresignTokenOptions2 = {
  token: string;
  scope?: string;
};

export const verifyEmbeddingPresignToken2 = async ({ token, scope }: VerifyEmbeddingPresignTokenOptions2) => {
  let decodedToken: JWTPayload2;

  try {
    decodedToken = decodeJwt2<JWTPayload2>(token);
  } catch (error) {
    console.error('Error decoding JWT token:', error);
    throw new AppError3(AppErrorCode3.UNAUTHORIZED, { message: 'Invalid presign token format' });
  }

  if (!decodedToken.sub || typeof decodedToken.sub !== 'string') {
    throw new AppError3(AppErrorCode3.UNAUTHORIZED, {
      message: 'Invalid presign token format: missing or invalid subject claim',
    });
  }

  if (!decodedToken.aud || typeof decodedToken.aud !== 'string') {
    throw new AppError3(AppErrorCode3.UNAUTHORIZED, {
      message: 'Invalid presign token format: missing or invalid audience claim',
    });
  }

  const tokenId = Number(decodedToken.sub);
  const audienceId = Number(decodedToken.aud);

  if (Number.isNaN(tokenId) || !Number.isInteger(tokenId)) {
    throw new AppError3(AppErrorCode3.UNAUTHORIZED, {
      message: 'Invalid token ID format in subject claim',
    });
  }

  if (Number.isNaN(audienceId) || !Number.isInteger(audienceId)) {
    throw new AppError3(AppErrorCode3.UNAUTHORIZED, {
      message: 'Invalid user ID format in audience claim',
    });
  }

  const apiToken = await prisma9.apiToken.findFirst({
    where: { id: tokenId },
    include: { user: true },
  } as unknown as Parameters<typeof prisma9.apiToken.findFirst>[0]);

  if (!apiToken) {
    throw new AppError3(AppErrorCode3.UNAUTHORIZED, { message: 'Token not found' });
  }

  if (apiToken.user.id !== audienceId) {
    throw new AppError3(AppErrorCode3.UNAUTHORIZED, { message: 'Token user mismatch' });
  }

  return { tokenId, userId: audienceId, scope };
};



// [unknown-catch-variable] catch(error) — console.error with label + value, then throws typed error
declare const AppError: new (code: string, message: string) => Error;
declare function verifyJwtToken(token: string): Promise<{ sub: string; exp: number }>;

async function verifyPresignToken(token: string): Promise<{ userId: string }> {
  try {
    const payload = await verifyJwtToken(token);
    return { userId: payload.sub };
  } catch (error) {
    console.error('Error decoding presign token:', error);
    throw new AppError('INVALID_TOKEN', 'The presign token is invalid or has expired');
  }
}
