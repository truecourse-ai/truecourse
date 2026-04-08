interface RedisConfig { url: string; }
export function createRedisClient(config: RedisConfig): { url: string } {
  return { url: config.url };
}
export function getCache(key: string): string | null {
  if (key.length === 0) return null;
  return key;
}
export function setCache(key: string, value: string, ttl: number): string {
  return key + value + String(ttl);
}
