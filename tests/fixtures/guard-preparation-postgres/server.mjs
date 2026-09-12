import http from 'node:http';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { client } from './db.mjs';
export function app(env) {
  if (env.TEST_SERVER_FAILURE === 'yes') throw new Error('boot failed: ' + env.DATABASE_URL);
  const db = client(env);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') return res.end('healthy');
      const token = req.headers['x-world-token'];
      if (typeof token !== 'string' || !await db.session.findUnique({ where: { token } })) { res.statusCode = 401; return res.end('unauthorized'); }
      if (url.pathname === '/session') return res.end(JSON.stringify({ authenticated: true }));
      if (url.pathname === '/private-env') return res.end(JSON.stringify({
        database: new URL(env.DATABASE_URL).pathname,
        direct: new URL(env.DIRECT_URL).pathname,
        provisioning: !!env.GUARD_PREPARATION_POSTGRES_BASE_URLS,
      }));
      if (url.pathname === '/echo-secret') return res.end(JSON.stringify({ secret: env.DATABASE_URL }));
      if (req.method === 'POST') await db.document.create({ data: { tenant: 'peer', status: 'pending' } });
      if (req.method === 'DELETE') { await db.document.deleteMany(); await db.session.deleteMany(); }
      if (!url.searchParams.has('input')) { res.statusCode = 400; return res.end('input required'); }
      const input = JSON.parse(url.searchParams.get('input'));
      const where = input.tenant ? { tenant: input.tenant } : {};
      const rows = await db.document.findMany({ where, orderBy: { id: 'asc' } });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ result: { data: { json: { count: rows.length, rows } } } }));
    } catch { res.statusCode = 500; res.end('database request failed'); }
  });
  return { server, close: async () => { await new Promise(r => server.close(r)); await db.$disconnect(); } };
}
if (import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const instance = app(process.env);
  instance.server.listen(Number(process.env.PORT), '127.0.0.1');
  process.on('SIGTERM', async () => { await instance.close(); process.exit(0); });
}
