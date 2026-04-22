import * as p from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { closeLogger, configureLogger } from "@truecourse/server/lib/logger";
import { readLatest } from "@truecourse/server/lib/analysis-store";
import {
  appendRejectedSignature,
  computeSignature,
  deleteAdrDraft,
  listAdrDrafts,
  loadAdrById,
  readAdrCorpus,
  readAdrDraft,
  readRejectedSignatures,
  writeAdrCorpus,
  writeAdrDraft,
} from "@truecourse/server/lib/adr-store";
import { acceptAdrDraft } from "@truecourse/server/lib/adr-writer";
import {
  suggestAdrsInProcess,
  type AdrSuggestEvent,
} from "@truecourse/server/services/llm/adr-suggester";
import { createLLMProvider } from "@truecourse/server/services/llm/provider";
import { readProjectConfig } from "@truecourse/server/config/project-config";
import type { AdrDraft, AdrIndexEntry } from "@truecourse/shared";
import { requireRegisteredRepo, isInteractive } from "./helpers.js";
import { runAnalyze } from "./analyze.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function ensureLatestIsFresh(repoPath: string): Promise<void> {
  // Right now we only check LATEST exists. A finer mtime-vs-sources check
  // lives in analyze itself — we just make sure something is there to
  // draft against.
  const latest = readLatest(repoPath);
  if (latest) return;

  p.log.info("No analysis found — running `truecourse analyze` first.");
  await runAnalyze({});
}

