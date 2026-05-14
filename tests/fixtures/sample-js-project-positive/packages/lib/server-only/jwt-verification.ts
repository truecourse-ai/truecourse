
// --- unknown-catch-variable shape: catch(error) instanceof Error checking .name; fixed message for non-Error ---
declare class AppError9 extends Error {
  constructor(code: string, opts?: { message?: string });
}
declare const AppErrorCode9: { UNAUTHORIZED: string };
declare function verifyJwt(token: string, secret: Uint8Array): Promise<void>;

async function verifyPresignJwt(token: string, secret: Uint8Array) {
  try {
    await verifyJwt(token, secret);
  } catch (error) {
    if (error instanceof Error && error.name === 'JWTExpired') {
      throw new AppError9(AppErrorCode9.UNAUTHORIZED, {
        message: 'Presign token has expired',
      });
    }

    throw new AppError9(AppErrorCode9.UNAUTHORIZED, {
      message: 'Presign token is invalid',
    });
  }
}
