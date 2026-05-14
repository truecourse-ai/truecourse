interface IncomingHeaders {
  get(name: string): string | null;
}

export function getClientIpAddress(headers: IncomingHeaders): string | null {
  const forwarded = headers.get('x-forwarded-for');

  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  const realIp = headers.get('x-real-ip');

  if (realIp) {
    return realIp;
  }

  const clientIp = headers.get('x-client-ip');

  if (clientIp) {
    return clientIp;
  }

  return null;
}
