import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const REPO = '/Users/musheghgevorgyan/repos/trilium';
export const SCRATCH = '/private/tmp/claude-501/-Users-musheghgevorgyan-repos-truecourse/ace1ded0-15bd-489a-81e7-579caf056682/scratchpad';
export const DATA_DIR = path.join(SCRATCH, 'tdata');
export const PORT = 8099;
export const BASE = `http://127.0.0.1:${PORT}`;
export const PASSWORD = 'TriliumGuard1!';
export const ENTRY = path.join(REPO, 'apps', 'server', 'dist', 'main.cjs');
export const IDS = path.join(SCRATCH, 'probe', 'ids.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function loadIds() { return JSON.parse(fs.readFileSync(IDS, 'utf8')); }
export function saveIds(o) { fs.writeFileSync(IDS, JSON.stringify(o, null, 2)); }

export async function startServer() {
  const proc = spawn(process.execPath, [ENTRY], {
    cwd: REPO,
    env: { ...process.env, TRILIUM_ENV: 'production', TRILIUM_HOST: '127.0.0.1', TRILIUM_PORT: String(PORT), TRILIUM_DATA_DIR: DATA_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (c) => (out += c));
  proc.stderr.on('data', (c) => (out += c));
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${BASE}/`, { redirect: 'manual' }); if (r.status === 200 || r.status === 302) break; } catch {}
    await sleep(150);
  }
  proc._out = () => out;
  return proc;
}

export async function stopServer(proc) {
  if (!proc) return;
  proc.kill('SIGTERM');
  const deadline = Date.now() + 10000;
  while (proc.exitCode === null && proc.signalCode === null && Date.now() < deadline) await sleep(50);
  if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
  await sleep(300);
}

/** Login and return a session object carrying cookies + csrf token. */
export async function login() {
  const jar = new Map();
  const absorb = (r) => { for (const c of (r.headers.getSetCookie?.() ?? [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

  const login = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: PASSWORD }).toString(),
    redirect: 'manual',
  });
  if (login.status !== 302) throw new Error(`POST /login -> ${login.status}`);
  absorb(login);
  const boot = await fetch(`${BASE}/bootstrap`, { headers: { cookie: cookie() }, redirect: 'manual' });
  absorb(boot);
  const payload = await boot.json();
  if (payload.loggedIn !== true) throw new Error('not logged in');
  const csrf = payload.csrfToken;

  async function api(method, p, body, opts = {}) {
    const headers = { cookie: cookie(), 'x-csrf-token': csrf };
    let init = { method, headers, redirect: 'manual' };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    if (opts.noBody) { delete headers['Content-Type']; delete init.body; }
    const r = await fetch(`${BASE}${p}`, init);
    absorb(r);
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: r.status, text, json };
  }

  return { api, cookie, csrf, jar };
}

export async function search(s, q) {
  const r = await s.api('GET', `/api/search/${encodeURIComponent(q)}`);
  return { status: r.status, ids: r.json, raw: r.text };
}

export async function quickSearch(s, q) {
  const r = await s.api('GET', `/api/quick-search/${encodeURIComponent(q)}`);
  return { status: r.status, body: r.json, raw: r.text };
}

export async function createNote(s, parent, params) {
  const r = await s.api('POST', `/api/notes/${parent}/children?target=into`, params);
  return r;
}

export async function addLabel(s, noteId, name, value) {
  return s.api('POST', `/api/notes/${noteId}/attributes`, { type: 'label', name, value: value ?? '', isInheritable: false });
}

/** A transcript recorder: every line lands in an array and on stdout. */
export function recorder() {
  const lines = [];
  return {
    lines,
    log(...a) { const l = a.join(' '); lines.push(l); console.log(l); },
    async probe(s, label, q) {
      const r = await search(s, q);
      const ids = Array.isArray(r.ids) ? r.ids : r.raw;
      const shown = Array.isArray(r.ids) ? (r.ids.length > 6 ? `[${r.ids.length}] ${JSON.stringify(r.ids.slice(0, 6))}…` : JSON.stringify(r.ids)) : String(ids);
      this.log(`${label.padEnd(9)} GET /api/search/${q}`);
      this.log(`          -> ${r.status} ${shown}`);
      return r;
    },
    dump(file) { fs.writeFileSync(file, lines.join('\n') + '\n'); },
  };
}
