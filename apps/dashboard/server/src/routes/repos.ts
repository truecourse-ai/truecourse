import { Router, type Request, type Response, type NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CreateRepoSchema, ConnectRepoSchema, BrowseDirQuerySchema } from '@truecourse/shared';
import { getCapabilities } from '../ee-loader.js';
import { createAppError } from '@truecourse/core/lib/errors';
import { getGit } from '@truecourse/core/lib/git';
import { getRepoTruecourseDir } from '@truecourse/core/config/paths';
import { readProjectConfig, updateProjectConfig } from '@truecourse/core/config/project-config';
import { readLatest } from '@truecourse/core/lib/analysis-store';
import { resolveLatestEvent } from '@truecourse/core/commands/repo-events';
import { getRules } from '@truecourse/core/services/rules';
import {
  readRegistry,
  getProjectBySlug,
  registerProject,
  unregisterProject,
} from '@truecourse/core/config/registry';
import {
  cloneRepository,
  getClonePath,
  isManagedClonePath,
  normalizeRemoteUrl,
  parseRemoteUrl,
} from '../services/repo-clone.service.js';
import { isSpecScanRunning, startOnboardingScan } from '../services/onboarding-scan.service.js';

const router: Router = Router();

async function requireRegistryEntry(slug: string) {
  const entry = await getProjectBySlug(slug);
  if (!entry) throw createAppError('Project not found', 404);
  return entry;
}

