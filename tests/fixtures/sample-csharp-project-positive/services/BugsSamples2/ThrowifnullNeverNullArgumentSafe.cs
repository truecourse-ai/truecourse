using System;

namespace Positive.Boundary.Bugs;

/// <summary>Guards inbound request bodies before processing them.</summary>
public sealed class ThrowifnullNeverNullArgumentSafe
{
    /// <summary>Throws when the supplied body reference is null.</summary>
    internal void Validate(object body)
    {
        // SAFE: bugs/deterministic/throwifnull-never-null-argument
        ArgumentNullException.ThrowIfNull(body);
    }
}
