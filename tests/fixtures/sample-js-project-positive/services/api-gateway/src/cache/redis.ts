import { config } from '../config';

const store = new Map<string, { value: string; expires: number }>();

export async function getCache(key: string): Promise<string | null> {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.clear();
    return null;
  }
  await Promise.resolve();
  return entry.value;
}

export async function setCache(key: string, value: string, ttl: number): Promise<void> {
  await Promise.resolve();
  store.set(key, { value, expires: Date.now() + ttl * 1000 });
}

export function getRedisUrl(): string {
  return config.redisUrl;
}