// POST /api/repos - Register a new repo
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateRepoSchema.safeParse(req.body);
    if (!parsed.success) {
      throw createAppError('Invalid request body: path is required', 400);
    }

    const repoPath = parsed.data.path;
    if (!fs.existsSync(repoPath)) {
      throw createAppError(`Path does not exist: ${repoPath}`, 400);
    }
    if (!fs.statSync(repoPath).isDirectory()) {
      throw createAppError(`Path is not a directory: ${repoPath}`, 400);
    }

    const entry = await registerProject(repoPath);
    res.status(201).json({
      id: entry.slug,
      name: entry.name,
      path: entry.path,
      lastAnalyzed: null,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/repos/connect - Connect a PUBLIC repository by its git URL.
// Clones it into `<globalDir>/clones/<owner>__<repo>` and registers the clone,
// so it behaves like any path-registered repo from then on. Disconnecting it
// (DELETE below) deletes the clone.
//
// Synchronous: the clone happens inside the request and the client shows a
// pending state. No job system, deliberately — this is the first step toward
// provider-connected repos, not the destination.
//
// The ONBOARDING SCAN is the exception to that synchrony: once the clone is
// registered the response goes out and the repo's spec scan starts in the
// background of this process (../services/onboarding-scan.service.ts). Its
// progress reaches the client over the socket and the sessions store, not over
// this response.
router.post('/connect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ConnectRepoSchema.safeParse(req.body);
    if (!parsed.success) {
      throw createAppError('Invalid request body: url is required', 400);
    }

    const remote = parseRemoteUrl(parsed.data.url);
    const registry = await readRegistry();

    // Already connected? Hand back the existing repo so the client can navigate
    // to it instead of cloning a second copy.
    const duplicate = registry.find(
      (e) => e.remoteUrl && normalizeRemoteUrl(e.remoteUrl) === remote.normalized,
    );
    if (duplicate) {
      res.status(409).json({
        error: `${remote.displayName} is already connected`,
        repoId: duplicate.slug,
      });
      return;
    }

    // Same `<owner>__<repo>` directory, different remote (e.g. the same
    // owner/repo on two hosts). Refuse rather than clobber the other clone.
    // Case-insensitive: clone dir names are lowercased now, but a registry
    // written before that can still hold a mixed-case dir which, on a
    // case-insensitive filesystem (macOS default), IS the directory this
    // connect would rmSync. A false 409 on Linux for a genuinely distinct
    // casing is the safe direction.
    const clonePath = getClonePath(remote);
    const occupant = registry.find(
      (e) => path.resolve(e.path).toLowerCase() === path.resolve(clonePath).toLowerCase(),
    );
    if (occupant) {
      throw createAppError(
        `${occupant.name} already occupies the directory ${remote.displayName} would clone into. Disconnect it first.`,
        409,
      );
    }

    // Cloning can take a while on a big repo; don't let the socket time out
    // under it. (Node's default request timeout is 5 minutes.)
    req.setTimeout(0);

    const repoPath = await cloneRepository(remote);
    const entry = await registerProject(repoPath, remote.displayName, { remoteUrl: remote.url });

    // Onboarding (§4.3): connecting a repository starts its spec scan. The
    // scan itself runs in the background — the call only claims the slot and
    // returns whether it started (false: a scan for this path is already
    // running, e.g. CLI-started), which the response reports so a client can
    // tell "scanning now" from "join the run already in flight". Never throws
    // (see the service).
    const onboardingScanStarted = startOnboardingScan(entry.slug, entry.path);

    res.status(201).json({
      id: entry.slug,
      name: entry.name,
      path: entry.path,
      remoteUrl: entry.remoteUrl ?? null,
      lastAnalyzed: null,
      onboardingScanStarted,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/repos - List all registered projects (home page).
// `lastAnalyzed` comes straight from the registry so unanalyzed projects don't
// surface a fake date. `latestEvent` is the repo's most recent lifecycle event
// (analyze / spec scan / contracts generate / verify / guard generate|run)
// composed from the per-repo stores' own timestamps — tolerant of missing,
// corrupt, or unreadable repos (`resolveLatestEvent` never throws).
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const entries = await readRegistry();
    const repos = await Promise.all(
      entries.map(async (e) => ({
        id: e.slug,
        name: e.name,
        path: e.path,
        remoteUrl: e.remoteUrl ?? null,
        lastAnalyzed: e.lastAnalyzed ?? null,
        latestEvent: await resolveLatestEvent(e.path, e.lastAnalyzed ?? null),
      })),
    );
    res.json(repos);
  } catch (error) {
    next(error);
  }
});

// The app-level CORS config reflects any origin with credentials and community
// mode has no auth, so /browse — a general filesystem-read primitive, unlike the
// other GETs which only expose registered-repo data — needs its own origin gate:
// any website open in the user's browser could otherwise read arbitrary directory
// listings cross-origin. Trusted: no Origin at all (same-origin GETs, curl), a
// loopback hostname on any port (dev client on :3000 → server on :3001), or an
// Origin host matching the request's own Host (same-site on a LAN IP).
function isTrustedBrowseOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false; // malformed Origin — reject
  }
  // WHATWG URL keeps the brackets on an IPv6 hostname ('[::1]').
  if (['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) return true;
  return host !== undefined && parsed.host === host;
}

// GET /api/repos/browse?path=<abs> — list subdirectories for the directory picker.
// LOCAL-ONLY: gated on the 'local-filesystem' capability (present in OSS, absent
// in hosted EE where there is no per-user disk) and on a trusted Origin (see
// isTrustedBrowseOrigin above). MUST be declared before GET '/:id' so 'browse'
// is not captured as a project id.
router.get('/browse', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Origin gate — reject cross-origin reads before anything else.
    if (!isTrustedBrowseOrigin(req.headers.origin, req.headers.host)) {
      throw createAppError('Cross-origin requests are not allowed', 403);
    }

    // Capability gate — hidden entirely (404) when local-filesystem is off.
    if (!getCapabilities().includes('local-filesystem')) {
      throw createAppError('Not found', 404);
    }

    const parsed = BrowseDirQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw createAppError('Invalid query: path must be a string', 400);
    }

    const raw = parsed.data.path;
    // Reject a relative path BEFORE resolving (realpath would resolve it against
    // the server cwd, silently browsing somewhere the caller didn't ask for).
    if (raw && raw.length > 0 && !path.isAbsolute(raw)) {
      throw createAppError('Path must be absolute', 400);
    }
    const target = raw && raw.length > 0 ? raw : os.homedir();

    // Resolve symlinks and stat in one guarded block — the dir can vanish or
    // become unreadable between the two calls; map fs errors to 4xx, never let
    // them surface as a 500.
    let resolved: string;
    let stat: fs.Stats;
    try {
      resolved = fs.realpathSync(target);
      stat = fs.statSync(resolved);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ELOOP' || code === 'ENOTDIR') {
        throw createAppError(`Path does not exist: ${target}`, 404);
      }
      if (code === 'EACCES' || code === 'EPERM') {
        throw createAppError(`Permission denied: ${target}`, 403);
      }
      throw err; // unexpected — let the error handler 500 it
    }

    if (!stat.isDirectory()) {
      throw createAppError(`Path is not a directory: ${target}`, 400);
    }

    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(resolved, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') {
        throw createAppError(`Permission denied: ${resolved}`, 403);
      }
      throw err;
    }

    const entries = dirents
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => {
        const childPath = path.join(resolved, d.name);
        let isRepo = false;
        try {
          isRepo = fs.statSync(path.join(childPath, '.git')).isDirectory();
        } catch {
          isRepo = false; // no .git, or unreadable
        }
        return { name: d.name, path: childPath, isRepo };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const parentPath = path.dirname(resolved);
    const parent = parentPath === resolved ? null : parentPath;

    res.json({ path: resolved, parent, entries });
  } catch (error) {
    next(error);
  }
});

