/**
 * Security violations related to network security, TLS/SSL, and SNMP.
 */

// VIOLATION: security/deterministic/ip-forwarding
export function ipForwarding(req: any) {
  const clientIp = req.headers['x-forwarded-for'];
  return clientIp;
}

// VIOLATION: security/deterministic/ssl-version-unsafe
export function sslVersionUnsafe() {
  return {
    minVersion: 'TLSv1',
    ciphers: 'HIGH:!aNULL:!MD5',
  };
}

// VIOLATION: security/deterministic/weak-ssl
export function weakSsl() {
  return {
    secureProtocol: 'TLSv1_method',
    host: 'example.com',
  };
}

// VIOLATION: security/deterministic/unverified-hostname
export function unverifiedHostname() {
  return {
    host: 'api.example.com',
    port: 443,
    checkServerIdentity: () => undefined,
  };
}

// VIOLATION: security/deterministic/snmp-insecure-version
export function snmpInsecureVersion() {
  const snmp = { createSession: (host: string, opts: any) => opts };
  return snmp.createSession('192.168.1.1', {
    version: '2c',
    community: 'public',
  });
}

// VIOLATION: security/deterministic/snmp-weak-crypto
export function snmpWeakCrypto() {
  const snmp = { createSession: (host: string, opts: any) => opts };
  return snmp.createSession('192.168.1.1', {
    version: '3',
    authAlgorithm: 'md5',
    privAlgorithm: 'des',
  });
}
