import { randomUUID } from 'node:crypto';
import type { Customer, Order, OrderStatus } from '../types.js';
import { ordersRepo } from '../repos/orders.repo.js';
import { events } from '../events/bus.js';
import { pricingService } from './pricing.service.js';

const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  placed: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  // Spec says shipped only transitions to delivered. Allowing cancelled
  // here means a shipped order can be silently rolled back, which the
  // accounting and warehouse downstream consumers don't expect.
  // IL-DRIFT: StateMachine:Order.status / transition.illegal.shipped-to-cancelled
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export const ordersService = {
  async create(input: {
    subtotalCents: number;
    customerId: string;
    customer: Customer;
  }): Promise<Order> {
    const now = new Date().toISOString();
    const discountCents = pricingService.computeDiscountCents(
      input.subtotalCents,
      input.customer,
    );
    const taxCents = pricingService.computeTaxCents(input.subtotalCents, discountCents);
    const totalCents = pricingService.computeTotalCents(
      input.subtotalCents,
      discountCents,
      taxCents,
    );
    const order: Order = {
      id: randomUUID(),
      status: 'placed',
      subtotalCents: input.subtotalCents,
      discountCents,
      taxCents,
      totalCents,
      customerId: input.customerId,
      placedAt: now,
      updatedAt: now,
    };
    await ordersRepo.insert(order);
    return order;
  },

  async transition(
    id: string,
    target: OrderStatus,
  ): Promise<
    | { ok: true; order: Order }
    | { ok: false; reason: 'not_found' | 'illegal_transition'; current?: OrderStatus }
  > {
    const order = await ordersRepo.findById(id);
    if (!order) return { ok: false, reason: 'not_found' };
    if (!ALLOWED[order.status].includes(target)) {
      return { ok: false, reason: 'illegal_transition', current: order.status };
    }
    // Spec marks placedAt immutable after creation. Refreshing it here on
    // every transition silently destroys the original placement timestamp,
    // breaking placedAt-desc sort + audit trails.
    // IL-DRIFT: Entity:Order / field.placedAt.mutability
    order.placedAt = new Date().toISOString();
    order.status = target;
    order.updatedAt = new Date().toISOString();
    await ordersRepo.update(order);
    return { ok: true, order };
  },

  /**
   * Background lease-recovery worker. When a worker that owns an in-flight
   * transition crashes, the lease expires and another worker takes over by
   * resetting the order so it gets re-picked-up.
   */
  async recoverExpired(orderId: string): Promise<void> {
    const order = await ordersRepo.findById(orderId);
    if (!order) return;
    // No guard on current status. A delivered or cancelled order (both
    // terminal) gets dragged back into 'paid', re-running already-completed
    // work. Classic terminal-regression bug.
    // IL-DRIFT: StateMachine:Order.status / transition.unguarded-terminal-regression.to-paid
    order.status = 'paid';
    order.updatedAt = new Date().toISOString();
    await ordersRepo.resetForRecovery(order);
  },
};

export function emitOrderEvent(name: string, order: Order): void {
  events.emit(name, { id: order.id, status: order.status, at: order.updatedAt });
}
