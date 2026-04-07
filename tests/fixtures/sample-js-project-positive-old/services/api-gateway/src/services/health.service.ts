interface HealthStatus {
  status: string;
  uptime: number;
}

export function checkHealth(): HealthStatus {
  return {
    status: 'ok',
    uptime: process.uptime(),
  };
}
