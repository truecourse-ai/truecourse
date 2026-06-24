using System;

namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// Grab-bag of small helpers. The file is named Helpers.cs but the type inside is
/// EmailFormatter, so the type is hard to find by file name.
/// </summary>
// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal sealed class EmailFormatter
{
    /// <summary>Builds a normalized email address from its parts.</summary>
    public string Format(string localPart, string domain)
    {
        // VIOLATION: bugs/deterministic/normalize-to-lower-not-upper
        return $"{localPart}@{domain}".ToLowerInvariant();
    }
}
