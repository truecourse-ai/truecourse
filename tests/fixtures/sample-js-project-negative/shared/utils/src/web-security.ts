/**
 * Web security utilities — CORS, cookies, Express configuration.
 */

declare function helmet(opts?: any): any;
declare function express(): any;

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function setupCors() {
  const cors = (opts: any) => opts;
  // VIOLATION: security/deterministic/permissive-cors
  return cors({ origin: '*' });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function setSessionCookie() {
  const res = {
    cookie: (name: string, value: string, opts: any) => opts,
  };
  // VIOLATION: security/deterministic/insecure-cookie
  res.cookie('session', 'abc123', { httpOnly: true });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function setupHelmet() {
  // VIOLATION: security/deterministic/missing-content-security-policy
  return helmet({ contentSecurityPolicy: false });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function disableFrameProtection() {
  // VIOLATION: security/deterministic/missing-frame-ancestors
  return helmet({ frameguard: false });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function disableSniffProtection() {
  // VIOLATION: security/deterministic/missing-mime-sniff-protection
  return helmet({ noSniff: false });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function disableReferrer() {
  // VIOLATION: security/deterministic/missing-referrer-policy
  return helmet({ referrerPolicy: false });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function disableHsts() {
  // VIOLATION: security/deterministic/missing-strict-transport
  return helmet({ hsts: false });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function catchAllRoute() {
  const app = { all: (path: string, handler: any) => {} };
  // VIOLATION: security/deterministic/mixed-http-methods
  app.all('/api/data', (req: any, res: any) => res.json({}));
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function debugConfig() {
  // VIOLATION: security/deterministic/production-debug-enabled
  return { debug: true, logLevel: 'verbose' };
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function exposeServerInfo() {
  const res = { setHeader: (name: string, value: string) => value };
  // VIOLATION: security/deterministic/server-fingerprinting
  res.setHeader('X-Powered-By', 'Express');
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function trustProxyOff() {
  const app = { set: (key: string, value: any) => {} };
  // VIOLATION: security/deterministic/express-trust-proxy-not-set
  app.set('trust proxy', false);
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function csrfOff() {
  // VIOLATION: security/deterministic/csrf-disabled
  return { csrf: false, session: true };
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function bindUnsafe() {
  const app = { listen: (port: number, host: string) => {} };
  // VIOLATION: security/deterministic/bind-all-interfaces
  app.listen(3000, '0.0.0.0');
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function unverifiedCert() {
  const https = { request: (opts: any) => opts };
  // VIOLATION: security/deterministic/unverified-certificate
  return https.request({ rejectUnauthorized: false });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function sessionOnStatic() {
  const app = { use: (...args: any[]) => {} };
  const session = (opts: any) => opts;
  // VIOLATION: security/deterministic/session-cookie-on-static
  app.use('/static', session({ secret: 'key' }), express.static('public'));
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function loginWithoutRegenerate() {
  const app = { post: (path: string, handler: any) => {} };
  app.post('/login', (req: any, res: any) => {
    // VIOLATION: security/deterministic/session-not-regenerated
    req.session.userId = req.body.userId;
    req.session.save(() => {
      res.redirect('/dashboard');
    });
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function hiddenFiles() {
  // VIOLATION: security/deterministic/hidden-file-exposure
  return express.static('/var/www/public');
}
