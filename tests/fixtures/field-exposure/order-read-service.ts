/**
 * Realistic order read API. The handler fetches an order with a Prisma
 * `select` projection (the columns the read path asks the DB for) and returns
 * a JSON response shaped from those columns. The fields that reach the caller
 * are exactly those on the read path: the projection's selected columns and
 * the response object's keys.
 *
 * `internalNotes` is explicitly DESELECTED (`select: { internalNotes: false }`)
 * — it is excluded, not exposed, so it must never appear as an exposure.
 */

import { prisma } from '../db.js';
import type { Request, Response } from 'express';

export async function getOrder(req: Request, res: Response): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      totalCents: true,
      status: true,
      createdAt: true,
      internalNotes: false, // excluded from the read path — never exposed
    },
  });

  if (!order) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  // The response shape exposes the customer-facing subset of the order.
  res.json({
    id: order.id,
    totalCents: order.totalCents,
    status: order.status,
  });
}

export async function listOrderSummaries(req: Request, res: Response): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { customerId: req.params.customerId },
    select: {
      id: true,
      status: true,
    },
  });
  res.json(orders);
}
