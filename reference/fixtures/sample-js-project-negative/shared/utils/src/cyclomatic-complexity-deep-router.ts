// True bug pattern: a single function makes many imperative branching
// decisions on disjoint conditions. The decision graph is wide and
// every path needs separate test coverage — the classic case for
// extracting a lookup table or smaller helpers.

type RouteRequest = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  user?: { role?: string; id?: number };
};

// VIOLATION: code-quality/deterministic/cyclomatic-complexity
export function dispatchRoute(req: RouteRequest): string {
  if (req.method === 'GET' && req.path === '/health') return 'ok';
  if (req.method === 'GET' && req.path === '/version') return 'v1';
  if (req.method === 'GET' && req.path === '/metrics') return 'metrics';
  if (req.method === 'POST' && req.path === '/login') return 'login';
  if (req.method === 'POST' && req.path === '/logout') return 'logout';
  if (req.method === 'POST' && req.path === '/register') return 'register';
  if (req.method === 'PUT' && req.path === '/profile') return 'profile';
  if (req.method === 'PUT' && req.path === '/password') return 'password';
  if (req.method === 'DELETE' && req.path === '/account') return 'account';
  if (req.method === 'GET' && req.path === '/orders') return 'orders';
  if (req.method === 'POST' && req.path === '/orders') return 'create-order';
  if (req.method === 'GET' && req.path === '/admin' && req.user?.role === 'admin') return 'admin';
  return 'not-found';
}
