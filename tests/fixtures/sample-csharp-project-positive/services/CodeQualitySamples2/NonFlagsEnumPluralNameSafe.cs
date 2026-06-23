namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A non-flags enum modelling a single choice with a singular name, plus a
/// <c>[Flags]</c> enum whose plural name is justified by combinable members.
/// Neither shape should trip the plural-name rule.
/// </summary>
public class NonFlagsEnumPluralNameSafe
{
    // SAFE: code-quality/deterministic/non-flags-enum-plural-name
    internal enum OrderStatus
    {
        Pending,
        Shipped,
    }

    [System.Flags]
    internal enum AccessRights
    {
        None = 0,
        Read = 1,
        Write = 2,
    }

    /// <summary>The current order status for this instance.</summary>
    internal OrderStatus Status { get; set; }
}
