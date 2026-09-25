/**
 * Guard routes — the dashboard read surface for spec-section scenario coverage.
 * Read-only (no generate/run triggering here) and diff-free by design: guard shows
 * current state only. Thin adapters over the `@truecourse/core` guard drivers.
 *
 *   GET /:id/guard/status        composed status summary (coverage / last run / last generate)
 *   GET /:id/guard/latest        the last run's per-scenario results (+ failure/evidence + runFlows)
 *   GET /:id/guard/history       the baseline run trend (?all=1: every stored run, not just the trend)
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
 *   GET /:id/guard/setup         the last `guard setup` report (?commit= pins one)
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { orgOf } from '../services/workspace-llm.service.js';
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
  readGuardDecisions,
  computeGuardStaleness,
  composeDocCoverage,
  listGuardScenarios,
  listGuardFlows,
  readGuardFlowDetail,
  readGuardFlowsForView,
  readGuardScenariosForView,
  readGuardInterfaces,
  readGuardClaims,
  readGuardClaimsForView,
  readGuardRunFlows,
  guardExternalSetupIndexForView,
  type GuardEvidenceLocator,
} from '@truecourse/core/commands/guard-read';
import { readRepoDependencies } from '../services/guard-dependencies.service.js';
import { readGuardSetup } from '@truecourse/core/commands/guard-setup';
import { readBundleGuardSetup } from '@truecourse/core/services/guard-setup/bundle';
import {
  listGuardVersions,
  loadGuardSetupBundle,
  readGuardVersion,
  readManifest,
  restoreGuardScenarioSet,
  versionAt,
} from '@truecourse/core/lib/guard-store';
import { emitRepoLifecycle } from '@truecourse/core/lib/repo-lifecycle';
import { diffScenarioSets, type GuardVersionArtifact } from '@truecourse/shared';
import { refOf } from './route-params.js';

const router: Router = Router();

// The composed status overview — always 200 (each piece is null until its command
// has run), so the tab renders empty-state CTAs rather than erroring.
router.get('/:id/guard/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    const ref = refOf(req);
    // With `?ref=<commit>`: the run is the one stored at that commit and never
    // the baseline; the generate-side inputs (manifest / result) fall back to
    // the baseline set when that commit stored none.
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
// exists, the empty-state CTA). With `ref` (a commit) → the run stored at THAT
// commit, `{ latest: null }` when none is — never the baseline under another
// commit's header.
//
// Both shapes carry `runFlows`: the milestone chains of the flows THIS run's
// results reference, so the Runs tab paints a result as a flow instance without a
// second fetch (a read-time join; the stored run object itself is untouched).
router.get('/:id/guard/latest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
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
    if (!latest) {
      res.json({ latest: null });
      return;
    }
    res.json({ latest: { ...latest, runFlows: await readGuardRunFlows(repo.path, latest, ref) } });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/guard/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    // `?all=1`: every run the store holds, not just the baseline trend — the Runs
    // list of a connected repository.
    res.json(await readGuardHistory(repo.path, { all: req.query.all === '1' }));
  } catch (e) {
    next(e);
  }
});

// One past run snapshot, with the same `runFlows` join `/latest` carries so a run
// selected from the history paints its flow instances too.
router.get('/:id/guard/runs/:runId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
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
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
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
// `?ref=` is accepted for the guard-side join; the document body is the
// workspace's current one (the doc reader takes no revision).
router.get('/:id/guard/coverage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
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
    // With a pinned commit: the run is the one stored at that commit, never the
    // baseline; the join falls back to the baseline set.
    res.json(
      composeDocCoverage(doc, content, {
        scenarios: await readGuardScenariosForView(repo.path, commit),
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
        // that promotes a providable `blocked-on` section to `needs-setup`,
        // read from the stored overlay.
        externals: await guardExternalSetupIndexForView(repo.path, refOf(req)),
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
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    res.json(await listGuardFlows(repo.path, refOf(req)));
  } catch (e) {
    next(e);
  }
});

// One flow's detail. 404 when no flow (synthesized, generated, or Manual) carries
// the id — the client re-lists rather than rendering a hollow panel.
router.get('/:id/guard/flows/:flowId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
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
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    res.json(await readGuardInterfaces(repo.path, refOf(req)));
  } catch (e) {
    next(e);
  }
});

// THE RAW ARTIFACT behind one entity — the second reading every artifact-backed
// surface offers (View + the stored file). Each answers the entity's own slice of
// its JSON store, pretty-printed by the driver; 404 when the store, or that entry
// in it, does not exist. The id selects INSIDE an already-read file and never
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
      const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
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
  rawArtifactRoute(readGuardInterfaceRaw, 'interface'),
);
router.get('/:id/guard/flow/raw', rawArtifactRoute(readGuardFlowRaw, 'flow'));
router.get('/:id/guard/claim/raw', rawArtifactRoute(readGuardClaimRaw, 'claim'));
// One dependency-catalog entry, addressed by its NAME (a catalog entry has no id).
// The gitignored instance overlay has no raw route and never will: it holds the
// registered values, and a stored secret is never handed back.
router.get('/:id/guard/dependency/raw', rawArtifactRoute(readGuardDependencyRaw, 'dependency'));
// The repo's ONE recipe — no id, and every inline secret masked by the driver
// (the same mask the recipe card shows).
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
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
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
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    res.json(await listGuardScenarios(repo.path, refOf(req)));
  } catch (e) {
    next(e);
  }
});

router.get('/:id/guard/scenario', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
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
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
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
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
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
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
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
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
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
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    res.json(await readGuardDecisions(repo.path));
  } catch (e) {
    next(e);
  }
});

router.get('/:id/guard/staleness', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    res.json(await computeGuardStaleness(repo.path, refOf(req)));
  } catch (e) {
    next(e);
  }
});


/** The series a `?artifact=` names; the scenario sets when it names none. */
function guardVersionArtifact(query: unknown): GuardVersionArtifact | null {
  const artifact = query == null || query === '' ? 'scenarios' : String(query);
  return artifact === 'scenarios' || artifact === 'report' || artifact === 'setup' ? artifact : null;
}

