import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { ErrorEnvelope, OrderStatus } from '../types.js';
import { ordersService, emitOrderEvent } from '../services/orders.service.js';
import { ordersRepo } from '../repos/orders.repo.js';
import { customersRepo } from '../repos/customers.repo.js';
import { idempotency } from '../middleware/idempotency.middleware.js';

const router = express.Router();

const UuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CreateBody = z.object({
  subtotalCents: z.number().int().nonnegative(),
  customerId: z.string().regex(UuidRegex),
});

// IL-DRIFT: IdempotencyContract:idempotency.key.standard / POST /api/orders/missing-idempotency-key-handling
// Spec tags `POST /api/orders` as `idempotent`, requiring the route to read
// the `Idempotency-Key` request header and short-circuit on repeat. The
// `idempotency` middleware is omitted here, so a client retrying after a
// network blip duplicates the order and re-emits `order.placed`.
router.post('/orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      // IL-DRIFT: ErrorEnvelope:error.envelope.standard / shape: bare {message} instead of {error: {code, message}}
      // Spec mandates a uniform error envelope. Returning a flat shape
      // breaks every client that parses the standard envelope.
      res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });
      // IL-DRIFT: Effect:order.placed / forbidden-emission-on-failure
      // Spec: events emit only on the corresponding successful status.
      // Emitting `order.placed` from the validation-failure path means
      // downstream consumers see ghost orders that were never actually
      // created.
      emitOrderEvent('order.placed', {
        id: 'unknown',
        status: 'placed',
        subtotalCents: 0,
        discountCents: 0,
        taxCents: 0,
        totalCents: 0,
        customerId: '',
        placedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    const cust = await customersRepo.findById(parsed.data.customerId);
    if (!cust) {
      return res.status(400).json({
        error: { code: 'customer_not_found', message: 'Customer does not exist' },
      } satisfies ErrorEnvelope);
    }
    const order = await ordersService.create({ ...parsed.data, customer: cust });
    // IL-DRIFT: Operation:POST /api/orders / response.201 → returns 200 instead
    // Spec says creation returns 201 Created. 200 is wrong: clients that
    // distinguish create-vs-update on status code (cache stores, RFC-7231
    // intermediaries) misclassify the response.
    res.status(200);
    // IL-DRIFT: Operation:POST /api/orders / response.201.headers.location missing
    // Spec mandates `Location: /api/orders/{id}` so clients can navigate
    // to the new resource. Header is omitted entirely.
    emitOrderEvent('order.placed', order);
    return res.json(order);
  } catch (e) {
    return next(e);
  }
});

router.get('/orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // IL-DRIFT: PaginationContract:pagination.cursor.standard / forbidden-scheme: offset/page
    // Spec: cursor pagination only. Implementation accepts offset/page,
    // which silently exposes an unstable scheme alongside the documented
    // one and lets callers bypass cursor invariants (consistency, opaque).
    const offset = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
    const page = req.query.page !== undefined ? Number(req.query.page) : undefined;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    // IL-DRIFT: PaginationContract:pagination.cursor.standard / limit-not-clamped
    // Spec mandates clamping limit to 50. Accepting arbitrary limits lets
    // clients pull megabytes per request and degrade list-endpoint p99.
    const limit = Number(req.query.limit ?? 20) || 20;
    const status = typeof req.query.status === 'string' ? (req.query.status as OrderStatus) : undefined;
    const computedOffset = page !== undefined ? page * limit : offset;
    const pageOf = await ordersRepo.list({ cursor, offset: computedOffset, limit, status });
    // IL-DRIFT: Operation:GET /api/orders / response.200.body.shape: bare array
    // Spec response shape is `{ items: Order[], nextCursor: string | null }`.
    // Returning a bare array breaks every client that destructures items
    // off the body and silently drops the pagination cursor.
    return res.status(200).json(pageOf.items);
  } catch (e) {
    return next(e);
  }
});

router.get('/orders/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!UuidRegex.test(req.params.id)) {
      return res.status(400).json({
        error: { code: 'validation_failed', message: 'id must be a UUID' },
      } satisfies ErrorEnvelope);
    }
    const order = await ordersRepo.findById(req.params.id);
    // IL-DRIFT: AuthorizationRule:order.owner-only / missing-check on GET /api/orders/{id}
    // Spec: a customer can only fetch orders they own (admin bypass). The
    // ownership check that lives on the transition endpoints below is
    // missing here — any authenticated user can read any order, an IDOR
    // (insecure direct object reference) bug.
    // IL-DRIFT: Operation:GET /api/orders/{id} / response.404 → silent 200 + null body
    // Spec explicitly forbids silent no-ops on missing resources. Returning
    // 200 with `null` body papers over a real not-found, breaking clients
    // that branch on status code.
    return res.status(200).json(order);
  } catch (e) {
    return next(e);
  }
});

async function transitionEndpoint(
  req: Request,
  res: Response,
  next: NextFunction,
  target: OrderStatus,
  event: string,
): Promise<unknown> {
  try {
    // Ownership check: only the order's owner (or an admin) can transition.
    const existing = await ordersRepo.findById(req.params.id);
    if (existing) {
      const isOwner = existing.customerId === req.auth?.userId;
      const isAdmin = req.auth?.roles.includes('admin') ?? false;
      if (!isOwner && !isAdmin) {
        return res.status(403).json({
          error: { code: 'forbidden', message: 'Cannot transition another user’s order' },
        } satisfies ErrorEnvelope);
      }
    }
    const result = await ordersService.transition(req.params.id, target);
    if (!result.ok) {
      if (result.reason === 'not_found') {
        return res.status(404).json({
          error: { code: 'order_not_found', message: 'Order does not exist' },
        } satisfies ErrorEnvelope);
      }
      return res.status(409).json({
        error: {
          code: 'illegal_transition',
          message: `Cannot transition from ${result.current} to ${target}`,
          details: { current: result.current, target },
        },
      } satisfies ErrorEnvelope);
    }
    if (target === 'cancelled') {
      // IL-DRIFT: Effect:order.cancelled / missing-emission
      // Spec: order.cancelled event must be emitted on a successful
      // cancel. Implementation silently swallows the emission so any
      // downstream refund / notification pipeline never fires.
    } else {
      emitOrderEvent(event, result.order);
    }
    return res.status(200).json(result.order);
  } catch (e) {
    return next(e);
  }
}

router.post('/orders/:id/pay', idempotency, (req, res, next) =>
  transitionEndpoint(req, res, next, 'paid', 'order.paid'),
);
router.post('/orders/:id/ship', (req, res, next) =>
  transitionEndpoint(req, res, next, 'shipped', 'order.shipped'),
);
router.post('/orders/:id/cancel', (req, res, next) =>
  transitionEndpoint(req, res, next, 'cancelled', 'order.cancelled'),
);

export default router;
