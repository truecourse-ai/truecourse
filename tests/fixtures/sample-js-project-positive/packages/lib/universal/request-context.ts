
// --- empty-catch shape: intentional swallow for optional telemetry field ---
declare function resolveClientIp(req: unknown): string;
declare const ZClientIpSchema: { safeParse: (v: unknown) => { success: boolean; data?: string } };

export function extractClientContext(req: unknown): { ipAddress?: string; userAgent?: string } {
  let ip: string | undefined;

  try {
    ip = resolveClientIp(req);
  } catch {
    // Do nothing.
  }

  const parsed = ZClientIpSchema.safeParse(ip);
  const ipAddress = parsed.success ? parsed.data : undefined;

  return { ipAddress };
}
