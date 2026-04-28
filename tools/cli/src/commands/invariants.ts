import path from "node:path";
import * as p from "@clack/prompts";
import {
  suggestInvariants,
  acceptDraft,
  rejectDraft,
  retireBySlug,
  listActive,
  listPendingDrafts,
} from "@truecourse/core/services/invariants";
import { resolveRepoDir, ensureRepoTruecourseDir } from "@truecourse/core/config/paths";
import { createLLMProvider } from "@truecourse/core/services/llm/provider";
import { configureLogger, closeLogger } from "@truecourse/core/lib/logger";
import type { ProgressEvent } from "@truecourse/core/services/invariants";

function resolveRepo(): string {
  const repo = resolveRepoDir(process.cwd()) ?? process.cwd();
  ensureRepoTruecourseDir(repo);
  return repo;
}

function configureInvariantsLogger(repoPath: string): void {
  configureLogger({
    filePath: path.join(repoPath, ".truecourse/logs/invariants.log"),
  });
}

// ---------------------------------------------------------------------------
// suggest [--diff]
// ---------------------------------------------------------------------------

export async function runInvariantsSuggest(opts: { diff?: boolean }): Promise<void> {
  const repoPath = resolveRepo();
  configureInvariantsLogger(repoPath);

  const llm = createLLMProvider();
  llm.setRepoPath(repoPath);

  const mode = opts.diff ? "diff" : "full";
  const spinner = p.spinner();
  spinner.start(`Running invariant discovery in ${mode} mode…`);

  const onProgress = (e: ProgressEvent) => {
    switch (e.kind) {
      case "spec-loaded":
        spinner.message(
          e.empty
            ? `No spec sources found (searched ${e.searchedPaths.length} path(s))`
            : `Spec loaded: ${e.sections} section(s)`,
        );
        return;
      case "files-analyzed":
        spinner.message(`Analyzed ${e.count} source file(s)`);
        return;
      case "plugin-start":
        spinner.message(`${e.plugin}: starting`);
        return;
      case "plugin-progress":
        spinner.message(`${e.plugin}: ${e.label} (${e.current}/${e.total})`);
        return;
      case "plugin-end":
        spinner.message(`${e.plugin}: ${e.drafts} draft(s) (${e.durationMs}ms)`);
        return;
      case "plugin-failed":
        spinner.message(`${e.plugin}: failed — ${e.error}`);
        return;
    }
  };

  try {
    const result = await suggestInvariants({ repoPath, mode, llm, onProgress });
    spinner.stop(
      `Discovery done. ${result.drafts.length} draft(s) written to .truecourse/invariant-drafts/.`,
    );

    if (result.spec.empty) {
      p.log.warn(
        `No spec source detected.\nSearched: ${result.spec.searchedPaths.join(", ")}\n` +
          `Plugins that depend on spec input (e.g. rest-contract) will produce no candidates. ` +
          `Add a spec file (SPEC.md at repo root) or configure a source in .truecourse/config.json.`,
      );
    }

    p.log.info(`Plugins run: ${result.pluginsRun.join(", ") || "(none)"}.`);
    if (result.pluginsSkipped.length > 0) {
      p.log.warn(`Plugins skipped: ${result.pluginsSkipped.join(", ")}.`);
    }
    if (result.drafts.length > 0) {
      p.log.info(`Review with: truecourse invariants list-drafts`);
    }
  } catch (err) {
    spinner.error(`Discovery failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    await closeLogger();
  }
}

// ---------------------------------------------------------------------------
// list — show active invariants
// ---------------------------------------------------------------------------

export async function runInvariantsList(): Promise<void> {
  const repoPath = resolveRepo();
  const active = listActive(repoPath);

  if (active.length === 0) {
    p.log.info("No active invariants. Run `truecourse invariants suggest` to discover candidates.");
    return;
  }

  p.log.info(`Active invariants (${active.length}):`);
  for (const inv of active) {
    process.stdout.write(`  • ${inv.type} — ${inv.scope}  [${inv.id}]\n`);
  }
}

// ---------------------------------------------------------------------------
// list-drafts — show pending review queue
// ---------------------------------------------------------------------------

export async function runInvariantsListDrafts(): Promise<void> {
  const repoPath = resolveRepo();
  const drafts = listPendingDrafts(repoPath);

  if (drafts.length === 0) {
    p.log.info("No pending drafts.");
    return;
  }

  p.log.info(`Pending drafts (${drafts.length}):`);
  for (const d of drafts) {
    const conf = (d.confidence * 100).toFixed(0);
    process.stdout.write(`  • [${d.id.slice(0, 8)}] ${d.type} — ${d.scope}  (${conf}% confidence)\n`);
    process.stdout.write(`    ${d.rationale}\n`);
  }
}

// ---------------------------------------------------------------------------
// accept <draft-id>
// ---------------------------------------------------------------------------

export async function runInvariantsAccept(draftId: string): Promise<void> {
  const repoPath = resolveRepo();
  const result = acceptDraft(repoPath, draftId);
  p.log.success(`Accepted: ${result.slug} (${result.invariant.type} — ${result.invariant.scope})`);
}

// ---------------------------------------------------------------------------
// reject <draft-id>
// ---------------------------------------------------------------------------

export async function runInvariantsReject(draftId: string): Promise<void> {
  const repoPath = resolveRepo();
  rejectDraft(repoPath, draftId);
  p.log.success(`Rejected. The draft signature is persisted; discovery won't resurface it.`);
}

// ---------------------------------------------------------------------------
// retire <slug>
// ---------------------------------------------------------------------------

export async function runInvariantsRetire(slug: string): Promise<void> {
  const repoPath = resolveRepo();
  const removed = retireBySlug(repoPath, slug);
  if (removed) {
    p.log.success(`Retired ${slug}. Enforcement stops.`);
  } else {
    p.log.warn(`No active invariant with slug ${slug}.`);
  }
}
