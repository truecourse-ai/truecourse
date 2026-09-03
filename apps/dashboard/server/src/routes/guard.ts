/**
 * Guard routes — the dashboard read surface for spec-section scenario coverage.
 * Read-only (no generate/run triggering here) and diff-free by design: guard shows
 * current state only. Thin adapters over the `@truecourse/core` guard drivers.
 *
 *   GET /:id/guard/status        composed status summary (coverage / last run / last generate)
 *   GET /:id/guard/latest        the last run's per-scenario results (+ failure/evidence + runFlows)
 *   GET /:id/guard/history       append-only run-summary history
 *   GET /:id/guard/runs/:runId   one past run snapshot (+ runFlows)
 *   GET /:id/guard/report        the last `guard generate` report
 *   GET /:id/guard/coverage      per-section coverage join for ?doc=<path> (over the live doc)
 *   GET /:id/guard/flows         the flow inventory + recipe card (the Flows tab)
 *   GET /:id/guard/flows/:flowId one flow: milestones, per-surface scenarios, gaps, findings
 *   GET /:id/guard/interfaces    the code-derived interface catalog + its reverse index
 *   GET /:id/guard/dependencies  the dependency catalog joined with its registered instances
 *   GET /:id/guard/dependency/raw one catalog entry in scenarios/dependencies.json by ?id=<name>
 *   GET /:id/guard/interface/raw one catalog entry's stored JSON, by ?id=
 *   GET /:id/guard/scenarios     the committed-scenario inventory + recipe card
 *   GET /:id/guard/scenario      a scenario's YAML source + step list by ?id= (+ per-step
 *                                actuals when ?runId= / ?evidencePath= names where it ran)
 *   GET /:id/guard/interface/raw   one interface's entry in guard/interfaces.json by ?id=
 *   GET /:id/guard/flow/raw      one flow's entry in scenarios/flows.json by ?id=
 *   GET /:id/guard/claim/raw     one claim's entry in scenarios/claims.json by ?id=
 *   GET /:id/guard/recipe/raw    scenarios/recipe.json itself, inline secrets masked
 *   GET /:id/guard/evidence      one evidence file for ?runId=&scenarioId=[&file=transcript.txt]
 *   GET /:id/guard/finding-evidence  one evidence file for a finding by ?path=<evidenceDir>[&file=]
 *   GET /:id/guard/evidence/visuals  a scenario's screenshots + session video (names only)
 *   GET /:id/guard/evidence/visual   one of those files, as image/png or video/webm
 *   GET /:id/guard/decisions     the committable guard decisions (dismissed claims)
 *   GET /:id/guard/staleness     the two amber-dot signals (generate / run)
 *   GET /:id/guard/externals     detected + declared external API accounts
 *   GET /:id/guard/setup         the last `guard setup` report (?commit= pins one)
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { readRepoDoc } from '@truecourse/core/lib/repo-doc-reader';
import { composeGuardStatus, GUARD_VISUAL_CONTENT_TYPE } from '@truecourse/shared';
import {
  readManifestForView,
  readGuardRunForView,
  readGuardSectionTotals,
  readGuardHistory,
  readGuardResultForView,
  readGuardReport,
  readGuardRun,
  readGuardHistoryForPr,
  readGuardScenarioSource,
  readGuardInterfaceRaw,
  readGuardFlowRaw,
  readGuardClaimRaw,
  readGuardDependencyRaw,
  readGuardRecipeRaw,
  readGuardEvidence,
  readGuardEvidenceAt,
  listGuardEvidenceVisuals,
  readGuardEvidenceVisual,
  getGuardDecisions,
  computeGuardStaleness,
  composeDocCoverage,
  listGuardScenarios,
  listGuardFlows,
  readGuardFlowDetail,
  readGuardFlowsForView,
  readGuardInterfaces,
  readGuardClaims,
  readGuardClaimsForView,
  readGuardRunFlows,
  guardExternalSetupIndexForView,
  type GuardEvidenceLocator,
} from '@truecourse/core/commands/guard-read';
import { readGuardExternalsView } from '@truecourse/core/commands/guard-externals';
import { readGuardDependenciesView } from '@truecourse/core/commands/guard-dependencies';
import { withGuardReadTree } from '@truecourse/core/lib/guard-read-tree';
import { hostedDependenciesView } from './guard-dependencies-hosted.js';
import { readGuardSetup } from '@truecourse/core/commands/guard-setup';
import { readBundleGuardSetup } from '@truecourse/core/services/guard-setup/bundle';
import { guardsMaterializeInPlace, loadGuardSetupBundle } from '@truecourse/core/lib/guard-store';
import { getGuardGatePendingLookup } from '@truecourse/core/lib/guard-gate-pending';
import { prOf, refOf } from './route-params.js';

const router: Router = Router();

// The composed status overview — always 200 (each piece is null until its command
// has run), so the tab renders empty-state CTAs rather than erroring.
router.get('/:id/guard/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const ref = refOf(req);
    // PR view: the RUN comes from the PR head alone (never the baseline); the
    // generate-side inputs (manifest / result) fall back to the baseline set —
    // the one the gate executed — when the head persisted nothing.
    res.json(
      composeGuardStatus(
        await readManifestForView(repo.path, ref),
        await readGuardRunForView(repo.path, ref),
        await readGuardResultForView(repo.path, ref),
        await readGuardSectionTotals(repo.path, ref),
      ),
    );
  } catch (e) {
    next(e);
  }
});

// The last run's materialized state. No ref → the repo baseline (404 until a run
// exists, the empty-state CTA). With `ref` (a PR head) → the run stored at THAT
// commit; when none is stored the response is an explicit pending/empty envelope
// (`{ latest: null, pending }`) — never the baseline under a PR header.
//
// Both shapes carry `runFlows`: the milestone chains of the flows THIS run's
// results reference, so the Runs tab paints a result as a flow instance without a
// second fetch (a read-time join; the stored run object itself is untouched).
router.get('/:id/guard/latest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const ref = refOf(req);
    const latest = await readGuardRunForView(repo.path, ref);
    if (!ref) {
      if (!latest) {
        res.status(404).json({ error: 'No guard run has been recorded yet.' });
        return;
      }
      res.json({ ...latest, runFlows: await readGuardRunFlows(repo.path, latest, ref) });
      return;
    }
    if (latest) {
      const runFlows = await readGuardRunFlows(repo.path, latest, ref);
      res.json({ latest: { ...latest, runFlows }, pending: null });
      return;
    }
    // No run at this commit — surface an in-flight gate (EE) or a plain empty state.
    const pending = (await getGuardGatePendingLookup()?.(repo.path, ref)) ?? null;
    res.json({ latest: null, pending });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/guard/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    // `?pr=` (EE): the PR's own run timeline — one run per pushed head, via the
    // gate-heads seam — never the repo baseline history under a PR view.
    const pr = prOf(req);
    res.json(pr !== undefined ? await readGuardHistoryForPr(repo.path, pr) : await readGuardHistory(repo.path));
  } catch (e) {
    next(e);
  }
});

// One past run snapshot, with the same `runFlows` join `/latest` carries so a run
// selected from the history paints its flow instances too.
router.get('/:id/guard/runs/:runId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const run = await readGuardRun(repo.path, req.params.runId as string);
    if (!run) {
      res.status(404).json({ error: 'Guard run not found.' });
      return;
    }
    res.json({ ...run, runFlows: await readGuardRunFlows(repo.path, run, refOf(req)) });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/guard/report', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const report = await readGuardReport(repo.path, refOf(req));
    if (!report) {
      res.status(404).json({ error: 'No guard generate report yet.' });
      return;
    }
    res.json(report);
  } catch (e) {
    next(e);
  }
});

// The per-section coverage join over a live spec doc. `?doc=` is repo-relative;
// `?ref=` (EE) pins the revision the doc is read at (OSS ignores it).
router.get('/:id/guard/coverage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const doc = String(req.query.doc ?? '');
    if (!doc) {
      res.status(400).json({ error: 'Missing ?doc=<doc path>.' });
      return;
    }
    // Confine to the repo tree — no traversal (mirrors the Spec doc read).
    if (path.isAbsolute(doc) || doc.split(/[\\/]/).includes('..')) {
      res.status(400).json({ error: 'doc escapes the repository.' });
      return;
    }
    const commit = refOf(req);
    const content = await readRepoDoc(repo.path, doc, commit ? { commit } : undefined);
    if (content == null) {
      res.status(404).json({ error: `Doc not found: ${doc}` });
      return;
    }
    // PR view: the run comes from the PR head's stored run, never the baseline;
    // the manifest/flows/result join falls back to the baseline set the gate executed.
    res.json(
      composeDocCoverage(doc, content, {
        manifest: await readManifestForView(repo.path, commit),
        latest: await readGuardRunForView(repo.path, commit),
        result: await readGuardReport(repo.path, commit),
        // The flow corpus gives each section's flows their title and milestone
        // positions; absent, they degrade to manifest-derived rows.
        flows: await readGuardFlowsForView(repo.path, commit),
        // Resolves each gapped claim to its store id, so a gap row in the section
        // detail can link to the claim it is about.
        claims: await readGuardClaimsForView(repo.path, commit),
        // Which third parties the user could PROVIDE right now — the join
        // that promotes a providable `blocked-on` section to `needs-setup`. Null on
        // a hosted store (no working tree, no externals page to send anyone to).
        externals: guardExternalSetupIndexForView(repo.path),
      }),
    );
  } catch (e) {
    next(e);
  }
});

// The Flows tab payload — the flow inventory + recipe card. Always 200 (empty
// list / null recipe until anything is synthesized), so the tab renders its own
// empty states rather than erroring.
router.get('/:id/guard/flows', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    res.json(await listGuardFlows(repo.path, refOf(req)));
  } catch (e) {
    next(e);
  }
});

// One flow's detail. 404 when no flow (synthesized, generated, or Manual) carries
// the id — the client re-lists rather than rendering a hollow panel.
router.get('/:id/guard/flows/:flowId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const flowId = req.params.flowId as string;
    const detail = await readGuardFlowDetail(repo.path, flowId, refOf(req));
    if (!detail) {
      res.status(404).json({ error: `Flow not found: ${flowId}` });
      return;
    }
    res.json(detail);
  } catch (e) {
    next(e);
  }
});

// The Interfaces tab payload — the merged catalog, its reverse index onto the
// flows, and the detected-surface banner. Always 200: no snapshot yet reads as
// `mapped: false` with an empty catalog (the Map CTA state), and a store with no
// stored setup bundle reports `unavailable: 'no-working-tree'`.
router.get('/:id/guard/interfaces', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    res.json(await readGuardInterfaces(repo.path, refOf(req)));
  } catch (e) {
    next(e);
  }
});

// THE RAW ARTIFACT behind one entity — the second reading every artifact-backed
// surface offers (View + the stored file). Each answers the entity's own slice of
// its JSON store, pretty-printed by the driver; 404 when the store, or that entry
// in it, does not exist — which is also how a hosted repo reads, since the stores
// live in the working tree. The id selects INSIDE an already-read file and never
// reaches a path, so the store seam's own confinement is the whole path story.
//
// The scenario detail has no route here: its artifact is the whole YAML file,
// which `/guard/scenario` already returns as `content`.
const rawArtifactRoute = (
  read: (repoPath: string, id: string, ref?: string) => Promise<unknown | null>,
  what: string,
  /**
   * A SINGLETON artifact — one per repo, addressed by nothing (the recipe). No
   * `?id=` is required and the read receives an empty one: demanding an id for a
   * resource there is only one of would be a lie about it.
   */
  singleton = false,
) =>
  async function handle(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const id = String(req.query.id ?? '');
      if (!id && !singleton) {
        res.status(400).json({ error: `Missing ?id=<${what} id>.` });
        return;
      }
      const source = await read(repo.path, id, refOf(req));
      if (!source) {
        res.status(404).json({ error: `No stored ${what}: ${id}` });
        return;
      }
      res.json(source);
    } catch (e) {
      next(e);
    }
  };

