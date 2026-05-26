// Spec's OrderStatus enum is [placed, paid, shipped, delivered, cancelled].
// `archived` is an extra member not in the spec — exhaustive switches on
// OrderStatus elsewhere silently won't account for it.
// IL-DRIFT: Enum:OrderStatus / enum.OrderStatus.extra-value.archived
export type OrderStatus = 'placed' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'archived';
export type LoyaltyTier = 'standard' | 'silver' | 'gold';

// Spend tier. Spec declares [bronze, silver, gold, platinum]; the code-side
// union is missing `platinum`, so platinum customers can't be represented.
// IL-DRIFT: Enum:CustomerTier / enum.CustomerTier.missing-value.platinum
export type CustomerTier = 'bronze' | 'silver' | 'gold';

// Workflow status-classification sets. The spec models these as trigger
// subsets of OrderStatus; both drift from it.
//
// `non-terminal` should be [placed, paid, shipped]. `placed` is missing
// here, so a freshly-placed order is wrongly treated as terminal by any
// consumer gated on this set.
// IL-DRIFT: Enum:OrderStatus / enum.OrderStatus.subset.non-terminal.missing-value.placed
export const NON_TERMINAL_SET = new Set(['paid', 'shipped']);

// `refundable` should be [paid, shipped]. `returned` is not even a valid
// OrderStatus, so this set lets a non-existent state pass a refund gate.
// IL-DRIFT: Enum:OrderStatus / enum.OrderStatus.subset.refundable.extra-value.returned
export const REFUNDABLE_SET = new Set(['paid', 'shipped', 'returned']);

// Spec declares a ShippingCarrier enum [ups, fedex, usps]; there is no
// corresponding code-side enum, so carrier selection is unmodeled.
// IL-DRIFT: Enum:ShippingCarrier / enum.ShippingCarrier.no-code-counterpart

export interface Order {
  id: string;
  status: OrderStatus;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  customerId: string;
  placedAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  email: string;
  name: string;
  loyaltyTier: LoyaltyTier;
  createdAt: string;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface PageOf<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AuthContext {
  userId: string;
  roles: string[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
