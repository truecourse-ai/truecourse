"""Customer account-status administration.

Account status (active / suspended / closed) is changed by staff through this
service. The contract `customer.suspension-reason-required-when-suspended` says
that moving an account to `suspended` requires the actor to record a
`suspension_reason` -- the reason feeds the audit trail and the customer notice.

This implementation applies the status change directly: there is NO guard
checking that a reason was supplied when the target status is `suspended`, so
the required-when rule the contract states is never enforced.
"""

from app.orm import Customer


def apply_account_status(actor, customer_id, account_status, suspension_reason=None):
    """Apply an account-status change for a customer.

    The new status is written straight through -- a suspension reason is
    accepted but never required.
    """
    # IL-DRIFT: ValidationRule:customer.suspension-reason-required-when-suspended / validation-rule.customer.suspension-reason-required-when-suspended.not-enforced
    Customer.objects.filter(id=customer_id).update(
        account_status=account_status,
        suspension_reason=suspension_reason,
    )