// GET — one series of this repository's generated state, newest first, each
// version with its provenance: the run that wrote it, the model, the commit.
// `?artifact=scenarios|report|setup` (the scenario sets unless named);
// `?scope=` reads another line of versions than the default branch's.
router.get('/:id/guard/versions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    const artifact = guardVersionArtifact(req.query.artifact);
    if (!artifact) {
      res.status(400).json({ error: 'artifact must be scenarios, report or setup.' });
      return;
    }
    const scope = req.query.scope ? String(req.query.scope) : undefined;
    res.json({ versions: await listGuardVersions(repo.path, artifact, scope ? { scope } : {}) });
  } catch (e) {
    next(e);
  }
});

// GET — what changed between two versions of the scenario set: the flows
// added, retired and amended, the scenarios that came and went, the sections
// that gained or lost coverage. `?from=` and `?to=` are version ids, and the
// answer carries both versions' provenance so it can say which run, on which
// model, made the change.
router.get('/:id/guard/versions/diff', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    const fromId = String(req.query.from ?? '');
    const toId = String(req.query.to ?? '');
    if (!fromId || !toId) {
      res.status(400).json({ error: 'Missing ?from=<version id>&to=<version id>.' });
      return;
    }
    const [from, to] = await Promise.all([
      readGuardVersion(repo.path, 'scenarios', fromId),
      readGuardVersion(repo.path, 'scenarios', toId),
    ]);
    if (!from || !to) {
      res.status(404).json({ error: `No scenario set version ${!from ? fromId : toId}.` });
      return;
    }
    const [prior, current] = await Promise.all([
      readManifest(repo.path, { id: from.id }),
      readManifest(repo.path, { id: to.id }),
    ]);
    res.json({ from, to, diff: diffScenarioSets(prior, current) });
  } catch (e) {
    next(e);
  }
});

// POST — roll the scenario set back to an older version. The version comes
// back as a NEW one holding the same files, so the series stays append-only
// and the rollback is on record; the next generate reconciles against it and
// the next run runs it. 404 when the id names no scenario set of this repository.
router.post(
  '/:id/guard/versions/:versionId/restore',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const repo = await resolveProjectForRequest(org, req.params.id as string);
      const version = await restoreGuardScenarioSet(repo.path, req.params.versionId as string);
      if (!version) {
        res.status(404).json({ error: 'No such scenario set version.' });
        return;
      }
      // The guard surfaces re-read on this, the way they do after a generate.
      await emitRepoLifecycle(org, repo.path, 'guard-generate');
      res.json({ version });
    } catch (e) {
      next(e);
    }
  },
);

// GET — what `guard setup` last decided for this repository: the recipe it
// derived, the dependencies it catalogued, the seed it drafted, and the step
// spine that says which of those are settled. It lives in the setup BUNDLE
// (`?commit=` pins a commit; without one the newest bundle answers). 404 when
// setup has never run.
router.get('/:id/guard/setup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    const commit = req.query.commit ? String(req.query.commit) : undefined;
    const bundle = await loadGuardSetupBundle(repo.path, versionAt(commit));
    const report = bundle ? readBundleGuardSetup(bundle) : null;
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
// one blocks, and the external-service half where the row is one. The view is
// composed over a scratch tree of the repo's stored state — the setup bundle,
// the scenario set, the generate report and the encrypted overlays — with an
// EMPTY host env, so the server's own variables never read as a registered
// account.
router.get('/:id/guard/dependencies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    res.json(await readRepoDependencies(repo.path, refOf(req)));
  } catch (e) {
    next(e);
  }
});

export default router;
