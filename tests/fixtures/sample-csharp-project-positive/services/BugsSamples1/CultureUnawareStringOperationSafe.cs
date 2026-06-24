using System;

namespace Positive.Boundary.Bugs;

/// <summary>
/// Normalizes a header name using the culture-explicit ToUpperInvariant overload rather
/// than the parameterless, current-culture ToUpper(), so the rule must not fire.
/// </summary>
internal sealed class CultureUnawareStringOperationSafe
{
    internal string NormalizeHeader(string header)
    {
        // SAFE: bugs/deterministic/culture-unaware-string-operation
        return header.ToUpperInvariant();
    }
}
