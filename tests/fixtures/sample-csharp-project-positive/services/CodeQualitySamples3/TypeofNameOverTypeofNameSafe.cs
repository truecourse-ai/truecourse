using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Reads typeof(X).FullName, which has no nameof equivalent. Only typeof(X).Name
/// is convertible to nameof(X); FullName, AssemblyQualifiedName and friends are
/// intentionally excluded, so the typeof-name-over-typeof-name check must not fire.
/// </summary>
public class TypeofNameOverTypeofNameSafe
{
    /// <summary>Returns the assembly-qualified full name of the value's type.</summary>
    public string FullTypeName(object value)
    {
        // SAFE: code-quality/deterministic/typeof-name-over-typeof-name
        return typeof(string).FullName ?? value.GetType().Name;
    }
}
