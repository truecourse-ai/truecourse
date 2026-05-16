declare const db: { rateLimit: { upsert: (opts: object) => Promise<{ count: number }> } };

interface RateLimitParams {
  identifier?: string;
  action: string;
  bucket: string;
}

export const applyRateLimit = async (params: RateLimitParams) => {
  // Upsert the identifier counter if provided.
  if (params.identifier) {
    const identifierResult = await db.rateLimit.upsert({
      where: {
        key_action_bucket: {
          key: `id:${params.identifier}`,
          action: params.action,
          bucket: params.bucket,
        },
      },
      create: { count: 1 },
      update: { count: { increment: 1 } },
    } as object);

    return identifierResult;
  }

  return null;
};