router.get(
  '/:id/guard/interface/raw',
  rawArtifactRoute((repoPath, id) => readGuardInterfaceRaw(repoPath, id), 'interface'),
);
router.get('/:id/guard/flow/raw', rawArtifactRoute(readGuardFlowRaw, 'flow'));
router.get('/:id/guard/claim/raw', rawArtifactRoute(readGuardClaimRaw, 'claim'));
// One dependency-catalog entry, addressed by its NAME (a catalog entry has no id).
// The gitignored instance overlay has no raw route and never will: it holds the
// registered values, and a stored secret is never handed back.
router.get('/:id/guard/dependency/raw', rawArtifactRoute(readGuardDependencyRaw, 'dependency'));
// The repo's ONE recipe — no id, and every inline secret masked by the driver
// (the same mask `truecourse guard recipe` prints).
router.get(
  '/:id/guard/recipe/raw',
  rawArtifactRoute((repoPath, _id, ref) => readGuardRecipeRaw(repoPath, ref), 'recipe', true),
);

// The claims payload — the extracted claim corpus with the trace from claim to
// the flows that carry it and the scenario steps that prove it. Always 200: no
// claims store yet reads as `extracted: false` with empty lists, which is the
// client's own empty state.
router.get('/:id/guard/claims', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    res.json(await readGuardClaims(repo.path, refOf(req)));
  } catch (e) {
    next(e);
  }
});

