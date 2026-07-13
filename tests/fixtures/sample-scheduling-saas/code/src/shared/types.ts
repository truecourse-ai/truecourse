export type AppointmentStatus = 'booked' | 'cancelled' | 'completed' | 'no_show';
export type AppointmentSource = 'customer' | 'agent';
export type RefundStatus = 'pending' | 'settled' | 'failed';

/** Booking app auth context — the customer id is the JWT subject (ADR 0001). */
export interface CustomerAuth {
  customerId: string;
}

/** Ops console auth context — an Okta session with one or more roles (ADR 0001). */
export interface AgentAuth {
  agentId: string;
  roles: string[];
}

/** Cursor-paginated result (used by the ops console appointment search). */
export interface PageOf<T> {
  items: T[];
  nextCursor: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      customer?: CustomerAuth;
      agent?: AgentAuth;
    }
  }
}
