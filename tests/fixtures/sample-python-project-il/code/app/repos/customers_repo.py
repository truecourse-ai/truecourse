"""Customers persistence — Django ORM over the Postgres `customers` table."""

from app.orm import Customer


def get_customer(customer_id):
    return Customer.objects.filter(id=customer_id).first()


def list_customers():
    # Spec allows listing customers in the `active` OR `pending` states.
    # This filter only admits `active`, silently hiding every pending
    # signup from the list view.
    # IL-DRIFT: QueryRule:customers-list.status-allowlist / query.predicate.value-mismatch.status.in
    return Customer.objects.filter(status__in=["active"]).order_by("-created_at")
