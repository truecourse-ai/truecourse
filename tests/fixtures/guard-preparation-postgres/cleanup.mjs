import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { admin, ownedName } = await import(pathToFileURL(path.join(process.env.GUARD_REPO_ROOT, 'db.mjs')));
const name = ownedName(process.env);
const connection = await admin(process.env);
try { await connection.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); }
finally { await connection.end(); }
if (process.env.TEST_CLEANUP_FAILURE === 'yes') throw new Error('cleanup reporting failure');
