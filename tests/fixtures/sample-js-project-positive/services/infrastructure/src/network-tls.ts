/**
 * Network security, TLS/SSL, and SNMP configuration patterns -- secure versions.
 */

export function getClientIp(req: { connection: { remoteAddress: string } }): string {
  return req.connection.remoteAddress;
}

export function createTlsConfig(): { minVersion: string; ciphers: string } {
  return {
    minVersion: 'TLSv1.3',
    ciphers: 'HIGH:!aNULL:!MD5',
  };
}

export function createSecureSslConfig(): { secureProtocol: string; host: string } {
  return {
    secureProtocol: 'TLSv1_3_method',
    host: 'example.com',
  };
}

export function verifyHostname(): { host: string; port: number; rejectUnauthorized: boolean } {
  return {
    host: 'api.example.com',
    port: 443,
    rejectUnauthorized: true,
  };
}

export function createSnmpV3Session(host: string): Record<string, string> {
  const snmp = { createSession: (_host: string, opts: Record<string, string>) => opts };
  return snmp.createSession(host, {
    version: '3',
    authAlgorithm: 'sha256',
    privAlgorithm: 'aes256',
  });
}

export function createSecureSnmpSession(host: string): Record<string, string> {
  const snmp = { createSession: (_host: string, opts: Record<string, string>) => opts };
  return snmp.createSession(host, {
    version: '3',
    authAlgorithm: 'sha512',
    privAlgorithm: 'aes256',
  });
}
