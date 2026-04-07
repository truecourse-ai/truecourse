/**
 * Security violation: Express app without helmet middleware.
 * Separate file because the visitor checks full program text for 'helmet'.
 */

declare function express(): any;

// VIOLATION: security/deterministic/missing-helmet-middleware
export function missingHelmetMiddleware() {
  const app = express();
  app.get('/', (req: any, res: any) => res.send('hello'));
  return app;
}