// The committed-scenario inventory + recipe card — always 200 (empty inventory /
// null recipe until scenarios and a recipe exist), so the tab renders its own
// empty states rather than erroring.
router.get('/:id/guard/scenarios', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    res.json(await listGuardScenarios(repo.path, refOf(req)));
  } catch (e) {
    next(e);
  }
});

router.get('/:id/guard/scenario', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const id = String(req.query.id ?? '');
    if (!id) {
      res.status(400).json({ error: 'Missing ?id=<scenario id>.' });
      return;
    }
    // WHERE this test ran, when the caller knows: the steps then carry what each one
    // actually did there, next to what it asserts. Without it the answer is the
    // authored file alone — which is all that is true of a test that never ran.
    const runId = req.query.runId ? String(req.query.runId) : '';
    const evidencePath = req.query.evidencePath ? String(req.query.evidencePath) : '';
    const actualsFrom = runId
      ? { runId }
      : evidencePath
        ? { evidenceDir: evidencePath }
        : undefined;
    const source = await readGuardScenarioSource(repo.path, id, refOf(req), actualsFrom);
    if (!source) {
      res.status(404).json({ error: `Scenario not found: ${id}` });
      return;
    }
    res.json(source);
  } catch (e) {
    next(e);
  }
});

// One evidence file for a failed scenario. Path-safe: the driver rejects unsafe
// run ids / filenames and confines the read to the run's evidence dir.
router.get('/:id/guard/evidence', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const runId = String(req.query.runId ?? '');
    const scenarioId = String(req.query.scenarioId ?? '');
    if (!runId || !scenarioId) {
      res.status(400).json({ error: 'Missing ?runId= and ?scenarioId=.' });
      return;
    }
    const file = req.query.file ? String(req.query.file) : undefined;
    const content = await readGuardEvidence(repo.path, runId, scenarioId, file);
    if (content == null) {
      res.status(404).json({ error: 'Evidence not found.' });
      return;
    }
    res.type('text/plain').send(content);
  } catch (e) {
    next(e);
  }
});

