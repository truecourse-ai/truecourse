/**
 * Security violations related to web security.
 */

// VIOLATION: security/deterministic/permissive-cors
export function permissiveCors() {
  const cors = (opts: any) => opts;
  return cors({ origin: '*' });
}

// VIOLATION: security/deterministic/insecure-cookie
export function insecureCookie() {
  const res = {
    cookie: (name: string, value: string, opts: any) => opts,
  };
  res.cookie('session', 'abc123', { httpOnly: true });
}

// link-target-blank is TSX-only, moved to web.tsx
// production-debug-enabled is Python-only, removed

// VIOLATION: security/deterministic/confidential-info-logging
export function confidentialInfoLogging(password: string) {
  console.log('User password:', password);
}

// VIOLATION: security/deterministic/unverified-certificate
export function unverifiedCertificate() {
  const https = { request: (opts: any) => opts };
  return https.request({ rejectUnauthorized: false });
}

// VIOLATION: security/deterministic/server-fingerprinting
export function serverFingerprinting() {
  const res = {
    setHeader: (name: string, value: string) => value,
  };
  res.setHeader('X-Powered-By', 'Express');
}

// VIOLATION: security/deterministic/bind-all-interfaces
export function bindAllInterfaces() {
  const app = { listen: (port: number, host: string) => {} };
  app.listen(3000, '0.0.0.0');
}

// VIOLATION: security/deterministic/sensitive-data-in-url
export function sensitiveDataInUrl() {
  return fetch('https://api.example.com/login?password=secret123');
}
