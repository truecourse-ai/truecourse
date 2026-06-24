using System.Globalization;

namespace Positive.Boundary.Bugs;

/// <summary>Formats a numeric amount with an explicit, culture-invariant provider.</summary>
public sealed class MissingFormatProviderOverloadSafe
{
    /// <summary>Renders the amount portably by passing the invariant culture.</summary>
    public string Format(decimal amount)
    {
        // SAFE: bugs/deterministic/missing-format-provider-overload
        return amount.ToString(CultureInfo.InvariantCulture);
    }
}
