from enum import Enum
from typing import Literal


# Spec's OrderStatus enum is [placed, paid, shipped, delivered, cancelled].
# `archived` is an extra member not in the spec — exhaustive matches on
# OrderStatus elsewhere silently won't account for it.
# IL-DRIFT: Enum:OrderStatus / enum.OrderStatus.extra-value.archived
class OrderStatus(str, Enum):
    PLACED = "placed"
    PAID = "paid"
    SHIPPED = "shipped"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"
    ARCHIVED = "archived"


# Spend tier. Spec declares [bronze, silver, gold, platinum]; the code-side
# Literal is missing `platinum`, so platinum customers can't be represented.
# IL-DRIFT: Enum:CustomerTier / enum.CustomerTier.missing-value.platinum
CustomerTier = Literal["bronze", "silver", "gold"]


# Workflow status-classification sets. The spec models these as trigger
# subsets of OrderStatus; both drift from it.
#
# `non-terminal` should be [placed, paid, shipped]; `placed` is missing here,
# so a freshly-placed order is wrongly treated as terminal.
# IL-DRIFT: Enum:OrderStatus / enum.OrderStatus.subset.non-terminal.missing-value.placed
NON_TERMINAL_SET = {"paid", "shipped"}

# `refundable` should be [paid, shipped]; `returned` isn't even a valid
# OrderStatus, so this set lets a non-existent state pass a refund gate.
# IL-DRIFT: Enum:OrderStatus / enum.OrderStatus.subset.refundable.extra-value.returned
REFUNDABLE_SET = {"paid", "shipped", "returned"}

# Spec declares a ShippingCarrier enum [ups, fedex, usps]; there is no
# corresponding code-side enum, so carrier selection is unmodeled.
# IL-DRIFT: Enum:ShippingCarrier / enum.ShippingCarrier.no-code-counterpart
