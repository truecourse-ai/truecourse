import dotenv from 'dotenv';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Packaged (npm) mode: the installed OSS CLI reads the user's own config.
dotenv.config({ path: path.join(os.homedir(), '.truecourse', '.env') });

// Dev mode: the repo-root .env (next to .env.example). Walk up from cwd
// to the workspace root so this resolves no matter which package the
// process was launched from — the server runs from apps/dashboard/server,
// where a fixed '../../.env' wrongly pointed at apps/.env.
function findRepoRootEnv(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return path.join(dir, '.env');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const repoRootEnv = findRepoRootEnv();
if (repoRootEnv) dotenv.config({ path: repoRootEnv });
