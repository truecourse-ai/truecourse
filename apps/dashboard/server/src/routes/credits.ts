/**
 * CREDITS, in two surfaces.
 *
 *   GET  /api/credits                  the balance, the statement, what is paused
 *   POST /api/credits/resume/:jobId    carry one paused run on
 *
 *   GET  /api/operator/credits         every workspace's balance and spend
 *   POST /api/operator/credits/grant   hand a workspace credits
 *   POST /api/operator/credits/adjust  correct a balance, either way
 *
 * The member's side is every member's: a balance is not a secret from the
 * people spending it. The operator's side is TrueCourse staff only, and a
 * caller who is not one is told the routes are NOT THERE rather than that they
 * are forbidden — an operator console a member can see the shape of is a
 * console a member knows to go looking at.
 *
 * Neither mounts in local mode: one developer on one machine has no operator to
 * grant anything and no platform key to spend (see `app.ts`).
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  CREDITS_EXHAUSTED,
  CREDITS_PRICES_UNAVAILABLE,
  CREDITS_PRICES_UNAVAILABLE_MESSAGE,
  usageJobTypeWord,
  type CreditEntryView,
  type CreditsResponse,
  type OperatorCreditsResponse,
} from '@truecourse/shared';
import type { CreditStatementRecord } from '@truecourse/core/lib/credits-store';
import { readCreditBalance } from '@truecourse/core/lib/credits-store';
import { priceOfConfig } from '@truecourse/core/services/llm/provider';
import {
  adjustWorkspaceCredits,
  creditStatement,
  creditsStartCheck,
  grantWorkspaceCredits,
  operatorCredits,
  pausedRuns,
  resumePausedJob,
} from '../services/credits.service.js';
import {
  creditsPriceModel,
  orgOf,
  workspaceOnCredits,
} from '../services/workspace-llm.service.js';
import { operatorOnly } from '../middleware/operator.js';
import {
  resolveWorkspaceName,
  type WorkspaceNameLookup,
} from '../services/workspace-name.service.js';

/** One statement line, named in the product's words rather than a job type's id. */
function toEntry(row: CreditStatementRecord): CreditEntryView {
  const base: CreditEntryView = {
    id: row.id,
    kind: row.kind,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    note: row.note,
    actorUserId: row.actorUserId,
    at: row.createdAt,
  };
  if (row.kind !== 'debit') return base;
  return {
    ...base,
    jobId: row.jobId ?? undefined,
    runId: row.runId,
    jobType: row.jobType ?? undefined,
    title: usageJobTypeWord(row.jobType ?? ''),
    repository: row.repoFullName,
  };
}

/**
 * The gate every start route runs before it queues anything, for a workspace
 * spending TrueCourse's credits. `true` means the route has answered and must
 * stop.
 *
 * At ZERO there is nothing to spend and the start is refused outright; with
 * no price for the model the run would be charged as, it could not be debited
 * and is refused too (503 `credits-prices-unavailable`). BELOW
 * WHAT THE RUN WOULD COST the answer asks instead of deciding: the run may
 * still be worth starting, it will simply pause part-way, and only the person
 * paying can say. A second request carrying `confirmCredits` is that answer.
 *
 * `estimateUsd` is the run's ceiling cost when the caller could work one out.
 * No hosted start route can today: every estimator reads a repository's working
 * tree, and a route has not cloned one — so the gates that fire are the empty
 * one and the price, and a priced start with money in the balance goes
 * straight through.
 */
export async function refusedWithoutCredits(
  req: Request,
  res: Response,
  opts: { estimateUsd?: number } = {},
): Promise<boolean> {
  const orgId = orgOf(req);
  if (!(await workspaceOnCredits(orgId))) return false;
  const check = await creditsStartCheck(orgId, {
    priceModel: creditsPriceModel(),
    ...(opts.estimateUsd === undefined ? {} : { estimateUsd: opts.estimateUsd }),
  });
  if (check.verdict === 'ok') return false;
  if (check.verdict === 'refused') {
    // No price is the server's state, not the workspace's: it clears once the
    // price list has been fetched, so it is answered as unavailable.
    if (check.reason === 'prices-unavailable') {
      res
        .status(503)
        .json({ error: CREDITS_PRICES_UNAVAILABLE, message: check.message, credits: check });
      return true;
    }
    res.status(409).json({ error: CREDITS_EXHAUSTED, message: check.message, credits: check });
    return true;
  }
  if ((req.body as { confirmCredits?: unknown } | undefined)?.confirmCredits === true) return false;
  res.status(200).json({ status: 'confirm', credits: check });
  return true;
}

