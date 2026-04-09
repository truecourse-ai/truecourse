import Redis from 'ioredis';

// NOTE: code-quality/deterministic/env-in-library-code — skipped for non-packages files
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export async function getCache(key: string): Promise<string | null> {
  return redis.get(key);
}

export async function setCache(key: string, value: string, ttl: number): Promise<void> {
  await redis.set(key, value, 'EX', ttl);
}

export { redis };
