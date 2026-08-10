/**
 * Network security, TLS/SSL, and SNMP configuration patterns.
 */

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function getClientIp(req: any) {
  // VIOLATION: security/deterministic/ip-forwarding
  const clientIp = req.headers['x-forwarded-for'];
  return clientIp;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createTlsConfig() {
  // VIOLATION: security/deterministic/ssl-version-unsafe
  return {
    minVersion: 'TLSv1',
    ciphers: 'HIGH:!aNULL:!MD5',
  };
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createWeakSslConfig() {
  // VIOLATION: security/deterministic/weak-ssl
  return {
    secureProtocol: 'TLSv1_method',
    host: 'example.com',
  };
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function skipHostnameCheck() {
  // VIOLATION: security/deterministic/unverified-hostname
  return {
    host: 'api.example.com',
    port: 443,
    checkServerIdentity: () => undefined,
  };
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createSnmpSession() {
  const snmp = { createSession: (host: string, opts: any) => opts };
  // VIOLATION: security/deterministic/snmp-insecure-version
  return snmp.createSession('192.168.1.1', {
    version: '2c',
    community: 'public',
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createSnmpV3Weak() {
  const snmp = { createSession: (host: string, opts: any) => opts };
  // VIOLATION: security/deterministic/snmp-weak-crypto
  return snmp.createSession('192.168.1.1', {
    version: '3',
    authAlgorithm: 'md5',
    privAlgorithm: 'des',
  });
}
