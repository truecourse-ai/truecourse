import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const root = process.env.GUARD_REPO_ROOT;
const { admin, ownedName, client } = await import(pathToFileURL(path.join(root, 'db.mjs')));
const name = ownedName(process.env);
const connection = await admin(process.env);
try { await connection.query(`CREATE DATABASE "${name}" TEMPLATE template0`); }
finally { await connection.end(); }
if (process.env.TEST_SEED_FAILURE === 'yes') throw new Error('failed before migration: ' + process.env.DIRECT_URL);
const require = createRequire(path.join(root, 'package.json'));
execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(root, 'prisma/schema.prisma')], { env: process.env });
const db = client(process.env);
try {
  const token = randomUUID();
  await db.session.create({ data: { token } });
  const inputs = process.env.GUARD_PREPARATION_BASELINE === 'empty' ? [] : [
    { tenant: 'alpha', status: 'pending' }, { tenant: 'beta', status: 'completed' },
  ];
  await db.document.createMany({ data: inputs });
  fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({ credentials: { owner: { value: token } }, fixtures: { documents: { count: inputs.length } } }));
} finally { await db.$disconnect(); }
