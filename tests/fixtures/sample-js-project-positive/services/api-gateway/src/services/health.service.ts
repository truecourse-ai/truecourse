export class HealthService {
  private readonly startTime = Date.now();

  check(): { status: string; uptime: number } {
    return {
      status: 'ok',
      uptime: (Date.now() - this.startTime) / 1000,
    };
  }
}
