import { prisma } from '../db.js';

/**
 * Customer account-status administration.
 *
 * Account status (active / suspended / closed) is changed by staff through this
 * service. The contract `customer.suspension-reason-required-when-suspended`
 * says that moving an account to `suspended` requires the actor to record a
 * `suspensionReason` — the reason feeds the audit trail and the customer notice.
 *
 * This implementation applies the status change directly: there is NO guard
 * checking that a reason was supplied when the target status is `suspended`,
 * so the required-when rule the contract states is never enforced.
 */

export interface AccountStatusChange {
  customerId: string;
  accountStatus: string;
  suspensionReason?: string;
}

/**
 * Apply an account-status change for a customer. The new status is written
 * straight through — a suspension reason is accepted but never required.
 */
export async function applyAccountStatus(
  actor: string,
  input: AccountStatusChange,
): Promise<void> {
  // IL-DRIFT: ValidationRule:customer.suspension-reason-required-when-suspended / validation-rule.customer.suspension-reason-required-when-suspended.not-enforced
  await prisma.customer.update({
    where: { id: input.customerId },
    data: {
      accountStatus: input.accountStatus,
      suspensionReason: input.suspensionReason ?? null,
    },
  });
}
