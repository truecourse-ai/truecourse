using System.Text.Json.Serialization;

namespace SampleApi.Domain;

// Spec's OrderStatus enum is [placed, paid, shipped, delivered, cancelled].
// `archived` is an extra member not in the spec — exhaustive matches on
// OrderStatus elsewhere silently won't account for it.
// IL-DRIFT: Enum:OrderStatus / enum.OrderStatus.extra-value.archived
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum OrderStatus
{
    Placed,
    Paid,
    Shipped,
    Delivered,
    Cancelled,
    Archived,
}

// Spend tier. Spec declares [bronze, silver, gold, platinum]; the code-side enum
// is missing `platinum`, so platinum customers can't be represented.
// IL-DRIFT: Enum:CustomerTier / enum.CustomerTier.missing-value.platinum
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum CustomerTier
{
    Bronze,
    Silver,
    Gold,
}

public static class OrderStatusSets
{
    // Workflow status-classification sets. The spec models these as trigger
    // subsets of OrderStatus; both drift from it.
    //
    // `non-terminal` should be [placed, paid, shipped]; `placed` is missing here,
    // so a freshly-placed order is wrongly treated as terminal.
    // IL-DRIFT: Enum:OrderStatus / enum.OrderStatus.subset.non-terminal.missing-value.placed
    public static readonly HashSet<string> NonTerminalSet = new() { "paid", "shipped" };

    // `refundable` should be [paid, shipped]; `returned` isn't even a valid
    // OrderStatus, so this set lets a non-existent state pass a refund gate.
    // IL-DRIFT: Enum:OrderStatus / enum.OrderStatus.subset.refundable.extra-value.returned
    public static readonly HashSet<string> RefundableSet = new() { "paid", "shipped", "returned" };
}

// Spec declares a ShippingCarrier enum [ups, fedex, usps]; there is no
// corresponding code-side enum, so carrier selection is unmodeled.
// IL-DRIFT: Enum:ShippingCarrier / enum.ShippingCarrier.no-code-counterpart
