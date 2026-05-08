import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import { isInteractive } from "./helpers.js";

// ---------------------------------------------------------------------------
// Hook identifier + script template
// ---------------------------------------------------------------------------

const HOOK_IDENTIFIER = "# TrueCourse auto-mode hook";
const BRANCH_MARKER = "# truecourse-branch:";

// `post-merge` covers `git pull` (default merge mode) and local merges.
// `post-rewrite` covers `git pull --rebase` and `pull.rebase=true`. Both
// gate on "current branch is the configured main branch", so installing
// both gives full coverage regardless of the team's pull strategy.
const HOOK_NAMES = ["post-merge", "post-rewrite"] as const;
type HookName = (typeof HOOK_NAMES)[number];

/**
 * Build the hook script with the branch name baked in. Baking it in (vs.
 * detecting at runtime via `origin/HEAD`) keeps the hook short and avoids
 * surprises when `origin/HEAD` is stale or unset. The trade-off is that
 * renaming the main branch later requires re-running `truecourse auto enable`.
 */
function buildHookScript(branch: string): string {
  return `#!/bin/sh
${HOOK_IDENTIFIER}
${BRANCH_MARKER} ${branch}
# Installed by: truecourse auto enable
# Disable with: truecourse auto disable
#
# After merges/rebases that land on the configured main branch, runs
# \`truecourse analyze --no-llm --no-stash\` detached so git returns instantly.
# Skips when another analyze is already in progress.

repo_root=\$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

current_branch=\$(git -C "\$repo_root" symbolic-ref --quiet --short HEAD 2>/dev/null) || exit 0
[ "\$current_branch" = "${branch}" ] || exit 0

[ -f "\$repo_root/.truecourse/.analyze.lock" ] && exit 0

if command -v truecourse >/dev/null 2>&1; then
  cmd=truecourse
else
  cmd="npx -y truecourse"
fi

mkdir -p "\$repo_root/.truecourse/logs"
( cd "\$repo_root" && nohup \$cmd analyze --no-llm --no-stash >> "\$repo_root/.truecourse/logs/auto.log" 2>&1 < /dev/null & )

exit 0
`;
}

/**
 * Extract the branch name baked into a hook script. Returns null if the
 * file isn't ours, or if it predates the branch marker.
 */
