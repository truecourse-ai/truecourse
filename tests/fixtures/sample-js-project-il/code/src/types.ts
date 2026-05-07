export type OrderStatus = 'placed' | 'paid' | 'shipped' | 'delivered' | 'cancelled';
export type LoyaltyTier = 'standard' | 'silver' | 'gold';

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
