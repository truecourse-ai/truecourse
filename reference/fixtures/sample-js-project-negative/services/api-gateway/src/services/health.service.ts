export class HealthService {
  // VIOLATION: code-quality/deterministic/static-method-candidate
  check(): { status: string; uptime: number } {
    return {
      status: 'ok',
      uptime: process.uptime(),
    };
  }
}
