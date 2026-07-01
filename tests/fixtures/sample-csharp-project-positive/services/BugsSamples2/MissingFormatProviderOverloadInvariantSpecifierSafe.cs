using System;

namespace Positive.Boundary.Bugs;

/// <summary>
/// Formats timestamps with the standard specifiers that .NET defines to always produce
/// culture-invariant output: "r"/"R" (RFC1123), "o"/"O" (round-trip), "s" (sortable),
/// "u" (universal sortable). Passing an <c>IFormatProvider</c> to these overloads changes
/// nothing, so upgrading to <c>ToString(format, provider)</c> is pointless and
/// missing-format-provider-overload must not fire.
/// </summary>
public sealed class MissingFormatProviderOverloadInvariantSpecifierSafe
{
    /// <summary>Renders an RFC1123 timestamp for an HTTP date header.</summary>
    public string ToHttpDate(DateTimeOffset when)
    {
        // SAFE: bugs/deterministic/missing-format-provider-overload
        return when.ToString("r");
    }

    /// <summary>Renders a round-trippable timestamp for serialization.</summary>
    public string ToRoundTrip(DateTime when)
    {
        // SAFE: bugs/deterministic/missing-format-provider-overload
        return when.ToString("O");
    }
}
