import { prisma } from '../db.js';
import type { LoyaltyTier } from '../types.js';

/**
 * Public customer-profile read path.
 *
 * The public profile is the customer-facing view of an account: it deliberately
 * projects only the fields a customer is allowed to see and serializes them
 * back over the API. Two cross-cutting decisions live here as code:
 *
 *   - The read PROJECTION (Prisma `select`) is the authoritative column set the
 *     profile query asks the data store for. `loyaltyTier` is part of that set,
 *     so the tier always travels on the read path — it is never silently
 *     dropped from the projection.
 *   - The API RESPONSE shape echoes the projected columns back to the caller, so
 *     `loyaltyTier` reaches the consumer rather than being read-then-discarded.
 *
 * `internalNotes` is explicitly DESELECTED — it is an internal staff field that
 * must never reach the public profile, so it is excluded from both the
 * projection and the response.
 */

export interface PublicProfile {
  id: string;
  email: string;
  loyaltyTier: LoyaltyTier;
}

/**
 * Load the public profile for a customer. The `select` projection is the
 * exposed column set; `internalNotes: false` keeps the staff-only field out.
 */
export async function readPublicProfile(id: string): Promise<PublicProfile | null> {
  const row = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      loyaltyTier: true,
      internalNotes: false,
    },
  });
  return (row as PublicProfile) ?? null;
}

/**
 * Serialize a loaded profile back to the API caller. The response shape echoes
 * the projected columns — `loyaltyTier` is exposed on this read path too.
 */
export function renderPublicProfile(
  res: { json: (body: unknown) => void },
  profile: PublicProfile,
): void {
  res.json({
    id: profile.id,
    email: profile.email,
    loyaltyTier: profile.loyaltyTier,
  });
}