// GET /api/repos/:id - Project details. Prefers the registry's cached
// `lastAnalyzed`, falling back to the persisted analysis timestamp when the
// registry doesn't track one (the hosted gh_repos-derived registry).
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await requireRegistryEntry(req.params.id as string);
    let branches: string[] = [];
    // The hosted registry tracks the default branch from gh_repos and has no local
    // checkout, so only shell out to git when a registry didn't supply it (OSS
    // local repos). Otherwise simple-git fails on the non-path repo identity and
    // logs "git unavailable" on every load.
    let defaultBranch = entry.defaultBranch;
    let isGitRepo = true;
    if (!defaultBranch) {
      try {
        const git = await getGit(entry.path);
        const branchSummary = await git.branch();
        branches = branchSummary.all;
        defaultBranch = branchSummary.current;
      } catch (err) {
        isGitRepo = false;
        console.warn(`[repos] git unavailable for ${entry.path}:`, (err as Error).message);
      }
    }
    // `lastAnalyzed` drives the dashboard's `hasAnalysis` gate (the Violations /
    // Analytics views render an empty "No analysis yet" state when it's null).
    // OSS file registries cache it on the entry; the hosted registry (a derived
    // view of gh_repos) doesn't, so fall back to the timestamp of the actual
    // persisted analysis — the source of truth — otherwise an analyzed hosted
    // repo looks "never analyzed" and hides its violations.
    const lastAnalyzed =
      entry.lastAnalyzed ?? (await readLatest(entry.path))?.analysis.createdAt ?? null;
    res.json({
      id: entry.slug,
      name: entry.name,
      path: entry.path,
      remoteUrl: entry.remoteUrl ?? null,
      lastAnalyzed,
      branches,
      defaultBranch,
      isGitRepo,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/repos/:id/branches - List git branches
router.get('/:id/branches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await requireRegistryEntry(req.params.id as string);
    const git = await getGit(entry.path);
    const branchSummary = await git.branch();
    res.json({
      branches: branchSummary.all,
      defaultBranch: branchSummary.current,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/repos/:id - Unregister the project, close its PGlite, and
// remove `<repo>/.truecourse/` from disk. The repo source itself is never
// touched — UNLESS the project was connected by URL and lives in a clone the
// dashboard manages, in which case disconnecting deletes the whole clone. Both
// conditions are required: a `remoteUrl` alone (a hosted registry could carry
// one for a repo we did not clone) never authorizes deleting a directory.
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.id as string;
    const entry = await getProjectBySlug(slug);
    if (!entry) {
      throw createAppError('Project not found', 404);
    }

    // A running spec scan is writing into this tree right now. Deleting it
    // under the scan leaves an orphaned `.truecourse/` the scan's later writes
    // recreate, and — because the in-flight guard is keyed on the path — blocks
    // a same-URL reconnect from ever getting its onboarding scan.
    if (isSpecScanRunning(entry.path)) {
      throw createAppError(
        'A spec scan is running for this repository. Wait for it to finish, then disconnect.',
        409,
      );
    }

    if (entry.remoteUrl && isManagedClonePath(entry.path)) {
      fs.rmSync(entry.path, { recursive: true, force: true });
    } else {
      const tcDir = getRepoTruecourseDir(entry.path);
      if (fs.existsSync(tcDir)) {
        fs.rmSync(tcDir, { recursive: true, force: true });
      }
    }

    await unregisterProject(slug);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// PUT /api/repos/:id/categories - Update per-repo enabled categories
router.put('/:id/categories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await requireRegistryEntry(req.params.id as string);
    const { enabledCategories } = req.body as { enabledCategories: string[] | null };
    const updated = await updateProjectConfig(entry.path, { enabledCategories });
    res.json({ enabledCategories: updated.enabledCategories ?? null });
  } catch (error) {
    next(error);
  }
});

// PUT /api/repos/:id/llm - Update per-repo LLM rules toggle
router.put('/:id/llm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await requireRegistryEntry(req.params.id as string);
    const { enableLlmRules } = req.body as { enableLlmRules: boolean | null };
    const updated = await updateProjectConfig(entry.path, { enableLlmRules });
    res.json({ enableLlmRules: updated.enableLlmRules ?? null });
  } catch (error) {
    next(error);
  }
});

// GET /api/repos/:id/config - Read per-repo config.json
router.get('/:id/config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await requireRegistryEntry(req.params.id as string);
    res.json(await readProjectConfig(entry.path));
  } catch (error) {
    next(error);
  }
});

// GET /api/repos/:id/rules - Catalog with per-repo enabled overrides applied.
router.get('/:id/rules', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await requireRegistryEntry(req.params.id as string);
    res.json(await getRules(entry.path));
  } catch (error) {
    next(error);
  }
});

// PATCH /api/repos/:id/rules/:ruleKey - Toggle a single rule for this repo.
// Rule keys contain slashes so the client must URL-encode the key segment.
router.patch('/:id/rules/:ruleKey', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await requireRegistryEntry(req.params.id as string);
    const ruleKey = req.params.ruleKey as string;
    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== 'boolean') {
      throw createAppError('Body must include `enabled: boolean`', 400);
    }

    const all = await getRules();
    if (!all.some((r) => r.key === ruleKey)) {
      throw createAppError(`Unknown rule: ${ruleKey}`, 404);
    }

    const current = await readProjectConfig(entry.path);
    const set = new Set<string>(current.disabledRules ?? []);
    if (enabled) set.delete(ruleKey);
    else set.add(ruleKey);
    await updateProjectConfig(entry.path, { disabledRules: [...set].sort() });

    res.json({ key: ruleKey, enabled });
  } catch (error) {
    next(error);
  }
});

export default router;
