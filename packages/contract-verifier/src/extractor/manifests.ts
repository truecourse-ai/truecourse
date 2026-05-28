/**
 * Cross-ecosystem dependency reader. Collects declared dependencies from
 * every package manifest under a directory, regardless of language:
 *
 *   - npm:    package.json (dependencies / devDependencies / peer / optional)
 *   - Python: requirements*.txt, pyproject.toml ([project].dependencies +
 *             [tool.poetry.dependencies]), setup.py (install_requires)
 *
 * Used by both the ForbiddenArtifact dependency detector and the
 * ArchitectureDecision package-signal collector, so "is package X
 * declared?" works the same across ecosystems. Adding an ecosystem is a
 * new reader here — no detector changes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadTcIgnore } from '@truecourse/shared';

export interface DeclaredDependency {
  /** Distribution name as declared (`pg`, `psycopg2-binary`, `@prisma/client`). */
  name: string;
  version: string;
  /** `dependencies` | `devDependencies` | `requirements.txt` | `pyproject` | … */
  field: string;
  filePath: string;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache',
  '.truecourse', '__pycache__', '.venv', 'venv', '.mypy_cache',
]);

export function collectDependencies(rootDir: string): DeclaredDependency[] {
  const out: DeclaredDependency[] = [];
  const tcIgnore = loadTcIgnore(rootDir);
  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (tcIgnore.ignores(full)) continue;
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === 'package.json') out.push(...readPackageJson(full));
      else if (/^requirements.*\.txt$/.test(entry.name)) out.push(...readRequirements(full));
      else if (entry.name === 'pyproject.toml') out.push(...readPyproject(full));
      else if (entry.name === 'setup.py') out.push(...readSetupPy(full));
    }
  };
  visit(rootDir);
  return out;
}

// ---------------------------------------------------------------------------
// npm
// ---------------------------------------------------------------------------

const NPM_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

function readPackageJson(filePath: string): DeclaredDependency[] {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
  const out: DeclaredDependency[] = [];
  for (const field of NPM_FIELDS) {
    const deps = pkg[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, version] of Object.entries(deps as Record<string, string>)) {
      out.push({ name, version: typeof version === 'string' ? version : '', field, filePath });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Python — requirements.txt
// ---------------------------------------------------------------------------

/** `Flask-Login==0.6.3 ; python_version >= "3.8"` → name `Flask-Login`. */
function pyDistName(spec: string): string | null {
  const s = spec.trim();
  if (!s || s.startsWith('#') || s.startsWith('-') || /^(git\+|https?:)/.test(s)) return null;
  const m = s.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
  return m ? m[1] : null;
}

function readRequirements(filePath: string): DeclaredDependency[] {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  const out: DeclaredDependency[] = [];
  for (const line of text.split('\n')) {
    const name = pyDistName(line.split('#')[0]);
    if (name) out.push({ name, version: '', field: path.basename(filePath), filePath });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Python — pyproject.toml (PEP 621 + poetry), best-effort regex
// ---------------------------------------------------------------------------

function readPyproject(filePath: string): DeclaredDependency[] {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  const out: DeclaredDependency[] = [];
  // PEP 621: dependencies = ["fastapi>=0.110", "pydantic"]
  const arr = text.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (arr) {
    for (const m of arr[1].matchAll(/["']([^"']+)["']/g)) {
      const name = pyDistName(m[1]);
      if (name) out.push({ name, version: '', field: 'pyproject', filePath });
    }
  }
  // poetry: [tool.poetry.dependencies] table of `name = "^1.0"`
  const poetry = text.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(\n\[|$)/);
  if (poetry) {
    for (const m of poetry[1].matchAll(/^\s*([A-Za-z0-9._-]+)\s*=/gm)) {
      if (m[1].toLowerCase() !== 'python') out.push({ name: m[1], version: '', field: 'pyproject', filePath });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Python — setup.py (install_requires), best-effort regex
// ---------------------------------------------------------------------------

function readSetupPy(filePath: string): DeclaredDependency[] {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  const out: DeclaredDependency[] = [];
  const block = text.match(/install_requires\s*=\s*\[([\s\S]*?)\]/);
  if (block) {
    for (const m of block[1].matchAll(/["']([^"']+)["']/g)) {
      const name = pyDistName(m[1]);
      if (name) out.push({ name, version: '', field: 'install_requires', filePath });
    }
  }
  return out;
}