export function createCreditsRouter(): Router {
  const router: Router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = orgOf(req);
      const [balance, statement, paused, onCredits] = await Promise.all([
        readCreditBalance(orgId),
        creditStatement(orgId),
        pausedRuns(orgId),
        workspaceOnCredits(orgId),
      ]);
      const body: CreditsResponse = {
        balance: balance.balance,
        lastGrantCredits: balance.lastGrantCredits,
        lastGrantAt: balance.lastGrantAt,
        entries: statement.map(toEntry),
        pausedRuns: paused,
        onCredits,
      };
      res.json(body);
    } catch (e) {
      next(e);
    }
  });

  // A member may carry a paused run on once the workspace can spend again —
  // either it has credits, or it has moved to a key of its own. Pressing this
  // while neither holds would only pause it again on the first call.
  router.post('/resume/:jobId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = orgOf(req);
      if (await workspaceOnCredits(orgId)) {
        const { balance } = await readCreditBalance(orgId);
        if (balance <= 0) {
          res.status(409).json({
            error: 'This workspace is out of credits. The run stays paused until it has some.',
          });
          return;
        }
        // Carried on with no price, the run would refuse at its start and end
        // failed; left paused, it can be carried on once the price is there.
        const priceModel = creditsPriceModel();
        if (priceModel !== null && !(await priceOfConfig({ model: priceModel }))) {
          res.status(503).json({
            error: CREDITS_PRICES_UNAVAILABLE,
            message: CREDITS_PRICES_UNAVAILABLE_MESSAGE,
          });
          return;
        }
      }
      const jobId = await resumePausedJob(orgId, req.params.jobId as string);
      if (!jobId) {
        res.status(404).json({ error: 'No paused run of this workspace has that id.' });
        return;
      }
      res.status(202).json({ jobId });
    } catch (e) {
      next(e);
    }
  });

  return router;
}

const movementSchema = z.object({
  workspaceOrgId: z.string().min(1).max(200),
  credits: z.number().int(),
  note: z.string().max(500).optional(),
  resumePaused: z.boolean().optional(),
});

/** What the operator's side is built from beyond the ledger itself. */
export interface OperatorCreditsRouterOptions {
  /**
   * An organization's display name, as the identity provider knows it: the
   * auth layer's cached lookup (`WorkspaceSessionTools.organizationName`).
   * Absent on a server with no identity provider, and then every row is listed
   * by its id.
   */
  workspaceName?: WorkspaceNameLookup;
}

export function createOperatorCreditsRouter(
  opts: OperatorCreditsRouterOptions = {},
): Router {
  const router: Router = Router();
  router.use(operatorOnly);

  // The ledger is one read; the names are one lookup each, all at once, and
  // mostly cached. A row nobody could name keeps its id.
  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await operatorCredits();
      const body: OperatorCreditsResponse = {
        workspaces: await Promise.all(
          rows.map(async (row) => ({
            ...row,
            workspaceName: await resolveWorkspaceName(opts.workspaceName, row.workspaceOrgId),
          })),
        ),
      };
      res.json(body);
    } catch (e) {
      next(e);
    }
  });

  router.post('/grant', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = movementSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid grant', details: parsed.error.flatten() });
        return;
      }
      if (parsed.data.credits <= 0) {
        res.status(400).json({ error: 'A grant adds credits; use Adjust to take them away.' });
        return;
      }
      res.json(
        await grantWorkspaceCredits({
          workspaceOrgId: parsed.data.workspaceOrgId,
          credits: parsed.data.credits,
          actorUserId: req.user!.id,
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
          ...(parsed.data.resumePaused === undefined
            ? {}
            : { resumePaused: parsed.data.resumePaused }),
        }),
      );
    } catch (e) {
      next(e);
    }
  });

  router.post('/adjust', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = movementSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid adjustment', details: parsed.error.flatten() });
        return;
      }
      if (parsed.data.credits === 0) {
        res.status(400).json({ error: 'An adjustment of nothing is not a correction.' });
        return;
      }
      res.json(
        await adjustWorkspaceCredits({
          workspaceOrgId: parsed.data.workspaceOrgId,
          credits: parsed.data.credits,
          actorUserId: req.user!.id,
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
        }),
      );
    } catch (e) {
      next(e);
    }
  });

  return router;
}
