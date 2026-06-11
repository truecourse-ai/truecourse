from enum import Enum, auto as _auto
from typing import Literal


class AutoEnum(str, Enum):
    """Enum subclass whose member values equal the member names."""
    @staticmethod
    def _generate_next_value_(name, *args, **kwargs): return name  # type: ignore[override]
    @staticmethod
    def auto(): return _auto()


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


# FP-GUARD: enum/no-code-counterpart — must NOT drift
# Transaction isolation is expressed via an AutoEnum subclass whose member
# values are auto-derived from their names.  The verifier must lift these
# members even though the RHS is AutoEnum.auto(), not a string literal.
class TxIsolation(AutoEnum):
    OPTIMISTIC = AutoEnum.auto()
    SERIALIZABLE = AutoEnum.auto()


# Job scheduling priority.  LOW is intentionally unimplemented in this
# service — the spec declares it but the platform does not support it yet.
# IL-DRIFT: Enum:JobPriority / enum.JobPriority.missing-value.LOW
class JobPriority(str, Enum):
    HIGH = "HIGH"
    NORMAL = "NORMAL"


# FP-GUARD: enum/no-code-counterpart — must NOT drift
# Pricing strategies are modeled as module-level singletons, each an instance
# of a subclass of a common base (not an Enum). The verifier must synthesize a
# `PricingStrategy` enum from the constant NAMES so the spec's PricingStrategies
# enum has a code counterpart. STANDARD is composed from other strategies.
class PricingStrategy:
    """Base class for all pricing strategies."""

class FlatRate(PricingStrategy): ...
class Tiered(PricingStrategy): ...
class Promotional(PricingStrategy): ...

FLAT_RATE = FlatRate()
TIERED = Tiered()
PROMOTIONAL = Promotional()
STANDARD = FLAT_RATE  # alias-composed member


# FP-GUARD: enum/no-code-counterpart — must NOT drift
# Fulfilment stage subsets exposed as named sets of enum-member references
# (not string literals). The spec models `picked`/`packed` as trigger subsets of
# FulfilmentStage; the verifier must lift the member last-segments and resolve
# the set-difference for OUTSTANDING_STAGES.
class FulfilmentStage(AutoEnum):
    PICKED = AutoEnum.auto()
    PACKED = AutoEnum.auto()
    SHIPPED = AutoEnum.auto()
    DELIVERED = AutoEnum.auto()

COMPLETED_STAGES: set[FulfilmentStage] = {FulfilmentStage.SHIPPED, FulfilmentStage.DELIVERED}
OUTSTANDING_STAGES = list(set(FulfilmentStage) - COMPLETED_STAGES)