function resolveOutputDirOverride(repoPath: string, configured?: string | null): string | undefined {
  if (!configured) return undefined;
  if (path.isAbsolute(configured)) return configured;
  return path.join(repoPath, configured);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

// ---------------------------------------------------------------------------
// truecourse adr suggest
// ---------------------------------------------------------------------------

export interface AdrSuggestOptions {
  threshold?: string;
  max?: string;
  topic?: string;
  nonInteractive?: boolean;
  json?: boolean;
}

export async function runAdrSuggest(opts: AdrSuggestOptions): Promise<void> {
  const repo = requireRegisteredRepo();

  // Route internal diagnostics (`[adr-suggest]`, `[CLI] ADR survey ...`, etc.)
  // to the repo's adr.log. Without this, `log.info/warn` from the suggester
  // and CLI provider fall through the logger's silent fallback.
  configureLogger({
    filePath: path.join(repo.path, ".truecourse/logs/adr.log"),
  });

  try {
    await runAdrSuggestInner(repo, opts);
  } finally {
    await closeLogger();
  }
}

async function runAdrSuggestInner(
  repo: ReturnType<typeof requireRegisteredRepo>,
  opts: AdrSuggestOptions,
): Promise<void> {
  await ensureLatestIsFresh(repo.path);
  const latest = readLatest(repo.path);
  if (!latest) {
    p.log.error("Analyze did not produce a LATEST snapshot. Aborting.");
    process.exit(1);
  }

  const config = readProjectConfig(repo.path);
  const threshold = opts.threshold != null ? Number(opts.threshold) : config.adr?.defaultThreshold ?? undefined;
  const max = opts.max != null ? Number(opts.max) : config.adr?.maxDraftsPerRun ?? undefined;
  const jsonMode = opts.json === true;
  const nonInteractive = opts.nonInteractive === true || jsonMode || !isInteractive();

  const provider = createLLMProvider();
  provider.setRepoPath(repo.path);

  const corpus = readAdrCorpus(repo.path);
  const rejected = readRejectedSignatures(repo.path);

  let spinner: ReturnType<typeof p.spinner> | null = null;
  if (!nonInteractive) {
    spinner = p.spinner();
    spinner.start("Surveying the graph for undocumented decisions…");
  }

  const onProgress = (event: AdrSuggestEvent) => {
    if (jsonMode) return;   // buffered output; progress printed at end
    if (!spinner) return;
    switch (event.kind) {
      case "survey-done":
        spinner.message(
          `Survey complete — ${event.afterFilter}/${event.candidates} candidates surviving filter`,
        );
        break;
      case "draft-start":
        spinner.message(`Drafting: ${event.topic} [${event.entities.join(", ")}]`);
        break;
      case "draft-done":
        spinner.message(`Draft written: ${event.draft.title}`);
        break;
      case "draft-dropped":
        spinner.message(`Dropped draft (${event.reason})`);
        break;
      default:
        // survey-start, candidate-dropped, complete — leave spinner message alone
        break;
    }
  };

  let result;
  try {
    result = await suggestAdrsInProcess({
      repoPath: repo.path,
      graph: latest.graph,
      existingAdrs: corpus?.adrs ?? [],
      rejectedSignatures: rejected,
      maxDrafts: Number.isFinite(max) ? max : undefined,
      threshold: Number.isFinite(threshold) ? threshold : undefined,
      topicHint: opts.topic,
      onProgress,
      provider,
    });
  } catch (err) {
    if (spinner) spinner.stop("Suggest failed");
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (spinner) spinner.stop(`Produced ${result.drafts.length} draft${result.drafts.length === 1 ? "" : "s"}`);

  if (jsonMode) {
    const summary = {
      drafts: result.drafts.map((d) => ({
        id: d.id,
        title: d.title,
        topic: d.topic,
        entities: d.entities,
        confidence: d.confidence,
      })),
      dropped: result.dropped,
      surveyCandidateCount: result.surveyCandidateCount,
    };
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (result.drafts.length === 0) {
    p.log.info("No drafts to review.");
    if (result.dropped.length) {
      p.log.info(`Dropped ${result.dropped.length} candidate(s) — run with --json for details.`);
    }
    return;
  }

  if (nonInteractive) {
    p.log.info(`Drafts written to .truecourse/drafts/. Review with:\n  truecourse adr drafts\n  truecourse adr accept <id>  |  truecourse adr reject <id>`);
    return;
  }

  // Interactive review loop.
  for (const draft of result.drafts) {
    p.log.message("");
    p.log.message(`\x1b[1m${draft.title}\x1b[0m`);
    p.log.message(`  topic: ${draft.topic}`);
    p.log.message(`  entities: ${draft.entities.join(", ")}`);
    p.log.message(`  confidence: ${draft.confidence.toFixed(2)}`);
    p.log.message("");
    const action = await p.select({
      message: "What next?",
      options: [
        { value: "accept", label: "Accept — write ADR-NNNN-<slug>.md" },
        { value: "edit", label: "Edit — open in $EDITOR" },
        { value: "reject", label: "Reject — persist signature, discard" },
        { value: "skip", label: "Skip — leave in review queue" },
      ],
    });
    if (p.isCancel(action) || action === "skip") continue;

    if (action === "accept") {
      await acceptDraftInteractive(repo.path, draft);
    } else if (action === "reject") {
      rejectDraft(repo.path, draft);
    } else if (action === "edit") {
      const updated = editDraftInEditor(draft);
      if (updated) {
        writeAdrDraft(repo.path, updated);
        p.log.success("Draft updated. Re-run `truecourse adr drafts` to review again.");
      }
    }
  }
}

async function acceptDraftInteractive(repoPath: string, draft: AdrDraft): Promise<void> {
  const config = readProjectConfig(repoPath);
  const outputDir = resolveOutputDirOverride(repoPath, config.adr?.path);
  try {
    const { adr, filePath } = await acceptAdrDraft({ repoPath, draft, outputDir });
    p.log.success(`Accepted → ${adr.id} at ${filePath}`);
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err));
  }
}

function rejectDraft(repoPath: string, draft: AdrDraft): void {
  const signature = computeSignature(draft);
  appendRejectedSignature(repoPath, signature);
  deleteAdrDraft(repoPath, draft.id);
  p.log.info(`Rejected. Signature saved so this topic won't reappear.`);
}

// ---------------------------------------------------------------------------
// truecourse adr drafts
// ---------------------------------------------------------------------------

export async function runAdrDrafts(opts: { json?: boolean } = {}): Promise<void> {
  const repo = requireRegisteredRepo();
  const drafts = listAdrDrafts(repo.path);

  if (opts.json) {
    console.log(JSON.stringify({ drafts }, null, 2));
    return;
  }

  if (drafts.length === 0) {
    p.log.info("No pending drafts. Run `truecourse adr suggest` to generate some.");
    return;
  }

  p.log.info(`${drafts.length} pending draft${drafts.length === 1 ? "" : "s"}:`);
  for (const d of drafts) {
    console.log("");
    console.log(`  ${d.id}`);
    console.log(`    title:      ${d.title}`);
    console.log(`    topic:      ${d.topic}`);
    console.log(`    entities:   ${d.entities.join(", ")}`);
    console.log(`    confidence: ${d.confidence.toFixed(2)}`);
    console.log(`    created:    ${d.createdAt}`);
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// truecourse adr accept / reject / edit
// ---------------------------------------------------------------------------

export async function runAdrAccept(draftId: string): Promise<void> {
  const repo = requireRegisteredRepo();
  const draft = readAdrDraft(repo.path, draftId);
  if (!draft) {
    p.log.error(`Draft "${draftId}" not found.`);
    process.exit(1);
  }
  await acceptDraftInteractive(repo.path, draft);
}

export async function runAdrReject(draftId: string): Promise<void> {
  const repo = requireRegisteredRepo();
  const draft = readAdrDraft(repo.path, draftId);
  if (!draft) {
    p.log.error(`Draft "${draftId}" not found.`);
    process.exit(1);
  }
  rejectDraft(repo.path, draft);
}

export async function runAdrEdit(draftId: string): Promise<void> {
  const repo = requireRegisteredRepo();
  const draft = readAdrDraft(repo.path, draftId);
  if (!draft) {
    p.log.error(`Draft "${draftId}" not found.`);
    process.exit(1);
  }
  const updated = editDraftInEditor(draft);
  if (updated) {
    writeAdrDraft(repo.path, updated);
    p.log.success("Draft updated.");
  }
}

function editDraftInEditor(draft: AdrDraft): AdrDraft | null {
  const editor = process.env.EDITOR || process.env.VISUAL || "nano";
  const tmp = path.join(os.tmpdir(), `truecourse-draft-${draft.id}-${Date.now()}.md`);
  try {
    fs.writeFileSync(tmp, draft.madrBody, "utf-8");
    const result = spawnSync(editor, [tmp], { stdio: "inherit" });
    if (result.status !== 0) {
      p.log.warn("Editor exited non-zero; leaving draft unchanged.");
      return null;
    }
    const next = fs.readFileSync(tmp, "utf-8");
    if (next.trim() === draft.madrBody.trim()) {
      p.log.info("No changes.");
      return null;
    }
    return { ...draft, madrBody: next };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// truecourse adr list / show / stale
// ---------------------------------------------------------------------------

export async function runAdrList(opts: { json?: boolean; status?: string; linkedTo?: string } = {}): Promise<void> {
  const repo = requireRegisteredRepo();
  const corpus = readAdrCorpus(repo.path);
  let adrs = corpus?.adrs ?? [];

  if (opts.status) adrs = adrs.filter((a) => a.status === opts.status || (opts.status === "stale" && a.isStale));
  if (opts.linkedTo) adrs = adrs.filter((a) => a.linkedNodeIds.includes(opts.linkedTo!));

  if (opts.json) {
    console.log(JSON.stringify({ adrs }, null, 2));
    return;
  }

  if (adrs.length === 0) {
    p.log.info("No ADRs match.");
    return;
  }

  for (const adr of adrs) {
    const staleTag = adr.isStale ? " \x1b[33m[stale]\x1b[0m" : "";
    console.log(`  ${adr.id}  ${adr.status.padEnd(10)}  ${truncate(adr.title, 60)}${staleTag}`);
  }
  console.log("");
}

export async function runAdrShow(adrId: string, opts: { json?: boolean } = {}): Promise<void> {
  const repo = requireRegisteredRepo();
  const adr = loadAdrById(repo.path, adrId);
  if (!adr) {
    p.log.error(`ADR "${adrId}" not found.`);
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify({ adr }, null, 2));
    return;
  }

  console.log("");
  console.log(`  \x1b[1m${adr.id}: ${adr.title}\x1b[0m`);
  console.log(`  status:  ${adr.status}${adr.isStale ? "  \x1b[33m(stale)\x1b[0m" : ""}`);
  console.log(`  date:    ${adr.date}`);
  console.log(`  path:    ${adr.path}`);
  if (adr.linkedNodeIds.length) console.log(`  linked:  ${adr.linkedNodeIds.join(", ")}`);
  if (adr.supersedes?.length) console.log(`  supersedes: ${adr.supersedes.join(", ")}`);
  if (adr.supersededBy) console.log(`  superseded-by: ${adr.supersededBy}`);
  if (adr.staleReasons?.length) console.log(`  stale: ${adr.staleReasons.join(", ")}`);
  console.log("");
  console.log("  ## Context\n" + indent(adr.sections.context, "  "));
  console.log("");
  console.log("  ## Decision\n" + indent(adr.sections.decision, "  "));
  console.log("");
  console.log("  ## Consequences\n" + indent(adr.sections.consequences, "  "));
  console.log("");
}

export async function runAdrStale(opts: { json?: boolean } = {}): Promise<void> {
  const repo = requireRegisteredRepo();
  const corpus = readAdrCorpus(repo.path);
  const stale = (corpus?.adrs ?? []).filter((a) => a.isStale);

  if (opts.json) {
    console.log(JSON.stringify({ adrs: stale }, null, 2));
    return;
  }

  if (stale.length === 0) {
    p.log.info("No stale ADRs.");
    return;
  }

  for (const adr of stale) {
    console.log(`  ${adr.id}  ${truncate(adr.title, 60)}`);
    for (const reason of adr.staleReasons ?? []) {
      console.log(`    - ${reason}`);
    }
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// truecourse adr link / unlink
// ---------------------------------------------------------------------------

export async function runAdrLink(adrId: string, nodeId: string): Promise<void> {
  const repo = requireRegisteredRepo();
  const updated = mutateCorpusLinks(repo.path, adrId, (links) =>
    Array.from(new Set([...links, nodeId])),
  );
  if (!updated) {
    p.log.error(`ADR "${adrId}" not found.`);
    process.exit(1);
  }
  p.log.success(`Linked ${nodeId} → ${adrId}`);
}

export async function runAdrUnlink(adrId: string, nodeId: string): Promise<void> {
  const repo = requireRegisteredRepo();
  const updated = mutateCorpusLinks(repo.path, adrId, (links) =>
    links.filter((id) => id !== nodeId),
  );
  if (!updated) {
    p.log.error(`ADR "${adrId}" not found.`);
    process.exit(1);
  }
  p.log.success(`Unlinked ${nodeId} from ${adrId}`);
}

function mutateCorpusLinks(
  repoPath: string,
  adrId: string,
  transform: (links: string[]) => string[],
): AdrIndexEntry | null {
  const corpus = readAdrCorpus(repoPath);
  if (!corpus) return null;
  const idx = corpus.adrs.findIndex((a) => a.id === adrId);
  if (idx === -1) return null;
  const updated = { ...corpus.adrs[idx]! };
  updated.linkedNodeIds = transform(updated.linkedNodeIds);
  corpus.adrs[idx] = updated;
  writeAdrCorpus(repoPath, { ...corpus, generatedAt: new Date().toISOString() });
  return updated;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function indent(text: string, prefix: string): string {
  return text.split("\n").map((line) => `${prefix}${line}`).join("\n");
}
