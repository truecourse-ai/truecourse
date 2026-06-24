using System;

namespace Positive.Boundary.Bugs;

/// <summary>Parses a tenant identifier from its canonical string form.</summary>
public sealed class EmptyGuidConstructorSafe
{
    /// <summary>Returns the Guid built from the supplied canonical text.</summary>
    internal Guid Parse(string canonical)
    {
        // SAFE: bugs/deterministic/empty-guid-constructor
        return new Guid(canonical);
    }
}
