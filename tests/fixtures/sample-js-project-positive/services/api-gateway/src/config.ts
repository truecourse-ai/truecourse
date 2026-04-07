const DEFAULT_PORT = 3000;

export const config = {
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  userServiceUrl: process.env.USER_SERVICE_URL ?? 'http://localhost:3001',
  port: Number(process.env.PORT ?? DEFAULT_PORT),
};