/**
 * WHERE a scenario's evidence bundle is, off the query — a run (`?runId=`) or the
 * evidence directory a birth finding stored (`?evidencePath=`). The same two
 * addressing modes `/guard/scenario` takes for its per-step actuals, because it is
 * the same bundle; `null` when the query names neither.
 */
function evidenceLocatorOf(req: Request): GuardEvidenceLocator | null {
  const runId = String(req.query.runId ?? '');
  if (runId) return { runId };
  const evidencePath = String(req.query.evidencePath ?? '');
  return evidencePath ? { evidenceDir: evidencePath } : null;
}

// The VISUAL evidence of one scenario — the per-step screenshots and the session
// video a browser run leaves in the bundle, as names + kinds + step indexes (the
// bytes come from the sibling route below). Always 200: a cli/api run has none, and
// an empty list is the honest answer for it.
router.get('/:id/guard/evidence/visuals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const scenarioId = String(req.query.scenarioId ?? '');
    const from = evidenceLocatorOf(req);
    if (!from || ('runId' in from && !scenarioId)) {
      res.status(400).json({ error: 'Missing ?runId=&scenarioId= or ?evidencePath=.' });
      return;
    }
    res.json({ visuals: await listGuardEvidenceVisuals(repo.path, scenarioId, from) });
  } catch (e) {
    next(e);
  }
});

// ONE of those files, as bytes. Served with the media type its KIND dictates —
// never sniffed, and never a file that is not a visual (a transcript is text and is
// read through `/guard/evidence`). Path-safe by the same driver confinement the text
// reads use: an unsafe file name, or a locator resolving outside the evidence root,
// reads as a miss.
//
// RANGE-AWARE, because the video's scrubber lives or dies on it: a media element
// only offers seeking when the server answers byte ranges — Chromium classifies a
// plain-200 resource as a stream and pins `video.seekable` to zero even when the
// file's own metadata is complete. The bytes are already in memory, so a range is
// a subarray, not a second read; screenshots get partial reads for free.
router.get('/:id/guard/evidence/visual', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const scenarioId = String(req.query.scenarioId ?? '');
    const file = String(req.query.file ?? '');
    const from = evidenceLocatorOf(req);
    if (!from || !file || ('runId' in from && !scenarioId)) {
      res.status(400).json({ error: 'Missing ?file= and ?runId=&scenarioId= or ?evidencePath=.' });
      return;
    }
    const found = await readGuardEvidenceVisual(repo.path, scenarioId, from, file);
    if (!found) {
      res.status(404).json({ error: 'Evidence not found.' });
      return;
    }
    const bytes = found.bytes;
    res.type(GUARD_VISUAL_CONTENT_TYPE[found.visual.kind]);
    res.setHeader('Accept-Ranges', 'bytes');
    const ranges = req.range(bytes.length);
    if (ranges === -1) {
      // Unsatisfiable — the 416 that names the real size, so the client can re-ask.
      res.status(416).setHeader('Content-Range', `bytes */${bytes.length}`);
      res.end();
      return;
    }
    if (Array.isArray(ranges) && ranges.type === 'bytes' && ranges.length === 1) {
      const { start, end } = ranges[0]!;
      res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
      res.send(bytes.subarray(start, end + 1));
      return;
    }
    // No Range header — or one this route does not slice by (malformed, a unit
    // other than bytes, a multipart ask): the whole file is always a valid answer.
    res.send(bytes);
  } catch (e) {
    next(e);
  }
});

