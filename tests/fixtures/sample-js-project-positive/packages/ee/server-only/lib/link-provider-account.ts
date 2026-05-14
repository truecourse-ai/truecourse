// Single server function throws a specific error message — one usage
declare class AppError extends Error {
  constructor(code: string, message: string);
}

async function linkProviderAccount(userId: string, providerId: string): Promise<void> {
  const existing = await findProviderAccount(userId, providerId);
  if (existing) {
    throw new AppError('ACCOUNT_ALREADY_LINKED', 'This provider account is already linked to another user.');
  }
  await createProviderLink(userId, providerId);
}

declare function findProviderAccount(userId: string, providerId: string): Promise<unknown | null>;
declare function createProviderLink(userId: string, providerId: string): Promise<void>;