function readHookBranch(content: string): string | null {
  if (!content.includes(HOOK_IDENTIFIER)) return null;
  const match = content.match(new RegExp(`^${BRANCH_MARKER} (.+)$`, "m"));
  return match ? match[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Git directory resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the directory holding `hooks/` for the current repo. For a regular
 * checkout this is `<repo>/.git`. For a worktree, `.git` is a file pointing
 * at the worktree's gitdir; we then read `commondir` to land in the shared
 * git dir (hooks live there, not per-worktree).
 */
function findGitDir(from: string): string | null {
  let dir = from;
  while (true) {
    const gitPath = path.join(dir, ".git");
    if (fs.existsSync(gitPath)) {
      const stat = fs.statSync(gitPath);
      if (stat.isDirectory()) return gitPath;
      if (stat.isFile()) {
        const content = fs.readFileSync(gitPath, "utf-8").trim();
        const match = content.match(/^gitdir:\s*(.+)$/);
        if (match) {
          const worktreeGitDir = path.resolve(dir, match[1]);
          const commondirFile = path.join(worktreeGitDir, "commondir");
          if (fs.existsSync(commondirFile)) {
            const commondir = fs.readFileSync(commondirFile, "utf-8").trim();
            return path.resolve(worktreeGitDir, commondir);
          }
          return worktreeGitDir;
        }
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function findRepoRoot(from: string): string | null {
  let dir = from;
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function requireGitDir(): { gitDir: string; repoRoot: string } {
  const repoRoot = findRepoRoot(process.cwd());
  const gitDir = findGitDir(process.cwd());
  if (!gitDir || !repoRoot) {
    console.error("Error: Not a git repository.");
    process.exit(1);
  }
  return { gitDir, repoRoot };
}

// ---------------------------------------------------------------------------
// Branch detection + resolution
// ---------------------------------------------------------------------------

/**
 * Try to determine the repo's main branch. Returns the first hit:
 *   1. `origin/HEAD` symbolic ref (set by `git clone` / `git remote set-head`)
 *   2. Local `main` branch
 *   3. Local `master` branch
 * Returns null if none of these exist.
 */
function detectMainBranch(repoRoot: string): string | null {
  try {
    const ref = execSync(
      "git symbolic-ref --quiet refs/remotes/origin/HEAD",
      { cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (ref.startsWith("refs/remotes/origin/")) {
      return ref.slice("refs/remotes/origin/".length);
    }
  } catch {
    // origin/HEAD not set — fall through
  }
  for (const candidate of ["main", "master"]) {
    try {
      execSync(`git show-ref --verify --quiet refs/heads/${candidate}`, {
        cwd: repoRoot,
        stdio: "ignore",
      });
      return candidate;
    } catch {
      // not present — try next
    }
  }
  return null;
}

/**
 * Resolve which branch to bake into the hook. Priority:
 *   1. `--branch` flag (always wins, no prompt)
 *   2. interactive: prompt with auto-detected default
 *   3. non-interactive: use auto-detected silently; error if none
 */
async function resolveBranch(
  repoRoot: string,
  explicit: string | undefined,
): Promise<string> {
  if (explicit) {
    if (!/^[A-Za-z0-9._/-]+$/.test(explicit)) {
      console.error(
        `Error: invalid branch name "${explicit}". Use only letters, digits, dot, underscore, slash, or dash.`,
      );
      process.exit(1);
    }
    return explicit;
  }

  const detected = detectMainBranch(repoRoot);

  if (!isInteractive()) {
    if (detected) return detected;
    console.error(
      "Error: could not detect a main branch (no `origin/HEAD`, `main`, or `master`).\n" +
        "Pass --branch <name> to specify the branch the hook should fire on.",
    );
    process.exit(1);
  }

  const answer = await p.text({
    message: "Which branch should auto-mode trigger on?",
    placeholder: detected ?? "main",
    initialValue: detected ?? "",
    validate: (value) => {
      const v = (value ?? "").trim();
      if (!v) return "Branch name is required.";
      if (!/^[A-Za-z0-9._/-]+$/.test(v))
        return "Use only letters, digits, dot, underscore, slash, or dash.";
      return undefined;
    },
  });
  if (p.isCancel(answer)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return (answer as string).trim();
}

// ---------------------------------------------------------------------------
// Hook state inspection
// ---------------------------------------------------------------------------

interface HookState {
  name: HookName;
  path: string;
  exists: boolean;
  ours: boolean;
  branch: string | null;
}

function inspectHooks(gitDir: string): HookState[] {
  const hooksDir = path.join(gitDir, "hooks");
  return HOOK_NAMES.map((name) => {
    const hookPath = path.join(hooksDir, name);
    const exists = fs.existsSync(hookPath);
    if (!exists) {
      return { name, path: hookPath, exists, ours: false, branch: null };
    }
    const content = fs.readFileSync(hookPath, "utf-8");
    const ours = content.includes(HOOK_IDENTIFIER);
    return {
      name,
      path: hookPath,
      exists,
      ours,
      branch: ours ? readHookBranch(content) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// enable / disable / status
// ---------------------------------------------------------------------------

interface AutoEnableOptions {
  branch?: string;
}

export async function runAutoEnable(options: AutoEnableOptions = {}): Promise<void> {
  const { gitDir, repoRoot } = requireGitDir();
  const hooksDir = path.join(gitDir, "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });

  const states = inspectHooks(gitDir);

  // Refuse to overwrite hooks we didn't write — a user's existing post-merge
  // hook may be load-bearing (e.g. submodule sync, asset rebuild). Tell them
  // and bail rather than clobber.
  const conflicts = states.filter((s) => s.exists && !s.ours);
  if (conflicts.length > 0) {
    console.error(
      "Error: existing non-TrueCourse hooks would be overwritten:",
    );
    for (const c of conflicts) console.error(`  ${c.path}`);
    console.error(
      "\nMove or remove them (or fold the TrueCourse snippet into yours), then\n" +
        "re-run `truecourse auto enable`.",
    );
    process.exit(1);
  }

  const branch = await resolveBranch(repoRoot, options.branch);
  const script = buildHookScript(branch);

  for (const state of states) {
    fs.writeFileSync(state.path, script, { mode: 0o755 });
  }

  p.log.success(`TrueCourse auto mode enabled (trigger branch: ${branch}).`);
  for (const s of states) console.log(`  ${s.path}`);
  console.log(
    `\nWhen "${branch}" advances locally (merge or rebase), TrueCourse will run\n` +
      "`analyze --no-llm --no-stash` in the background.\n" +
      "Logs: .truecourse/logs/auto.log",
  );
}

export function runAutoDisable(): void {
  const { gitDir } = requireGitDir();
  const states = inspectHooks(gitDir);
  const ours = states.filter((s) => s.ours);

  if (ours.length === 0) {
    console.log("Auto mode is not enabled (no TrueCourse hooks found).");
    return;
  }

  for (const state of ours) {
    fs.unlinkSync(state.path);
    console.log(`Removed ${state.path}`);
  }
  p.log.success("TrueCourse auto mode disabled.");
}

export function runAutoStatus(): void {
  const { gitDir } = requireGitDir();
  const states = inspectHooks(gitDir);

  const ourCount = states.filter((s) => s.ours).length;
  const branches = new Set(
    states.filter((s) => s.ours && s.branch).map((s) => s.branch as string),
  );

  if (ourCount === states.length) {
    if (branches.size === 1) {
      console.log(`TrueCourse auto mode: enabled (branch: ${[...branches][0]})`);
    } else if (branches.size > 1) {
      // Hooks pointing at different branches — half-installed state from a
      // partial reinstall. Show both so the user can fix.
      console.log(
        `TrueCourse auto mode: enabled but inconsistent (branches: ${[...branches].join(", ")})`,
      );
      console.log("  Re-run `truecourse auto enable` to resync.");
    } else {
      console.log("TrueCourse auto mode: enabled (no branch recorded)");
      console.log("  Re-run `truecourse auto enable` to record the trigger branch.");
    }
  } else if (ourCount > 0) {
    console.log("TrueCourse auto mode: partially enabled");
  } else {
    console.log("TrueCourse auto mode: disabled");
    console.log('  Run "truecourse auto enable" to set up.');
  }

  for (const s of states) {
    let tag: string;
    if (s.ours) {
      tag = s.branch ? `TrueCourse (branch: ${s.branch})` : "TrueCourse";
    } else if (s.exists) {
      tag = "non-TrueCourse (will not be touched)";
    } else {
      tag = "not installed";
    }
    console.log(`  ${s.name}: ${tag}`);
    if (s.exists) console.log(`    ${s.path}`);
  }
}