// One evidence file for a BIRTH FINDING, addressed by its stored `evidencePath`
// (`.truecourse/guard/evidence/<runId>/<scenarioId>`). Path-safe: the driver
// confines the read to the guard evidence root and rejects unsafe filenames.
router.get('/:id/guard/finding-evidence', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const evidencePath = String(req.query.path ?? '');
    if (!evidencePath) {
      res.status(400).json({ error: 'Missing ?path=<evidence dir>.' });
      return;
    }
    const file = req.query.file ? String(req.query.file) : undefined;
    const content = await readGuardEvidenceAt(repo.path, evidencePath, file);
    if (content == null) {
      res.status(404).json({ error: 'Evidence not found.' });
      return;
    }
    res.type('text/plain').send(content);
  } catch (e) {
    next(e);
  }
});

// The committable guard decisions file (dismissed claims). Always 200 (an empty
// file until the user dismisses anything), so the client can derive per-finding
// dismissed state without a 404 branch.
router.get('/:id/guard/decisions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const pr = prOf(req);
    // With `pr` (EE) the PR overlay is merged over the repo row; OSS has no overlay
    // dimension, so the driver ignores it there (the file store rejects a PR scope).
    res.json(await getGuardDecisions(repo.path, pr !== undefined ? { pr } : undefined));
  } catch (e) {
    next(e);
  }
});

router.get('/:id/guard/staleness', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    res.json(await computeGuardStaleness(repo.path, refOf(req)));
  } catch (e) {
    next(e);
  }
});

// GET — the external API accounts view: what the analyzer detected, what
// recipe.json declares, how each resolves on THIS machine (provided / incomplete /
// unprovided, with per-requirement reasons), and how many flows the last generate
// left blocked on each service. Reads the WORKING TREE (recipe.json + the
// gitignored overlay + the host env), so a store that does not materialize in place
// has nothing to answer with — 501, the same gate the map action uses.
router.get('/:id/guard/externals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    if (!guardsMaterializeInPlace()) {
      res.status(501).json({ error: 'External accounts require a local working tree.' });
      return;
    }
    res.json(readGuardExternalsView(repo.path));
  } catch (e) {
    next(e);
  }
});

// GET — what `guard setup` last decided for this repository: the recipe it
// derived, the dependencies it catalogued, the seed it drafted, and the step
// spine that says which of those are settled. Hosted repos keep it in the setup
// BUNDLE (`?commit=` pins a commit; without one the newest bundle answers); a
// working-tree store reads it off disk. 404 when setup has never run.
router.get('/:id/guard/setup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const commit = req.query.commit ? String(req.query.commit) : undefined;
    const bundle = await loadGuardSetupBundle(repo.path, commit);
    const report = bundle
      ? readBundleGuardSetup(bundle)
      : guardsMaterializeInPlace()
        ? readGuardSetup(repo.path)
        : null;
    if (!report) {
      res.status(404).json({ error: 'Guard setup has not run for this repository yet.' });
      return;
    }
    res.json({ report });
  } catch (e) {
    next(e);
  }
});

// GET — the DEPENDENCIES view: every class of starting state the program needs
// (the committed catalog) joined with the registered instances, the flows each
// one blocks, and the external-service half where the row is one. A working tree
// reads itself, host env included; a hosted repo composes the same view over a
// scratch tree of its stored state — the setup bundle, the scenario set, the
// generate report and the encrypted overlays — with an EMPTY host env, so the
// server's own variables never read as a registered account.
router.get('/:id/guard/dependencies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    if (guardsMaterializeInPlace()) {
      res.json(readGuardDependenciesView(repo.path));
      return;
    }
    res.json(
      await withGuardReadTree(repo.path, refOf(req), (tree) =>
        hostedDependenciesView(tree, readGuardDependenciesView(tree, { env: {}, hostless: true })),
      ),
    );
  } catch (e) {
    next(e);
  }
});

export default router;
