using System;

namespace Positive.Boundary.Bugs;

/// <summary>
/// Reads <see cref="System.Guid"/> identifiers from text. Guid parsing is
/// culture-invariant: its <c>IParsable</c>/<c>ISpanParsable</c> overloads accept an
/// <c>IFormatProvider</c> only to satisfy the interface and ignore it entirely, so
/// <c>Guid.Parse</c>/<c>Guid.TryParse</c> without a provider is fully portable and the
/// rule must not fire.
/// </summary>
public sealed class MissingFormatProviderOverloadGuidParseSafe
{
    /// <summary>Returns the parsed identifier, or null when the text is not a Guid.</summary>
    public Guid? TryRead(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        // SAFE: bugs/deterministic/missing-format-provider-overload
        return Guid.TryParse(text, out var parsed) ? parsed : (Guid?)null;
    }

    /// <summary>Parses a required identifier from its canonical text form.</summary>
    public Guid Read(string text)
    {
        // SAFE: bugs/deterministic/missing-format-provider-overload
        return Guid.Parse(text);
    }
}
