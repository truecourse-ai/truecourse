/**
 * Security violations related to Express middleware and configuration.
 */

declare function helmet(opts?: any): any;
declare function express(): any;

// VIOLATION: security/deterministic/csrf-disabled
export function csrfDisabled() {
  return { csrf: false, session: true };
}

// VIOLATION: security/deterministic/express-trust-proxy-not-set
export function expressTrustProxyNotSet() {
  const app = { set: (key: string, value: any) => {} };
  app.set('trust proxy', false);
}

// VIOLATION: security/deterministic/hidden-file-exposure
export function hiddenFileExposure() {
  return express.static('/var/www/public');
}

// VIOLATION: security/deterministic/missing-content-security-policy
export function missingContentSecurityPolicy() {
  return helmet({ contentSecurityPolicy: false });
}

// VIOLATION: security/deterministic/missing-frame-ancestors
export function missingFrameAncestors() {
  return helmet({ frameguard: false });
}

// missing-helmet-middleware moved to its own file (visitor checks full program text for 'helmet')

// VIOLATION: security/deterministic/missing-mime-sniff-protection
export function missingMimeSniffProtection() {
  return helmet({ noSniff: false });
}

// VIOLATION: security/deterministic/missing-referrer-policy
export function missingReferrerPolicy() {
  return helmet({ referrerPolicy: false });
}

// VIOLATION: security/deterministic/missing-strict-transport
export function missingStrictTransport() {
  return helmet({ hsts: false });
}

// VIOLATION: security/deterministic/mixed-http-methods
export function mixedHttpMethods() {
  const app = { all: (path: string, handler: any) => {} };
  app.all('/api/data', (req: any, res: any) => res.json({}));
}

// VIOLATION: security/deterministic/production-debug-enabled
export function productionDebugEnabled() {
  return { debug: true, logLevel: 'verbose' };
}

// VIOLATION: security/deterministic/session-cookie-on-static
export function sessionCookieOnStatic() {
  const app = { use: (...args: any[]) => {} };
  const session = (opts: any) => opts;
  app.use('/static', session({ secret: 'key' }), express.static('public'));
}

// VIOLATION: security/deterministic/session-not-regenerated
export function sessionNotRegenerated() {
  const app = { post: (path: string, handler: any) => {} };
  app.post('/login', (req: any, res: any) => {
    req.session.userId = req.body.userId;
    req.session.save(() => {
      res.redirect('/dashboard');
    });
  });
}
